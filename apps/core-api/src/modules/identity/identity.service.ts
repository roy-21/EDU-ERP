import { randomInt } from "node:crypto";
import { PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { postgresService } from "../../database/postgres";
import { currentRequest } from "../../middleware/request-context";
import { HostelError, newId, toIso } from "../hostel/hostel.common";
import { isSmtpConfigured, renderEmailHtml, sendSmtpMail } from "../hostel/hostel-email.service";
import {
  ALL_PERMISSION_KEYS,
  CORE_MODULES,
  SYSTEM_ROLES,
  isSystemRole,
  keysFromLegacy,
  legacyFromKeys,
  moduleOf,
} from "./identity.catalog";

const SALT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

export type Actor = { institutionId: string; userId: string; email: string; role: string; permissions: string[] };

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalEmail = (value: unknown): string | null => {
  const email = text(value, "Email", 255).toLowerCase();
  if (email && !EMAIL.test(email)) fail(400, "Enter a valid email address.");
  return email || null;
};
const optionalPhone = (value: unknown): string | null => {
  const phone = text(value, "Phone", 30);
  if (phone && !/^\+?[0-9 -]{6,20}$/.test(phone)) fail(400, "Enter a valid phone number.");
  return phone || null;
};

// ---- Passwords and usernames ---------------------------------------------

export const hashPassword = (plain: string) => bcrypt.hash(plain, SALT_ROUNDS);

// Random from the operating system, with every character class present.
export const temporaryPassword = (): string => {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghjkmnpqrstuvwxyz", "23456789", "@#$%&!"];
  const all = sets.join("");
  const chars = [...sets.map((set) => set[randomInt(set.length)]), ...Array.from({ length: 8 }, () => all[randomInt(all.length)])];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
};

export const checkNewPassword = (password: unknown) => {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) fail(400, "The new password must be 8 to 128 characters.");
  if (!/[A-Za-z]/.test(password as string) || !/[0-9]/.test(password as string)) fail(400, "The new password needs at least one letter and one number.");
  return password as string;
};

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const usernameBase = (fullName: string) => {
  const parts = fullName.toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
  return `${parts[0] || "user"}${parts.length > 1 ? `.${parts[parts.length - 1]}` : ""}`.slice(0, 40);
};

const freeUsername = async (tx: PoolClient, wanted: string | null, fullName: string) => {
  if (wanted) {
    const taken = await tx.query("SELECT 1 FROM erp_users WHERE LOWER(username) = LOWER($1)", [wanted]);
    if (taken.rows[0]) fail(409, "This username is already taken.");
    return wanted;
  }
  const base = usernameBase(fullName);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${randomInt(10, 9999)}`;
    const taken = await tx.query("SELECT 1 FROM erp_users WHERE LOWER(username) = LOWER($1)", [candidate]);
    if (!taken.rows[0]) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
};

// ---- Credentials email ----------------------------------------------------

export type Delivery = { delivered: boolean; reason?: string };

// The temporary password goes only to the person's own inbox. It is never logged or returned.
export const sendCredentials = async (user: { email: string | null; fullName: string; username: string }, password: string, brand: string, kind: "new" | "reset"): Promise<Delivery> => {
  if (!user.email) return { delivered: false, reason: "This user has no email address." };
  if (!isSmtpConfigured()) return { delivered: false, reason: "Email is not configured on the server." };
  const loginUrl = `${(process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "")}/login`;
  const title = kind === "new" ? "Your account is ready" : "Your password was reset";
  const body = `Hello ${user.fullName},\n\nSign in with the username and temporary password below. You will be asked to choose your own password straight away.`;
  try {
    await sendSmtpMail({
      brand,
      to: user.email,
      subject: `${brand}: ${title}`,
      text: `${body}\n\nUsername: ${user.username}\nTemporary password: ${password}\nSign in: ${loginUrl}\n\nIf you did not expect this, contact your institution.`,
      html: renderEmailHtml({ brand, title, body, rows: [["Username", user.username], ["Temporary password", password]], actionUrl: loginUrl, actionLabel: "Sign In" }),
    });
    return { delivered: true };
  } catch (err: any) {
    return { delivered: false, reason: `The email could not be sent: ${err.message}` };
  }
};

// Every account email is logged, sent or not. The password itself is never stored.
export const recordEmail = async (
  input: { institutionId: string; userId: string | null; kind: string; recipient: string | null; delivery: Delivery; sentBy: string },
  db: PoolClient | typeof postgresService = postgresService
) => {
  await db.query(
    `INSERT INTO erp_email_log (id, institution_id, user_id, kind, recipient, status, error, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [newId(), input.institutionId, input.userId, input.kind, input.recipient || "", input.delivery.delivered ? "SENT" : "FAILED",
      (input.delivery.reason || "").slice(0, 500), input.sentBy || ""]
  );
  if (input.delivery.delivered && input.userId) await db.query("UPDATE erp_users SET credentials_sent_at = NOW() WHERE id = $1", [input.userId]);
};

const brandOf = async (institutionId: string) => {
  const { rows } = await postgresService.query("SELECT name FROM erp_tenants WHERE id = $1", [institutionId]);
  return rows[0]?.name || "ERP";
};

// ---- Audit ----------------------------------------------------------------

