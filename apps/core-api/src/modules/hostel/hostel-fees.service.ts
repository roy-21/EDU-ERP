import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { createChargeInvoice, invoiceStatus } from "./hostel-billing.service";
import { getRentSettings, getToday } from "./hostel-rent.repository";
import {
  HostelContext,
  HostelError,
  addMonths,
  monthOf,
  newId,
  toHostelError,
  toIso,
  toMoney,
  writeAudit,
} from "./hostel.common";

const FREQUENCIES = ["ONE_TIME", "MONTHLY"];
const SCOPES = ["ALL", "BUILDING", "ROOM", "SEAT", "STUDENTS", "GROUP"];
const MONEY_LIMIT = 10_000_000;

const invalid = (message: string): never => {
  throw new HostelError(400, message);
};

const text = (value: unknown, label: string, max: number, required = false): string => {
  if (value !== undefined && value !== null && typeof value !== "string") invalid(`${label} must be text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) invalid(`${label} is required.`);
  if (result.length > max) invalid(`${label} must be ${max} characters or fewer.`);
  return result;
};

export const parseFeeType = (body: any) => {
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MONEY_LIMIT || Math.round(amount * 100) / 100 !== amount) {
    invalid("Amount must be more than 0, with up to 2 decimal places.");
  }
  if (!FREQUENCIES.includes(body?.frequency)) invalid("Billing frequency must be one time or monthly.");
  const dueDays = Number(body?.dueDays ?? 7);
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 90) invalid("Days to pay must be a whole number from 0 to 90.");
  const effectiveDate = text(body?.effectiveDate, "Effective date", 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) invalid("Effective date must be a date.");
  return {
    name: text(body?.name, "Fee name", 100, true),
    description: text(body?.description, "Description", 500),
    amount,
    frequency: body.frequency as string,
    dueDays,
    effectiveDate,
    active: body?.active !== false,
  };
};

const feeFromRow = (row: any) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  amount: toMoney(row.amount),
  frequency: row.frequency,
  dueDays: row.due_days,
  effectiveDate: row.effective_date,
  active: row.active,
  assignments: Number(row.assignments ?? 0),
  createdAt: toIso(row.created_at),
});

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const inTransaction = <T>(work: (tx: PoolClient) => Promise<T>) =>
  postgresService.transaction(work).catch((err) => {
    throw toHostelError(err);
  });

// Students an assignment covers right now, worked out from where they live.
const MATCHING = `
  SELECT a.id, a.billing_from, a.start_date, a.end_date, a.status
  FROM hostel_allocations a
  LEFT JOIN hostel_rooms r ON r.id = a.room_id
  WHERE a.institution_id = $1 AND a.status IN ('Allocated', 'Vacated') AND a.billing_active AND a.start_date IS NOT NULL
    AND (
      $2 = 'ALL'
      OR ($2 = 'BUILDING' AND r.building_id = ANY($3))
      OR ($2 = 'ROOM' AND a.room_id = ANY($3))
      OR ($2 = 'SEAT' AND a.seat_id = ANY($3))
      OR ($2 = 'STUDENTS' AND a.id = ANY($3))
      OR ($2 = 'GROUP' AND a.id IN (
        SELECT m.allocation_id FROM hostel_student_group_members m
        JOIN hostel_student_groups g ON g.id = m.group_id
        WHERE g.institution_id = $1 AND m.group_id = ANY($3)))
    )`;

// One late fee per overdue rent invoice, once its grace days have passed.
// The source key is the invoice, so a rerun never charges twice.
export const applyLateFees = async (institutionId: string, options: { today?: string } = {}) => {
  const settings = await getRentSettings(institutionId);
  if (settings.lateFeeType === "NONE" || !settings.lateFeeStartsOn) return { created: 0, errors: [] as string[] };
  const today = options.today || (await getToday(institutionId));
  const { rows } = await postgresService.query(
    `SELECT v.id, v.allocation_id, v.invoice_number, v.billing_month, v.amount_due
     FROM hostel_invoice_balances v
     WHERE v.institution_id = $1 AND v.category = 'RENT' AND v.outstanding_amount > 0
       AND v.due_date >= $2 AND v.due_date + $3::int < $4::date
       AND NOT EXISTS (SELECT 1 FROM hostel_invoices f WHERE f.source_type = 'LATE_FEE' AND f.source_id = v.id)`,
    [institutionId, settings.lateFeeStartsOn, settings.lateFeeGraceDays, today]
  );
  let created = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const amount = settings.lateFeeType === "FLAT"
      ? settings.lateFeeValue
      : Math.round(toMoney(row.amount_due) * settings.lateFeeValue) / 100;
    if (amount <= 0) continue;
    try {
      const id = await postgresService.transaction((tx) =>
        createChargeInvoice(tx, {
          allocationId: row.allocation_id,
          category: "FEE",
          title: `Late fee for ${row.invoice_number}`,
          amount,
          billingMonth: row.billing_month,
          dueDate: plusDays(today, 7),
          sourceType: "LATE_FEE",
          sourceId: row.id,
          items: [{
            description: settings.lateFeeType === "FLAT" ? `Late payment of ${row.invoice_number}` : `Late payment of ${row.invoice_number} (${settings.lateFeeValue}%)`,
            quantity: 1,
            unitPrice: amount,
          }],
        })
      );
      if (id) created += 1;
    } catch (err: any) {
      errors.push(`${row.invoice_number}: ${err.message}`);
    }
  }
  return { created, errors };
};

const parseGroup = (body: any) => {
  const allocationIds = body?.allocationIds ?? [];
  if (!Array.isArray(allocationIds) || allocationIds.length > 1000 || allocationIds.some((item: unknown) => typeof item !== "string")) {
    invalid("Members must be a list of students.");
  }
  return {
    name: text(body?.name, "Group name", 100, true),
    description: text(body?.description, "Description", 500),
    allocationIds: [...new Set<string>(allocationIds)],
  };
};

const setMembers = async (tx: PoolClient, institutionId: string, groupId: string, allocationIds: string[]) => {
  const found = await tx.query("SELECT id FROM hostel_allocations WHERE institution_id = $1 AND id = ANY($2)", [institutionId, allocationIds]);
  if (found.rows.length !== allocationIds.length) throw new HostelError(400, "One or more students were not found.");
  await tx.query("DELETE FROM hostel_student_group_members WHERE group_id = $1 AND NOT (allocation_id = ANY($2))", [groupId, allocationIds]);
  await tx.query(
    `INSERT INTO hostel_student_group_members (group_id, allocation_id)
     SELECT $1, UNNEST($2::varchar[]) ON CONFLICT DO NOTHING`,
    [groupId, allocationIds]
  );
};

export const hostelGroupsService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(
      `SELECT g.*, COALESCE(ARRAY_AGG(m.allocation_id) FILTER (WHERE m.allocation_id IS NOT NULL), '{}') AS members,
         COALESCE(JSON_AGG(JSON_BUILD_OBJECT('allocationId', a.id, 'studentId', a.student_id, 'studentName', a.student_name, 'status', a.status))
           FILTER (WHERE a.id IS NOT NULL), '[]') AS member_details
       FROM hostel_student_groups g
       LEFT JOIN hostel_student_group_members m ON m.group_id = g.id
       LEFT JOIN hostel_allocations a ON a.id = m.allocation_id
       WHERE g.institution_id = $1 GROUP BY g.id ORDER BY g.name`,
      [institutionId]
    );
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      allocationIds: row.members,
      members: row.member_details,
      createdBy: row.created_by,
      createdAt: toIso(row.created_at),
    }));
  },

  create(ctx: HostelContext, body: any) {
    const group = parseGroup(body);
    return inTransaction(async (tx) => {
      const id = newId();
      await tx.query(
        "INSERT INTO hostel_student_groups (id, institution_id, name, description, created_by) VALUES ($1, $2, $3, $4, $5)",
        [id, ctx.institutionId, group.name, group.description, ctx.actorEmail]
      );
      await setMembers(tx, ctx.institutionId, id, group.allocationIds);
      await writeAudit(tx, ctx, "Created", "Student Group", id, `Created group ${group.name} with ${group.allocationIds.length} student(s).`);
      return { id };
    });
  },

  // Membership changes apply to charges raised from now on.
  update(ctx: HostelContext, id: string, body: any) {
    const group = parseGroup(body);
    return inTransaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hostel_student_groups WHERE institution_id = $1 AND id = $2 FOR UPDATE", [ctx.institutionId, id]);
      if (!rows[0]) throw new HostelError(404, "Group not found.");
      await tx.query("UPDATE hostel_student_groups SET name = $2, description = $3, updated_at = NOW() WHERE id = $1", [id, group.name, group.description]);
      await setMembers(tx, ctx.institutionId, id, group.allocationIds);
      await writeAudit(tx, ctx, "Updated", "Student Group", id, `Updated group ${group.name}: ${group.allocationIds.length} student(s).`);
      return { id };
    }).then(async (result) => ({ ...result, billing: await billFees(ctx.institutionId) }));
  },

  remove(ctx: HostelContext, id: string) {
    return inTransaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hostel_student_groups WHERE institution_id = $1 AND id = $2 FOR UPDATE", [ctx.institutionId, id]);
      if (!rows[0]) throw new HostelError(404, "Group not found.");
      const used = await tx.query(
        "SELECT 1 FROM hostel_fee_assignments WHERE institution_id = $1 AND scope = 'GROUP' AND active AND $2 = ANY(target_ids) LIMIT 1",
        [ctx.institutionId, id]
      );
      if (used.rows[0]) throw new HostelError(409, "An active fee is assigned to this group. Stop that fee first.");
      await tx.query("DELETE FROM hostel_student_groups WHERE id = $1", [id]);
      await writeAudit(tx, ctx, "Deleted", "Student Group", id, `Deleted group ${rows[0].name}.`);
      return { id, deleted: true };
    });
  },
};

// Raises each fee as its own invoice. The source key holds the assignment,
// student and month, so running this again never charges twice.
export const billFees = async (institutionId: string, options: { today?: string } = {}) => {
  const today = options.today || (await getToday(institutionId));
  const { rows: assignments } = await postgresService.query(
    `SELECT s.*, f.name, f.amount, f.frequency, f.due_days, f.effective_date
     FROM hostel_fee_assignments s JOIN hostel_fee_types f ON f.id = s.fee_type_id
     WHERE s.institution_id = $1 AND s.active AND f.active AND f.effective_date <= $2`,
    [institutionId, today]
  );

  let created = 0;
  const errors: string[] = [];
  for (const assignment of assignments) {
    const { rows: students } = await postgresService.query(MATCHING, [institutionId, assignment.scope, assignment.target_ids]);
    for (const student of students) {
      try {
        created += await postgresService.transaction(async (tx) => {
          const charges: { month: string; sourceId: string }[] = [];
          if (assignment.frequency === "ONE_TIME") {
            if (student.status !== "Allocated") return 0;
            charges.push({ month: monthOf(today), sourceId: `${assignment.id}:${student.id}` });
          } else {
            const first = [monthOf(assignment.effective_date), student.billing_from || monthOf(student.start_date)].sort().pop() as string;
            const last = student.end_date && monthOf(student.end_date) < monthOf(today) ? monthOf(student.end_date) : monthOf(today);
            for (let month = first; month <= last; month = addMonths(month, 1)) {
              charges.push({ month, sourceId: `${assignment.id}:${student.id}:${month}` });
            }
          }

          let count = 0;
          for (const charge of charges) {
            const issued = charge.month === monthOf(today) ? today : charge.month;
            const id = await createChargeInvoice(tx, {
              allocationId: student.id,
              category: "FEE",
              title: assignment.frequency === "MONTHLY" ? `${assignment.name}, ${charge.month.slice(0, 7)}` : assignment.name,
              amount: toMoney(assignment.amount),
              billingMonth: charge.month,
              dueDate: plusDays(issued, assignment.due_days),
              sourceType: "FEE",
              sourceId: charge.sourceId,
              items: [{ description: assignment.name, quantity: 1, unitPrice: toMoney(assignment.amount) }],
            });
            if (id) count += 1;
          }
          return count;
        });
      } catch (err: any) {
        errors.push(`${assignment.id}/${student.id}: ${err.message}`);
      }
    }
  }
  return { created, errors };
};

export const hostelFeesService = {
  async list(institutionId: string) {
    const [types, assignments] = await Promise.all([
      postgresService.query(
        `SELECT f.*, (SELECT COUNT(*) FROM hostel_fee_assignments s WHERE s.fee_type_id = f.id AND s.active) AS assignments
         FROM hostel_fee_types f WHERE f.institution_id = $1 ORDER BY f.name`,
        [institutionId]
      ),
      postgresService.query(
        `SELECT s.*, f.name FROM hostel_fee_assignments s JOIN hostel_fee_types f ON f.id = s.fee_type_id
         WHERE s.institution_id = $1 ORDER BY s.created_at DESC`,
        [institutionId]
      ),
    ]);
    return {
      feeTypes: types.rows.map(feeFromRow),
      assignments: assignments.rows.map((row: any) => ({
        id: row.id,
        feeTypeId: row.fee_type_id,
        feeName: row.name,
        scope: row.scope,
        targetIds: row.target_ids,
        active: row.active,
        createdBy: row.created_by,
        createdAt: toIso(row.created_at),
      })),
    };
  },

  createType(ctx: HostelContext, body: any) {
    const fee = parseFeeType(body);
    return inTransaction(async (tx) => {
      const id = newId();
      await tx.query(
        `INSERT INTO hostel_fee_types (id, institution_id, name, description, amount, frequency, due_days, effective_date, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, ctx.institutionId, fee.name, fee.description, fee.amount, fee.frequency, fee.dueDays, fee.effectiveDate, fee.active, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Created", "Fee", id, `Created fee ${fee.name}: ${fee.amount}, ${fee.frequency.toLowerCase().replace("_", " ")}.`);
      return { id };
    });
  },

  // A new amount applies to charges raised from now on. Issued invoices stay as they are.
  updateType(ctx: HostelContext, id: string, body: any) {
    const fee = parseFeeType(body);
    return inTransaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hostel_fee_types WHERE institution_id = $1 AND id = $2 FOR UPDATE", [ctx.institutionId, id]);
      if (!rows[0]) throw new HostelError(404, "Fee not found.");
      if (rows[0].frequency !== fee.frequency) {
        throw new HostelError(409, "The billing frequency cannot change after a fee is created. Create a new fee instead.");
      }
      await tx.query(
        `UPDATE hostel_fee_types SET name = $2, description = $3, amount = $4, due_days = $5, effective_date = $6,
           active = $7, updated_at = NOW() WHERE id = $1`,
        [id, fee.name, fee.description, fee.amount, fee.dueDays, fee.effectiveDate, fee.active]
      );
      await writeAudit(tx, ctx, "Updated", "Fee", id, `Updated fee ${fee.name}: ${toMoney(rows[0].amount)} to ${fee.amount}, ${fee.active ? "active" : "inactive"}.`);
      return { id };
    });
  },

  assign(ctx: HostelContext, body: any) {
    const scope = body?.scope;
    if (!SCOPES.includes(scope)) invalid(`Apply to must be one of: ${SCOPES.join(", ")}.`);
    const targets = scope === "ALL" ? [] : body?.targetIds;
    if (scope !== "ALL" && (!Array.isArray(targets) || targets.length === 0 || targets.length > 500 || targets.some((item: unknown) => typeof item !== "string"))) {
      invalid("Choose at least one target.");
    }
    return inTransaction(async (tx) => {
      const fee = await tx.query("SELECT name FROM hostel_fee_types WHERE institution_id = $1 AND id = $2", [ctx.institutionId, String(body?.feeTypeId || "")]);
      if (!fee.rows[0]) throw new HostelError(404, "Fee not found.");
      if (scope === "GROUP") {
        const groups = await tx.query("SELECT id FROM hostel_student_groups WHERE institution_id = $1 AND id = ANY($2)", [ctx.institutionId, targets]);
        if (groups.rows.length !== new Set(targets).size) throw new HostelError(400, "One or more groups were not found.");
      }
      const id = newId();
      await tx.query(
        `INSERT INTO hostel_fee_assignments (id, institution_id, fee_type_id, scope, target_ids, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, ctx.institutionId, body.feeTypeId, scope, targets, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Assigned", "Fee", id, `Assigned ${fee.rows[0].name} to ${scope === "ALL" ? "all students" : `${targets.length} ${scope.toLowerCase()}(s)`}.`);
      return { id };
    }).then(async (result) => ({ ...result, billing: await billFees(ctx.institutionId) }));
  },

  // Stops future charges. Charges already raised stay on the students' invoices.
  setAssignmentActive(ctx: HostelContext, id: string, active: boolean) {
    return inTransaction(async (tx) => {
      const { rows } = await tx.query(
        "UPDATE hostel_fee_assignments SET active = $3 WHERE institution_id = $1 AND id = $2 RETURNING id",
        [ctx.institutionId, id, active]
      );
      if (!rows[0]) throw new HostelError(404, "Assignment not found.");
      await writeAudit(tx, ctx, "Updated", "Fee", id, `Fee assignment ${active ? "resumed" : "stopped"}.`);
      return { id, active };
    });
  },

  // Totals across every kind of hostel charge, from the invoices themselves.
  async overview(institutionId: string) {
    const today = await getToday(institutionId);
    const { rows } = await postgresService.query("SELECT * FROM hostel_invoice_balances WHERE institution_id = $1", [institutionId]);
    const cents = (value: unknown) => Math.round(toMoney(value) * 100);
    const byCategory: Record<string, { expected: number; collected: number; outstanding: number; overdue: number }> = {};
    const counts = { Paid: 0, "Partially Paid": 0, Unpaid: 0, Overdue: 0, Waived: 0 } as Record<string, number>;
    for (const row of rows) {
      const status = invoiceStatus(row, today);
      counts[status] = (counts[status] || 0) + 1;
      const bucket = (byCategory[row.category] ||= { expected: 0, collected: 0, outstanding: 0, overdue: 0 });
      bucket.expected += cents(row.amount_due);
      bucket.collected += cents(row.paid_amount);
      bucket.outstanding += cents(row.outstanding_amount);
      if (status === "Overdue") bucket.overdue += cents(row.outstanding_amount);
    }
    const total = { expected: 0, collected: 0, outstanding: 0, overdue: 0 };
    const categories = Object.entries(byCategory).map(([category, values]) => {
      (Object.keys(total) as (keyof typeof total)[]).forEach((key) => (total[key] += values[key]));
      return { category, expected: values.expected / 100, collected: values.collected / 100, outstanding: values.outstanding / 100, overdue: values.overdue / 100 };
    });
    return {
      expected: total.expected / 100,
      collected: total.collected / 100,
      outstanding: total.outstanding / 100,
      overdue: total.overdue / 100,
      paidRecords: counts.Paid,
      partialRecords: counts["Partially Paid"],
      unpaidRecords: counts.Unpaid + counts.Overdue,
      overdueRecords: counts.Overdue,
      categories,
    };
  },
};
