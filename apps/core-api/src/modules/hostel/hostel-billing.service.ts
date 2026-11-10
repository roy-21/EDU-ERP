import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import {
  HostelContext,
  HostelError,
  addMonths,
  daysBetween,
  dueDateFor,
  monthOf,
  newId,
  toHostelError,
  monthLabel,
  toIso,
  toMoney,
  writeAudit,
} from "./hostel.common";
import { getRentSettings, getToday, resolveDueDay } from "./hostel-rent.repository";
import { PAYMENT_METHODS } from "./hostel.validation";

const SYSTEM_ACTOR = (institutionId: string): HostelContext => ({
  institutionId,
  actorId: "system",
  actorEmail: "system",
});

const toCents = (value: number) => Math.round(value * 100);

// Derived from confirmed payments and adjustments, never stored.
export const invoiceStatus = (row: any, today: string): string => {
  const due = toMoney(row.amount_due);
  const paid = toMoney(row.paid_amount);
  const outstanding = toMoney(row.outstanding_amount);

  if (due === 0 && paid === 0) return "Waived";
  if (outstanding <= 0) return "Paid";
  if (today > row.due_date) return "Overdue";
  return paid > 0 ? "Partially Paid" : "Unpaid";
};

const invoiceFromRow = (row: any, today: string) => ({
  id: row.id,
  invoiceNumber: row.invoice_number,
  allocationId: row.allocation_id,
  studentId: row.student_id,
  studentName: row.student_name,
  studentPhone: row.student_phone,
  studentEmail: row.student_email,
  buildingId: row.building_id,
  roomId: row.room_id,
  seatId: row.seat_id,
  hostelName: row.hostel_name,
  buildingName: row.building_name,
  roomNumber: row.room_number,
  seatNumber: row.seat_number,
  billingMonth: row.billing_month,
  category: row.category,
  title: row.title || (row.category === "RENT" ? "Monthly hostel rent" : ""),
  sourceType: row.source_type,
  createdDate: toIso(row.created_at)?.slice(0, 10),
  rentAmount: toMoney(row.rent_amount),
  adjustmentTotal: toMoney(row.adjustment_total),
  amountDue: toMoney(row.amount_due),
  previousOutstanding: toMoney(row.previous_outstanding),
  // What the student owed in total when this invoice was issued.
  totalPayable: toMoney(row.previous_outstanding) + toMoney(row.amount_due),
  paidAmount: toMoney(row.paid_amount),
  outstandingAmount: toMoney(row.outstanding_amount),
  dueDate: row.due_date,
  dueSource: row.due_source,
  overdueDays:
    today > row.due_date && toMoney(row.outstanding_amount) > 0
      ? daysBetween(row.due_date, today)
      : 0,
  status: invoiceStatus(row, today),
  createdAt: toIso(row.created_at),
});

const paymentFromRow = (row: any) => ({
  id: row.id,
  invoiceId: row.invoice_id,
  allocationId: row.allocation_id,
  studentId: row.student_id,
  amount: toMoney(row.amount),
  paymentDate: row.payment_date,
  method: row.method,
  transactionReference: row.transaction_reference,
  receiptNumber: row.receipt_number,
  recordedBy: row.recorded_by,
  notes: row.notes,
  status: row.status,
  reversedAt: toIso(row.reversed_at),
  reversedBy: row.reversed_by,
  reversalReason: row.reversal_reason,
  createdAt: toIso(row.created_at),
  billingMonth: row.billing_month,
  invoiceNumber: row.invoice_number,
  studentName: row.student_name,
  hostelName: row.hostel_name,
  buildingName: row.building_name,
  roomNumber: row.room_number,
  seatNumber: row.seat_number,
});

const INVOICE_SELECT = `
  SELECT i.*, a.student_phone, a.student_email
  FROM hostel_invoice_balances i
  JOIN hostel_allocations a ON a.id = i.allocation_id`;

const PAYMENT_SELECT = `
  SELECT p.*, i.billing_month, i.invoice_number, i.student_name, i.hostel_name,
    i.building_name, i.room_number, i.seat_number
  FROM hostel_payments p JOIN hostel_invoices i ON i.id = p.invoice_id`;