export const audit = (db: PoolClient | typeof postgresService, actor: Pick<Actor, "institutionId" | "userId" | "email">, action: string, entityType: string, entityId: string, summary: string) =>
  db.query(
    `INSERT INTO erp_audit_log (id, institution_id, actor_id, actor_email, action, entity_type, entity_id, summary, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [newId(), actor.institutionId, actor.userId, actor.email, action, entityType, entityId, summary.slice(0, 2000),
      currentRequest()?.ip || "", currentRequest()?.userAgent || ""]
  );

// ---- Permissions ----------------------------------------------------------

// Role grants plus allowed exceptions, minus denied ones, limited to what the tenant subscribes to.
export const resolvePermissions = (input: {
  role: string;
  rolePermissions: string[] | null;
  inheritsSystemRole?: string | null;
  overrides: { key: string; effect: string }[];
  modules: string[];
  extraKeys?: string[];
}) => {
  const everything = [...ALL_PERMISSION_KEYS, ...(input.extraKeys || [])];
  const system = SYSTEM_ROLES[input.role];
  const granted = new Set<string>(system ? (system.permissions === "ALL" ? everything : system.permissions) : input.rolePermissions || []);
  // A custom role built on a staff role gets that role's permissions too.
  const inherited = input.inheritsSystemRole ? SYSTEM_ROLES[input.inheritsSystemRole]?.permissions : null;
  if (!system && Array.isArray(inherited)) inherited.forEach((key) => granted.add(key));
  input.overrides.filter((item) => item.effect === "ALLOW").forEach((item) => granted.add(item.key));
  input.overrides.filter((item) => item.effect === "DENY").forEach((item) => granted.delete(item.key));
  const entitled = new Set([...CORE_MODULES, ...input.modules]);
  return [...granted].filter((key) => entitled.has(moduleOf(key))).sort();
};

const ACTIVE_MODULES = `
  SELECT COALESCE(ARRAY_AGG(module_id), '{}') FROM erp_tenant_modules tm
  WHERE tm.tenant_id = u.institution_id AND tm.status = 'ACTIVE'
    AND tm.starts_on <= CURRENT_DATE AND (tm.ends_on IS NULL OR tm.ends_on >= CURRENT_DATE)`;

// The role and every role above it: their permissions, and a built-in staff role at the top, if any.
const MAX_ROLE_DEPTH = 6;
const ROLE_CHAIN = `
  WITH RECURSIVE chain AS (
    SELECT id, parent_role_id, permissions, 1 AS depth FROM erp_roles WHERE id = u.role AND institution_id = u.institution_id
    UNION ALL
    SELECT p.id, p.parent_role_id, p.permissions, c.depth + 1
    FROM erp_roles p JOIN chain c ON p.id = c.parent_role_id AND p.institution_id = u.institution_id
    WHERE c.depth < ${MAX_ROLE_DEPTH}
  )
  SELECT JSON_BUILD_OBJECT(
    'keys', COALESCE((SELECT ARRAY_AGG(DISTINCT k) FROM chain, UNNEST(chain.permissions) k), '{}'),
    'system', (SELECT c.parent_role_id FROM chain c WHERE c.parent_role_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM erp_roles x WHERE x.id = c.parent_role_id AND x.institution_id = u.institution_id) LIMIT 1))`;

const PRINCIPAL = `
  SELECT u.*, t.status AS tenant_status, t.name AS tenant_name, r.name AS role_name,
    (${ROLE_CHAIN}) AS role_chain,
    (${ACTIVE_MODULES}) AS modules,
    (SELECT st.data->>'maintenanceMode' FROM erp_settings st WHERE st.tenant_id = u.institution_id AND st.section = 'general') AS maintenance_mode,
    (SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('key', o.permission_key, 'effect', o.effect)), '[]')
       FROM erp_user_permission_overrides o WHERE o.user_id = u.id) AS overrides,
    (SELECT COALESCE(ARRAY_AGG(f.permission_keys), '{}') FROM (
       SELECT UNNEST(ARRAY[f.module_id || '.feature.' || f.key || '.read', f.module_id || '.feature.' || f.key || '.create',
         f.module_id || '.feature.' || f.key || '.update', f.module_id || '.feature.' || f.key || '.delete']) AS permission_keys
       FROM erp_features f WHERE f.institution_id = u.institution_id AND f.status = 'PUBLISHED') f) AS feature_keys
  FROM erp_users u
  JOIN erp_tenants t ON t.id = u.institution_id
  LEFT JOIN erp_roles r ON r.id = u.role AND r.institution_id = u.institution_id`;

export type Principal = {
  userId: string;
  institutionId: string;
  role: string;
  roleName: string;
  email: string;
  username: string;
  fullName: string;
  permissions: string[];
  modules: string[];
  linkedType: string | null;
  linkedId: string | null;
  mustChangePassword: boolean;
  tenantName: string;
};

const principalFromRow = (row: any): Principal => ({
  userId: row.id,
  institutionId: row.institution_id,
  role: row.role,
  roleName: SYSTEM_ROLES[row.role]?.name || row.role_name || row.role,
  email: row.email || "",
  username: row.username,
  fullName: row.full_name,
  permissions: resolvePermissions({
    role: row.role,
    rolePermissions: row.role_chain?.keys || null,
    inheritsSystemRole: row.role_chain?.system || null,
    overrides: row.overrides,
    modules: row.modules,
    extraKeys: row.feature_keys,
  }),
  modules: [...new Set([...CORE_MODULES, ...row.modules])].sort(),
  linkedType: row.linked_type,
  linkedId: row.linked_id,
  mustChangePassword: row.must_change_password,
  tenantName: row.tenant_name,
});

// Read on every request, so a role change, override or deactivation applies at once.
export const loadPrincipal = async (userId: string, issuedAt: number): Promise<{ principal?: Principal; problem?: { status: number; message: string; code?: string } }> => {
  const { rows } = await postgresService.query(`${PRINCIPAL} WHERE u.id = $1`, [userId]);
  const row = rows[0];
  if (!row) return { problem: { status: 401, message: "This account no longer exists." } };
  if (row.status !== "ACTIVE") return { problem: { status: 401, message: "This account is disabled." } };
  if (SYSTEM_ROLES[row.role] && !SYSTEM_ROLES[row.role].canLogIn) return { problem: { status: 401, message: "This person does not have system access." } };
  if (row.tenant_status !== "ACTIVE") return { problem: { status: 403, message: "Your institution's account is not active." } };
  if (row.maintenance_mode === "true" && !ADMIN_ROLES.has(row.role)) return { problem: { status: 503, message: "The system is under maintenance. Please try again later." } };
  // A password change ends every session started before it.
  if (issuedAt < Math.floor(new Date(row.password_changed_at).getTime() / 1000)) {
    return { problem: { status: 401, message: "Your password was changed. Sign in again." } };
  }
  return { principal: principalFromRow(row) };
};

// ---- Sign in ----------------------------------------------------------------

const ALWAYS_HASH = bcrypt.hashSync("timing-equaliser", 4);

export const authenticate = async (identifier: string, password: string) => {
  const value = identifier.trim().toLowerCase();
  const { rows } = await postgresService.query(
    `${PRINCIPAL} WHERE LOWER(u.username) = $1 OR LOWER(u.email) = $1`,
    [value]
  );
  const byUsername = rows.filter((row: any) => row.username.toLowerCase() === value);
  const candidates = byUsername.length > 0 ? byUsername : rows;
  if (candidates.length > 1) fail(400, "This email is used at more than one institution. Sign in with your username.");
  const row = candidates[0];
  if (!row) {
    await bcrypt.compare(password, ALWAYS_HASH);
    fail(401, "Invalid credentials.");
  }

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60_000);
    fail(423, `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }

  const valid = row.password_hash.startsWith("$2") && (await bcrypt.compare(password, row.password_hash));
  if (!valid) {
    await postgresService.query(
      `UPDATE erp_users SET failed_logins = failed_logins + 1,
         locked_until = CASE WHEN failed_logins + 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END
       WHERE id = $1`,
      [row.id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)]
    );
    // The attempt goes on the account's own activity, so its admin can see it.
    await audit(postgresService, { institutionId: row.institution_id, userId: row.id, email: row.email || row.username }, "Sign-in Failed", "Session", row.id,
      `Wrong password for ${row.username}${row.failed_logins + 1 >= MAX_FAILED_LOGINS ? `; locked for ${LOCK_MINUTES} minutes` : ""}.`);
    fail(401, "Invalid credentials.");
  }

  if (row.status !== "ACTIVE") fail(403, row.tenant_status === "PENDING" ? "Your institution's registration is still being reviewed." : "This account is disabled.");
  if (SYSTEM_ROLES[row.role] && !SYSTEM_ROLES[row.role].canLogIn) fail(403, "This person does not have system access.");
  if (row.tenant_status !== "ACTIVE") fail(403, row.tenant_status === "PENDING" ? "Your institution's registration is still being reviewed." : "Your institution's account is not active.");
  if (row.maintenance_mode === "true" && !ADMIN_ROLES.has(row.role)) fail(503, "The system is under maintenance. Please try again later.");

  await postgresService.query("UPDATE erp_users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1", [row.id]);
  await audit(postgresService, { institutionId: row.institution_id, userId: row.id, email: row.email || row.username }, "Signed In", "Session", row.id, `${row.username} signed in.`);
  return principalFromRow(row);
};

