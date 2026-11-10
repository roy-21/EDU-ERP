import { postgresService } from "../../database/postgres";
import { HostelError, newId, toIso, toMoney } from "../hostel/hostel.common";
import { CORE_MODULES, MODULES } from "./identity.catalog";
import { Actor, Delivery, audit, hashPassword, recordEmail, sendCredentials, temporaryPassword } from "./identity.service";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

const text = (value: unknown, label: string, max: number, required = false): string => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(400, `${label} must be text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) fail(400, `${label} is required.`);
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return result;
};

const TENANT_TYPES = ["University", "College", "School", "Madrasa", "Training Center", "Other"];
const YEARLY_MONTHS_CHARGED = 10;

// Puts the code's module list into the database. Prices set by a platform admin are kept.
export const syncModuleCatalog = async () => {
  for (const [index, module] of MODULES.entries()) {
    await postgresService.query(
      `INSERT INTO erp_modules (id, name, category, icon, monthly_price, is_core, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, icon = EXCLUDED.icon,
         is_core = EXCLUDED.is_core, sort_order = EXCLUDED.sort_order`,
      [module.id, module.name, module.category, module.icon, module.monthlyPrice, module.isCore, index]
    );
  }
};

type CatalogItem = { id: string; name: string; category: string; icon: string; monthlyPrice: number; isCore: boolean; isAvailable: boolean };

const catalog = async (includeHidden = false): Promise<CatalogItem[]> => {
  const { rows } = await postgresService.query(
    `SELECT * FROM erp_modules ${includeHidden ? "" : "WHERE is_available"} ORDER BY sort_order`
  );
  return rows.map((row: any) => ({
    id: row.id, name: row.name, category: row.category, icon: row.icon,
    monthlyPrice: toMoney(row.monthly_price), isCore: row.is_core, isAvailable: row.is_available,
  }));
};

// Prices come from the server's catalog, never from what the browser sends.
const quote = async (moduleIds: unknown, billingCycle: unknown) => {
  if (!Array.isArray(moduleIds) || moduleIds.some((item) => typeof item !== "string")) fail(400, "Choose the modules you want.");
  const cycle = billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const available = await catalog();
  const chosen = [...new Set<string>([...(moduleIds as string[]), ...CORE_MODULES])];
  const unknown = chosen.filter((id) => !available.some((item) => item.id === id));
  if (unknown.length > 0) fail(400, `This module is not offered: ${unknown[0]}.`);
  const lines = available.filter((item) => chosen.includes(item.id));
  const monthly = Math.round(lines.reduce((sum, item) => sum + item.monthlyPrice * 100, 0)) / 100;
  return {
    moduleIds: lines.map((item) => item.id),
    lines,
    billingCycle: cycle,
    monthlyTotal: monthly,
    // A yearly plan is charged for ten months.
    periodTotal: cycle === "YEARLY" ? Math.round(monthly * YEARLY_MONTHS_CHARGED * 100) / 100 : monthly,
  };
};

const tenantFromRow = (row: any) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  contactName: row.contact_name,
  contactEmail: row.contact_email,
  contactPhone: row.contact_phone,
  address: row.address,
  status: row.status,
  statusReason: row.status_reason,
  billingEnabled: row.billing_enabled,
  billingCycle: row.billing_cycle,
  users: Number(row.users ?? 0),
  modules: row.modules || [],
  pendingRequest: row.pending_request || null,
  createdAt: toIso(row.created_at),
});

const requestFromRow = (row: any) => ({
  id: row.id,
  tenantId: row.tenant_id,
  tenantName: row.tenant_name,
  tenantCode: row.tenant_code,
  kind: row.kind,
  moduleIds: row.module_ids,
  monthlyTotal: toMoney(row.monthly_total),
  billingCycle: row.billing_cycle,
  status: row.status,
  note: row.note,
  requestedBy: row.requested_by,
  decidedBy: row.decided_by,
  decidedAt: toIso(row.decided_at),
  decisionNote: row.decision_note,
  createdAt: toIso(row.created_at),
});

const TENANT_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM erp_users u WHERE u.institution_id = t.id) AS users,
    (SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('moduleId', m.module_id, 'status', m.status, 'startsOn', m.starts_on, 'endsOn', m.ends_on,
        'monthlyPrice', m.monthly_price) ORDER BY m.module_id), '[]') FROM erp_tenant_modules m WHERE m.tenant_id = t.id) AS modules,
    (SELECT ROW_TO_JSON(r) FROM (SELECT id, kind, module_ids AS "moduleIds", monthly_total AS "monthlyTotal", created_at AS "createdAt"
        FROM erp_subscription_requests s WHERE s.tenant_id = t.id AND s.status = 'PENDING') r) AS pending_request
  FROM erp_tenants t`;

const REQUEST_SELECT = `
  SELECT s.*, t.name AS tenant_name, t.code AS tenant_code
  FROM erp_subscription_requests s JOIN erp_tenants t ON t.id = s.tenant_id`;

// A simple brake on sign-ups from one address.
const registrations = new Map<string, number[]>();
const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const throttle = (address: string) => {
  const now = Date.now();
  const recent = (registrations.get(address) || []).filter((time) => now - time < REGISTRATION_WINDOW_MS);
  if (recent.length >= REGISTRATION_LIMIT) fail(429, "Too many registrations from this network. Try again later.");
  registrations.set(address, [...recent, now]);
};

export const tenancyService = {
  plans: () => catalog(),
  quote,

  // A new institution waits for approval. Its admin account exists but is off until then.
  async register(body: any, address: string) {
    const name = text(body?.institutionName, "Institution name", 255, true);
    const code = text(body?.institutionCode, "Institution code", 20, true).toUpperCase();
    if (!/^[A-Z0-9-]{2,20}$/.test(code)) fail(400, "The institution code has 2 to 20 letters, numbers or dashes.");
    const type = body?.type || "University";
    if (!TENANT_TYPES.includes(type)) fail(400, `Type must be one of: ${TENANT_TYPES.join(", ")}.`);
    const contactName = text(body?.contactName, "Contact name", 150, true);
    const email = text(body?.email, "Email", 255, true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
    const phone = text(body?.phone, "Phone", 30, true);
    if (!/^\+?[0-9 -]{6,20}$/.test(phone)) fail(400, "Enter a valid phone number.");
    const plan = await quote(body?.moduleIds, body?.billingCycle);
    throttle(address);

    const tenantId = `t-${newId()}`;
    const requestId = newId();
    const ownerId = newId();
    try {
      await postgresService.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO erp_tenants (id, code, name, type, contact_name, contact_email, contact_phone, address, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
          [tenantId, code, name, type, contactName, email, phone, text(body?.address, "Address", 500)]
        );
        await tx.query(
          `INSERT INTO erp_subscription_requests (id, tenant_id, kind, module_ids, monthly_total, billing_cycle, note, requested_by)
           VALUES ($1, $2, 'REGISTRATION', $3, $4, $5, $6, $7)`,
          [requestId, tenantId, plan.moduleIds, plan.monthlyTotal, plan.billingCycle, text(body?.note, "Note", 1000), email]
        );
        // The real password is made and emailed on approval.
        await tx.query(
          `INSERT INTO erp_users (id, institution_id, username, email, phone, full_name, password_hash, role, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, '!pending', 'ADMIN', 'INACTIVE', 'registration')`,
          [ownerId, tenantId, `admin.${code.toLowerCase()}`, email, phone, contactName]
        );
        // This account bought the subscription. It is the owner, not an operational user.
        await tx.query("UPDATE erp_tenants SET owner_user_id = $2 WHERE id = $1", [tenantId, ownerId]);
        await audit(tx, { institutionId: tenantId, userId: "", email }, "Registered", "Tenant", tenantId, `${name} (${code}) registered for ${plan.moduleIds.length} module(s).`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "This institution code or admin username is already registered.");
      throw err;
    }
    return { reference: requestId, tenantId, status: "PENDING", ...plan };
  },

  async listTenants() {
    const { rows } = await postgresService.query(`${TENANT_SELECT} ORDER BY t.created_at DESC`);
    return rows.map(tenantFromRow);
  },

  async getTenant(id: string) {
    const { rows } = await postgresService.query(`${TENANT_SELECT} WHERE t.id = $1`, [id]);
    if (!rows[0]) fail(404, "Institution not found.");
    return tenantFromRow(rows[0]);
  },

  async listRequests(status = "") {
    const { rows } = await postgresService.query(`${REQUEST_SELECT} WHERE ($1 = '' OR s.status = $1) ORDER BY s.created_at DESC LIMIT 200`, [status]);
    return rows.map(requestFromRow);
  },

  // Approval switches on the modules, and for a new institution its account and admin.
  async decide(actor: Actor, requestId: string, approve: boolean, note: unknown) {
    const decisionNote = text(note, "Note", 1000);
    if (!approve && !decisionNote) fail(400, "Give a reason for rejecting.");
    let admin: { id: string; email: string; fullName: string; username: string; tenantName: string } | null = null;
    let password = "";
    const tenantId = await postgresService.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM erp_subscription_requests WHERE id = $1 FOR UPDATE", [requestId]);
      const request = rows[0];
      if (!request) fail(404, "Request not found.");
      if (request.status !== "PENDING") fail(409, "This request was already decided.");
      const tenant = (await tx.query("SELECT * FROM erp_tenants WHERE id = $1 FOR UPDATE", [request.tenant_id])).rows[0];

      await tx.query(
        "UPDATE erp_subscription_requests SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4 WHERE id = $1",
        [requestId, approve ? "APPROVED" : "REJECTED", actor.email, decisionNote]
      );
      if (approve) {
        const prices = await tx.query("SELECT id, monthly_price FROM erp_modules WHERE id = ANY($1)", [request.module_ids]);
        for (const module of prices.rows) {
          await tx.query(
            `INSERT INTO erp_tenant_modules (tenant_id, module_id, status, starts_on, monthly_price)
             VALUES ($1, $2, 'ACTIVE', CURRENT_DATE, $3)
             ON CONFLICT (tenant_id, module_id) DO UPDATE SET status = 'ACTIVE', ends_on = NULL, monthly_price = EXCLUDED.monthly_price, updated_at = NOW()`,
            [request.tenant_id, module.id, module.monthly_price]
          );
        }
        if (request.kind === "REGISTRATION") {
          await tx.query("UPDATE erp_tenants SET status = 'ACTIVE', status_reason = '', billing_cycle = $2, billing_enabled = TRUE, updated_at = NOW() WHERE id = $1", [request.tenant_id, request.billing_cycle]);
          const user = (await tx.query(
            `SELECT u.* FROM erp_users u JOIN erp_tenants t ON t.id = u.institution_id
             WHERE u.institution_id = $1 AND u.role = 'ADMIN' ORDER BY (u.id = t.owner_user_id) DESC NULLS LAST, u.created_at LIMIT 1`,
            [request.tenant_id]
          )).rows[0];
          if (user) {
            password = temporaryPassword();
            await tx.query(
              `UPDATE erp_users SET status = 'ACTIVE', password_hash = $2, must_change_password = TRUE,
                 password_changed_at = DATE_TRUNC('second', NOW()), updated_at = NOW() WHERE id = $1`,
              [user.id, await hashPassword(password)]
            );
            admin = { id: user.id, email: user.email, fullName: user.full_name, username: user.username, tenantName: tenant.name };
          }
        }
      } else if (request.kind === "REGISTRATION") {
        await tx.query("UPDATE erp_tenants SET status = 'REJECTED', status_reason = $2, updated_at = NOW() WHERE id = $1", [request.tenant_id, decisionNote]);
      }
      await audit(tx, actor, approve ? "Approved" : "Rejected", "Subscription", requestId,
        `${approve ? "Approved" : "Rejected"} ${request.kind === "REGISTRATION" ? "registration" : "module request"} of ${tenant.name}: ${request.module_ids.join(", ")}.${decisionNote ? ` ${decisionNote}` : ""}`);
      return request.tenant_id as string;
    });

    let credentials: Delivery | null = null;
    if (admin) {
      const a = admin as { id: string; email: string; fullName: string; username: string; tenantName: string };
      credentials = await sendCredentials({ email: a.email, fullName: a.fullName, username: a.username }, password, a.tenantName, "new");
      await recordEmail({ institutionId: tenantId, userId: a.id, kind: "ADMIN_APPROVED", recipient: a.email, delivery: credentials, sentBy: actor.email });
    }
    return { tenant: await this.getTenant(tenantId), adminCredentials: credentials };
  },

  // Sends the institution admin a new temporary password, for when the approval email did not arrive.
  // The password is emailed first and saved only if the mail server accepted it.
  async resendAdminSignIn(actor: Actor, tenantId: string) {
    const tenant = await this.getTenant(tenantId);
    if (tenant.status !== "ACTIVE") fail(409, "Only an active institution's admin can get new sign-in details.");
    const { rows } = await postgresService.query(
      `SELECT u.* FROM erp_users u JOIN erp_tenants t ON t.id = u.institution_id
       WHERE u.institution_id = $1 AND u.role = 'ADMIN' AND u.status = 'ACTIVE' ORDER BY (u.id = t.owner_user_id) DESC NULLS LAST, u.created_at LIMIT 1`,
      [tenantId]
    );
    const user = rows[0];
    if (!user) fail(404, "This institution has no active admin account.");
    if (!user.email) fail(409, "The admin account has no email address.");
    const password = temporaryPassword();
    const delivery = await sendCredentials({ email: user.email, fullName: user.full_name, username: user.username }, password, tenant.name, "reset");
    await recordEmail({ institutionId: tenantId, userId: user.id, kind: "ADMIN_RESEND", recipient: user.email, delivery, sentBy: actor.email });
    if (!delivery.delivered) fail(409, `${delivery.reason} The password was not changed.`);
    await postgresService.query(
      `UPDATE erp_users SET password_hash = $2, must_change_password = TRUE, password_changed_at = DATE_TRUNC('second', NOW()),
         failed_logins = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`,
      [user.id, await hashPassword(password)]
    );
    await audit(postgresService, actor, "Password Reset", "Tenant", tenantId, `Sent new sign-in details to the admin of ${tenant.name} (${user.username}).`);
    return { delivered: true, username: user.username, email: user.email };
  },

  async setStatus(actor: Actor, id: string, status: unknown, reason: unknown) {
    if (!["ACTIVE", "SUSPENDED"].includes(status as string)) fail(400, "Status must be ACTIVE or SUSPENDED.");
    if (id === actor.institutionId) fail(403, "You cannot suspend your own institution.");
    const why = text(reason, "Reason", 500);
    if (status === "SUSPENDED" && !why) fail(400, "Give a reason for suspending.");
    const { rows } = await postgresService.query(
      "UPDATE erp_tenants SET status = $2, status_reason = $3, updated_at = NOW() WHERE id = $1 AND status IN ('ACTIVE', 'SUSPENDED') RETURNING name",
      [id, status, why]
    );
    if (!rows[0]) fail(409, "Only an active or suspended institution can change status.");
    await audit(postgresService, actor, String(status) === "ACTIVE" ? "Activated" : "Suspended", "Tenant", id, `${rows[0].name}: ${status}. ${why}`);
    return this.getTenant(id);
  },

  // Direct change by a platform admin: switch modules on or off, or set an end date.
  async setModules(actor: Actor, id: string, body: any) {
    const list = body?.modules;
    if (!Array.isArray(list)) fail(400, "Send the list of modules.");
    const known = new Set(MODULES.map((item) => item.id));
    await postgresService.transaction(async (tx) => {
      const tenant = (await tx.query("SELECT name FROM erp_tenants WHERE id = $1", [id])).rows[0];
      if (!tenant) fail(404, "Institution not found.");
      for (const item of list) {
        if (!known.has(item?.moduleId)) fail(400, `Unknown module: ${item?.moduleId}.`);
        if (!["ACTIVE", "SUSPENDED"].includes(item?.status)) fail(400, "Module status must be ACTIVE or SUSPENDED.");
        if (item.endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(item.endsOn)) fail(400, "An end date must be a date.");
        if (CORE_MODULES.includes(item.moduleId) && item.status !== "ACTIVE") fail(400, "Core modules cannot be switched off.");
        await tx.query(
          `INSERT INTO erp_tenant_modules (tenant_id, module_id, status, ends_on, monthly_price)
           VALUES ($1, $2::varchar, $3, $4::date, (SELECT monthly_price FROM erp_modules WHERE id = $2::varchar))
           ON CONFLICT (tenant_id, module_id) DO UPDATE SET status = EXCLUDED.status, ends_on = EXCLUDED.ends_on, updated_at = NOW()`,
          [id, item.moduleId, item.status, item.endsOn || null]
        );
      }
      await audit(tx, actor, "Modules", "Tenant", id, `Changed modules of ${tenant.name}: ${list.map((item: any) => `${item.moduleId} ${item.status}${item.endsOn ? ` until ${item.endsOn}` : ""}`).join(", ")}.`);
    });
    return this.getTenant(id);
  },

  async updateModulePrice(actor: Actor, moduleId: string, body: any) {
    const price = Number(body?.monthlyPrice);
    if (!Number.isFinite(price) || price < 0 || price > 10_000_000 || Math.round(price * 100) / 100 !== price) fail(400, "Price must be 0 or more, with up to 2 decimal places.");
    const { rows } = await postgresService.query(
      "UPDATE erp_modules SET monthly_price = $2, is_available = $3 WHERE id = $1 RETURNING name",
      [moduleId, price, body?.isAvailable !== false]
    );
    if (!rows[0]) fail(404, "Module not found.");
    await audit(postgresService, actor, "Pricing", "Module", moduleId, `${rows[0].name}: ${price} per month${body?.isAvailable === false ? ", hidden from sign-up" : ""}.`);
    return (await catalog(true)).find((item) => item.id === moduleId);
  },

  catalogAll: () => catalog(true),

  // The institution's own view: what it has, and asking for more.
  async mySubscription(institutionId: string) {
    const tenant = await this.getTenant(institutionId);
    const history = await postgresService.query(`${REQUEST_SELECT} WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 20`, [institutionId]);
    const { subscriptionBilling } = await import("./billing.service");
    return { tenant, catalog: await catalog(), requests: history.rows.map(requestFromRow), invoices: await subscriptionBilling.list(institutionId) };
  },

  async requestModules(actor: Actor, body: any) {
    const plan = await quote(body?.moduleIds, body?.billingCycle);
    const current = await postgresService.query(
      "SELECT module_id FROM erp_tenant_modules WHERE tenant_id = $1 AND status = 'ACTIVE' AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)",
      [actor.institutionId]
    );
    const have = new Set<string>(current.rows.map((row: any) => row.module_id));
    const wanted = plan.moduleIds.filter((id) => !have.has(id));
    if (wanted.length === 0) fail(400, "You already have every module you chose.");
    const monthly = Math.round(plan.lines.filter((item) => wanted.includes(item.id)).reduce((sum, item) => sum + item.monthlyPrice * 100, 0)) / 100;
    const id = newId();
    try {
      await postgresService.query(
        `INSERT INTO erp_subscription_requests (id, tenant_id, kind, module_ids, monthly_total, billing_cycle, note, requested_by)
         VALUES ($1, $2, 'ADD_MODULES', $3, $4, $5, $6, $7)`,
        [id, actor.institutionId, wanted, monthly, plan.billingCycle, text(body?.note, "Note", 1000), actor.email]
      );
    } catch (err: any) {
      if (err.code === "23505") fail(409, "You already have a request waiting for approval.");
      throw err;
    }
    await audit(postgresService, actor, "Requested", "Subscription", id, `Asked for ${wanted.join(", ")} (${monthly} per month).`);
    return { id, moduleIds: wanted, monthlyTotal: monthly, status: "PENDING" };
  },
};