export const nextNumber = async (tx: PoolClient, prefix: string, sequence: string, month: string) => {
  const { rows } = await tx.query(`SELECT nextval('${sequence}') AS value`);
  return `${prefix}-${month.slice(0, 7).replace("-", "")}-${String(rows[0].value).padStart(6, "0")}`;
};

export type ChargeInput = {
  allocationId: string;
  category: "MEAL" | "FEE" | "DEPOSIT";
  title: string;
  amount: number;
  billingMonth: string;
  dueDate: string;
  sourceType: string;
  sourceId: string;
  items: { description: string; quantity: number; unitPrice: number }[];
};

// Every non-rent charge is an invoice with a source, so meals, fees and deposits
// share payments, receipts, balances and the ledger with rent. The source key
// makes a repeat do nothing. Returns the new invoice id, or null if it existed.
export const createChargeInvoice = async (tx: PoolClient, input: ChargeInput): Promise<string | null> => {
  const { rows } = await tx.query(
    `SELECT a.*, s.seat_number AS current_seat_number, r.id AS current_room_id, r.room_number,
       r.hostel_name AS room_hostel, r.building AS room_building, r.building_id
     FROM hostel_allocations a
     LEFT JOIN hostel_seats s ON s.id = a.seat_id
     LEFT JOIN hostel_rooms r ON r.id = a.room_id
     WHERE a.id = $1`,
    [input.allocationId]
  );
  const allocation = rows[0];
  if (!allocation) throw new HostelError(404, "Allocation not found.");

  const id = newId();
  const inserted = await tx.query(
    `INSERT INTO hostel_invoices (id, institution_id, invoice_number, allocation_id, student_id,
       student_name, building_id, room_id, seat_id, hostel_name, building_name, room_number,
       seat_number, billing_month, rent_amount, previous_outstanding, due_date, due_source,
       category, title, source_type, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16, 'FIXED', $17, $18, $19, $20)
     ON CONFLICT (source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      id,
      allocation.institution_id,
      await nextNumber(tx, "INV", "hostel_invoice_number_seq", input.billingMonth),
      input.allocationId,
      allocation.student_id,
      allocation.student_name,
      allocation.building_id,
      allocation.current_room_id,
      allocation.seat_id,
      allocation.room_hostel || "",
      allocation.room_building || "",
      allocation.room_number || "",
      allocation.current_seat_number ?? allocation.seat_number,
      input.billingMonth,
      input.amount,
      input.dueDate,
      input.category,
      input.title.slice(0, 200),
      input.sourceType,
      input.sourceId,
    ]
  );
  if (!inserted.rows[0]) return null;

  for (const [index, item] of input.items.entries()) {
    await tx.query(
      `INSERT INTO hostel_invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId(), id, item.description.slice(0, 255), item.quantity, item.unitPrice, Math.round(item.quantity * item.unitPrice * 100) / 100, index]
    );
  }
  return id;
};