export const changePassword = async (identifier: string, currentPassword: string, newPassword: unknown) => {
  const principal = await authenticate(identifier, currentPassword).catch((err) => {
    if (err instanceof HostelError && err.statusCode === 401) throw new HostelError(401, "Current password is incorrect.");
    throw err;
  });
  const password = checkNewPassword(newPassword);
  if (password === currentPassword) fail(400, "Choose a password different from the current one.");
  // Whole seconds, so a token issued in the same second as the change still counts as newer.
  await postgresService.query(
    `UPDATE erp_users SET password_hash = $2, must_change_password = FALSE,
       password_changed_at = DATE_TRUNC('second', NOW()), updated_at = NOW() WHERE id = $1`,
    [principal.userId, await hashPassword(password)]
  );
  await audit(postgresService, { institutionId: principal.institutionId, userId: principal.userId, email: principal.email }, "Password Changed", "User", principal.userId, `${principal.username} changed their password.`);
  return { ...principal, mustChangePassword: false };
};

// ---- Roles ----------------------------------------------------------------

// Built-in roles a custom role may build on. Admin and portal roles cannot be parents.
const PARENTABLE_SYSTEM_ROLES = ["HOSTEL_WARDEN", "ACCOUNTANT", "STOREKEEPER", "TEACHER", "STAFF"];

// Own permissions plus everything from the roles above, walking up at most MAX_ROLE_DEPTH steps.
const chainOf = (rows: any[], id: string) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const inherited = new Set<string>();
  const parents: string[] = [];
  let current = byId.get(id)?.parent_role_id || null;
  for (let depth = 0; current && depth < MAX_ROLE_DEPTH; depth += 1) {
    parents.push(current);
    const parent = byId.get(current);
    if (parent) {
      parent.permissions.forEach((key: string) => inherited.add(key));
      current = parent.parent_role_id;
    } else {
      const system = SYSTEM_ROLES[current]?.permissions;
      if (Array.isArray(system)) system.forEach((key) => inherited.add(key));
      current = null;
    }
  }
  return { inherited: [...inherited].sort(), parents };
};

const roleFromRow = (row: any, userCount = 0, rows: any[] = []) => ({
  parentRoleId: row.parent_role_id || null,
  inheritedKeys: chainOf(rows, row.id).inherited,
  effectiveKeys: [...new Set([...row.permissions, ...chainOf(rows, row.id).inherited])].sort(),
  id: row.id,
  name: row.name,
  description: row.description,
  portalType: row.portal_type,
  isSystem: false,
  isProtected: false,
  canLogIn: true,
  formId: row.form_id,
  permissionKeys: row.permissions,
  permissions: legacyFromKeys(row.permissions),
  userCount,
  createdBy: row.created_by,
  updatedAt: toIso(row.updated_at),
});

const systemRoleView = (id: string, userCount = 0) => {
  const role = SYSTEM_ROLES[id];
  const keys = role.permissions === "ALL" ? ALL_PERMISSION_KEYS : role.permissions;
  return {
    id,
    name: role.name,
    description: role.description,
    portalType: role.portalType,
    isSystem: true,
    isProtected: true,
    canLogIn: role.canLogIn,
    formId: null,
    permissionKeys: keys,
    permissions: role.permissions === "ALL" ? [{ moduleId: "all", canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true, canExport: true }] : legacyFromKeys(keys),
    userCount,
  };
};

const isAdmin = (actor: Actor) => ADMIN_ROLES.has(actor.role) || actor.role === "SERVICE_INTERNAL";

// Nobody can hand out a permission they do not hold themselves.
const assertCanGrant = (actor: Actor, keys: string[]) => {
  if (isAdmin(actor)) return;
  const held = new Set(actor.permissions);
  const missing = keys.filter((key) => !held.has(key));
  if (missing.length > 0) fail(403, `You cannot grant permissions you do not have: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}.`);
};

const featureKeys = async (institutionId: string): Promise<string[]> => {
  const { rows } = await postgresService.query(
    "SELECT module_id, key FROM erp_features WHERE institution_id = $1 AND status = 'PUBLISHED'",
    [institutionId]
  );
  return rows.flatMap((row: any) => ["read", "create", "update", "delete"].map((action) => `${row.module_id}.feature.${row.key}.${action}`));
};

const parsePermissionInput = async (institutionId: string, body: any): Promise<string[]> => {
  const valid = new Set([...ALL_PERMISSION_KEYS, ...(await featureKeys(institutionId))]);
  if (Array.isArray(body?.permissionKeys)) {
    const keys = [...new Set<string>(body.permissionKeys.filter((key: unknown) => typeof key === "string"))];
    const unknown = keys.filter((key) => !valid.has(key));
    if (unknown.length > 0) fail(400, `Unknown permission: ${unknown[0]}.`);
    return keys.sort();
  }
  return keysFromLegacy(body?.permissions || []).filter((key) => valid.has(key)).sort();
};

const PORTALS = ["ADMIN", "STAFF", "TEACHER", "STUDENT", "GUARDIAN"];

const userCounts = async (institutionId: string) => {
  const { rows } = await postgresService.query("SELECT role, COUNT(*)::int AS count FROM erp_users WHERE institution_id = $1 GROUP BY role", [institutionId]);
  return Object.fromEntries(rows.map((row: any) => [row.role, row.count]));
};

// The roles of a tenant, for working out inherited permissions.
const tenantRoles = async (institutionId: string) =>
  (await postgresService.query("SELECT * FROM erp_roles WHERE institution_id = $1", [institutionId])).rows;

export const effectiveRoleKeys = async (institutionId: string, roleId: string): Promise<string[] | null> => {
  const rows = await tenantRoles(institutionId);
  const role = rows.find((row: any) => row.id === roleId);
  if (!role) return null;
  return [...new Set([...role.permissions, ...chainOf(rows, roleId).inherited])];
};

// A parent must exist, must not create a loop, and must not give the actor's role more than they hold.
const checkParent = async (actor: Actor, roleId: string | null, parent: unknown) => {
  if (parent === undefined) return undefined;
  if (parent === null || parent === "") return null;
  if (typeof parent !== "string") fail(400, "Choose a parent role.");
  const parentId = parent as string;
  if (isSystemRole(parentId)) {
    if (!PARENTABLE_SYSTEM_ROLES.includes(parentId)) fail(400, `A role can only build on: ${PARENTABLE_SYSTEM_ROLES.map((id) => SYSTEM_ROLES[id].name).join(", ")}, or a custom role.`);
    assertCanGrant(actor, SYSTEM_ROLES[parentId].permissions as string[]);
    return parentId;
  }
  const rows = await tenantRoles(actor.institutionId);
  const target = rows.find((row: any) => row.id === parentId);
  if (!target) fail(400, "The parent role does not exist in your institution.");
  if (roleId && (parentId === roleId || chainOf(rows, parentId).parents.includes(roleId))) fail(409, "This would make a loop: a role cannot sit above itself.");
  if (chainOf(rows, parentId).parents.length >= MAX_ROLE_DEPTH - 1) fail(409, `Roles can be at most ${MAX_ROLE_DEPTH} levels deep.`);
  assertCanGrant(actor, [...target.permissions, ...chainOf(rows, parentId).inherited]);
  return parentId;
};

// ---- Registration forms of roles -----------------------------------------

