import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { addAdjustment, createChargeInvoice } from "./hostel-billing.service";
import { getRentSettings, getToday } from "./hostel-rent.repository";
import { cleanFileName, detectMimeType } from "./hostel-documents.repository";
import {
  HostelContext,
  HostelError,
  monthOf,
  newId,
  toHostelError,
  toIso,
  toMoney,
  writeAudit,
} from "./hostel.common";

export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Special Meal", "Snacks"];
const MAX_ITEMS = 30;
const MAX_QUANTITY = 20;
const MONEY_LIMIT = 1_000_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// A photo of the meal. The type comes from the file's bytes, and only JPG or PNG is kept.
const parseImage = (value: any): { content: Buffer; mimeType: string; fileName: string } | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value?.contentBase64 !== "string") invalid("The meal image must be a file.");
  const content = Buffer.from(value.contentBase64, "base64");
  if (content.length === 0) invalid("The meal image is empty.");
  if (content.length > MAX_IMAGE_BYTES) invalid("The meal image must be 2 MB or smaller.");
  const mimeType = detectMimeType(content);
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") invalid("The meal image must be a JPG or PNG file.");
  return { content, mimeType: mimeType as string, fileName: cleanFileName(value.fileName) };
};

const toCents = (value: number) => Math.round(value * 100);
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

const money = (value: unknown, label: string, optional = false): number | null => {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MONEY_LIMIT) {
    invalid(`${label} must be a number from 0 to ${MONEY_LIMIT}.`);
  }
  if (toCents(amount as number) / 100 !== amount) invalid(`${label} can have at most 2 decimal places.`);
  return amount as number;
};

// "2026-11-09T08:00" is read in the hostel's time zone. A value with Z or an offset is exact.
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const EXACT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const parseTime = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !(LOCAL_TIME.test(value) || EXACT_TIME.test(value))) {
    invalid(`${label} must be a date and time.`);
  }
  return value as string;
};

const instant = async (value: string, timezone: string): Promise<string> => {
  const { rows } = await postgresService.query(
    EXACT_TIME.test(value) ? "SELECT $1::timestamptz AS at" : "SELECT ($1::timestamp AT TIME ZONE $2) AS at",
    EXACT_TIME.test(value) ? [value] : [value, timezone]
  );
  return new Date(rows[0].at).toISOString();
};

export const parseMeal = async (body: any, institutionId: string) => {
  const settings = await getRentSettings(institutionId);
  const items = body?.menuItems;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    invalid(`Add between 1 and ${MAX_ITEMS} menu items.`);
  }
  const menuItems = items.map((item: unknown, index: number) => text(item, `Menu item ${index + 1}`, 100, true));
  const mealType = text(body?.mealType, "Meal type", 20, true);
  if (!MEAL_TYPES.includes(mealType)) invalid(`Meal type must be one of: ${MEAL_TYPES.join(", ")}.`);
  const mealDate = text(body?.mealDate, "Meal date", 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate)) invalid("Meal date must be a date.");

  const meal = {
    title: text(body?.title, "Meal title", 150, true),
    mealType,
    mealDate,
    category: text(body?.category, "Meal category", 50),
    description: text(body?.description, "Description", 1000),
    menuItems,
    pricePerMeal: money(body?.pricePerMeal, "Price per meal") as number,
    specialPrice: money(body?.specialPrice, "Special meal price", true),
    additionalCharge: money(body?.additionalCharge ?? 0, "Additional charge") as number,
    bookingOpensAt: await instant(parseTime(body?.bookingOpensAt, "Booking opening time"), settings.timezone),
    bookingClosesAt: await instant(parseTime(body?.bookingClosesAt, "Booking closing time"), settings.timezone),
    collectFrom: await instant(parseTime(body?.collectFrom, "Collection start time"), settings.timezone),
    collectUntil: await instant(parseTime(body?.collectUntil, "Collection end time"), settings.timezone),
  };
  if (meal.bookingClosesAt <= meal.bookingOpensAt) invalid("Booking must close after it opens.");
  if (meal.collectUntil <= meal.collectFrom) invalid("Collection must end after it starts.");
  if (meal.bookingClosesAt > meal.collectUntil) invalid("Booking must close before collection ends.");
  return { ...meal, image: parseImage(body?.image) };
};