// Adds a correction to an invoice inside a caller's transaction.
export const addAdjustment = (tx: PoolClient, ctx: HostelContext, invoiceId: string, amount: number, reason: string) =>
  tx.query(
    `INSERT INTO hostel_invoice_adjustments (id, institution_id, invoice_id, amount, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), ctx.institutionId, invoiceId, amount, reason, ctx.actorEmail]
  );

// Creates any missing invoices for one allocation, oldest month first. The rent
// and due date are stored on the invoice, so later changes cannot rewrite it.
const billAllocation = async (
  tx: PoolClient,
  allocationId: string,
  today: string,
  globalDueDay: number
): Promise<number> => {
  const { rows } = await tx.query(
    `SELECT a.*, s.due_day AS seat_due_day, s.seat_number AS current_seat_number,
       r.id AS current_room_id, r.room_number, r.hostel_name AS room_hostel, r.building AS room_building,
       r.building_id, b.due_day AS building_due_day
     FROM hostel_allocations a
     LEFT JOIN hostel_seats s ON s.id = a.seat_id
     LEFT JOIN hostel_rooms r ON r.id = a.room_id
     LEFT JOIN hostel_buildings b ON b.id = r.building_id
     WHERE a.id = $1 FOR UPDATE OF a`,
    [allocationId]
  );
  const allocation = rows[0];
  if (!allocation?.billing_from || !allocation.start_date) return 0;
  if (!["Allocated", "Vacated"].includes(allocation.status) || !allocation.billing_active) return 0;

  const currentMonth = monthOf(today);
  const lastMonth =
    allocation.end_date && monthOf(allocation.end_date) < currentMonth
      ? monthOf(allocation.end_date)
      : currentMonth;

  const existing = await tx.query(
    "SELECT billing_month FROM hostel_invoices WHERE allocation_id = $1 AND category = 'RENT'",
    [allocationId]
  );
  const billed = new Set(existing.rows.map((row: any) => row.billing_month));
  let created = 0;

  for (let month = allocation.billing_from; month <= lastMonth; month = addMonths(month, 1)) {
    if (billed.has(month)) continue;

    const rent = await tx.query(
      `SELECT monthly_rent FROM hostel_allocation_rents
       WHERE allocation_id = $1 AND effective_month <= $2
       ORDER BY effective_month DESC LIMIT 1`,
      [allocationId, month]
    );
    if (!rent.rows[0]) continue;

    const { dueDay, source } = resolveDueDay(
      allocation.seat_due_day,
      allocation.building_due_day,
      globalDueDay
    );

    // The first invoice uses the agreed date, and is never due before move-in.
    let dueDate = dueDateFor(month, dueDay);
    let dueSource: string = source;
    if (month === monthOf(allocation.start_date)) {
      if (allocation.first_due_date) {
        dueDate = allocation.first_due_date;
        dueSource = "INITIAL";
      } else if (dueDate < allocation.start_date) {
        dueDate = allocation.start_date;
        dueSource = "INITIAL";
      }
    }

    const previous = await tx.query(
      `SELECT COALESCE(SUM(outstanding_amount), 0) AS total FROM hostel_invoice_balances
       WHERE allocation_id = $1 AND billing_month < $2 AND category = 'RENT'`,
      [allocationId, month]
    );

    const inserted = await tx.query(
      `INSERT INTO hostel_invoices (id, institution_id, invoice_number, allocation_id, student_id,
         student_name, building_id, room_id, seat_id, hostel_name, building_name, room_number,
         seat_number, billing_month, rent_amount, previous_outstanding, due_date, due_source, category, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'RENT', $19)
       ON CONFLICT (allocation_id, billing_month) WHERE category = 'RENT' DO NOTHING
       RETURNING id`,
      [
        newId(),
        allocation.institution_id,
        await nextNumber(tx, "INV", "hostel_invoice_number_seq", month),
        allocationId,
        allocation.student_id,
        allocation.student_name,
        allocation.building_id,
        allocation.current_room_id,
        allocation.seat_id,
        allocation.room_hostel || "",
        allocation.room_building || "",
        allocation.room_number || "",
        allocation.current_seat_number ?? allocation.seat_number,
        month,
        rent.rows[0].monthly_rent,
        previous.rows[0].total,
        dueDate,
        dueSource,
        `Hostel rent for ${monthLabel(month)}`,
      ]
    );
    if (inserted.rows[0]) {
      await tx.query(
        `INSERT INTO hostel_invoice_items (id, invoice_id, description, quantity, unit_price, amount)
         VALUES ($1, $2, $3, 1, $4, $4)`,
        [newId(), inserted.rows[0].id, `Seat rent, ${monthLabel(month)}`, rent.rows[0].monthly_rent]
      );
    }
    created += inserted.rowCount ?? 0;
  }

  return created;
};

export const generateInvoices = async (
  institutionId: string,
  options: { today?: string; ctx?: HostelContext } = {}
) => {
  const settings = await getRentSettings(institutionId);
  const today = options.today || (await getToday(institutionId));
  const { rows } = await postgresService.query(
    `SELECT id FROM hostel_allocations
     WHERE institution_id = $1 AND status IN ('Allocated', 'Vacated')
       AND billing_active AND billing_from IS NOT NULL`,
    [institutionId]
  );

  let created = 0;
  const errors: string[] = [];

  // One transaction per allocation, so one bad record cannot stop the others.
  for (const { id } of rows) {
    try {
      created += await postgresService.transaction((tx) =>
        billAllocation(tx, id, today, settings.defaultDueDay)
      );
    } catch (err: any) {
      errors.push(`${id}: ${err.message}`);
    }
  }

  if (created > 0) {
    await postgresService.transaction((tx) =>
      writeAudit(
        tx,
        options.ctx || SYSTEM_ACTOR(institutionId),
        "Generated",
        "Invoice",
        "",
        `Generated ${created} rent invoice(s) up to ${monthOf(today).slice(0, 7)}.`
      )
    );
  }

  return { created, checked: rows.length, errors };
};

type PaymentInput = {
  amount: number;
  paymentDate: string;
  method: string;
  transactionReference: string;
  notes: string;
  idempotencyKey: string | null;
};

// Every payment goes through here, by hand or online, so the same rules apply to both.
export const postPayment = async (
  tx: PoolClient,
  ctx: HostelContext,
  invoiceId: string,
  input: PaymentInput
) => {
  const lock = await tx.query(
    "SELECT id FROM hostel_invoices WHERE institution_id = $1 AND id = $2 FOR UPDATE",
    [ctx.institutionId, invoiceId]
  );
  if (!lock.rows[0]) throw new HostelError(404, "Invoice not found.");

  const { rows } = await tx.query("SELECT * FROM hostel_invoice_balances WHERE id = $1", [invoiceId]);
  const invoice = rows[0];
  const outstanding = toMoney(invoice.outstanding_amount);

  if (outstanding <= 0) {
    throw new HostelError(409, "This invoice has nothing left to pay.");
  }
  if (toCents(input.amount) > toCents(outstanding)) {
    throw new HostelError(400, `Payment amount is more than the outstanding amount of ${outstanding}.`);
  }

  const id = newId();
  const receiptNumber = await nextNumber(tx, "RCP", "hostel_receipt_number_seq", input.paymentDate);
  await tx.query(
    `INSERT INTO hostel_payments (id, institution_id, invoice_id, allocation_id, student_id,
       amount, payment_date, method, transaction_reference, receipt_number, recorded_by,
       notes, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      ctx.institutionId,
      invoiceId,
      invoice.allocation_id,
      invoice.student_id,
      input.amount,
      input.paymentDate,
      input.method,
      input.transactionReference,
      receiptNumber,
      ctx.actorEmail,
      input.notes,
      input.idempotencyKey,
    ]
  );
  await writeAudit(
    tx,
    ctx,
    "Payment",
    "Payment",
    id,
    `Recorded ${input.amount} (${input.method}) from ${invoice.student_name} (${invoice.student_id}) on ${invoice.invoice_number}. Receipt ${receiptNumber}.`
  );

  const saved = await tx.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
  return paymentFromRow(saved.rows[0]);
};