// The form a role registers its users with. Custom roles keep it on the role; built-in roles in erp_role_forms.
export const roleFormId = async (institutionId: string, role: string): Promise<string | null> => {
  const { rows } = await postgresService.query(
    `SELECT form_id FROM erp_roles WHERE institution_id = $1 AND id = $2 AND form_id IS NOT NULL
     UNION ALL SELECT form_id FROM erp_role_forms WHERE institution_id = $1 AND role_id = $2`,
    [institutionId, role]
  );
  return rows[0]?.form_id || null;
};

const systemRoleForms = async (institutionId: string): Promise<Record<string, string>> => {
  const { rows } = await postgresService.query("SELECT role_id, form_id FROM erp_role_forms WHERE institution_id = $1", [institutionId]);
  return Object.fromEntries(rows.map((row: any) => [row.role_id, row.form_id]));
};

// Only a published user-profile form of the same institution can be a role's form.
const checkProfileForm = async (institutionId: string, formId: unknown): Promise<string | null> => {
  if (formId === null || formId === undefined || formId === "") return null;
  if (typeof formId !== "string") fail(400, "Choose a form.");
  const { rows } = await postgresService.query("SELECT title, purpose, status FROM erp_forms WHERE institution_id = $1 AND id = $2", [institutionId, formId]);
  const form = rows[0];
  if (!form) fail(400, "The form does not exist in your institution.");
  if (form.purpose !== "USER_PROFILE") fail(400, `"${form.title}" is not a user profile form. Make one with the purpose "User profile" in the Form Builder.`);
  if (form.status !== "PUBLISHED") fail(400, `Publish "${form.title}" before giving it to a role.`);
  return formId as string;
};

// Which form fields fill the account itself: the name, the email the sign-in details go to, and the phone.
const NAME_FIELD_IDS = ["full_name", "fullname", "name"];
export const accountFieldMap = (fields: { id: string; type: string; label: string }[]) => ({
  fullName: fields.find((field) => field.type === "text" && (NAME_FIELD_IDS.includes(field.id) || /^(full\s*)?name$/i.test(field.label.trim())))?.id || null,
  email: fields.find((field) => field.type === "email")?.id || null,
  phone: fields.find((field) => field.type === "phone")?.id || null,
});

const roleNameOf = async (institutionId: string, role: string): Promise<string | null> => {
  if (SYSTEM_ROLES[role]) return SYSTEM_ROLES[role].name;
  const { rows } = await postgresService.query("SELECT name FROM erp_roles WHERE institution_id = $1 AND id = $2", [institutionId, role]);
  return rows[0]?.name || null;
};

