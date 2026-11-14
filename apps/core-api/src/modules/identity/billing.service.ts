import { postgresService } from "../../database/postgres";
import { HostelError, newId, toIso, toMoney } from "../hostel/hostel.common";
import { Actor, audit } from "./identity.service";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

const DUE_AFTER_DAYS = 10;
const YEARLY_MONTHS_CHARGED = 10;
const MAX_CATCH_UP = 12;
const METHODS = ["Bank Transfer", "bKash", "Nagad", "Cash", "Cheque", "Card"];

const pad = (value: number) => String(value).padStart(2, "0");
const addMonths = (date: string, months: number) => {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
};
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const todayUtc = () => new Date().toISOString().slice(0, 10);

const statusOf = (row: any, today: string) => {
  if (row.status === "VOID") return "Void";
  const amount = Math.round(toMoney(row.amount) * 100);
  const paid = Math.round(toMoney(row.paid) * 100);
  if (paid >= amount) return "Paid";
  if (row.due_date < today) return "Overdue";
  return paid > 0 ? "Partially Paid" : "Unpaid";
};

const invoiceFromRow = (row: any, today: string) => ({
  id: row.id as string,
  tenantId: row.tenant_id as string,
  tenantName: row.tenant_name,
  tenantCode: row.tenant_code,
  invoiceNumber: row.invoice_number as string,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  billingCycle: row.billing_cycle,
  lines: row.lines,
  amount: toMoney(row.amount),
  paid: toMoney(row.paid),
  balance: Math.max(0, Math.round((toMoney(row.amount) - toMoney(row.paid)) * 100) / 100),
  dueDate: row.due_date,
  status: statusOf(row, today),
  voidReason: row.void_reason,
  payments: row.payments || [],
  createdAt: toIso(row.created_at),
});

const SELECT = `
  SELECT i.*, t.name AS tenant_name, t.code AS tenant_code,
    COALESCE((SELECT SUM(amount) FROM erp_subscription_payments p WHERE p.invoice_id = i.id), 0) AS paid,
    (SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', p.id, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
       'paidOn', p.paid_on, 'recordedBy', p.recorded_by) ORDER BY p.created_at), '[]') FROM erp_subscription_payments p WHERE p.invoice_id = i.id) AS payments
  FROM erp_subscription_invoices i JOIN erp_tenants t ON t.id = i.tenant_id`;

// Raises each active institution's invoice for every period that has started. The
// (tenant, period start) key means a rerun never bills twice.
export const generateSubscriptionInvoices = async (options: { today?: string; tenantId?: string } = {}) => {
  const today = options.today || todayUtc();
  const { rows: tenants } = await postgresService.query(
    "SELECT id, code, billing_cycle FROM erp_tenants WHERE status = 'ACTIVE' AND billing_enabled AND ($1 = '' OR id = $1)",
    [options.tenantId || ""]
  );
  let created = 0;
  const errors: string[] = [];
  for (const tenant of tenants) {
    try {
      const months = tenant.billing_cycle === "YEARLY" ? 12 : 1;
      const last = await postgresService.query("SELECT MAX(period_end) AS end FROM erp_subscription_invoices WHERE tenant_id = $1", [tenant.id]);
      let start: string = last.rows[0].end ? addDays(last.rows[0].end, 1) : `${today.slice(0, 7)}-01`;
      for (let step = 0; start <= today && step < MAX_CATCH_UP; step += 1) {
        const end = addDays(addMonths(start, months), -1);
        const { rows: lines } = await postgresService.query(
          `SELECT m.id, m.name, tm.monthly_price FROM erp_tenant_modules tm JOIN erp_modules m ON m.id = tm.module_id
           WHERE tm.tenant_id = $1 AND tm.status = 'ACTIVE' AND NOT m.is_core AND tm.monthly_price > 0
             AND tm.starts_on <= $2 AND (tm.ends_on IS NULL OR tm.ends_on >= $3) ORDER BY m.sort_order`,
          [tenant.id, end, start]
        );
        if (lines.length === 0) break;
        const factor = months === 12 ? YEARLY_MONTHS_CHARGED : 1;
        const items = lines.map((line: any) => ({
          moduleId: line.id, name: line.name, monthlyPrice: toMoney(line.monthly_price),
          amount: Math.round(toMoney(line.monthly_price) * factor * 100) / 100,
        }));
        const amount = Math.round(items.reduce((sum: number, item: any) => sum + item.amount * 100, 0)) / 100;
        // Due ten days after the invoice is raised. On the scheduled run that is the period's first
        // day; an invoice raised later (billing turned on mid-month, or catching up after downtime)
        // still gets its ten days instead of being overdue the moment it is created.
        const dueDate = addDays(start > today ? start : today, DUE_AFTER_DAYS);
        const result = await postgresService.query(
          `INSERT INTO erp_subscription_invoices (id, tenant_id, invoice_number, period_start, period_end, billing_cycle, lines, amount, due_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, period_start) DO NOTHING`,
          [newId(), tenant.id, `SUB-${start.slice(0, 7).replace("-", "")}-${tenant.code}`, start, end, months === 12 ? "YEARLY" : "MONTHLY",
            JSON.stringify(items), amount, dueDate]
        );
        created += result.rowCount || 0;
        start = addDays(end, 1);
      }
    } catch (err: any) {
      errors.push(`${tenant.id}: ${err.message}`);
    }
  }
  return { created, errors };
};

