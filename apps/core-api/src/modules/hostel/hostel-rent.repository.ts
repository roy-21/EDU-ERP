import { postgresService } from "../../database/postgres";
import { HostelContext, HostelError, toIso, writeAudit } from "./hostel.common";

export type DueSource = "SEAT" | "BUILDING" | "GLOBAL";

// Seat, then building, then the global default.
export const resolveDueDay = (
  seatDay: number | null | undefined,
  buildingDay: number | null | undefined,
  globalDay: number
): { dueDay: number; source: DueSource } => {
  if (seatDay) return { dueDay: seatDay, source: "SEAT" };
  if (buildingDay) return { dueDay: buildingDay, source: "BUILDING" };
  return { dueDay: globalDay, source: "GLOBAL" };
};

const settingsFromRow = (row: any) => ({
  defaultDueDay: row.default_due_day,
  timezone: row.timezone,
  reminderDaysBefore: row.reminder_days_before,
  remindOnDueDate: row.remind_on_due_date,
  overdueFirstAfterDays: row.overdue_first_after_days,
  overdueIntervalDays: row.overdue_interval_days,
  reminderHour: row.reminder_hour,
  channels: row.channels,
  paymentInstructions: row.payment_instructions,
  brandName: row.brand_name,
  allowPartialOnline: row.allow_partial_online,
  contactInfo: row.contact_info,
  hostelRules: row.hostel_rules,
  mealReminderThreshold: Number(row.meal_reminder_threshold),
  mealReminderIntervalDays: row.meal_reminder_interval_days,
  mealPaymentDays: row.meal_payment_days,
  lateFeeType: row.late_fee_type,
  lateFeeValue: Number(row.late_fee_value),
  lateFeeGraceDays: row.late_fee_grace_days,
  lateFeeStartsOn: row.late_fee_starts_on,
  updatedAt: toIso(row.updated_at),
});

export const getRentSettings = async (institutionId: string) => {
  await postgresService.query(
    "INSERT INTO hostel_rent_settings (institution_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [institutionId]
  );
  const { rows } = await postgresService.query(
    "SELECT * FROM hostel_rent_settings WHERE institution_id = $1",
    [institutionId]
  );
  return settingsFromRow(rows[0]);
};

// The current date and hour in the institution's configured time zone.
export const getLocalNow = async (institutionId: string) => {
  const settings = await getRentSettings(institutionId);
  const { rows } = await postgresService.query(
    `SELECT TO_CHAR(NOW() AT TIME ZONE $1, 'YYYY-MM-DD') AS today,
       EXTRACT(HOUR FROM NOW() AT TIME ZONE $1)::int AS hour`,
    [settings.timezone]
  );
  return { today: rows[0].today as string, hour: rows[0].hour as number, settings };
};

export const getToday = async (institutionId: string): Promise<string> =>
  (await getLocalNow(institutionId)).today;

const buildingFromRow = (row: any) => ({
  id: row.id,
  hostelName: row.hostel_name,
  name: row.name,
  dueDay: row.due_day,
  rooms: row.rooms,
  seats: row.seats,
});

