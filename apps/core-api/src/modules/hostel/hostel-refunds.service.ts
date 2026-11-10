import { postgresService } from "../../database/postgres";
import { addAdjustment } from "./hostel-billing.service";
import { getToday } from "./hostel-rent.repository";
import { HostelContext, HostelError, toHostelError, toIso, toMoney, writeAudit } from "./hostel.common";

const METHODS = ["Cash", "bKash", "Nagad", "Bank Transfer", "Card", "Cheque"];

const refundFromRow = (row: any) => ({
  id: row.id,
  allocationId: row.allocation_id,
  studentId: row.student_id,
  studentName: row.student_name,
  invoiceId: row.invoice_id,
  invoiceNumber: row.invoice_number,
  sourceType: row.source_type,
  amount: toMoney(row.amount),
  reason: row.reason,
  status: row.status,
  method: row.method,
  reference: row.reference,
  paidOn: row.paid_on,
  paidBy: row.paid_by,
  createdAt: toIso(row.created_at),
});

const SELECT = `
  SELECT f.*, a.student_id, a.student_name, i.invoice_number
  FROM hostel_refunds f
  JOIN hostel_allocations a ON a.id = f.allocation_id
  JOIN hostel_invoices i ON i.id = f.invoice_id`;

export const hostelRefundsService = {
  async list(institutionId: string, filters: { status?: string; allocationId?: string } = {}) {
    const { rows } = await postgresService.query(
      `${SELECT} WHERE f.institution_id = $1 AND ($2 = '' OR f.status = $2) AND ($3 = '' OR f.allocation_id = $3)
       ORDER BY f.status, f.created_at DESC`,
      [institutionId, filters.status || "", filters.allocationId || ""]
    );
    return rows.map(refundFromRow);
  },

  // Paying a refund reverses what was collected for the cancelled charge and clears its
  // invoice, so collections, balances and receipts all agree that the money went back.
  async pay(ctx: HostelContext, id: string, body: any) {
    const method = body?.method;
    if (!METHODS.includes(method)) throw new HostelError(400, `Refund method must be one of: ${METHODS.join(", ")}.`);
    const reference = typeof body?.reference === "string" ? body.reference.trim().slice(0, 100) : "";
    if (method !== "Cash" && !reference) throw new HostelError(400, "Give the transaction reference of the refund.");
    const today = await getToday(ctx.institutionId);
    const paidOn = body?.paidOn || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > today) throw new HostelError(400, "The refund date must be a date, not in the future.");

    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hostel_refunds WHERE institution_id = $1 AND id = $2 FOR UPDATE", [ctx.institutionId, id]);
      const refund = rows[0];
      if (!refund) throw new HostelError(404, "Refund not found.");
      if (refund.status === "PAID") throw new HostelError(409, "This refund was already paid.");
      await tx.query("SELECT id FROM hostel_invoices WHERE id = $1 FOR UPDATE", [refund.invoice_id]);

      const payments = await tx.query(
        "SELECT id, receipt_number, amount FROM hostel_payments WHERE invoice_id = $1 AND status = 'Confirmed' FOR UPDATE",
        [refund.invoice_id]
      );
      const collected = payments.rows.reduce((sum: number, row: any) => sum + Math.round(toMoney(row.amount) * 100), 0) / 100;
      if (collected !== toMoney(refund.amount)) {
        throw new HostelError(409, `The invoice now shows ${collected} collected, not ${toMoney(refund.amount)}. Check its payments before refunding.`);
      }
      const why = `Refunded by ${method}${reference ? ` (${reference})` : ""}: ${refund.reason}`;
      for (const payment of payments.rows) {
        await tx.query(
          "UPDATE hostel_payments SET status = 'Reversed', reversed_at = NOW(), reversed_by = $2, reversal_reason = $3 WHERE id = $1",
          [payment.id, ctx.actorEmail, why]
        );
      }
      await addAdjustment(tx, ctx, refund.invoice_id, -toMoney(refund.amount), why);
      await tx.query(
        "UPDATE hostel_refunds SET status = 'PAID', method = $2, reference = $3, paid_on = $4, paid_by = $5 WHERE id = $1",
        [id, method, reference, paidOn, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Refunded", "Payment", id, `${why}. Amount ${toMoney(refund.amount)}.`);
      const saved = await tx.query(`${SELECT} WHERE f.id = $1`, [id]);
      return refundFromRow(saved.rows[0]);
    }).catch((err) => {
      throw toHostelError(err);
    });
  },
};