export const rolesService = {
  async list(institutionId: string) {
    const [custom, counts, forms] = await Promise.all([
      postgresService.query("SELECT * FROM erp_roles WHERE institution_id = $1 ORDER BY name", [institutionId]),
      userCounts(institutionId),
      systemRoleForms(institutionId),
    ]);
    return [
      ...Object.keys(SYSTEM_ROLES).map((id) => ({ ...systemRoleView(id, counts[id] || 0), formId: forms[id] || null })),
      ...custom.rows.map((row: any) => roleFromRow(row, counts[row.id] || 0, custom.rows)),
    ];
  },

  async create(actor: Actor, body: any) {
    const name = text(body?.name, "Role name", 100, true);
    if (Object.values(SYSTEM_ROLES).some((role) => role.name.toLowerCase() === name.toLowerCase()) || isSystemRole(name.toUpperCase())) {
      fail(409, "This name belongs to a built-in role.");
    }
    const portalType = body?.portalType || "STAFF";
    if (!PORTALS.includes(portalType)) fail(400, `Portal must be one of: ${PORTALS.join(", ")}.`);
    const keys = await parsePermissionInput(actor.institutionId, body);
    assertCanGrant(actor, keys);
    const parent = (await checkParent(actor, null, body?.parentRoleId)) ?? null;
    const formId = await checkProfileForm(actor.institutionId, body?.formId);
    const id = `role-${newId()}`;
    try {
      await postgresService.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO erp_roles (id, institution_id, name, description, portal_type, permissions, form_id, created_by, parent_role_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, actor.institutionId, name, text(body?.description, "Description", 500), portalType, keys, formId, actor.email, parent]
        );
        await audit(tx, actor, "Created", "Role", id, `Created role ${name} with ${keys.length} permission(s)${parent ? `, building on ${parent}` : ""}.`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "A role with this name already exists.");
      throw err;
    }
    return (await this.list(actor.institutionId)).find((role) => role.id === id);
  },

  async update(actor: Actor, id: string, body: any) {
    if (isSystemRole(id)) fail(403, "Built-in roles cannot be changed. Clone it into a custom role instead.");
    const { rows } = await postgresService.query("SELECT * FROM erp_roles WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
    const current = rows[0];
    if (!current) fail(404, "Role not found.");
    const name = body?.name === undefined ? current.name : text(body.name, "Role name", 100, true);
    const keys = body?.permissions === undefined && body?.permissionKeys === undefined ? current.permissions : await parsePermissionInput(actor.institutionId, body);
    const added = keys.filter((key: string) => !current.permissions.includes(key));
    assertCanGrant(actor, added);
    const portalType = body?.portalType ?? current.portal_type;
    if (!PORTALS.includes(portalType)) fail(400, `Portal must be one of: ${PORTALS.join(", ")}.`);
    const checked = await checkParent(actor, id, body?.parentRoleId);
    const parent = checked === undefined ? current.parent_role_id : checked;
    const formId = body?.formId === undefined || (body.formId || null) === current.form_id ? current.form_id : await checkProfileForm(actor.institutionId, body.formId);
    try {
      await postgresService.transaction(async (tx) => {
        await tx.query(
          `UPDATE erp_roles SET name = $3, description = $4, portal_type = $5, permissions = $6, form_id = $7, parent_role_id = $8, updated_at = NOW()
           WHERE institution_id = $1 AND id = $2`,
          [actor.institutionId, id, name, body?.description === undefined ? current.description : text(body.description, "Description", 500),
            portalType, keys, formId, parent]
        );
        if (parent !== current.parent_role_id) await audit(tx, actor, "Updated", "Role", id, `Role ${name} now builds on ${parent || "nothing"} (was ${current.parent_role_id || "nothing"}).`);
        const removed = current.permissions.filter((key: string) => !keys.includes(key));
        await audit(tx, actor, "Updated", "Role", id, `Updated role ${name}. Added: ${added.join(", ") || "none"}. Removed: ${removed.join(", ") || "none"}.`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "A role with this name already exists.");
      throw err;
    }
    return (await this.list(actor.institutionId)).find((role) => role.id === id);
  },

  async clone(actor: Actor, id: string, body: any) {
    const source = (await this.list(actor.institutionId)).find((role) => role.id === id);
    if (!source) fail(404, "Role not found.");
    if (source!.id === "NOT_SYSTEM_USER") fail(400, "This role has no permissions to copy.");
    return this.create(actor, {
      name: body?.name || `${source!.name} (copy)`,
      description: source!.description,
      portalType: source!.portalType === "NONE" ? "STAFF" : source!.portalType,
      permissionKeys: source!.permissionKeys,
      parentRoleId: (source as any).parentRoleId || undefined,
    });
  },

  // Gives a role, built-in or custom, the form its new users are registered with. null removes it.
  async setForm(actor: Actor, id: string, formIdInput: unknown) {
    if (id === "SUPER_ADMIN") fail(403, "The super admin role has no registration form.");
    const roleName = await roleNameOf(actor.institutionId, id);
    if (!roleName) fail(404, "Role not found.");
    const formId = await checkProfileForm(actor.institutionId, formIdInput);
    await postgresService.transaction(async (tx) => {
      if (isSystemRole(id)) {
        if (formId) {
          await tx.query(
            `INSERT INTO erp_role_forms (institution_id, role_id, form_id, updated_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (institution_id, role_id) DO UPDATE SET form_id = EXCLUDED.form_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [actor.institutionId, id, formId, actor.email]
          );
        } else {
          await tx.query("DELETE FROM erp_role_forms WHERE institution_id = $1 AND role_id = $2", [actor.institutionId, id]);
        }
      } else {
        await tx.query("UPDATE erp_roles SET form_id = $3, updated_at = NOW() WHERE institution_id = $1 AND id = $2", [actor.institutionId, id, formId]);
      }
      await audit(tx, actor, "Updated", "Role", id, formId ? `Role ${roleName} now registers users with form ${formId}.` : `Role ${roleName} no longer has a registration form.`);
    });
    return (await this.list(actor.institutionId)).find((role: any) => role.id === id);
  },

  // The form to fill when adding a user with this role, and which of its fields make the account.
  async registrationForm(institutionId: string, id: string) {
    const roleName = await roleNameOf(institutionId, id);
    if (!roleName) fail(404, "Role not found.");
    const base = { roleId: id, roleName, canLogIn: !(SYSTEM_ROLES[id] && !SYSTEM_ROLES[id].canLogIn) };
    const formId = await roleFormId(institutionId, id);
    if (!formId) return { ...base, form: null, accountFields: null, problem: `No registration form is assigned to the ${roleName} role.` };
    const { formsService } = await import("../forms/forms.service");
    const meta = await formsService.get(institutionId, formId);
    try {
      const published = await formsService.publishedFields(institutionId, formId);
      return {
        ...base,
        form: { id: meta.id, title: meta.title, description: meta.description, version: published.version, fields: published.fields },
        accountFields: accountFieldMap(published.fields),
        problem: null,
      };
    } catch (err) {
      if (err instanceof HostelError && err.statusCode === 409) return { ...base, form: null, accountFields: null, problem: `The ${roleName} role's form "${meta.title}" is not published.` };
      throw err;
    }
  },

  async remove(actor: Actor, id: string) {
    if (isSystemRole(id)) fail(403, "Built-in roles cannot be deleted.");
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM erp_roles WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Role not found.");
      const users = await tx.query("SELECT COUNT(*)::int AS count FROM erp_users WHERE institution_id = $1 AND role = $2", [actor.institutionId, id]);
      if (users.rows[0].count > 0) fail(409, `${users.rows[0].count} user(s) still have this role. Move them to another role first.`);
      const children = await tx.query("SELECT name FROM erp_roles WHERE institution_id = $1 AND parent_role_id = $2", [actor.institutionId, id]);
      if (children.rows[0]) fail(409, `Other roles build on this one: ${children.rows.map((row: any) => row.name).join(", ")}. Change them first.`);
      await tx.query("DELETE FROM erp_roles WHERE id = $1", [id]);
      await audit(tx, actor, "Deleted", "Role", id, `Deleted role ${rows[0].name}.`);
      return { id, deleted: true };
    });
  },
};

// ---- Users ----------------------------------------------------------------

const userFromRow = (row: any) => ({
  id: row.id,
  username: row.username,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  roleName: SYSTEM_ROLES[row.role]?.name || row.role_name || row.role,
  status: row.status,
  canLogIn: !(SYSTEM_ROLES[row.role] && !SYSTEM_ROLES[row.role].canLogIn),
  mustChangePassword: row.must_change_password,
  linkedType: row.linked_type,
  linkedId: row.linked_id,
  profile: row.profile,
  isLocked: Boolean(row.locked_until && new Date(row.locked_until) > new Date()),
  isOwner: row.is_owner === true,
  credentialsSentAt: toIso(row.credentials_sent_at),
  lastLoginAt: toIso(row.last_login_at),
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
});

const USER_SELECT = `
  SELECT u.*, r.name AS role_name, (t.owner_user_id IS NOT NULL AND t.owner_user_id = u.id) AS is_owner
  FROM erp_users u
  JOIN erp_tenants t ON t.id = u.institution_id
  LEFT JOIN erp_roles r ON r.id = u.role AND r.institution_id = u.institution_id`;

// The subscription owner's account is managed by the owner alone.
const assertNotOwner = (actor: Actor, user: { id: string; isOwner: boolean }, what: string) => {
  if (user.isOwner && actor.userId !== user.id) fail(403, `This is the subscription owner's account. Nobody else can ${what} it.`);
};

const entitledModules = async (institutionId: string) => {
  const { rows } = await postgresService.query(
    `SELECT module_id FROM erp_tenant_modules WHERE tenant_id = $1 AND status = 'ACTIVE'
       AND starts_on <= CURRENT_DATE AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)`,
    [institutionId]
  );
  return new Set<string>([...CORE_MODULES, ...rows.map((row: any) => row.module_id)]);
};

const LINK_TYPES = ["STUDENT", "TEACHER", "STAFF", "GUARDIAN"];

const assertAssignableRole = async (actor: Actor, role: string) => {
  if (role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") fail(403, "Only a super admin can create another super admin.");
  if (role === "ADMIN" && !isAdmin(actor)) fail(403, "Only an admin can make someone an admin.");
  if (isSystemRole(role)) {
    const keys = SYSTEM_ROLES[role].permissions;
    if (keys !== "ALL") assertCanGrant(actor, keys);
    return;
  }
  const keys = await effectiveRoleKeys(actor.institutionId, role);
  if (!keys) fail(400, "Choose a role that exists in your institution.");
  assertCanGrant(actor, keys as string[]);
};

// A role can carry a form. Its answers are checked here and kept on the user.
const validateProfile = async (institutionId: string, role: string, profile: unknown) => {
  const formId = await roleFormId(institutionId, role);
  if (!formId) return typeof profile === "object" && profile ? profile : {};
  const { formsService } = await import("../forms/forms.service");
  return formsService.validateAgainstPublished(institutionId, formId, profile);
};

const parseLink = (body: any) => {
  const linkedType = body?.linkedType ? text(body.linkedType, "Record type", 30) : null;
  if (linkedType && !LINK_TYPES.includes(linkedType)) fail(400, `Record type must be one of: ${LINK_TYPES.join(", ")}.`);
  const linkedId = linkedType ? text(body?.linkedId, "Record ID", 64, true) : null;
  return { linkedType, linkedId };
};

const parseWantedUsername = (value: unknown) => {
  const wanted = text(value, "Username", 50).toLowerCase() || null;
  if (wanted && !USERNAME.test(wanted)) fail(400, "A username has 3 to 50 lowercase letters, numbers, dots, dashes or underscores.");
  return wanted;
};

export const usersService = {
  // The operational users. The subscription owner is left out unless asked for.
  async list(institutionId: string, filters: { search?: string; role?: string; status?: string; includeOwner?: boolean }) {
    const { rows } = await postgresService.query(
      `${USER_SELECT}
       WHERE u.institution_id = $1
         AND ($2 = '' OR u.full_name ILIKE '%' || $2 || '%' OR u.username ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%' OR u.phone ILIKE '%' || $2 || '%')
         AND ($3 = '' OR u.role = $3) AND ($4 = '' OR u.status = $4)
         AND ($5 OR t.owner_user_id IS DISTINCT FROM u.id)
       ORDER BY u.created_at DESC LIMIT 500`,
      [institutionId, filters.search?.trim() || "", filters.role || "", filters.status || "", filters.includeOwner === true]
    );
    return rows.map(userFromRow);
  },

  async owner(institutionId: string) {
    const { rows } = await postgresService.query(`${USER_SELECT} WHERE u.institution_id = $1 AND t.owner_user_id = u.id`, [institutionId]);
    if (!rows[0]) return null;
    const user = userFromRow(rows[0]);
    return { id: user.id, fullName: user.fullName, username: user.username, email: user.email, status: user.status, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt };
  },

  // One user with their registration answers (and the fields to label them) and their account emails.
  async details(institutionId: string, id: string) {
    const user = await this.get(institutionId, id);
    const submitted = await postgresService.query(
      `SELECT v.fields FROM erp_form_submissions s JOIN erp_form_versions v ON v.form_id = s.form_id AND v.version = s.version
       WHERE s.institution_id = $1 AND s.user_id = $2 ORDER BY s.created_at DESC LIMIT 1`,
      [institutionId, id]
    );
    let profileFields: unknown[] = submitted.rows[0]?.fields || [];
    const formId = submitted.rows[0] ? null : await roleFormId(institutionId, user.role);
    if (formId) {
      const { formsService } = await import("../forms/forms.service");
      profileFields = await formsService.publishedFields(institutionId, formId).then((form) => form.fields).catch(() => []);
    }
    const emails = await postgresService.query(
      "SELECT kind, recipient, status, error, sent_by, created_at FROM erp_email_log WHERE institution_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 20",
      [institutionId, id]
    );
    return {
      ...user,
      profileFields,
      emails: emails.rows.map((row: any) => ({ kind: row.kind, recipient: row.recipient, status: row.status, error: row.error, sentBy: row.sent_by, createdAt: toIso(row.created_at) })),
    };
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${USER_SELECT} WHERE u.institution_id = $1 AND u.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "User not found.");
    return userFromRow(rows[0]);
  },

  // Finds a person who already has an account, so nobody gets two.
  async lookup(institutionId: string, query: { email?: string; phone?: string; linkedType?: string; linkedId?: string }) {
    const email = query.email?.trim().toLowerCase() || "";
    const phone = query.phone?.trim() || "";
    const linkedId = query.linkedId?.trim() || "";
    if (!email && !phone && !linkedId) return [];
    const { rows } = await postgresService.query(
      `${USER_SELECT} WHERE u.institution_id = $1 AND (
         ($2 <> '' AND LOWER(u.email) = $2) OR ($3 <> '' AND u.phone = $3) OR ($5 <> '' AND u.linked_type = $4 AND u.linked_id = $5))`,
      [institutionId, email, phone, query.linkedType || "", linkedId]
    );
    return rows.map((row: any) => {
      const user = userFromRow(row);
      return {
        ...user,
        matchedOn: [
          email && row.email?.toLowerCase() === email ? "email" : "",
          phone && row.phone === phone ? "phone" : "",
          linkedId && row.linked_id === linkedId ? "record" : "",
        ].filter(Boolean),
      };
    });
  },

  async create(actor: Actor, body: any) {
    const fullName = text(body?.fullName, "Full name", 150, true);
    const email = optionalEmail(body?.email);
    const phone = optionalPhone(body?.phone);
    const role = text(body?.role, "Role", 64, true);
    const wanted = parseWantedUsername(body?.username);
    const { linkedType, linkedId } = parseLink(body);
    await assertAssignableRole(actor, role);
    const profile = await validateProfile(actor.institutionId, role, body?.profile);
    await this.assertNoDuplicate(actor.institutionId, { email, phone, linkedType, linkedId });

    const canLogIn = !(SYSTEM_ROLES[role] && !SYSTEM_ROLES[role].canLogIn);
    const password = canLogIn ? temporaryPassword() : "";
    // Someone who cannot sign in gets a hash nothing can match.
    const passwordHash = canLogIn ? await hashPassword(password) : "!no-login";
    const id = newId();
    let username = "";
    try {
      await postgresService.transaction(async (tx) => {
        username = await freeUsername(tx, wanted, fullName);
        await tx.query(
          `INSERT INTO erp_users (id, institution_id, username, email, phone, full_name, password_hash, role, must_change_password,
             linked_type, linked_id, profile, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, actor.institutionId, username, email, phone, fullName, passwordHash, role, canLogIn, linkedType, linkedId, JSON.stringify(profile), actor.email]
        );
        await audit(tx, actor, "Created", "User", id, `Created ${username} (${fullName}) as ${SYSTEM_ROLES[role]?.name || role}.`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "A user with this username, email or record already exists.");
      throw err;
    }
    const credentials: Delivery = canLogIn
      ? await sendCredentials({ email, fullName, username }, password, await brandOf(actor.institutionId), "new")
      : { delivered: false, reason: "This person cannot sign in, so no password was made." };
    if (canLogIn && email) await recordEmail({ institutionId: actor.institutionId, userId: id, kind: "ACCOUNT_CREATED", recipient: email, delivery: credentials, sentBy: actor.email });
    return { user: await this.get(actor.institutionId, id), credentials };
  },

  async assertNoDuplicate(institutionId: string, who: { email: string | null; phone: string | null; linkedType: string | null; linkedId: string | null }) {
    const existing = await this.lookup(institutionId, { email: who.email || "", phone: who.phone || "", linkedType: who.linkedType || "", linkedId: who.linkedId || "" });
    if (existing.length > 0) {
      const error: any = new HostelError(409, `${existing[0].fullName} (${existing[0].username}) already has an account with the same ${existing[0].matchedOn.join(" and ")}.`);
      error.details = { existing };
      throw error;
    }
  },

  // Role first: the role's own registration form is filled, then the account is made.
  // The sign-in email is sent before the account is committed, so a failed email leaves nothing
  // behind and the same form can simply be submitted again.
  async register(actor: Actor, body: any) {
    const role = text(body?.role, "Role", 64, true);
    await assertAssignableRole(actor, role);
    const roleName = (await roleNameOf(actor.institutionId, role)) as string;
    const formId = await roleFormId(actor.institutionId, role);
    if (!formId) fail(409, `No registration form is assigned to the ${roleName} role. Assign one on the Roles page first.`);
    const { formsService, validateAnswers } = await import("../forms/forms.service");
    const { version, fields } = await formsService.publishedFields(actor.institutionId, formId as string);
    const answers = validateAnswers(fields, body?.answers);
    const map = accountFieldMap(fields);
    const pick = (fieldId: string | null, fallback: unknown) => (fieldId && answers[fieldId] !== undefined && answers[fieldId] !== "" ? answers[fieldId] : fallback);
    const fullName = text(pick(map.fullName, body?.fullName), "Full name", 150, true);
    const email = optionalEmail(pick(map.email, body?.email));
    const phone = optionalPhone(pick(map.phone, body?.phone));
    const wanted = parseWantedUsername(body?.username);
    const { linkedType, linkedId } = parseLink(body);
    const canLogIn = !(SYSTEM_ROLES[role] && !SYSTEM_ROLES[role].canLogIn);
    if (canLogIn && !email) fail(400, "An email address is needed: the sign-in details are sent there.");
    await this.assertNoDuplicate(actor.institutionId, { email, phone, linkedType, linkedId });

    const password = canLogIn ? temporaryPassword() : "";
    const passwordHash = canLogIn ? await hashPassword(password) : "!no-login";
    const brand = await brandOf(actor.institutionId);
    const id = newId();
    let username = "";
    let delivery: Delivery = { delivered: false, reason: "This person cannot sign in, so no password was made." };
    let attempted = false;
    try {
      await postgresService.transaction(async (tx) => {
        username = await freeUsername(tx, wanted, fullName);
        await tx.query(
          `INSERT INTO erp_users (id, institution_id, username, email, phone, full_name, password_hash, role, must_change_password,
             linked_type, linked_id, profile, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, actor.institutionId, username, email, phone, fullName, passwordHash, role, canLogIn, linkedType, linkedId, JSON.stringify(answers), actor.email]
        );
        await tx.query(
          "INSERT INTO erp_form_submissions (id, institution_id, form_id, version, data, submitted_by, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [newId(), actor.institutionId, formId, version, JSON.stringify(answers), actor.email || actor.userId, id]
        );
        await audit(tx, actor, "Created", "User", id, `Registered ${username} (${fullName}) as ${roleName} with form ${formId} v${version}.`);
        if (canLogIn) {
          attempted = true;
          delivery = await sendCredentials({ email, fullName, username }, password, brand, "new");
          if (!delivery.delivered) fail(409, `${delivery.reason} No account was created. Fix the problem and submit again.`);
        }
      });
    } catch (err: any) {
      if (attempted && !delivery.delivered) {
        await recordEmail({ institutionId: actor.institutionId, userId: null, kind: "ACCOUNT_CREATED", recipient: email, delivery, sentBy: actor.email });
      }
      if (err.code === "23505") fail(409, "A user with this username, email or record already exists.");
      throw err;
    }
    if (canLogIn) await recordEmail({ institutionId: actor.institutionId, userId: id, kind: "ACCOUNT_CREATED", recipient: email, delivery, sentBy: actor.email });
    return { user: await this.get(actor.institutionId, id), credentials: delivery };
  },

  // Deletes an account and what was kept only for it: overrides, guardian links, registration answers, email log.
  async remove(actor: Actor, id: string) {
    if (id === actor.userId) fail(403, "You cannot delete your own account.");
    const user = await this.get(actor.institutionId, id);
    if (user.isOwner) fail(403, "The subscription owner's account cannot be deleted.");
    await assertAssignableRole(actor, user.role);
    await postgresService.transaction(async (tx) => {
      await tx.query("DELETE FROM erp_email_log WHERE institution_id = $1 AND user_id = $2", [actor.institutionId, id]);
      await tx.query("DELETE FROM erp_users WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
      await audit(tx, actor, "Deleted", "User", id, `Deleted ${user.username} (${user.fullName}), who was ${user.roleName}.`);
    });
    return { id, deleted: true };
  },

  async update(actor: Actor, id: string, body: any) {
    const current = await this.get(actor.institutionId, id);
    assertNotOwner(actor, current, "change");
    if (id === actor.userId && ((body?.role && body.role !== current.role) || (body?.status && body.status !== current.status))) {
      fail(403, "You cannot change your own role or status.");
    }
    if (current.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") fail(403, "Only a super admin can change a super admin.");
    const role = body?.role === undefined ? current.role : text(body.role, "Role", 64, true);
    if (role !== current.role) await assertAssignableRole(actor, role);
    const status = body?.status ?? current.status;
    if (!["ACTIVE", "INACTIVE"].includes(status)) fail(400, "Status must be ACTIVE or INACTIVE.");
    const email = body?.email === undefined ? current.email : optionalEmail(body.email);
    const phone = body?.phone === undefined ? current.phone : optionalPhone(body.phone);
    const fullName = body?.fullName === undefined ? current.fullName : text(body.fullName, "Full name", 150, true);
    const profile = body?.profile === undefined ? current.profile : await validateProfile(actor.institutionId, role, body.profile);
    try {
      await postgresService.transaction(async (tx) => {
        await tx.query(
          `UPDATE erp_users SET full_name = $3, email = $4, phone = $5, role = $6, status = $7, profile = $8,
             failed_logins = CASE WHEN $9 THEN 0 ELSE failed_logins END,
             locked_until = CASE WHEN $9 THEN NULL ELSE locked_until END, updated_at = NOW()
           WHERE institution_id = $1 AND id = $2`,
          [actor.institutionId, id, fullName, email, phone, role, status, JSON.stringify(profile), body?.unlock === true]
        );
        const changes = [
          fullName !== current.fullName && "name",
          email !== current.email && "email",
          phone !== current.phone && "phone",
          role !== current.role && `role ${current.role} to ${role}`,
          status !== current.status && `status ${current.status} to ${status}`,
          body?.unlock === true && "unlocked",
        ].filter(Boolean);
        await audit(tx, actor, "Updated", "User", id, `Updated ${current.username}: ${changes.join(", ") || "profile"}.`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "Another user already has this email.");
      throw err;
    }
    return this.get(actor.institutionId, id);
  },

  // The new password is emailed first and saved only if the email went out.
  async resetPassword(actor: Actor, id: string) {
    const user = await this.get(actor.institutionId, id);
    assertNotOwner(actor, user, "reset the password of");
    if (!user.canLogIn) fail(409, "This person cannot sign in.");
    if (user.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") fail(403, "Only a super admin can reset a super admin.");
    const password = temporaryPassword();
    const neverSent = !user.credentialsSentAt;
    const delivery = await sendCredentials(user, password, await brandOf(actor.institutionId), neverSent ? "new" : "reset");
    await recordEmail({ institutionId: actor.institutionId, userId: id, kind: neverSent ? "ACCOUNT_CREATED" : "PASSWORD_RESET", recipient: user.email, delivery, sentBy: actor.email });
    if (!delivery.delivered) fail(409, `${delivery.reason} The password was not changed.`);
    await postgresService.query(
      `UPDATE erp_users SET password_hash = $3, must_change_password = TRUE, password_changed_at = DATE_TRUNC('second', NOW()),
         failed_logins = 0, locked_until = NULL, updated_at = NOW() WHERE institution_id = $1 AND id = $2`,
      [actor.institutionId, id, await hashPassword(password)]
    );
    await audit(postgresService, actor, "Password Reset", "User", id, `Sent a new temporary password to ${user.username}.`);
    return { delivered: true };
  },

  async permissions(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${PRINCIPAL} WHERE u.institution_id = $1 AND u.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "User not found.");
    const row = rows[0];
    const overrides = await postgresService.query(
      "SELECT permission_key, effect, reason, created_by, created_at FROM erp_user_permission_overrides WHERE user_id = $1 ORDER BY permission_key",
      [id]
    );
    const fromRole = resolvePermissions({ role: row.role, rolePermissions: row.role_chain?.keys || null, inheritsSystemRole: row.role_chain?.system || null, overrides: [], modules: row.modules, extraKeys: row.feature_keys });
    return {
      role: row.role,
      roleName: SYSTEM_ROLES[row.role]?.name || row.role_name || row.role,
      entitledModules: [...new Set([...CORE_MODULES, ...row.modules])].sort(),
      fromRole,
      overrides: overrides.rows.map((item: any) => ({ key: item.permission_key, effect: item.effect, reason: item.reason, createdBy: item.created_by, createdAt: toIso(item.created_at) })),
      effective: principalFromRow(row).permissions,
    };
  },

  async setOverrides(actor: Actor, id: string, body: any) {
    if (id === actor.userId) fail(403, "You cannot change your own permissions.");
    const user = await this.get(actor.institutionId, id);
    assertNotOwner(actor, user, "change the permissions of");
    if (user.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") fail(403, "Only a super admin can change a super admin.");
    const list = body?.overrides;
    if (!Array.isArray(list) || list.length > 500) fail(400, "Overrides must be a list.");
    const valid = new Set([...ALL_PERMISSION_KEYS, ...(await featureKeys(actor.institutionId))]);
    const seen = new Set<string>();
    const overrides = list.map((item: any) => {
      if (!valid.has(item?.key)) fail(400, `Unknown permission: ${item?.key}.`);
      if (!["ALLOW", "DENY"].includes(item?.effect)) fail(400, "Each override is ALLOW or DENY.");
      if (seen.has(item.key)) fail(400, `${item.key} is listed twice.`);
      seen.add(item.key);
      return { key: item.key as string, effect: item.effect as string, reason: text(item.reason, "Reason", 500) };
    });
    const allowed = overrides.filter((item: any) => item.effect === "ALLOW").map((item: any) => item.key as string);
    // An allow can never reach past what the institution subscribes to.
    const entitled = await entitledModules(actor.institutionId);
    const outside = [...new Set(allowed.filter((key: string) => !entitled.has(moduleOf(key))).map(moduleOf))];
    if (outside.length > 0) fail(403, `Your subscription does not include: ${outside.join(", ")}. Subscribe to the module before giving anyone access to it.`);
    assertCanGrant(actor, allowed);
    await postgresService.transaction(async (tx) => {
      await tx.query("DELETE FROM erp_user_permission_overrides WHERE user_id = $1", [id]);
      for (const item of overrides) {
        await tx.query(
          "INSERT INTO erp_user_permission_overrides (user_id, permission_key, effect, reason, created_by) VALUES ($1, $2, $3, $4, $5)",
          [id, item.key, item.effect, item.reason, actor.email]
        );
      }
      await audit(tx, actor, "Permissions", "User", id,
        `Set ${overrides.length} override(s) for ${user.username}: ${overrides.map((item: any) => `${item.effect} ${item.key}`).join(", ") || "none"}.`);
    });
    return this.permissions(actor.institutionId, id);
  },

  // Takes away one exception, so the user follows their role for that permission again.
  async removeOverride(actor: Actor, id: string, key: string) {
    if (id === actor.userId) fail(403, "You cannot change your own permissions.");
    const user = await this.get(actor.institutionId, id);
    assertNotOwner(actor, user, "change the permissions of");
    if (user.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") fail(403, "Only a super admin can change a super admin.");
    const { rows } = await postgresService.query("DELETE FROM erp_user_permission_overrides WHERE user_id = $1 AND permission_key = $2 RETURNING effect", [id, key]);
    if (!rows[0]) fail(404, `${user.username} has no override for ${key}.`);
    await audit(postgresService, actor, "Permissions", "User", id, `Removed the ${rows[0].effect} override of ${key} from ${user.username}; the role decides again.`);
    return this.permissions(actor.institutionId, id);
  },

  // The students a guardian account may see in the portal.
  async wards(institutionId: string, id: string) {
    const user = await this.get(institutionId, id);
    if (user.role !== "GUARDIAN") fail(409, "Only a guardian account has linked students.");
    const { rows } = await postgresService.query(
      `SELECT l.student_id, l.relationship, l.created_by, l.created_at,
         COALESCE((SELECT full_name FROM acad_students s WHERE s.institution_id = l.institution_id AND LOWER(s.student_no) = LOWER(l.student_id)),
          (SELECT student_name FROM hostel_allocations a WHERE a.institution_id = l.institution_id AND LOWER(a.student_id) = LOWER(l.student_id)
          ORDER BY a.created_at DESC LIMIT 1)) AS student_name
       FROM erp_guardian_links l WHERE l.guardian_user_id = $1 AND l.institution_id = $2 ORDER BY l.created_at`,
      [id, institutionId]
    );
    return rows.map((row: any) => ({ studentId: row.student_id, studentName: row.student_name, relationship: row.relationship, createdBy: row.created_by, createdAt: toIso(row.created_at) }));
  },

  async setWards(actor: Actor, id: string, body: any) {
    const user = await this.get(actor.institutionId, id);
    if (user.role !== "GUARDIAN") fail(409, "Only a guardian account can be linked to students.");
    const list = body?.wards;
    if (!Array.isArray(list) || list.length > 20) fail(400, "Send up to 20 linked students.");
    const wards = list.map((item: any) => ({ studentId: text(item?.studentId, "Student ID", 100, true), relationship: text(item?.relationship, "Relationship", 100) }));
    if (new Set(wards.map((item: any) => item.studentId.toLowerCase())).size !== wards.length) fail(400, "A student is listed twice.");
    // Only students the institution actually has: a hostel record or a student account.
    for (const ward of wards) {
      const { rows } = await postgresService.query(
        `SELECT 1 FROM hostel_allocations WHERE institution_id = $1 AND LOWER(student_id) = LOWER($2)
         UNION SELECT 1 FROM erp_users WHERE institution_id = $1 AND linked_type = 'STUDENT' AND LOWER(linked_id) = LOWER($2)
         UNION SELECT 1 FROM acad_students WHERE institution_id = $1 AND LOWER(student_no) = LOWER($2) LIMIT 1`,
        [actor.institutionId, ward.studentId]
      );
      if (!rows[0]) fail(400, `No student with ID ${ward.studentId} was found.`);
    }
    await postgresService.transaction(async (tx) => {
      await tx.query("DELETE FROM erp_guardian_links WHERE guardian_user_id = $1", [id]);
      for (const ward of wards) {
        await tx.query(
          "INSERT INTO erp_guardian_links (guardian_user_id, institution_id, student_id, relationship, created_by) VALUES ($1, $2, $3, $4, $5)",
          [id, actor.institutionId, ward.studentId, ward.relationship, actor.email]
        );
      }
      await audit(tx, actor, "Linked", "User", id, `${user.username} may now see: ${wards.map((item: any) => item.studentId).join(", ") || "no students"}.`);
    });
    return this.wards(actor.institutionId, id);
  },

  async auditLog(institutionId: string, limit = 100) {
    const { rows } = await postgresService.query(
      "SELECT * FROM erp_audit_log WHERE institution_id = $1 ORDER BY created_at DESC LIMIT $2",
      [institutionId, Math.min(Math.max(Number(limit) || 100, 1), 500)]
    );
    return rows.map((row: any) => ({
      id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, summary: row.summary,
      actorEmail: row.actor_email, createdAt: toIso(row.created_at),
    }));
  },
};