export const hostelRentRepository = {
  async overview(institutionId: string) {
    const [settings, buildings, seatOverrides] = await Promise.all([
      getRentSettings(institutionId),
      postgresService.query(
        `SELECT b.*, COUNT(DISTINCT r.id)::int AS rooms, COUNT(s.id)::int AS seats
         FROM hostel_buildings b
         LEFT JOIN hostel_rooms r ON r.building_id = b.id
         LEFT JOIN hostel_seats s ON s.room_id = r.id
         WHERE b.institution_id = $1
         GROUP BY b.id ORDER BY b.hostel_name, b.name`,
        [institutionId]
      ),
      postgresService.query(
        `SELECT s.id, s.seat_number, s.due_day, r.id AS room_id, r.room_number, r.hostel_name, r.building
         FROM hostel_seats s JOIN hostel_rooms r ON r.id = s.room_id
         WHERE s.institution_id = $1 AND s.due_day IS NOT NULL
         ORDER BY r.hostel_name, r.building, r.room_number, s.seat_number`,
        [institutionId]
      ),
    ]);

    return {
      settings,
      buildings: buildings.rows.map(buildingFromRow),
      seatOverrides: seatOverrides.rows.map((row: any) => ({
        id: row.id,
        seatNumber: row.seat_number,
        dueDay: row.due_day,
        roomId: row.room_id,
        roomNumber: row.room_number,
        hostelName: row.hostel_name,
        building: row.building,
      })),
    };
  },

  async updateSettings(ctx: HostelContext, input: ReturnType<typeof import("./hostel.validation").parseRentSettings>) {
    const zone = await postgresService.query(
      "SELECT 1 FROM pg_timezone_names WHERE name = $1 LIMIT 1",
      [input.timezone]
    );
    if (zone.rows.length === 0) {
      throw new HostelError(400, `"${input.timezone}" is not a known time zone.`);
    }

    const before = await getRentSettings(ctx.institutionId);
    await postgresService.transaction(async (tx) => {
      await tx.query(
        `UPDATE hostel_rent_settings SET default_due_day = $2, timezone = $3,
           reminder_days_before = $4, remind_on_due_date = $5, overdue_first_after_days = $6,
           overdue_interval_days = $7, reminder_hour = $8, channels = $9,
           payment_instructions = $10, brand_name = $11, allow_partial_online = $12, contact_info = $13, hostel_rules = $14,
           meal_reminder_threshold = $15, meal_reminder_interval_days = $16, meal_payment_days = $17,
           late_fee_type = $18::varchar, late_fee_value = $19, late_fee_grace_days = $20,
           late_fee_starts_on = CASE WHEN $18::varchar = 'NONE' THEN NULL
             WHEN late_fee_type = 'NONE' OR late_fee_starts_on IS NULL THEN (NOW() AT TIME ZONE $3::varchar)::date
             ELSE late_fee_starts_on END,
           updated_at = NOW()
         WHERE institution_id = $1`,
        [
          ctx.institutionId,
          input.defaultDueDay,
          input.timezone,
          input.reminderDaysBefore,
          input.remindOnDueDate,
          input.overdueFirstAfterDays,
          input.overdueIntervalDays,
          input.reminderHour,
          input.channels,
          input.paymentInstructions,
          input.brandName,
          input.allowPartialOnline,
          input.contactInfo,
          input.hostelRules,
          input.mealReminderThreshold,
          input.mealReminderIntervalDays,
          input.mealPaymentDays,
          input.lateFeeType,
          input.lateFeeValue,
          input.lateFeeGraceDays,
        ]
      );
      await writeAudit(
        tx,
        ctx,
        "Updated",
        "Rent Config",
        "",
        `Global rent settings saved. Default due day ${before.defaultDueDay} to ${input.defaultDueDay}.`
      );
    });
    return getRentSettings(ctx.institutionId);
  },

  setBuildingDueDay(ctx: HostelContext, id: string, dueDay: number | null) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE hostel_buildings SET due_day = $3, updated_at = NOW()
         WHERE institution_id = $1 AND id = $2 RETURNING *`,
        [ctx.institutionId, id, dueDay]
      );
      if (!rows[0]) throw new HostelError(404, "Building not found.");

      await writeAudit(
        tx,
        ctx,
        "Updated",
        "Rent Config",
        id,
        `${rows[0].hostel_name}, ${rows[0].name} due day ${dueDay ? `set to ${dueDay}` : "removed (uses global default)"}.`
      );
      return { id: rows[0].id, dueDay: rows[0].due_day };
    });
  },

  setSeatDueDay(ctx: HostelContext, id: string, dueDay: number | null) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE hostel_seats s SET due_day = $3 FROM hostel_rooms r
         WHERE s.room_id = r.id AND s.institution_id = $1 AND s.id = $2
         RETURNING s.id, s.seat_number, s.due_day, r.room_number, r.hostel_name, r.building`,
        [ctx.institutionId, id, dueDay]
      );
      if (!rows[0]) throw new HostelError(404, "Seat not found.");

      await writeAudit(
        tx,
        ctx,
        "Updated",
        "Rent Config",
        id,
        `${rows[0].hostel_name}, ${rows[0].building}, room ${rows[0].room_number}, seat ${rows[0].seat_number} due day ${dueDay ? `set to ${dueDay}` : "removed (uses building or global)"}.`
      );
      return { id: rows[0].id, dueDay: rows[0].due_day };
    });
  },

  async effectiveDueDay(institutionId: string, seatId: string) {
    const settings = await getRentSettings(institutionId);
    const { rows } = await postgresService.query(
      `SELECT s.due_day AS seat_day, b.due_day AS building_day
       FROM hostel_seats s
       JOIN hostel_rooms r ON r.id = s.room_id
       LEFT JOIN hostel_buildings b ON b.id = r.building_id
       WHERE s.institution_id = $1 AND s.id = $2`,
      [institutionId, seatId]
    );
    if (!rows[0]) throw new HostelError(404, "Seat not found.");
    return resolveDueDay(rows[0].seat_day, rows[0].building_day, settings.defaultDueDay);
  },
};
