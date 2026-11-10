import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso, toMoney } from "../hostel/hostel.common";
import { nextNumber } from "../hostel/hostel-billing.service";
import { Actor, audit } from "../identity/identity.service";
import { amount, code, date, fail, inTx, oneOf, text, todayBd } from "../academics/academics.common";

export const FEE_CATEGORIES = ["TUITION", "ADMISSION", "EXAM", "LAB", "LIBRARY", "TRANSPORT", "DEVELOPMENT", "FINE", "OTHER"] as const;
export const FEE_FREQUENCIES = ["ONE_TIME", "PER_TERM", "MONTHLY", "YEARLY"] as const;
export const PAYMENT_METHODS = ["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "CHEQUE", "OTHER"] as const;
const ADJUSTMENT_KINDS = ["WAIVER", "DISCOUNT", "FINE"] as const;
const INVOICE_STATES = ["UNPAID", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"] as const;

// ---- Fee heads and the fee structure ----------------------------------------------

const feeHeadFromRow = (row: any) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  category: row.category,
  frequency: row.frequency,
  defaultAmount: toMoney(row.default_amount),
  status: row.status,
  rates: Number(row.rates ?? 0),
});

const feeHeadInput = (body: any, existing?: any) => ({
  code: body?.code !== undefined || !existing ? code(body?.code, "Code") : existing.code,
  name: body?.name !== undefined || !existing ? text(body?.name, "Name", 100, true) : existing.name,
  category: oneOf(body?.category, "Category", FEE_CATEGORIES, existing?.category || "TUITION"),
  frequency: oneOf(body?.frequency, "Frequency", FEE_FREQUENCIES, existing?.frequency || "PER_TERM"),
  defaultAmount: body?.defaultAmount !== undefined || !existing ? amount(body?.defaultAmount ?? 0, "Default amount") : toMoney(existing.default_amount),
  status: oneOf(body?.status, "Status", ["ACTIVE", "INACTIVE"] as const, existing?.status || "ACTIVE"),
});