const unitPrice = (row: any) =>
  (toCents(toMoney(row.special_price ?? row.price_per_meal)) + toCents(toMoney(row.additional_charge))) / 100;

// The stored status is Draft, Published or Cancelled. The rest follows from the clock.
const statusOf = (row: any, now: Date): string => {
  if (row.status !== "Published") return row.status;
  if (now < new Date(row.booking_opens_at)) return "Published";
  if (now < new Date(row.booking_closes_at)) return "Booking Open";
  if (now < new Date(row.collect_until)) return "Booking Closed";
  return "Completed";
};

const mealFromRow = (row: any, now: Date) => ({
  id: row.id,
  title: row.title,
  mealType: row.meal_type,
  mealDate: row.meal_date,
  category: row.category,
  description: row.description,
  menuItems: row.menu_items,
  pricePerMeal: toMoney(row.price_per_meal),
  specialPrice: row.special_price === null ? null : toMoney(row.special_price),
  additionalCharge: toMoney(row.additional_charge),
  unitPrice: unitPrice(row),
  bookingOpensAt: toIso(row.booking_opens_at),
  bookingClosesAt: toIso(row.booking_closes_at),
  collectFrom: toIso(row.collect_from),
  collectUntil: toIso(row.collect_until),
  status: statusOf(row, now),
  isLocked: row.status !== "Draft",
  cancelReason: row.cancel_reason,
  hasImage: Boolean(row.image_mime),
  totalOrders: Number(row.total_orders ?? 0),
  totalMeals: Number(row.total_meals ?? 0),
  expectedRevenue: toMoney(row.expected_revenue ?? 0),
  publishedAt: toIso(row.published_at),
  publishedBy: row.published_by,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
});

const MEAL_SELECT = `
  SELECT m.id, m.institution_id, m.title, m.meal_type, m.meal_date, m.category, m.description, m.menu_items,
    m.price_per_meal, m.special_price, m.additional_charge, m.booking_opens_at, m.booking_closes_at, m.collect_from,
    m.collect_until, m.status, m.published_at, m.published_by, m.cancel_reason, m.created_by, m.created_at, m.image_mime,
    (SELECT COUNT(*) FROM hostel_meal_bookings b WHERE b.meal_id = m.id AND b.status = 'Confirmed') AS total_orders,
    (SELECT COALESCE(SUM(quantity), 0) FROM hostel_meal_bookings b WHERE b.meal_id = m.id AND b.status = 'Confirmed') AS total_meals,
    (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM hostel_meal_bookings b WHERE b.meal_id = m.id AND b.status = 'Confirmed') AS expected_revenue
  FROM hostel_meals m`;

const bookingFromRow = (row: any) => ({
  id: row.id,
  mealId: row.meal_id,
  allocationId: row.allocation_id,
  studentId: row.student_id,
  studentName: row.student_name,
  hostelName: row.hostel_name,
  building: row.building_name,
  roomNumber: row.room_number,
  seatNumber: row.seat_number,
  quantity: row.quantity,
  unitPrice: toMoney(row.unit_price),
  totalPrice: (row.quantity * toCents(toMoney(row.unit_price))) / 100,
  status: row.status,
  invoiceNumber: row.invoice_number,
  paidAmount: toMoney(row.paid_amount ?? 0),
  outstandingAmount: toMoney(row.outstanding_amount ?? 0),
  bookedBy: row.booked_by,
  bookedAt: toIso(row.created_at),
  collectedAt: toIso(row.collected_at),
  mealTitle: row.meal_title,
  mealDate: row.meal_date,
  mealType: row.meal_type,
});

const BOOKING_SELECT = `
  SELECT b.*, i.invoice_number, i.hostel_name, i.building_name, i.room_number, i.seat_number,
    v.paid_amount, v.outstanding_amount, m.title AS meal_title, m.meal_date, m.meal_type
  FROM hostel_meal_bookings b
  JOIN hostel_meals m ON m.id = b.meal_id
  LEFT JOIN hostel_invoices i ON i.id = b.invoice_id
  LEFT JOIN hostel_invoice_balances v ON v.id = b.invoice_id`;

const inTransaction = <T>(work: (tx: PoolClient) => Promise<T>) =>
  postgresService.transaction(work).catch((err) => {
    throw toHostelError(err);
  });