export const hostelPaymentMethods = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(
      "SELECT method, enabled FROM hostel_payment_methods WHERE institution_id = $1",
      [institutionId]
    );
    return PAYMENT_METHODS.map((method) => ({
      method,
      enabled: rows.find((row: any) => row.method === method)?.enabled ?? true,
    }));
  },

  async setEnabled(ctx: HostelContext, method: string, enabled: boolean) {
    await postgresService.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO hostel_payment_methods (institution_id, method, enabled) VALUES ($1, $2, $3)
         ON CONFLICT (institution_id, method) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [ctx.institutionId, method, enabled]
      );
      await writeAudit(tx, ctx, "Updated", "Payment Config", method, `Payment method ${method} ${enabled ? "enabled" : "disabled"}.`);
    });
    return { method, enabled };
  },
};

export const hostelDashboardService = {
  // Everything is worked out from invoices and payments on each request.
  async get(
    institutionId: string,
    filters: { buildingId?: string; month?: string; method?: string; status?: string }
  ) {
    const today = await getToday(institutionId);
    const values: unknown[] = [institutionId];
    let where = "i.institution_id = $1 AND i.category = 'RENT'";
    if (filters.buildingId) {
      values.push(filters.buildingId);
      where += ` AND i.building_id = $${values.length}`;
    }
    if (filters.month) {
      values.push(`${filters.month.slice(0, 7)}-01`);
      where += ` AND i.billing_month = $${values.length}`;
    }

    const [invoiceResult, paymentResult, gatewayResult, activeResult, buildingResult] = await Promise.all([
      postgresService.query(`SELECT i.* FROM hostel_invoice_balances i WHERE ${where}`, values),
      postgresService.query(
        `SELECT p.invoice_id, p.method, p.amount FROM hostel_payments p
         JOIN hostel_invoices i ON i.id = p.invoice_id
         WHERE ${where} AND p.status = 'Confirmed'`,
        values
      ),
      postgresService.query(
        `SELECT t.invoice_id, t.status FROM hostel_gateway_transactions t
         JOIN hostel_invoices i ON i.id = t.invoice_id WHERE ${where}`,
        values
      ),
      postgresService.query(
        `SELECT COUNT(*)::int AS total FROM hostel_allocations a
         LEFT JOIN hostel_rooms r ON r.id = a.room_id
         WHERE a.institution_id = $1 AND a.status = 'Allocated'
           ${filters.buildingId ? "AND r.building_id = $2" : ""}`,
        filters.buildingId ? [institutionId, filters.buildingId] : [institutionId]
      ),
      postgresService.query(
        "SELECT id, hostel_name, name FROM hostel_buildings WHERE institution_id = $1 ORDER BY hostel_name, name",
        [institutionId]
      ),
    ]);

    const payments = paymentResult.rows.filter((row: any) => !filters.method || row.method === filters.method);
    const paidByMethod = new Set(payments.map((row: any) => row.invoice_id));
    const invoices = invoiceResult.rows
      .map((row: any) => ({ ...row, status: invoiceStatus(row, today) }))
      .filter((row: any) => !filters.status || row.status === filters.status)
      .filter((row: any) => !filters.method || paidByMethod.has(row.id));
    const shown = new Set(invoices.map((row: any) => row.id));

    const sumCents = (rows: any[], read: (row: any) => unknown) =>
      rows.reduce((total: number, row: any) => total + toCents(toMoney(read(row))), 0) / 100;

    const students = new Map<string, { paid: number; outstanding: number; overdue: boolean }>();
    invoices.forEach((row: any) => {
      const entry = students.get(row.allocation_id) || { paid: 0, outstanding: 0, overdue: false };
      entry.paid += toCents(toMoney(row.paid_amount));
      entry.outstanding += toCents(toMoney(row.outstanding_amount));
      entry.overdue = entry.overdue || row.status === "Overdue";
      students.set(row.allocation_id, entry);
    });
    const people = [...students.values()];
    const gateway = gatewayResult.rows.filter((row: any) => shown.has(row.invoice_id));

    return {
      activeStudents: activeResult.rows[0].total,
      expected: sumCents(invoices, (row) => row.amount_due),
      collected: sumCents(payments.filter((row: any) => shown.has(row.invoice_id)), (row) => row.amount),
      outstanding: sumCents(invoices, (row) => row.outstanding_amount),
      overdue: sumCents(invoices.filter((row: any) => row.status === "Overdue"), (row) => row.outstanding_amount),
      paidStudents: people.filter((item) => item.outstanding <= 0 && item.paid > 0).length,
      partialStudents: people.filter((item) => item.outstanding > 0 && item.paid > 0).length,
      unpaidStudents: people.filter((item) => item.outstanding > 0 && item.paid === 0).length,
      overdueStudents: people.filter((item) => item.overdue).length,
      onlineSuccessful: gateway.filter((row: any) => row.status === "Completed").length,
      onlineFailed: gateway.filter((row: any) => row.status === "Failed").length,
      onlineReview: gateway.filter((row: any) => row.status === "Review").length,
      filterOptions: {
        buildings: buildingResult.rows.map((row: any) => ({ id: row.id, label: `${row.hostel_name} · ${row.name}` })),
        methods: PAYMENT_METHODS,
      },
    };
  },
};

