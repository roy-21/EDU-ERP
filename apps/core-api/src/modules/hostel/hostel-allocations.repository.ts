import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
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
import { createChargeInvoice } from "./hostel-billing.service";
import { getToday } from "./hostel-rent.repository";
import { applyAllocationRent, syncSeatOnAllocate } from "./hostel-rent-sync.service";
import { roomLabel } from "./hostel-rooms.repository";
import { AllocationInput, assertReadyToAllocate } from "./hostel.validation";

const maskNid = (nid: string): string => (nid ? `•••••••${nid.slice(-3)}` : "");

const fromRow = (row: any, revealNid = false) => ({
  id: row.id,
  studentId: row.student_id,
  studentName: row.student_name,
  department: row.department,
  studentPhone: row.student_phone,
  studentEmail: row.student_email,
  studentNid: revealNid ? row.student_nid : maskNid(row.student_nid),
  guardianName: row.guardian_name,
  guardianPhone: row.guardian_phone,
  guardianNid: revealNid ? row.guardian_nid : maskNid(row.guardian_nid),
  guardianRelationship: row.guardian_relationship,
  preferredHostel: row.preferred_hostel,
  notes: row.notes,
  status: row.status,
  monthlyRent: toMoney(row.monthly_rent),
  securityDeposit: toMoney(row.security_deposit),
  startDate: row.start_date,
  endDate: row.end_date,
  firstDueDate: row.first_due_date,
  billingActive: row.billing_active,
  roomId: row.room_id,
  seatId: row.seat_id,
  roomLabel: row.room_label,
  seatNumber: row.seat_number,
  rejectReason: row.reject_reason,
  allocatedAt: toIso(row.allocated_at),
  vacatedAt: toIso(row.vacated_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

// Locks the room first, the same order capacity changes use, so a seat cannot
// be removed while it is being given to a student.
const claimSeat = async (tx: PoolClient, institutionId: string, seatId: string) => {
  const { rows } = await tx.query(
    `SELECT s.id, s.seat_number, r.id AS room_id, r.hostel_name, r.building,
       r.room_number, r.under_maintenance, r.closed
     FROM hostel_seats s JOIN hostel_rooms r ON r.id = s.room_id
     WHERE s.institution_id = $1 AND s.id = $2 FOR UPDATE OF r, s`,
    [institutionId, seatId]
  );
  const seat = rows[0];
  if (!seat) throw new HostelError(404, "Seat not found.");
  if (seat.closed) {
    throw new HostelError(409, `Room ${seat.room_number} is closed, so its seats cannot be allocated.`);
  }

  const blocking = await tx.query(
    `SELECT 1 FROM hostel_maintenance_tickets
     WHERE room_id = $1 AND status <> 'Resolved' AND blocks_room LIMIT 1`,
    [seat.room_id]
  );
  if (seat.under_maintenance || blocking.rows.length > 0) {
    throw new HostelError(409, `Room ${seat.room_number} is under maintenance, so its seats cannot be allocated.`);
  }

  const occupied = await tx.query(
    "SELECT 1 FROM hostel_allocations WHERE seat_id = $1 AND status = 'Allocated' LIMIT 1",
    [seatId]
  );
  if (occupied.rows.length > 0) {
    throw new HostelError(409, "This seat is already occupied. Choose a different seat.");
  }

  await tx.query("UPDATE hostel_seats SET reserved = FALSE WHERE id = $1", [seatId]);
  return seat;
};

const lockAllocation = async (tx: PoolClient, institutionId: string, id: string) => {
  const { rows } = await tx.query(
    "SELECT * FROM hostel_allocations WHERE institution_id = $1 AND id = $2 FOR UPDATE",
    [institutionId, id]
  );
  if (!rows[0]) throw new HostelError(404, "Allocation not found.");
  return rows[0];
};

const setSeat = (tx: PoolClient, id: string, seat: any) =>
  tx.query(
    `UPDATE hostel_allocations SET status = 'Allocated', room_id = $2, seat_id = $3,
       room_label = $4, seat_number = $5, allocated_at = COALESCE(allocated_at, NOW()),
       updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, seat.room_id, seat.id, roomLabel(seat), seat.seat_number]
  );

const saveRent = (tx: PoolClient, id: string, month: string, rent: number, actor: string) =>
  tx.query(
    `INSERT INTO hostel_allocation_rents (allocation_id, effective_month, monthly_rent, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (allocation_id, effective_month)
     DO UPDATE SET monthly_rent = EXCLUDED.monthly_rent, created_by = EXCLUDED.created_by`,
    [id, month, rent, actor]
  );

// Starts billing on a new allocation. The agreed rent becomes the seat's fee, and a
// security deposit becomes its own invoice, so it is collected like any other charge.
const startBilling = async (
  tx: PoolClient,
  ctx: HostelContext,
  id: string,
  seatId: string,
  details: { monthlyRent: number; securityDeposit: number; startDate: string; firstDueDate: string | null }
) => {
  const month = monthOf(details.startDate);
  const { rows } = await tx.query(
    `UPDATE hostel_allocations SET monthly_rent = $2, security_deposit = $3, start_date = $4,
       first_due_date = $5, billing_from = $6, billing_active = TRUE
     WHERE id = $1 RETURNING *`,
    [id, details.monthlyRent, details.securityDeposit, details.startDate, details.firstDueDate, month]
  );
  await saveRent(tx, id, month, details.monthlyRent, ctx.actorEmail);
  await syncSeatOnAllocate(tx, ctx, rows[0], seatId, details.monthlyRent, month);

  if (details.securityDeposit > 0) {
    await createChargeInvoice(tx, {
      allocationId: id,
      category: "DEPOSIT",
      title: "Security deposit",
      amount: details.securityDeposit,
      billingMonth: month,
      dueDate: details.firstDueDate || details.startDate,
      sourceType: "DEPOSIT",
      sourceId: id,
      items: [{ description: "Refundable security deposit", quantity: 1, unitPrice: details.securityDeposit }],
    });
  }
};

const inTransaction = <T>(work: (tx: PoolClient) => Promise<T>) =>
  postgresService.transaction(work).catch((err) => {
    throw toHostelError(err);
  });

const FIELD_COLUMNS: Record<keyof AllocationInput, string> = {
  studentId: "student_id",
  studentName: "student_name",
  department: "department",
  studentPhone: "student_phone",
  studentEmail: "student_email",
  studentNid: "student_nid",
  guardianName: "guardian_name",
  guardianPhone: "guardian_phone",
  guardianNid: "guardian_nid",
  guardianRelationship: "guardian_relationship",
  preferredHostel: "preferred_hostel",
  notes: "notes",
  monthlyRent: "monthly_rent",
  securityDeposit: "security_deposit",
  startDate: "start_date",
  firstDueDate: "first_due_date",
  billingActive: "billing_active",
};

export const STUDENT_FIELDS: (keyof AllocationInput)[] = [
  "studentId",
  "studentName",
  "department",
  "studentPhone",
  "studentEmail",
  "studentNid",
  "guardianName",
  "guardianPhone",
  "guardianNid",
  "guardianRelationship",
];

const isSame = (key: keyof AllocationInput, current: unknown, next: unknown) =>
  key === "monthlyRent" || key === "securityDeposit"
    ? toMoney(current) === next
    : (current ?? null) === (next ?? null);

export const hostelAllocationsRepository = {
  async list(institutionId: string, roomId?: string) {
    const result = await postgresService.query(
      `SELECT * FROM hostel_allocations WHERE institution_id = $1
       ${roomId ? "AND room_id = $2" : ""} ORDER BY created_at DESC`,
      roomId ? [institutionId, roomId] : [institutionId]
    );
    return result.rows.map((row: any) => fromRow(row));
  },

  async get(institutionId: string, id: string, revealNid: boolean) {
    const { rows } = await postgresService.query(
      "SELECT * FROM hostel_allocations WHERE institution_id = $1 AND id = $2",
      [institutionId, id]
    );
    if (!rows[0]) throw new HostelError(404, "Allocation not found.");
    return fromRow(rows[0], revealNid);
  },

  create(ctx: HostelContext, input: AllocationInput, seatId: string | null) {
    return inTransaction(async (tx) => {
      if (seatId) assertReadyToAllocate(input);

      const id = newId();
      const { rows } = await tx.query(
        `INSERT INTO hostel_allocations (id, institution_id, student_id, student_name,
           department, student_phone, student_email, student_nid, guardian_name, guardian_phone,
           guardian_nid, guardian_relationship, preferred_hostel, notes, monthly_rent,
           security_deposit, start_date, first_due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [
          id,
          ctx.institutionId,
          input.studentId,
          input.studentName,
          input.department,
          input.studentPhone,
          input.studentEmail,
          input.studentNid,
          input.guardianName,
          input.guardianPhone,
          input.guardianNid,
          input.guardianRelationship,
          input.preferredHostel,
          input.notes,
          input.monthlyRent,
          input.securityDeposit,
          input.startDate,
          input.firstDueDate,
        ]
      );

      if (!seatId) {
        await writeAudit(tx, ctx, "Created", "Allocation", id, `New hostel application for ${input.studentName} (${input.studentId}).`);
        return fromRow(rows[0]);
      }

      const seat = await claimSeat(tx, ctx.institutionId, seatId);
      await setSeat(tx, id, seat);
      await startBilling(tx, ctx, id, seatId, {
        monthlyRent: input.monthlyRent,
        securityDeposit: input.securityDeposit,
        startDate: input.startDate as string,
        firstDueDate: input.firstDueDate,
      });
      if (!input.billingActive) {
        await tx.query("UPDATE hostel_allocations SET billing_active = FALSE WHERE id = $1", [id]);
      }
      await writeAudit(tx, ctx, "Allocated", "Allocation", id, `Allocated ${input.studentName} (${input.studentId}) to seat ${seat.seat_number}, ${roomLabel(seat)}, at rent ${input.monthlyRent}.`);

      const created = await tx.query("SELECT * FROM hostel_allocations WHERE id = $1", [id]);
      return fromRow(created.rows[0]);
    });
  },

  // Saves only the fields that changed. Issued invoices are never touched: a new
  // rent applies from the first month that has no invoice yet.
  update(ctx: HostelContext, id: string, changes: Partial<AllocationInput>, revealNid: boolean) {
    return inTransaction(async (tx) => {
      const current = await lockAllocation(tx, ctx.institutionId, id);
      if (current.status !== "Pending" && current.status !== "Allocated") {
        throw new HostelError(409, `A ${current.status.toLowerCase()} allocation cannot be edited.`);
      }

      const changedKeys = (Object.keys(changes) as (keyof AllocationInput)[]).filter(
        (key) => !isSame(key, current[FIELD_COLUMNS[key]], changes[key])
      );
      if (changedKeys.length === 0) return fromRow(current, revealNid);

      const merged = fromRow({ ...current, student_nid: "", guardian_nid: "" });
      const next = { ...merged, ...changes };
      if (current.status === "Allocated") {
        assertReadyToAllocate(next as any);
      }

      const lastInvoice = await tx.query(
        "SELECT MAX(billing_month) AS month FROM hostel_invoices WHERE allocation_id = $1",
        [id]
      );
      const invoicedThrough: string | null = lastInvoice.rows[0].month;

      if (changedKeys.includes("startDate") && invoicedThrough) {
        throw new HostelError(
          409,
          "The start date cannot change after invoices are issued. Use an invoice adjustment to correct a charge."
        );
      }

      const assignments = changedKeys.map((key, index) => `${FIELD_COLUMNS[key]} = $${index + 2}`);
      const values = changedKeys.map((key) => changes[key]);
      const { rows } = await tx.query(
        `UPDATE hostel_allocations SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, ...values]
      );

      if (current.status === "Allocated") {
        if (changedKeys.includes("startDate") && changes.startDate) {
          const month = monthOf(changes.startDate);
          await tx.query("UPDATE hostel_allocations SET billing_from = $2 WHERE id = $1", [id, month]);
          await tx.query("DELETE FROM hostel_allocation_rents WHERE allocation_id = $1", [id]);
          await saveRent(tx, id, month, next.monthlyRent, ctx.actorEmail);
        } else if (changedKeys.includes("monthlyRent")) {
          // The same service as Edit Seat, so the seat's fee follows.
          await applyAllocationRent(tx, ctx, current, changes.monthlyRent as number, { source: "ALLOCATION" });
        }

        // Months while billing was inactive are not charged later.
        if (changes.billingActive === true && !current.billing_active) {
          const today = await getToday(ctx.institutionId);
          await tx.query(
            "UPDATE hostel_allocations SET billing_from = GREATEST(billing_from, $2::date) WHERE id = $1",
            [id, monthOf(today)]
          );
        }
      }

      // Records which fields changed, without NID numbers or other values.
      const rentNote = changedKeys.includes("monthlyRent")
        ? ` Rent ${toMoney(current.monthly_rent)} to ${changes.monthlyRent}.`
        : "";
      await writeAudit(
        tx,
        ctx,
        "Updated",
        "Allocation",
        id,
        `Updated ${rows[0].student_name} (${rows[0].student_id}): ${changedKeys.join(", ")}.${rentNote}`
      );

      const updated = await tx.query("SELECT * FROM hostel_allocations WHERE id = $1", [id]);
      return fromRow(updated.rows[0], revealNid);
    });
  },

  // Gives a pending application a seat, or moves an allocated student to a new one.
  assignSeat(
    ctx: HostelContext,
    id: string,
    seatId: string,
    billing: { monthlyRent?: number; securityDeposit?: number; startDate?: string | null; firstDueDate?: string | null }
  ) {
    return inTransaction(async (tx) => {
      const current = await lockAllocation(tx, ctx.institutionId, id);
      if (current.status !== "Pending" && current.status !== "Allocated") {
        throw new HostelError(409, `A ${current.status.toLowerCase()} application cannot be given a seat.`);
      }
      const isTransfer = current.status === "Allocated";

      const details = {
        monthlyRent: billing.monthlyRent ?? toMoney(current.monthly_rent),
        securityDeposit: billing.securityDeposit ?? toMoney(current.security_deposit),
        startDate: billing.startDate ?? current.start_date,
        firstDueDate: billing.firstDueDate ?? current.first_due_date,
      };
      if (!isTransfer) {
        assertReadyToAllocate({
          studentPhone: current.student_phone,
          guardianName: current.guardian_name,
          guardianPhone: current.guardian_phone,
          monthlyRent: details.monthlyRent,
          startDate: details.startDate,
        });
      }

      const seat = await claimSeat(tx, ctx.institutionId, seatId);
      await setSeat(tx, id, seat);
      if (!isTransfer) await startBilling(tx, ctx, id, seatId, details);
      // A move keeps the student's rent, so the new seat shows it.
      if (isTransfer) {
        await syncSeatOnAllocate(tx, ctx, current, seatId, toMoney(current.monthly_rent), monthOf(await getToday(ctx.institutionId)));
      }

      await writeAudit(
        tx,
        ctx,
        isTransfer ? "Transferred" : "Allocated",
        "Allocation",
        id,
        isTransfer
          ? `Moved ${current.student_name} from seat ${current.seat_number}, ${current.room_label} to seat ${seat.seat_number}, ${roomLabel(seat)}.`
          : `Allocated ${current.student_name} (${current.student_id}) to seat ${seat.seat_number}, ${roomLabel(seat)}, at rent ${details.monthlyRent}.`
      );

      const updated = await tx.query("SELECT * FROM hostel_allocations WHERE id = $1", [id]);
      return fromRow(updated.rows[0]);
    });
  },

  reject(ctx: HostelContext, id: string, reason: string) {
    return inTransaction(async (tx) => {
      const current = await lockAllocation(tx, ctx.institutionId, id);
      if (current.status !== "Pending") {
        throw new HostelError(409, "Only a pending application can be rejected.");
      }

      const { rows } = await tx.query(
        `UPDATE hostel_allocations SET status = 'Rejected', reject_reason = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, reason]
      );
      await writeAudit(tx, ctx, "Rejected", "Allocation", id, `Rejected application of ${current.student_name} (${current.student_id}).`);
      return fromRow(rows[0]);
    });
  },

  // Ends the allocation. The seat becomes free and billing stops after the end
  // month, while anything still owed stays on the student's invoices.
  vacate(ctx: HostelContext, id: string, endDate: string | null) {
    return inTransaction(async (tx) => {
      const current = await lockAllocation(tx, ctx.institutionId, id);
      if (current.status !== "Allocated") {
        throw new HostelError(409, "Only an allocated student can vacate a seat.");
      }

      const end = endDate || (await getToday(ctx.institutionId));
      if (current.start_date && end < current.start_date) {
        throw new HostelError(400, "The end date cannot be before the allocation start date.");
      }

      const { rows } = await tx.query(
        `UPDATE hostel_allocations SET status = 'Vacated', vacated_at = NOW(), end_date = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, end]
      );
      await writeAudit(tx, ctx, "Vacated", "Allocation", id, `${current.student_name} vacated seat ${current.seat_number}, ${current.room_label}, on ${end}.`);
      return fromRow(rows[0]);
    });
  },

  remove(ctx: HostelContext, id: string) {
    return inTransaction(async (tx) => {
      const current = await lockAllocation(tx, ctx.institutionId, id);
      if (current.status !== "Pending" && current.status !== "Rejected") {
        throw new HostelError(409, "Allocated and vacated records are kept as history and cannot be deleted.");
      }

      await tx.query("DELETE FROM hostel_allocations WHERE id = $1", [id]);
      await writeAudit(tx, ctx, "Deleted", "Allocation", id, `Deleted application of ${current.student_name} (${current.student_id}).`);
    });
  },

  async countPending(institutionId: string): Promise<number> {
    const { rows } = await postgresService.query(
      "SELECT COUNT(*)::int AS count FROM hostel_allocations WHERE institution_id = $1 AND status = 'Pending'",
      [institutionId]
    );
    return rows[0].count;
  },
};