export const feeHeadsService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(
      `SELECT h.*, (SELECT COUNT(*) FROM fin_fee_rates r WHERE r.fee_head_id = h.id) AS rates
       FROM fin_fee_heads h WHERE h.institution_id = $1 ORDER BY h.status, h.code`,
      [institutionId]
    );
    return rows.map(feeHeadFromRow);
  },

  async create(actor: Actor, body: any) {
    const input = feeHeadInput(body);
    return inTx(async (tx) => {
      const id = newId();
      const { rows } = await tx.query(
        `INSERT INTO fin_fee_heads (id, institution_id, code, name, category, frequency, default_amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, actor.institutionId, input.code, input.name, input.category, input.frequency, input.defaultAmount, input.status]
      );
      await audit(tx, actor, "finance.fee_head.create", "fee_head", id, `Created fee head ${input.code} (${input.name}).`);
      return feeHeadFromRow(rows[0]);
    });
  },

  async update(actor: Actor, id: string, body: any) {
    return inTx(async (tx) => {
      const { rows: found } = await tx.query("SELECT * FROM fin_fee_heads WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!found[0]) fail(404, "Fee head not found.");
      const input = feeHeadInput(body, found[0]);
      const { rows } = await tx.query(
        `UPDATE fin_fee_heads SET code = $3, name = $4, category = $5, frequency = $6, default_amount = $7, status = $8
         WHERE institution_id = $1 AND id = $2 RETURNING *`,
        [actor.institutionId, id, input.code, input.name, input.category, input.frequency, input.defaultAmount, input.status]
      );
      await audit(tx, actor, "finance.fee_head.update", "fee_head", id, `Updated fee head ${input.code}.`);
      return feeHeadFromRow(rows[0]);
    });
  },

  // A fee head already billed stays, so old invoices keep their meaning. Make it inactive instead.
  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const { rows } = await tx.query("SELECT code FROM fin_fee_heads WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Fee head not found.");
      const used = await tx.query("SELECT 1 FROM fin_invoice_items WHERE fee_head_id = $1 LIMIT 1", [id]);
      if (used.rows[0]) fail(409, "This fee head is on invoices already. Make it inactive instead.");
      await tx.query("DELETE FROM fin_fee_heads WHERE id = $1", [id]);
      await audit(tx, actor, "finance.fee_head.delete", "fee_head", id, `Deleted fee head ${rows[0].code}.`);
      return { id };
    });
  },

  // Programs by fee heads, with the amount each program pays.
  async structure(institutionId: string) {
    const [heads, programs, rates] = await Promise.all([
      this.list(institutionId),
      postgresService.query("SELECT id, code, name FROM acad_programs WHERE institution_id = $1 AND status = 'ACTIVE' ORDER BY code", [institutionId]),
      postgresService.query(
        "SELECT r.fee_head_id, r.program_id, r.amount FROM fin_fee_rates r JOIN fin_fee_heads h ON h.id = r.fee_head_id WHERE h.institution_id = $1",
        [institutionId]
      ),
    ]);
    return {
      feeHeads: heads,
      programs: programs.rows,
      rates: rates.rows.map((row: any) => ({ feeHeadId: row.fee_head_id, programId: row.program_id, amount: toMoney(row.amount) })),
    };
  },

  // Sets one program's amount for a fee head. An empty amount goes back to the default.
  async setRate(actor: Actor, body: any) {
    return inTx(async (tx) => {
      const head = await tx.query("SELECT id, code FROM fin_fee_heads WHERE institution_id = $1 AND id = $2", [actor.institutionId, body?.feeHeadId]);
      if (!head.rows[0]) fail(400, "That fee head does not exist.");
      const program = await tx.query("SELECT id, code FROM acad_programs WHERE institution_id = $1 AND id = $2", [actor.institutionId, body?.programId]);
      if (!program.rows[0]) fail(400, "That program does not exist.");
      if (body?.amount === null || body?.amount === "" || body?.amount === undefined) {
        await tx.query("DELETE FROM fin_fee_rates WHERE fee_head_id = $1 AND program_id = $2", [head.rows[0].id, program.rows[0].id]);
        await audit(tx, actor, "finance.rate.clear", "fee_head", head.rows[0].id, `${program.rows[0].code} now pays the default ${head.rows[0].code}.`);
        return { feeHeadId: head.rows[0].id, programId: program.rows[0].id, amount: null };
      }
      const value = amount(body.amount, "Amount");
      await tx.query(
        `INSERT INTO fin_fee_rates (fee_head_id, program_id, amount) VALUES ($1, $2, $3)
         ON CONFLICT (fee_head_id, program_id) DO UPDATE SET amount = EXCLUDED.amount`,
        [head.rows[0].id, program.rows[0].id, value]
      );
      await audit(tx, actor, "finance.rate.set", "fee_head", head.rows[0].id, `${program.rows[0].code} pays ${value} for ${head.rows[0].code}.`);
      return { feeHeadId: head.rows[0].id, programId: program.rows[0].id, amount: value };
    });
  },
};

// ---- Invoices -------------------------------------------------------------------

const stateOf = (row: any, today: string) => {
  if (row.status === "CANCELLED") return "CANCELLED";
  const outstanding = toMoney(row.outstanding_amount);
  if (outstanding <= 0) return "PAID";
  if (row.due_date < today) return "OVERDUE";
  return toMoney(row.paid_amount) > 0 ? "PARTIAL" : "UNPAID";
};

const invoiceFromRow = (row: any, today = todayBd()) => ({
  id: row.id,
  invoiceNumber: row.invoice_number,
  studentId: row.student_id,
  studentNo: row.student_no,
  studentName: row.student_name,
  programName: row.program_name,
  title: row.title,
  issuedOn: row.issued_on,
  dueDate: row.due_date,
  totalAmount: toMoney(row.total_amount),
  adjustmentTotal: toMoney(row.adjustment_total),
  amountDue: toMoney(row.amount_due),
  paidAmount: toMoney(row.paid_amount),
  outstanding: Math.max(0, toMoney(row.outstanding_amount)),
  state: stateOf(row, today),
  status: row.status,
  cancelReason: row.cancel_reason,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
});

const paymentFromRow = (row: any) => ({
  id: row.id,
  invoiceId: row.invoice_id,
  invoiceNumber: row.invoice_number,
  invoiceTitle: row.title,
  studentNo: row.student_no,
  studentName: row.student_name,
  amount: toMoney(row.amount),
  paidOn: row.paid_on,
  method: row.method,
  reference: row.reference,
  receiptNumber: row.receipt_number,
  notes: row.notes,
  status: row.status,
  recordedBy: row.recorded_by,
  reversedAt: toIso(row.reversed_at),
  reversedBy: row.reversed_by,
  reversalReason: row.reversal_reason,
  createdAt: toIso(row.created_at),
});

const PAYMENT_SELECT = `SELECT p.*, i.invoice_number, i.title, i.student_no, i.student_name FROM fin_payments p JOIN fin_invoices i ON i.id = p.invoice_id`;

type Item = { feeHeadId: string | null; description: string; amount: number };

const insertInvoice = async (tx: PoolClient, actor: Actor, student: any, input: { title: string; dueDate: string; issuedOn: string; items: Item[] }) => {
  const id = newId();
  const total = Math.round(input.items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  await tx.query(
    `INSERT INTO fin_invoices (id, institution_id, invoice_number, student_id, student_no, student_name, program_name, title, issued_on, due_date, total_amount, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, actor.institutionId, await nextNumber(tx, "FIN", "fin_invoice_number_seq", input.issuedOn), student.id, student.student_no, student.full_name,
      student.program_name || "", input.title, input.issuedOn, input.dueDate, total, actor.email]
  );
  for (const item of input.items) {
    await tx.query("INSERT INTO fin_invoice_items (id, invoice_id, fee_head_id, description, amount) VALUES ($1, $2, $3, $4, $5)",
      [newId(), id, item.feeHeadId, item.description, item.amount]);
  }
  return { id, total };
};

const STUDENT_SELECT = `SELECT s.id, s.student_no, s.full_name, s.program_id, s.status, p.name AS program_name
  FROM acad_students s JOIN acad_programs p ON p.id = s.program_id`;

const titleAndDates = (body: any) => {
  const title = text(body?.title, "Title", 150, true);
  const issuedOn = date(body?.issuedOn, "Issue date") || todayBd();
  const dueDate = date(body?.dueDate, "Due date", true) as string;
  if (dueDate < issuedOn) fail(400, "The due date cannot be before the issue date.");
  return { title, issuedOn, dueDate };
};

export const invoicesService = {
  async list(institutionId: string, filters: { search?: string; state?: string; studentId?: string } = {}) {
    const today = todayBd();
    const state = filters.state && (INVOICE_STATES as readonly string[]).includes(filters.state) ? filters.state : "";
    const { rows } = await postgresService.query(
      `SELECT * FROM fin_invoice_balances WHERE institution_id = $1
         AND ($2 = '' OR student_name ILIKE '%' || $2 || '%' OR student_no ILIKE '%' || $2 || '%' OR invoice_number ILIKE '%' || $2 || '%' OR title ILIKE '%' || $2 || '%')
         AND ($3 = '' OR student_id = $3)
         AND ($4 = '' OR ($4 = 'CANCELLED' AND status = 'CANCELLED') OR ($4 <> 'CANCELLED' AND status = 'ISSUED' AND CASE
               WHEN outstanding_amount <= 0 THEN 'PAID' WHEN due_date < $5::date THEN 'OVERDUE' WHEN paid_amount > 0 THEN 'PARTIAL' ELSE 'UNPAID' END = $4))
       ORDER BY created_at DESC LIMIT 500`,
      [institutionId, filters.search?.trim() || "", filters.studentId || "", state, today]
    );
    return rows.map((row: any) => invoiceFromRow(row, today));
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query("SELECT * FROM fin_invoice_balances WHERE institution_id = $1 AND id = $2", [institutionId, id]);
    if (!rows[0]) fail(404, "Invoice not found.");
    const [items, adjustments, payments] = await Promise.all([
      postgresService.query("SELECT * FROM fin_invoice_items WHERE invoice_id = $1 ORDER BY description", [id]),
      postgresService.query("SELECT * FROM fin_adjustments WHERE invoice_id = $1 ORDER BY created_at", [id]),
      postgresService.query(`${PAYMENT_SELECT} WHERE p.invoice_id = $1 ORDER BY p.created_at`, [id]),
    ]);
    return {
      ...invoiceFromRow(rows[0]),
      items: items.rows.map((row: any) => ({ id: row.id, feeHeadId: row.fee_head_id, description: row.description, amount: toMoney(row.amount) })),
      adjustments: adjustments.rows.map((row: any) => ({ id: row.id, kind: row.kind, amount: toMoney(row.amount), reason: row.reason, createdBy: row.created_by, createdAt: toIso(row.created_at) })),
      payments: payments.rows.map(paymentFromRow),
    };
  },

  // One invoice with hand-written lines, for a single student.
  async create(actor: Actor, body: any) {
    const base = titleAndDates(body);
    if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > 30) fail(400, "Add between 1 and 30 lines.");
    return inTx(async (tx) => {
      const { rows } = await tx.query(`${STUDENT_SELECT} WHERE s.institution_id = $1 AND s.id = $2`, [actor.institutionId, body?.studentId]);
      const student = rows[0];
      if (!student) fail(400, "That student does not exist.");
      const items: Item[] = [];
      for (const [index, line] of body.items.entries()) {
        let feeHeadId: string | null = null;
        let description = text(line?.description, `Line ${index + 1} description`, 150);
        if (line?.feeHeadId) {
          const head = await tx.query("SELECT id, name FROM fin_fee_heads WHERE institution_id = $1 AND id = $2", [actor.institutionId, line.feeHeadId]);
          if (!head.rows[0]) fail(400, `Line ${index + 1}: that fee head does not exist.`);
          feeHeadId = head.rows[0].id;
          description = description || head.rows[0].name;
        }
        if (!description) fail(400, `Line ${index + 1} needs a description or a fee head.`);
        items.push({ feeHeadId, description, amount: amount(line?.amount, `Line ${index + 1} amount`) });
      }
      const { id, total } = await insertInvoice(tx, actor, student, { ...base, items });
      await audit(tx, actor, "finance.invoice.create", "invoice", id, `Invoiced ${student.student_no} ${total} for "${base.title}".`);
      return id;
    }).then((id) => this.get(actor.institutionId, id));
  },

  // Bills every active student of a section, a program, or a list, using the fee structure.
  // Students who already have an invoice with this title are skipped, so running it twice is safe.
  async generate(actor: Actor, body: any) {
    const base = titleAndDates(body);
    const feeHeadIds: string[] = Array.isArray(body?.feeHeadIds) ? body.feeHeadIds.filter((id: unknown) => typeof id === "string") : [];
    if (feeHeadIds.length === 0) fail(400, "Choose at least one fee head.");
    const target = oneOf(body?.target, "Bill", ["SECTION", "PROGRAM", "STUDENTS"] as const);
    return inTx(async (tx) => {
      const heads = (await tx.query("SELECT * FROM fin_fee_heads WHERE institution_id = $1 AND id = ANY($2) AND status = 'ACTIVE'", [actor.institutionId, feeHeadIds])).rows;
      if (heads.length !== new Set(feeHeadIds).size) fail(400, "Some fee heads do not exist or are inactive.");
      let students: any[];
      if (target === "SECTION") {
        students = (await tx.query(`${STUDENT_SELECT} WHERE s.institution_id = $1 AND s.section_id = $2 AND s.status = 'ACTIVE' ORDER BY s.student_no`, [actor.institutionId, body?.sectionId])).rows;
      } else if (target === "PROGRAM") {
        students = (await tx.query(`${STUDENT_SELECT} WHERE s.institution_id = $1 AND s.program_id = $2 AND s.status = 'ACTIVE' ORDER BY s.student_no`, [actor.institutionId, body?.programId])).rows;
      } else {
        const ids = Array.isArray(body?.studentIds) ? body.studentIds : [];
        students = (await tx.query(`${STUDENT_SELECT} WHERE s.institution_id = $1 AND s.id = ANY($2) AND s.status = 'ACTIVE' ORDER BY s.student_no`, [actor.institutionId, ids])).rows;
      }
      if (students.length === 0) fail(400, "No active students match.");
      const rates = (await tx.query("SELECT fee_head_id, program_id, amount FROM fin_fee_rates WHERE fee_head_id = ANY($1)", [feeHeadIds])).rows;
      const rateOf = (head: any, programId: string) => {
        const rate = rates.find((row: any) => row.fee_head_id === head.id && row.program_id === programId);
        return toMoney(rate ? rate.amount : head.default_amount);
      };
      const already = new Set((await tx.query(
        "SELECT student_id FROM fin_invoices WHERE institution_id = $1 AND status = 'ISSUED' AND LOWER(title) = LOWER($2) AND student_id = ANY($3)",
        [actor.institutionId, base.title, students.map((s) => s.id)]
      )).rows.map((row: any) => row.student_id));
      let created = 0;
      let total = 0;
      const skipped: string[] = [];
      for (const student of students) {
        if (already.has(student.id)) { skipped.push(student.student_no); continue; }
        const items = heads.map((head: any) => ({ feeHeadId: head.id, description: head.name, amount: rateOf(head, student.program_id) }));
        if (items.every((item: Item) => item.amount === 0)) { skipped.push(student.student_no); continue; }
        const result = await insertInvoice(tx, actor, student, { ...base, items });
        created += 1;
        total += result.total;
      }
      await audit(tx, actor, "finance.invoice.generate", "invoice", "", `Generated ${created} invoices "${base.title}" totalling ${total}; skipped ${skipped.length}.`);
      return { created, skipped: skipped.length, skippedStudents: skipped.slice(0, 50), total: Math.round(total * 100) / 100 };
    });
  },

  async cancel(actor: Actor, id: string, body: any) {
    const reason = text(body?.reason, "Reason", 500, true);
    return inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM fin_invoices WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Invoice not found.");
      if (rows[0].status === "CANCELLED") fail(409, "This invoice is already cancelled.");
      const paid = await tx.query("SELECT 1 FROM fin_payments WHERE invoice_id = $1 AND status = 'CONFIRMED' LIMIT 1", [id]);
      if (paid.rows[0]) fail(409, "This invoice has payments. Reverse them before cancelling.");
      await tx.query("UPDATE fin_invoices SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1", [id, reason]);
      await audit(tx, actor, "finance.invoice.cancel", "invoice", id, `Cancelled ${rows[0].invoice_number}. Reason: ${reason}`);
    }).then(() => this.get(actor.institutionId, id));
  },

  // Waivers and discounts lower what is owed, never below what is already paid. Fines raise it.
  async adjust(actor: Actor, id: string, body: any) {
    const kind = oneOf(body?.kind, "Kind", ADJUSTMENT_KINDS);
    const value = amount(body?.amount, "Amount", 0.01);
    const reason = text(body?.reason, "Reason", 500, true);
    return inTx(async (tx) => {
      const locked = await tx.query("SELECT id FROM fin_invoices WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!locked.rows[0]) fail(404, "Invoice not found.");
      const { rows } = await tx.query("SELECT * FROM fin_invoice_balances WHERE id = $1", [id]);
      const invoice = rows[0];
      if (invoice.status === "CANCELLED") fail(409, "This invoice is cancelled.");
      const signed = kind === "FINE" ? value : -value;
      if (toMoney(invoice.amount_due) + signed < toMoney(invoice.paid_amount)) fail(400, "That would make the invoice owe less than has already been paid.");
      await tx.query("INSERT INTO fin_adjustments (id, institution_id, invoice_id, kind, amount, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [newId(), actor.institutionId, id, kind, signed, reason, actor.email]);
      await audit(tx, actor, "finance.invoice.adjust", "invoice", id, `${kind} of ${value} on ${invoice.invoice_number}. Reason: ${reason}`);
    }).then(() => this.get(actor.institutionId, id));
  },
};

// ---- Payments -------------------------------------------------------------------

export const paymentsService = {
  async list(institutionId: string, filters: { search?: string; method?: string; from?: string; to?: string; status?: string } = {}) {
    const { rows } = await postgresService.query(
      `${PAYMENT_SELECT} WHERE p.institution_id = $1
         AND ($2 = '' OR i.student_name ILIKE '%' || $2 || '%' OR i.student_no ILIKE '%' || $2 || '%' OR p.receipt_number ILIKE '%' || $2 || '%'
              OR i.invoice_number ILIKE '%' || $2 || '%' OR p.reference ILIKE '%' || $2 || '%')
         AND ($3 = '' OR p.method = $3) AND ($4 = '' OR p.paid_on >= $4::date) AND ($5 = '' OR p.paid_on <= $5::date) AND ($6 = '' OR p.status = $6)
       ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 500`,
      [institutionId, filters.search?.trim() || "", filters.method || "", date(filters.from, "From") || "", date(filters.to, "To") || "", filters.status || ""]
    );
    return rows.map(paymentFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${PAYMENT_SELECT} WHERE p.institution_id = $1 AND p.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Payment not found.");
    return paymentFromRow(rows[0]);
  },

  // Records money received against an invoice. The same request key twice returns the first payment.
  async record(actor: Actor, body: any) {
    const value = amount(body?.amount, "Amount", 0.01);
    const method = oneOf(body?.method, "Method", PAYMENT_METHODS);
    const paidOn = date(body?.paidOn, "Payment date") || todayBd();
    if (paidOn > todayBd()) fail(400, "The payment date cannot be in the future.");
    const reference = text(body?.reference, "Reference", 100);
    if (method !== "CASH" && !reference) fail(400, "Give the transaction or cheque reference for non-cash payments.");
    const notes = text(body?.notes, "Notes", 500);
    const key = body?.idempotencyKey ? text(body.idempotencyKey, "Request key", 64) : null;
    if (key) {
      const { rows } = await postgresService.query("SELECT id FROM fin_payments WHERE institution_id = $1 AND idempotency_key = $2", [actor.institutionId, key]);
      if (rows[0]) return this.get(actor.institutionId, rows[0].id);
    }
    const id = await inTx(async (tx) => {
      const locked = await tx.query("SELECT id FROM fin_invoices WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, body?.invoiceId]);
      if (!locked.rows[0]) fail(404, "Invoice not found.");
      const invoice = (await tx.query("SELECT * FROM fin_invoice_balances WHERE id = $1", [body.invoiceId])).rows[0];
      if (invoice.status === "CANCELLED") fail(409, "This invoice is cancelled.");
      const outstanding = toMoney(invoice.outstanding_amount);
      if (outstanding <= 0) fail(409, "This invoice is already paid.");
      if (value > outstanding) fail(400, `The amount is more than what is owed (${outstanding}).`);
      const paymentId = newId();
      const receipt = await nextNumber(tx, "FRC", "fin_receipt_number_seq", paidOn);
      await tx.query(
        `INSERT INTO fin_payments (id, institution_id, invoice_id, amount, paid_on, method, reference, receipt_number, notes, idempotency_key, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [paymentId, actor.institutionId, invoice.id, value, paidOn, method, reference, receipt, notes, key, actor.email]
      );
      await audit(tx, actor, "finance.payment.record", "payment", paymentId, `Received ${value} (${method}) from ${invoice.student_no} on ${invoice.invoice_number}. Receipt ${receipt}.`);
      return paymentId;
    });
    return this.get(actor.institutionId, id);
  },

  async reverse(actor: Actor, id: string, body: any) {
    const reason = text(body?.reason, "Reason", 500, true);
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM fin_payments WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Payment not found.");
      if (rows[0].status === "REVERSED") fail(409, "This payment is already reversed.");
      await tx.query("UPDATE fin_payments SET status = 'REVERSED', reversed_at = NOW(), reversed_by = $2, reversal_reason = $3 WHERE id = $1", [id, actor.email, reason]);
      await audit(tx, actor, "finance.payment.reverse", "payment", id, `Reversed receipt ${rows[0].receipt_number} of ${toMoney(rows[0].amount)}. Reason: ${reason}`);
    });
    return this.get(actor.institutionId, id);
  },
};

// ---- Dashboard and student statements ---------------------------------------------

export const financeReports = {
  async summary(institutionId: string) {
    const today = todayBd();
    const [totals, byMethod, byMonth, byHead, defaulters] = await Promise.all([
      postgresService.query(
        `SELECT COUNT(*) AS invoices, COALESCE(SUM(amount_due), 0) AS billed, COALESCE(SUM(paid_amount), 0) AS collected,
           COALESCE(SUM(GREATEST(outstanding_amount, 0)), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN due_date < $2::date THEN GREATEST(outstanding_amount, 0) ELSE 0 END), 0) AS overdue,
           COUNT(*) FILTER (WHERE outstanding_amount > 0 AND due_date < $2::date) AS overdue_invoices
         FROM fin_invoice_balances WHERE institution_id = $1 AND status = 'ISSUED'`,
        [institutionId, today]
      ),
      postgresService.query(
        "SELECT method, COUNT(*) AS count, SUM(amount) AS total FROM fin_payments WHERE institution_id = $1 AND status = 'CONFIRMED' GROUP BY method ORDER BY total DESC",
        [institutionId]
      ),
      postgresService.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', paid_on), 'YYYY-MM') AS month, SUM(amount) AS total FROM fin_payments
         WHERE institution_id = $1 AND status = 'CONFIRMED' AND paid_on >= (DATE_TRUNC('month', $2::date) - INTERVAL '5 months')
         GROUP BY 1 ORDER BY 1`,
        [institutionId, today]
      ),
      postgresService.query(
        `SELECT COALESCE(h.name, it.description) AS name, SUM(it.amount) AS billed FROM fin_invoice_items it
         JOIN fin_invoices i ON i.id = it.invoice_id LEFT JOIN fin_fee_heads h ON h.id = it.fee_head_id
         WHERE i.institution_id = $1 AND i.status = 'ISSUED' GROUP BY 1 ORDER BY billed DESC LIMIT 10`,
        [institutionId]
      ),
      postgresService.query(
        `SELECT student_id, student_no, student_name, SUM(outstanding_amount) AS outstanding, MIN(due_date) AS oldest_due
         FROM fin_invoice_balances WHERE institution_id = $1 AND status = 'ISSUED' AND outstanding_amount > 0 AND due_date < $2::date
         GROUP BY student_id, student_no, student_name ORDER BY outstanding DESC LIMIT 10`,
        [institutionId, today]
      ),
    ]);
    const row = totals.rows[0];
    return {
      invoices: Number(row.invoices),
      billed: toMoney(row.billed),
      collected: toMoney(row.collected),
      outstanding: toMoney(row.outstanding),
      overdue: toMoney(row.overdue),
      overdueInvoices: Number(row.overdue_invoices),
      byMethod: byMethod.rows.map((r: any) => ({ method: r.method, count: Number(r.count), total: toMoney(r.total) })),
      byMonth: byMonth.rows.map((r: any) => ({ month: r.month, total: toMoney(r.total) })),
      byFeeHead: byHead.rows.map((r: any) => ({ name: r.name, billed: toMoney(r.billed) })),
      defaulters: defaulters.rows.map((r: any) => ({ studentId: r.student_id, studentNo: r.student_no, studentName: r.student_name, outstanding: toMoney(r.outstanding), oldestDue: r.oldest_due })),
    };
  },

  // Invoices and payments of one student, by their student ID (student_no).
  async statement(institutionId: string, studentNo: string) {
    const { rows } = await postgresService.query("SELECT id FROM acad_students WHERE institution_id = $1 AND LOWER(student_no) = LOWER($2)", [institutionId, studentNo]);
    if (!rows[0]) return { invoices: [], payments: [], totalOutstanding: 0, totalOverdue: 0 };
    const invoices: ReturnType<typeof invoiceFromRow>[] = (await invoicesService.list(institutionId, { studentId: rows[0].id })).filter((item: ReturnType<typeof invoiceFromRow>) => item.status === "ISSUED");
    const payments = (await postgresService.query(`${PAYMENT_SELECT} WHERE p.institution_id = $1 AND i.student_id = $2 AND p.status = 'CONFIRMED' ORDER BY p.paid_on DESC`, [institutionId, rows[0].id])).rows.map(paymentFromRow);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      invoices,
      payments,
      totalOutstanding: round(invoices.reduce((sum, item) => sum + item.outstanding, 0)),
      totalOverdue: round(invoices.filter((item) => item.state === "OVERDUE").reduce((sum, item) => sum + item.outstanding, 0)),
    };
  },
};