export const hostelBillingService = {
  async listInvoices(
    institutionId: string,
    filters: {
      month?: string;
      status?: string;
      query?: string;
      category?: string;
      buildingId?: string;
      from?: string;
      to?: string;
    } = {}
  ) {
    const today = await getToday(institutionId);
    const values: unknown[] = [institutionId];
    let where = "i.institution_id = $1";
    if (filters.category) {
      values.push(filters.category);
      where += ` AND i.category = $${values.length}`;
    }
    if (filters.buildingId) {
      values.push(filters.buildingId);
      where += ` AND i.building_id = $${values.length}`;
    }
    if (filters.from) {
      values.push(filters.from);
      where += ` AND i.created_at >= $${values.length}::date`;
    }
    if (filters.to) {
      values.push(filters.to);
      where += ` AND i.created_at < $${values.length}::date + 1`;
    }

    if (filters.month) {
      values.push(`${filters.month.slice(0, 7)}-01`);
      where += ` AND i.billing_month = $${values.length}`;
    }
    if (filters.query) {
      values.push(`%${filters.query.toLowerCase()}%`);
      where += ` AND (LOWER(i.student_name) LIKE $${values.length} OR LOWER(i.student_id) LIKE $${values.length} OR LOWER(i.invoice_number) LIKE $${values.length})`;
    }

    const { rows } = await postgresService.query(
      `${INVOICE_SELECT} WHERE ${where} ORDER BY i.billing_month DESC, i.student_name`,
      values
    );
    const invoices = rows.map((row: any) => invoiceFromRow(row, today));
    return filters.status
      ? invoices.filter((item: any) => item.status === filters.status)
      : invoices;
  },

  async getInvoice(institutionId: string, id: string) {
    const today = await getToday(institutionId);
    const { rows } = await postgresService.query(
      `${INVOICE_SELECT} WHERE i.institution_id = $1 AND i.id = $2`,
      [institutionId, id]
    );
    if (!rows[0]) throw new HostelError(404, "Invoice not found.");

    const [payments, items, adjustments] = await Promise.all([
      postgresService.query(`${PAYMENT_SELECT} WHERE p.invoice_id = $1 ORDER BY p.created_at DESC`, [id]),
      postgresService.query("SELECT * FROM hostel_invoice_items WHERE invoice_id = $1 ORDER BY sort_order", [id]),
      postgresService.query(
        "SELECT * FROM hostel_invoice_adjustments WHERE invoice_id = $1 ORDER BY created_at DESC",
        [id]
      ),
    ]);

    const invoice = invoiceFromRow(rows[0], today);
    const lines = items.rows.length
      ? items.rows.map((row: any) => ({
          description: row.description,
          quantity: Number(row.quantity),
          unitPrice: toMoney(row.unit_price),
          amount: toMoney(row.amount),
        }))
      : [{ description: invoice.title, quantity: 1, unitPrice: invoice.rentAmount, amount: invoice.rentAmount }];
    return {
      invoice,
      items: lines,
      payments: payments.rows.map(paymentFromRow),
      adjustments: adjustments.rows.map((row: any) => ({
        id: row.id,
        amount: toMoney(row.amount),
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: toIso(row.created_at),
      })),
    };
  },

  // Everything about one student's rent, for the ledger page.
  async getLedger(institutionId: string, allocationId: string) {
    const today = await getToday(institutionId);
    const [invoices, payments, adjustments] = await Promise.all([
      postgresService.query(
        `${INVOICE_SELECT} WHERE i.institution_id = $1 AND i.allocation_id = $2 ORDER BY i.billing_month DESC`,
        [institutionId, allocationId]
      ),
      postgresService.query(
        `${PAYMENT_SELECT} WHERE p.institution_id = $1 AND p.allocation_id = $2 ORDER BY p.created_at DESC`,
        [institutionId, allocationId]
      ),
      postgresService.query(
        `SELECT j.*, i.invoice_number, i.billing_month FROM hostel_invoice_adjustments j
         JOIN hostel_invoices i ON i.id = j.invoice_id
         WHERE j.institution_id = $1 AND i.allocation_id = $2 ORDER BY j.created_at DESC`,
        [institutionId, allocationId]
      ),
    ]);

    const items = invoices.rows.map((row: any) => invoiceFromRow(row, today));
    const sum = (list: any[]) =>
      list.reduce((total: number, item: any) => total + toCents(item.outstandingAmount), 0) / 100;

    return {
      invoices: items,
      payments: payments.rows.map(paymentFromRow),
      adjustments: adjustments.rows.map((row: any) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        billingMonth: row.billing_month,
        amount: toMoney(row.amount),
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: toIso(row.created_at),
      })),
      totalOutstanding: sum(items),
      totalOverdue: sum(items.filter((item: any) => item.status === "Overdue")),
    };
  },

  async recordPayment(ctx: HostelContext, invoiceId: string, input: PaymentInput) {
    const today = await getToday(ctx.institutionId);
    if (input.paymentDate > today) {
      throw new HostelError(400, "Payment date cannot be in the future.");
    }
    const methods = await hostelPaymentMethods.list(ctx.institutionId);
    if (!methods.some((item) => item.method === input.method && item.enabled)) {
      throw new HostelError(400, `The payment method ${input.method} is disabled.`);
    }

    return postgresService
      .transaction(async (tx) => {
        // A repeated request returns the first result instead of paying twice.
        if (input.idempotencyKey) {
          const repeat = await tx.query(
            `${PAYMENT_SELECT} WHERE p.institution_id = $1 AND p.idempotency_key = $2`,
            [ctx.institutionId, input.idempotencyKey]
          );
          if (repeat.rows[0]) {
            return { payment: paymentFromRow(repeat.rows[0]), isRepeat: true };
          }
        }

        return { payment: await postPayment(tx, ctx, invoiceId, input), isRepeat: false };
      })
      .catch((err) => {
        throw toHostelError(err);
      });
  },

  async listPayments(institutionId: string) {
    const { rows } = await postgresService.query(
      `${PAYMENT_SELECT} WHERE p.institution_id = $1 ORDER BY p.created_at DESC`,
      [institutionId]
    );
    return rows.map(paymentFromRow);
  },

  async getPayment(institutionId: string, id: string) {
    const { rows } = await postgresService.query(
      `${PAYMENT_SELECT} WHERE p.institution_id = $1 AND p.id = $2`,
      [institutionId, id]
    );
    if (!rows[0]) throw new HostelError(404, "Payment not found.");
    return paymentFromRow(rows[0]);
  },

  reversePayment(ctx: HostelContext, id: string, reason: string) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM hostel_payments WHERE institution_id = $1 AND id = $2 FOR UPDATE",
        [ctx.institutionId, id]
      );
      const payment = rows[0];
      if (!payment) throw new HostelError(404, "Payment not found.");
      if (payment.status === "Reversed") {
        throw new HostelError(409, "This payment is already reversed.");
      }

      await tx.query(
        `UPDATE hostel_payments SET status = 'Reversed', reversed_at = NOW(), reversed_by = $2,
           reversal_reason = $3
         WHERE id = $1`,
        [id, ctx.actorEmail, reason]
      );
      await writeAudit(
        tx,
        ctx,
        "Reversed",
        "Payment",
        id,
        `Reversed payment ${payment.receipt_number} of ${toMoney(payment.amount)} from ${payment.student_id}. Reason: ${reason}`
      );

      const saved = await tx.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
      return paymentFromRow(saved.rows[0]);
    });
  },

  adjustInvoice(ctx: HostelContext, invoiceId: string, input: { amount: number; reason: string }) {
    return postgresService.transaction(async (tx) => {
      const lock = await tx.query(
        "SELECT id FROM hostel_invoices WHERE institution_id = $1 AND id = $2 FOR UPDATE",
        [ctx.institutionId, invoiceId]
      );
      if (!lock.rows[0]) throw new HostelError(404, "Invoice not found.");

      const { rows } = await tx.query("SELECT * FROM hostel_invoice_balances WHERE id = $1", [invoiceId]);
      const invoice = rows[0];
      const nextDue = toCents(toMoney(invoice.amount_due)) + toCents(input.amount);

      if (nextDue < 0) {
        throw new HostelError(400, "An adjustment cannot make the amount owed less than 0.");
      }
      if (nextDue < toCents(toMoney(invoice.paid_amount))) {
        throw new HostelError(
          400,
          "An adjustment cannot make the amount owed less than what was paid. Reverse the payment first."
        );
      }

      const id = newId();
      await tx.query(
        `INSERT INTO hostel_invoice_adjustments (id, institution_id, invoice_id, amount, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, ctx.institutionId, invoiceId, input.amount, input.reason, ctx.actorEmail]
      );
      await writeAudit(
        tx,
        ctx,
        "Adjusted",
        "Invoice",
        invoiceId,
        `Adjusted ${invoice.invoice_number} by ${input.amount}. Reason: ${input.reason}`
      );
      return { id, invoiceId, amount: input.amount, reason: input.reason };
    });
  },

  async dueRentCount(institutionId: string) {
    const today = await getToday(institutionId);
    const { rows } = await postgresService.query(
      `SELECT COUNT(DISTINCT LOWER(student_id))::int AS students, COUNT(*)::int AS invoices,
         COALESCE(SUM(outstanding_amount), 0) AS total_outstanding
       FROM hostel_invoice_balances
       WHERE institution_id = $1 AND due_date < $2 AND outstanding_amount > 0 AND category = 'RENT'`,
      [institutionId, today]
    );
    return {
      students: rows[0].students,
      invoices: rows[0].invoices,
      totalOutstanding: toMoney(rows[0].total_outstanding),
    };
  },

  async listDueRent(
    institutionId: string,
    filters: {
      buildingId?: string;
      room?: string;
      month?: string;
      dueOn?: string;
      paymentState?: string;
      query?: string;
    } = {}
  ) {
    const today = await getToday(institutionId);
    const values: unknown[] = [institutionId, today];
    let where =
      "i.institution_id = $1 AND i.due_date < $2 AND i.outstanding_amount > 0 AND i.category = 'RENT'";
    const add = (clause: (index: number) => string, value: unknown) => {
      values.push(value);
      where += ` AND ${clause(values.length)}`;
    };

    if (filters.buildingId) add((n) => `i.building_id = $${n}`, filters.buildingId);
    if (filters.room) add((n) => `LOWER(i.room_number) = LOWER($${n})`, filters.room);
    if (filters.month) add((n) => `i.billing_month = $${n}`, `${filters.month.slice(0, 7)}-01`);
    if (filters.dueOn) add((n) => `i.due_date = $${n}`, filters.dueOn);
    if (filters.query) {
      add(
        (n) => `(LOWER(i.student_name) LIKE $${n} OR LOWER(i.student_id) LIKE $${n})`,
        `%${filters.query.toLowerCase()}%`
      );
    }
    if (filters.paymentState === "Partially Paid") where += " AND i.paid_amount > 0";
    if (filters.paymentState === "Unpaid") where += " AND i.paid_amount = 0";

    const { rows } = await postgresService.query(
      `${INVOICE_SELECT} WHERE ${where} ORDER BY i.due_date, i.student_name`,
      values
    );

    const options = await postgresService.query(
      `SELECT DISTINCT i.building_id, i.hostel_name, i.building_name, i.room_number, i.billing_month
       FROM hostel_invoice_balances i
       WHERE i.institution_id = $1 AND i.due_date < $2 AND i.outstanding_amount > 0 AND i.category = 'RENT'`,
      [institutionId, today]
    );

    const buildings = new Map<string, string>();
    options.rows.forEach((row: any) => {
      if (row.building_id) buildings.set(row.building_id, `${row.hostel_name} · ${row.building_name}`);
    });

    return {
      rows: rows.map((row: any) => invoiceFromRow(row, today)),
      filterOptions: {
        buildings: [...buildings.entries()].map(([id, label]) => ({ id, label })),
        rooms: [...new Set(options.rows.map((row: any) => row.room_number))].sort(),
        months: [...new Set(options.rows.map((row: any) => row.billing_month))].sort().reverse(),
      },
    };
  },
};