const lockMeal = async (tx: PoolClient, institutionId: string, id: string) => {
  const { rows } = await tx.query("SELECT *, NOW() AS db_now FROM hostel_meals WHERE institution_id = $1 AND id = $2 FOR UPDATE", [
    institutionId,
    id,
  ]);
  if (!rows[0]) throw new HostelError(404, "Meal not found.");
  return rows[0];
};

// The database clock decides, so a browser with a wrong clock cannot book late.
const assertBookingOpen = (meal: any) => {
  const now = new Date(meal.db_now);
  if (meal.status !== "Published") throw new HostelError(409, `This meal is ${meal.status.toLowerCase()}, so it cannot be booked.`);
  if (now < new Date(meal.booking_opens_at)) throw new HostelError(409, "Booking for this meal has not opened yet.");
  if (now >= new Date(meal.booking_closes_at)) {
    throw new HostelError(409, "Booking for this meal is closed. Orders cannot be created or changed after the deadline.");
  }
};

const mealLabel = (meal: any) => `${meal.title} (${meal.meal_type}, ${meal.meal_date})`;

export const hostelMealsService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(
      `${MEAL_SELECT} WHERE m.institution_id = $1 ORDER BY m.meal_date DESC, m.collect_from DESC`,
      [institutionId]
    );
    const now = new Date();
    return rows.map((row: any) => mealFromRow(row, now));
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${MEAL_SELECT} WHERE m.institution_id = $1 AND m.id = $2`, [institutionId, id]);
    if (!rows[0]) throw new HostelError(404, "Meal not found.");
    const orders = await postgresService.query(`${BOOKING_SELECT} WHERE b.meal_id = $1 ORDER BY b.created_at`, [id]);
    return { meal: mealFromRow(rows[0], new Date()), orders: orders.rows.map(bookingFromRow) };
  },

  async image(institutionId: string, id: string) {
    const { rows } = await postgresService.query(
      "SELECT image, image_mime, image_name FROM hostel_meals WHERE institution_id = $1 AND id = $2",
      [institutionId, id]
    );
    if (!rows[0]) throw new HostelError(404, "Meal not found.");
    if (!rows[0].image) throw new HostelError(404, "This meal has no image.");
    return { fileName: rows[0].image_name, mimeType: rows[0].image_mime, contentBase64: rows[0].image.toString("base64") };
  },

  async create(ctx: HostelContext, body: any) {
    const meal = await parseMeal(body, ctx.institutionId);
    return inTransaction(async (tx) => {
      const id = newId();
      await tx.query(
        `INSERT INTO hostel_meals (id, institution_id, title, meal_type, meal_date, category, description, menu_items,
           price_per_meal, special_price, additional_charge, booking_opens_at, booking_closes_at, collect_from,
           collect_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [id, ctx.institutionId, meal.title, meal.mealType, meal.mealDate, meal.category, meal.description,
          JSON.stringify(meal.menuItems), meal.pricePerMeal, meal.specialPrice, meal.additionalCharge,
          meal.bookingOpensAt, meal.bookingClosesAt, meal.collectFrom, meal.collectUntil, ctx.actorEmail]
      );
      if (meal.image) {
        await tx.query("UPDATE hostel_meals SET image = $2, image_mime = $3, image_name = $4 WHERE id = $1", [
          id, meal.image.content, meal.image.mimeType, meal.image.fileName,
        ]);
      }
      await writeAudit(tx, ctx, "Created", "Meal", id, `Created draft meal ${meal.title} for ${meal.mealDate}.`);
      return id;
    }).then((id) => this.get(ctx.institutionId, id));
  },

  // Only a draft can change. A published meal is cancelled and made again.
  async update(ctx: HostelContext, id: string, body: any) {
    const meal = await parseMeal(body, ctx.institutionId);
    await inTransaction(async (tx) => {
      const current = await lockMeal(tx, ctx.institutionId, id);
      if (current.status !== "Draft") {
        throw new HostelError(409, "A published meal cannot be edited. Cancel it and create a new one.");
      }
      await tx.query(
        `UPDATE hostel_meals SET title = $2, meal_type = $3, meal_date = $4, category = $5, description = $6,
           menu_items = $7, price_per_meal = $8, special_price = $9, additional_charge = $10, booking_opens_at = $11,
           booking_closes_at = $12, collect_from = $13, collect_until = $14, updated_at = NOW()
         WHERE id = $1`,
        [id, meal.title, meal.mealType, meal.mealDate, meal.category, meal.description, JSON.stringify(meal.menuItems),
          meal.pricePerMeal, meal.specialPrice, meal.additionalCharge, meal.bookingOpensAt, meal.bookingClosesAt,
          meal.collectFrom, meal.collectUntil]
      );
      // Left out keeps the photo, null removes it, a file replaces it.
      if (meal.image !== undefined) {
        await tx.query("UPDATE hostel_meals SET image = $2, image_mime = $3, image_name = $4 WHERE id = $1", [
          id, meal.image?.content ?? null, meal.image?.mimeType ?? null, meal.image?.fileName ?? null,
        ]);
      }
      await writeAudit(tx, ctx, "Updated", "Meal", id, `Updated draft meal ${meal.title}.`);
    });
    return this.get(ctx.institutionId, id);
  },

  async publish(ctx: HostelContext, id: string) {
    await inTransaction(async (tx) => {
      const meal = await lockMeal(tx, ctx.institutionId, id);
      if (meal.status !== "Draft") throw new HostelError(409, "Only a draft meal can be published.");
      if (new Date(meal.booking_closes_at) <= new Date(meal.db_now)) {
        throw new HostelError(409, "The booking deadline has already passed. Change the times before publishing.");
      }
      await tx.query(
        "UPDATE hostel_meals SET status = 'Published', published_at = NOW(), published_by = $2, updated_at = NOW() WHERE id = $1",
        [id, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Published", "Meal", id, `Published ${mealLabel(meal)} at ${unitPrice(meal)} per meal.`);
    });
    return this.get(ctx.institutionId, id);
  },

  // A draft is deleted. A published meal is cancelled: unpaid charges are cleared
  // by adjustment, and paid ones are kept and listed for a refund.
  async cancel(ctx: HostelContext, id: string, reason: string) {
    return inTransaction(async (tx) => {
      const meal = await lockMeal(tx, ctx.institutionId, id);
      if (meal.status === "Cancelled") throw new HostelError(409, "This meal is already cancelled.");

      if (meal.status === "Draft") {
        await tx.query("DELETE FROM hostel_meals WHERE id = $1", [id]);
        await writeAudit(tx, ctx, "Deleted", "Meal", id, `Deleted draft meal ${meal.title}.`);
        return { deleted: true, needsRefund: [] };
      }
      if (!reason) throw new HostelError(400, "A reason is required to cancel a published meal.");

      const bookings = await tx.query(
        `SELECT b.id, b.student_name, b.student_id, b.invoice_id, b.allocation_id, v.amount_due, v.paid_amount
         FROM hostel_meal_bookings b JOIN hostel_invoice_balances v ON v.id = b.invoice_id
         WHERE b.meal_id = $1 AND b.status = 'Confirmed'`,
        [id]
      );
      const needsRefund: { studentName: string; studentId: string; paid: number }[] = [];
      for (const booking of bookings.rows) {
        await tx.query("SELECT id FROM hostel_invoices WHERE id = $1 FOR UPDATE", [booking.invoice_id]);
        const paid = toMoney(booking.paid_amount);
        const unpaid = (toCents(toMoney(booking.amount_due)) - toCents(paid)) / 100;
        if (unpaid > 0) await addAdjustment(tx, ctx, booking.invoice_id, -unpaid, `Meal cancelled: ${reason}`);
        if (paid > 0) {
          needsRefund.push({ studentName: booking.student_name, studentId: booking.student_id, paid });
          // Kept as money owed back, until someone records paying it out.
          await tx.query(
            `INSERT INTO hostel_refunds (id, institution_id, allocation_id, invoice_id, source_type, source_id, amount, reason)
             VALUES ($1, $2, $3, $4, 'MEAL_BOOKING', $5, $6, $7) ON CONFLICT (source_type, source_id) DO NOTHING`,
            [newId(), ctx.institutionId, booking.allocation_id, booking.invoice_id, booking.id, paid, `Meal cancelled: ${reason}`]
          );
        }
        await tx.query("UPDATE hostel_meal_bookings SET status = 'Cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1", [booking.id]);
      }
      await tx.query(
        "UPDATE hostel_meals SET status = 'Cancelled', cancelled_at = NOW(), cancelled_by = $2, cancel_reason = $3, updated_at = NOW() WHERE id = $1",
        [id, ctx.actorEmail, reason]
      );
      await writeAudit(tx, ctx, "Cancelled", "Meal", id, `Cancelled ${mealLabel(meal)} with ${bookings.rows.length} order(s). Reason: ${reason}`);
      return { deleted: false, needsRefund };
    });
  },

  // Each order is its own meal invoice, so it is paid, receipted and chased like rent.
  async book(ctx: HostelContext, mealId: string, input: { allocationId: unknown; quantity: unknown }) {
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HostelError(400, `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    const settings = await getRentSettings(ctx.institutionId);
    return inTransaction(async (tx) => {
      const meal = await lockMeal(tx, ctx.institutionId, mealId);
      assertBookingOpen(meal);

      const { rows } = await tx.query(
        "SELECT * FROM hostel_allocations WHERE institution_id = $1 AND id = $2 FOR UPDATE",
        [ctx.institutionId, String(input.allocationId || "")]
      );
      const allocation = rows[0];
      if (!allocation) throw new HostelError(404, "Student not found.");
      if (allocation.status !== "Allocated") throw new HostelError(409, "Only a student with a seat can book meals.");

      const existing = await tx.query(
        "SELECT id FROM hostel_meal_bookings WHERE meal_id = $1 AND allocation_id = $2 AND status = 'Confirmed'",
        [mealId, allocation.id]
      );
      if (existing.rows[0]) throw new HostelError(409, "This student already ordered this meal. Change the quantity instead.");

      const price = unitPrice(meal);
      const id = newId();
      const due = new Date(Date.parse(`${meal.meal_date}T00:00:00Z`) + settings.mealPaymentDays * 86_400_000).toISOString().slice(0, 10);
      const invoiceId = await createChargeInvoice(tx, {
        allocationId: allocation.id,
        category: "MEAL",
        title: `${meal.title} on ${meal.meal_date}`,
        amount: (quantity * toCents(price)) / 100,
        billingMonth: monthOf(meal.meal_date),
        dueDate: due,
        sourceType: "MEAL_BOOKING",
        sourceId: id,
        items: [{ description: `${meal.meal_type}: ${meal.title}`, quantity, unitPrice: price }],
      });
      await tx.query(
        `INSERT INTO hostel_meal_bookings (id, institution_id, meal_id, allocation_id, student_id, student_name,
           quantity, unit_price, invoice_id, booked_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, ctx.institutionId, mealId, allocation.id, allocation.student_id, allocation.student_name, quantity, price, invoiceId, ctx.actorEmail]
      );
      await writeAudit(tx, ctx, "Booked", "Meal", id, `Booked ${quantity} x ${mealLabel(meal)} for ${allocation.student_name} (${allocation.student_id}).`);
      const saved = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
      return bookingFromRow(saved.rows[0]);
    });
  },

  // A change before the deadline adjusts the order's invoice. Money already paid is never taken away.
  async changeBooking(ctx: HostelContext, bookingId: string, input: { quantity?: unknown; cancel?: boolean }) {
    return inTransaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM hostel_meal_bookings WHERE institution_id = $1 AND id = $2 FOR UPDATE",
        [ctx.institutionId, bookingId]
      );
      const booking = rows[0];
      if (!booking) throw new HostelError(404, "Order not found.");
      if (booking.status !== "Confirmed") throw new HostelError(409, "This order is already cancelled.");
      const meal = await lockMeal(tx, ctx.institutionId, booking.meal_id);
      assertBookingOpen(meal);

      const quantity = input.cancel ? 0 : Number(input.quantity);
      if (!input.cancel && (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)) {
        throw new HostelError(400, `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
      }
      await tx.query("SELECT id FROM hostel_invoices WHERE id = $1 FOR UPDATE", [booking.invoice_id]);
      const balance = await tx.query("SELECT amount_due, paid_amount FROM hostel_invoice_balances WHERE id = $1", [booking.invoice_id]);
      const newTotal = quantity * toCents(toMoney(booking.unit_price));
      const oldTotal = toCents(toMoney(balance.rows[0].amount_due));
      if (newTotal < toCents(toMoney(balance.rows[0].paid_amount))) {
        throw new HostelError(409, "Part of this order is already paid. Reverse the payment before reducing it.");
      }
      if (newTotal !== oldTotal) {
        await addAdjustment(tx, ctx, booking.invoice_id, (newTotal - oldTotal) / 100,
          input.cancel ? "Meal order cancelled before the deadline" : `Meal order changed to ${quantity}`);
      }
      if (input.cancel) {
        await tx.query("UPDATE hostel_meal_bookings SET status = 'Cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1", [bookingId]);
      } else {
        await tx.query("UPDATE hostel_meal_bookings SET quantity = $2, updated_at = NOW() WHERE id = $1", [bookingId, quantity]);
      }
      await writeAudit(tx, ctx, input.cancel ? "Cancelled" : "Updated", "Meal", bookingId,
        `${input.cancel ? "Cancelled" : `Changed to ${quantity}`} the ${mealLabel(meal)} order of ${booking.student_name} (${booking.student_id}).`);
      const saved = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
      return bookingFromRow(saved.rows[0]);
    });
  },

  async markCollected(ctx: HostelContext, bookingId: string) {
    return inTransaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE hostel_meal_bookings SET collected_at = NOW(), updated_at = NOW()
         WHERE institution_id = $1 AND id = $2 AND status = 'Confirmed' AND collected_at IS NULL RETURNING *`,
        [ctx.institutionId, bookingId]
      );
      if (!rows[0]) throw new HostelError(409, "Only an active order that was not yet collected can be marked.");
      await writeAudit(tx, ctx, "Collected", "Meal", bookingId, `${rows[0].student_name} (${rows[0].student_id}) collected a meal.`);
      const saved = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
      return bookingFromRow(saved.rows[0]);
    });
  },

  // One student's meals, from their orders and meal invoices.
  async memberSummary(institutionId: string, allocationId: string) {
    const [orders, money] = await Promise.all([
      postgresService.query(`${BOOKING_SELECT} WHERE b.institution_id = $1 AND b.allocation_id = $2 ORDER BY m.meal_date DESC`, [institutionId, allocationId]),
      postgresService.query(
        `SELECT COALESCE(SUM(amount_due), 0) AS cost, COALESCE(SUM(paid_amount), 0) AS paid,
           COALESCE(SUM(outstanding_amount), 0) AS outstanding
         FROM hostel_invoice_balances WHERE institution_id = $1 AND allocation_id = $2 AND category = 'MEAL'`,
        [institutionId, allocationId]
      ),
    ]);
    const active = orders.rows.filter((row: any) => row.status === "Confirmed");
    return {
      totalMealsOrdered: active.reduce((sum: number, row: any) => sum + row.quantity, 0),
      totalMealsCollected: active.filter((row: any) => row.collected_at).reduce((sum: number, row: any) => sum + row.quantity, 0),
      totalCost: toMoney(money.rows[0].cost),
      totalPaid: toMoney(money.rows[0].paid),
      totalOutstanding: toMoney(money.rows[0].outstanding),
      orders: orders.rows.map(bookingFromRow),
    };
  },

  // Students who owe for meals, for choosing who to remind.
  async dues(institutionId: string) {
    const today = await getToday(institutionId);
    const { rows } = await postgresService.query(
      `SELECT v.allocation_id, a.student_id, a.student_name, a.student_email, a.room_label, a.seat_number,
         COUNT(*)::int AS invoices, SUM(v.outstanding_amount) AS outstanding, MIN(v.due_date) AS oldest_due
       FROM hostel_invoice_balances v JOIN hostel_allocations a ON a.id = v.allocation_id
       WHERE v.institution_id = $1 AND v.category = 'MEAL' AND v.outstanding_amount > 0
       GROUP BY v.allocation_id, a.student_id, a.student_name, a.student_email, a.room_label, a.seat_number
       ORDER BY SUM(v.outstanding_amount) DESC`,
      [institutionId]
    );
    return rows.map((row: any) => ({
      allocationId: row.allocation_id,
      studentId: row.student_id,
      studentName: row.student_name,
      hasEmail: Boolean(row.student_email),
      location: `${row.room_label || ""}${row.seat_number ? `, seat ${row.seat_number}` : ""}`,
      invoices: row.invoices,
      outstanding: toMoney(row.outstanding),
      oldestDue: row.oldest_due,
      isOverdue: row.oldest_due < today,
    }));
  },
};
