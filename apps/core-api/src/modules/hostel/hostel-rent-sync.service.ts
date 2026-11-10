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
import { getToday } from "./hostel-rent.repository";

// One place for rent. The seat's fee is the default for the next student. An
// active allocation's rent is the student's contract. A change made from either
// screen updates both, takes effect from the first month not yet invoiced, and
// is written to hostel_rent_changes. Issued invoices never change.
//
// Lock order is always allocation, then seat, the same order used when a seat is
// assigned, so two people changing rent at once cannot deadlock.

type Source = "SEAT" | "ALLOCATION" | "ALLOCATED";

const toCents = (value: number) => Math.round(value * 100);

const seatLabel = (row: any) =>
  `${row.hostel_name}, ${row.building}, room ${row.room_number}, seat ${row.seat_number}`;

export const recordRentChange = (
  tx: PoolClient,
  ctx: HostelContext,
  change: {
    seat: any;
    allocation?: any;
    oldAmount: number | null;
    newAmount: number;
    effectiveMonth: string | null;
    source: Source;
  }
) =>
  tx.query(
    `INSERT INTO hostel_rent_changes (id, institution_id, seat_id, allocation_id, seat_label, student_id,
       old_amount, new_amount, effective_month, source, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      newId(),
      ctx.institutionId,
      change.seat?.id ?? null,
      change.allocation?.id ?? null,
      change.seat ? seatLabel(change.seat) : "",
      change.allocation?.student_id ?? "",
      change.oldAmount,
      change.newAmount,
      change.effectiveMonth,
      change.source,
      ctx.actorEmail,
    ]
  );

// The first month a new rent can apply to: after the last rent invoice, and
// never before the month the student started.
export const nextUninvoicedMonth = async (tx: PoolClient, allocation: any): Promise<string> => {
  const { rows } = await tx.query(
    "SELECT MAX(billing_month) AS month FROM hostel_invoices WHERE allocation_id = $1 AND category = 'RENT'",
    [allocation.id]
  );
  return rows[0].month ? addMonths(rows[0].month, 1) : allocation.billing_from || monthOf(allocation.start_date);
};

const saveContractRent = (tx: PoolClient, allocationId: string, month: string, rent: number, actor: string) =>
  tx.query(
    `INSERT INTO hostel_allocation_rents (allocation_id, effective_month, monthly_rent, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (allocation_id, effective_month)
     DO UPDATE SET monthly_rent = EXCLUDED.monthly_rent, created_by = EXCLUDED.created_by`,
    [allocationId, month, rent, actor]
  );

const lockSeat = async (tx: PoolClient, institutionId: string, seatId: string) => {
  const { rows } = await tx.query(
    `SELECT s.*, r.hostel_name, r.building, r.room_number
     FROM hostel_seats s JOIN hostel_rooms r ON r.id = s.room_id
     WHERE s.institution_id = $1 AND s.id = $2 FOR UPDATE OF s`,
    [institutionId, seatId]
  );
  if (!rows[0]) throw new HostelError(404, "Seat not found.");
  return rows[0];
};

// Changes an active allocation's rent and keeps its seat in step. The caller has
// already locked the allocation row.
export const applyAllocationRent = async (
  tx: PoolClient,
  ctx: HostelContext,
  allocation: any,
  amount: number,
  options: { effectiveMonth?: string | null; source: Source }
) => {
  const earliest = await nextUninvoicedMonth(tx, allocation);
  const effective = options.effectiveMonth ? monthOf(options.effectiveMonth) : earliest;
  if (effective < earliest) {
    throw new HostelError(
      400,
      `Rent can change from ${earliest.slice(0, 7)} onwards. Earlier months are already invoiced; use an invoice adjustment for those.`
    );
  }

  await saveContractRent(tx, allocation.id, effective, amount, ctx.actorEmail);
  await tx.query("UPDATE hostel_allocations SET monthly_rent = $2, updated_at = NOW() WHERE id = $1", [
    allocation.id,
    amount,
  ]);

  const seat = allocation.seat_id ? await lockSeat(tx, ctx.institutionId, allocation.seat_id) : null;
  if (seat) {
    await tx.query("UPDATE hostel_seats SET monthly_fee = $2 WHERE id = $1", [seat.id, amount]);
  }
  await recordRentChange(tx, ctx, {
    seat,
    allocation,
    oldAmount: toMoney(allocation.monthly_rent),
    newAmount: amount,
    effectiveMonth: effective,
    source: options.source,
  });
  return { effectiveMonth: effective, seat };
};

// Called when a student is placed on a seat: the agreed rent becomes the seat's fee.
export const syncSeatOnAllocate = async (
  tx: PoolClient,
  ctx: HostelContext,
  allocation: any,
  seatId: string,
  amount: number,
  effectiveMonth: string
) => {
  const seat = await lockSeat(tx, ctx.institutionId, seatId);
  if (toCents(toMoney(seat.monthly_fee)) !== toCents(amount)) {
    await tx.query("UPDATE hostel_seats SET monthly_fee = $2 WHERE id = $1", [seatId, amount]);
  }
  await recordRentChange(tx, ctx, {
    seat,
    allocation,
    oldAmount: toMoney(seat.monthly_fee),
    newAmount: amount,
    effectiveMonth,
    source: "ALLOCATED",
  });
};

const activeAllocationOn = async (tx: PoolClient, seatId: string, lock: boolean) => {
  const { rows } = await tx.query(
    `SELECT * FROM hostel_allocations WHERE seat_id = $1 AND status = 'Allocated' ${lock ? "FOR UPDATE" : ""}`,
    [seatId]
  );
  return rows[0] || null;
};

const inTransaction = <T>(work: (tx: PoolClient) => Promise<T>) =>
  postgresService.transaction(work).catch((err) => {
    throw toHostelError(err);
  });

export const hostelRentSync = {
  // Edit Seat and the Rent action both come here.
  updateSeat(
    ctx: HostelContext,
    seatId: string,
    input: { monthlyFee: number; reserved?: boolean; effectiveMonth?: string | null }
  ) {
    return inTransaction(async (tx) => {
      // Lock the student first, then the seat, then check nothing moved in between.
      const candidate = await activeAllocationOn(tx, seatId, false);
      const allocation = candidate ? await activeAllocationOn(tx, seatId, true) : null;
      const seat = await lockSeat(tx, ctx.institutionId, seatId);
      if (candidate && (!allocation || allocation.id !== candidate.id)) {
        throw new HostelError(409, "This seat changed while you were editing. Reload and try again.");
      }

      if (allocation && input.reserved) {
        throw new HostelError(409, "An occupied seat cannot be reserved.");
      }
      const reserved = input.reserved ?? seat.reserved;
      const feeChanged = toCents(toMoney(seat.monthly_fee)) !== toCents(input.monthlyFee);
      const rentChanged = allocation && toCents(toMoney(allocation.monthly_rent)) !== toCents(input.monthlyFee);

      let effectiveMonth: string | null = null;
      if (allocation && (rentChanged || input.effectiveMonth)) {
        ({ effectiveMonth } = await applyAllocationRent(tx, ctx, allocation, input.monthlyFee, {
          effectiveMonth: input.effectiveMonth,
          source: "SEAT",
        }));
      } else if (feeChanged) {
        await tx.query("UPDATE hostel_seats SET monthly_fee = $2 WHERE id = $1", [seatId, input.monthlyFee]);
        await recordRentChange(tx, ctx, {
          seat,
          oldAmount: toMoney(seat.monthly_fee),
          newAmount: input.monthlyFee,
          effectiveMonth: null,
          source: "SEAT",
        });
      }
      await tx.query("UPDATE hostel_seats SET reserved = $2 WHERE id = $1", [seatId, reserved]);

      const summary = allocation
        ? ` Rent for ${allocation.student_name} (${allocation.student_id}) is ${input.monthlyFee}${effectiveMonth ? ` from ${effectiveMonth.slice(0, 7)}` : ""}.`
        : "";
      await writeAudit(
        tx,
        ctx,
        "Updated",
        "Seat",
        seatId,
        `Updated ${seatLabel(seat)}: fee ${input.monthlyFee}, ${reserved ? "reserved" : "not reserved"}.${summary}`
      );
      return { effectiveMonth };
    });
  },

  // Everything the Rent window shows.
  async rentDetails(institutionId: string, seatId: string) {
    return postgresService.transaction(async (tx) => {
      const seat = await tx.query(
        `SELECT s.*, r.hostel_name, r.building, r.room_number
         FROM hostel_seats s JOIN hostel_rooms r ON r.id = s.room_id
         WHERE s.institution_id = $1 AND s.id = $2`,
        [institutionId, seatId]
      );
      if (!seat.rows[0]) throw new HostelError(404, "Seat not found.");

      const allocation = await activeAllocationOn(tx, seatId, false);
      const today = await getToday(institutionId);
      let contract = null;
      if (allocation) {
        const schedule = await tx.query(
          "SELECT effective_month, monthly_rent FROM hostel_allocation_rents WHERE allocation_id = $1 ORDER BY effective_month",
          [allocation.id]
        );
        const rows = schedule.rows.map((row: any) => ({ effectiveMonth: row.effective_month, rent: toMoney(row.monthly_rent) }));
        const current = [...rows].reverse().find((row) => row.effectiveMonth <= monthOf(today));
        const next = rows.find((row) => row.effectiveMonth > monthOf(today));
        contract = {
          allocationId: allocation.id,
          studentName: allocation.student_name,
          studentId: allocation.student_id,
          currentRent: current?.rent ?? toMoney(allocation.monthly_rent),
          nextRent: next ?? null,
          schedule: rows,
          earliestChangeMonth: await nextUninvoicedMonth(tx, allocation),
        };
      }

      const history = await tx.query(
        "SELECT * FROM hostel_rent_changes WHERE seat_id = $1 ORDER BY created_at DESC LIMIT 100",
        [seatId]
      );
      return {
        seatId,
        seatFee: toMoney(seat.rows[0].monthly_fee),
        label: seatLabel(seat.rows[0]),
        contract,
        history: history.rows.map((row: any) => ({
          id: row.id,
          studentId: row.student_id,
          oldAmount: row.old_amount === null ? null : toMoney(row.old_amount),
          newAmount: toMoney(row.new_amount),
          effectiveMonth: row.effective_month,
          source: row.source,
          changedBy: row.changed_by,
          createdAt: toIso(row.created_at),
        })),
      };
    });
  },
};