export const subscriptionBilling = {
  async setEnabled(actor: Actor, tenantId: string, enabled: boolean) {
    const { rows } = await postgresService.query("UPDATE erp_tenants SET billing_enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING name", [tenantId, enabled]);
    if (!rows[0]) fail(404, "Institution not found.");
    await audit(postgresService, { ...actor, institutionId: tenantId }, "Billing", "Tenant", tenantId, `Billing ${enabled ? "turned on" : "turned off"} for ${rows[0].name}.`);
    return { tenantId, billingEnabled: enabled };
  },

  async list(tenantId = ""): Promise<ReturnType<typeof invoiceFromRow>[]> {
    const { rows } = await postgresService.query(`${SELECT} WHERE ($1 = '' OR i.tenant_id = $1) ORDER BY i.period_start DESC, t.name LIMIT 500`, [tenantId]);
    const today = todayUtc();
    return rows.map((row: any) => invoiceFromRow(row, today));
  },

  async recordPayment(actor: Actor, invoiceId: string, body: any) {
    const method = body?.method;
    if (!METHODS.includes(method)) fail(400, `Method must be one of: ${METHODS.join(", ")}.`);
    const reference = typeof body?.reference === "string" ? body.reference.trim().slice(0, 100) : "";
    if (method !== "Cash" && !reference) fail(400, "Give the transaction reference.");
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) fail(400, "Amount must be more than 0, with up to 2 decimal places.");
    const paidOn = body?.paidOn || todayUtc();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > todayUtc()) fail(400, "The payment date must be a date, not in the future.");
    try {
      await postgresService.transaction(async (tx) => {
        await tx.query("SELECT id FROM erp_subscription_invoices WHERE id = $1 FOR UPDATE", [invoiceId]);
        const { rows } = await tx.query(`${SELECT} WHERE i.id = $1`, [invoiceId]);
        if (!rows[0]) fail(404, "Invoice not found.");
        const invoice = invoiceFromRow(rows[0], todayUtc());
        if (invoice.status === "Void") fail(409, "This invoice is void.");
        if (amount > invoice.balance) fail(400, `Only ${invoice.balance} is left to pay on this invoice.`);
        await tx.query(
          "INSERT INTO erp_subscription_payments (id, invoice_id, amount, method, reference, paid_on, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [newId(), invoiceId, amount, method, reference, paidOn, actor.email]
        );
        await audit(tx, { ...actor, institutionId: invoice.tenantId }, "Paid", "Subscription Invoice", invoiceId,
          `Recorded ${amount} by ${method}${reference ? ` (${reference})` : ""} on ${invoice.invoiceNumber}.`);
      });
    } catch (err: any) {
      if (err.code === "23505") fail(409, "A payment with this reference was already recorded.");
      throw err;
    }
    return (await this.list()).find((item) => item.id === invoiceId);
  },

  async voidInvoice(actor: Actor, invoiceId: string, reason: unknown) {
    const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
    if (!why) fail(400, "Give a reason for voiding.");
    await postgresService.transaction(async (tx) => {
      await tx.query("SELECT id FROM erp_subscription_invoices WHERE id = $1 FOR UPDATE", [invoiceId]);
      const { rows } = await tx.query(`${SELECT} WHERE i.id = $1`, [invoiceId]);
      if (!rows[0]) fail(404, "Invoice not found.");
      if (toMoney(rows[0].paid) > 0) fail(409, "This invoice has payments. It cannot be voided.");
      await tx.query("UPDATE erp_subscription_invoices SET status = 'VOID', void_reason = $2 WHERE id = $1", [invoiceId, why]);
      await audit(tx, { ...actor, institutionId: rows[0].tenant_id }, "Voided", "Subscription Invoice", invoiceId, `Voided ${rows[0].invoice_number}: ${why}`);
    });
    return (await this.list()).find((item) => item.id === invoiceId);
  },
};
