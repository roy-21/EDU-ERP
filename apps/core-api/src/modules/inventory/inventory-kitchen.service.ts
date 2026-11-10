import { postgresService } from "../../database/postgres";
import { Actor, audit } from "../identity/identity.service";
import { date, fail, inTx, oneOf, text, todayBd, whole } from "../academics/academics.common";
import { activeItem, activeStore, docNo, expenseCategoryOf, linesOf, listDocument, r2, r3, takeOut } from "./inventory.service";

// Consumption and wastage: stock used up inside the organisation, never sold and never issued
// to someone who could bring it back. A kitchen records what each meal used and what was thrown
// away, and its day sheet works out
//     closing = opening + received - consumed - wasted (+/- transfers, issues and counts)
// straight from the ledger, so the sheet and the stock balance can never disagree.

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks", "Special Meal"] as const;

// A kitchen's use is a food cost unless the cook says otherwise.
const defaultCategory = (store: any, given: string) => given || (store.kind === "KITCHEN" ? "Kitchen & food" : "");

// Each ledger row with the kind it really counts as: a reversal counts as the opposite of what it reverses.
const EFFECTIVE = `SELECT m.item_id, m.quantity, m.unit_cost, m.meal, m.created_at,
    (m.created_at AT TIME ZONE 'Asia/Dhaka')::date AS day,
    CASE WHEN m.kind = 'REVERSAL' THEN o.kind ELSE m.kind END AS k
  FROM inv_movements m LEFT JOIN inv_movements o ON o.id = m.reverses_id
  WHERE m.institution_id = $1 AND m.store_id = $2`;

const IN_KINDS = "('OPENING', 'RECEIPT', 'RETURN', 'TRANSFER_IN')";
const WASTE_KINDS = "('WASTAGE', 'DAMAGE', 'LOSS')";
const OTHER_KINDS = "('ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT')";

// Meals served per day and meal: a hand count when there is one, otherwise the hostel meal bookings.
const mealsServed = async (institutionId: string, storeId: string, from: string, to: string) => {
  const booked = (await postgresService.query(
    `SELECT m.meal_date AS day, m.meal_type AS meal, COALESCE(SUM(b.quantity), 0) AS served
     FROM hostel_meals m JOIN hostel_meal_bookings b ON b.meal_id = m.id AND b.status = 'Confirmed'
     WHERE m.institution_id = $1 AND m.status <> 'Cancelled' AND m.meal_date BETWEEN $2::date AND $3::date
     GROUP BY 1, 2`, [institutionId, from, to])).rows;
  const counted = (await postgresService.query(
    "SELECT day, meal, served FROM inv_meal_counts WHERE store_id = $1 AND day BETWEEN $2::date AND $3::date", [storeId, from, to])).rows;
  const result: Record<string, Record<string, { served: number; source: "COUNT" | "BOOKINGS" }>> = {};
  for (const row of booked) (result[row.day] ||= {})[row.meal] = { served: Number(row.served), source: "BOOKINGS" };
  for (const row of counted) (result[row.day] ||= {})[row.meal] = { served: Number(row.served), source: "COUNT" };
  return result;
};

const kitchenStore = async (institutionId: string, storeId: unknown) => {
  if (typeof storeId !== "string" || !storeId) fail(400, "Choose a store.");
  const store = (await postgresService.query("SELECT * FROM inv_stores WHERE institution_id = $1 AND id = $2", [institutionId, storeId])).rows[0];
  if (!store) fail(404, "Store not found.");
  return store;
};

const MAX_PERIOD_DAYS = 366;
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

// A month (2026-11), or any range of days with from and to.
const periodOf = (query: { month?: unknown; from?: unknown; to?: unknown }) => {
  if (query.from || query.to) {
    const from = date(query.from, "From date", true) as string;
    const to = date(query.to, "To date", true) as string;
    if (to < from) fail(400, "The end date is before the start date.");
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > MAX_PERIOD_DAYS) fail(400, `Choose at most ${MAX_PERIOD_DAYS} days.`);
    return { month: "", from, to, days };
  }
  const month = typeof query.month === "string" && /^\d{4}-\d{2}$/.test(query.month) ? query.month : todayBd().slice(0, 7);
  const [year, mon] = month.split("-").map(Number);
  if (mon < 1 || mon > 12) fail(400, "Month must look like 2026-11.");
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, days: last };
};

export const consumptionService = {
  // Stock used up: cooked for a meal, or used in the office or a lab. Expired batches are not used.
  async consume(actor: Actor, body: any) {
    const lines = linesOf(body);
    const meal = body?.meal ? oneOf(body.meal, "Meal", MEALS) : "";
    const note = text(body?.note, "Note", 500);
    const no = docNo("CON");
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      const expenseCategory = defaultCategory(store, expenseCategoryOf(body?.expenseCategory));
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await takeOut(tx, actor, item, store, line.quantity, { kind: "CONSUMPTION", docNo: no, note, meal, expenseCategory, party: meal }, { usableOnly: true });
      }
      await audit(tx, actor, "inventory.stock.consume", "stock", no, `Recorded use of ${lines.length} item(s) in ${store.name}${meal ? ` for ${meal}` : ""}.`);
    });
    return listDocument(actor.institutionId, no);
  },

  // Food spoilt, burnt or thrown away. Expired stock can be wasted.
  async waste(actor: Actor, body: any) {
    const lines = linesOf(body);
    const reason = text(body?.reason, "Reason", 500, true);
    const no = docNo("WST");
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      const expenseCategory = defaultCategory(store, expenseCategoryOf(body?.expenseCategory));
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await takeOut(tx, actor, item, store, line.quantity, { kind: "WASTAGE", docNo: no, note: reason, expenseCategory });
      }
      await audit(tx, actor, "inventory.stock.wastage", "stock", no, `Recorded wastage of ${lines.length} item(s) in ${store.name}. ${reason}`);
    });
    return listDocument(actor.institutionId, no);
  },

  async setMealCount(actor: Actor, body: any) {
    const store = await kitchenStore(actor.institutionId, body?.storeId);
    const day = date(body?.date, "Date", true) as string;
    if (day > todayBd()) fail(400, "Meals cannot be counted for a day that has not come yet.");
    const meal = oneOf(body?.meal, "Meal", MEALS);
    if (body?.served === "" || body?.served === null || body?.served === undefined) {
      await postgresService.query("DELETE FROM inv_meal_counts WHERE store_id = $1 AND day = $2 AND meal = $3", [store.id, day, meal]);
    } else {
      const served = whole(body.served, "Meals served", 0, 100_000);
      await postgresService.query(
        `INSERT INTO inv_meal_counts (institution_id, store_id, day, meal, served, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (store_id, day, meal) DO UPDATE SET served = $5, updated_by = $6, updated_at = NOW()`,
        [actor.institutionId, store.id, day, meal, served, actor.email]);
    }
    await audit(postgresService, actor, "inventory.kitchen.meal_count", "store", store.id, `${meal} on ${day} in ${store.name}: ${body?.served ?? "cleared"} served.`);
    return this.day(actor.institutionId, store.id, day);
  },

  // The day sheet of one store: per item opening, in, used, wasted, other and closing, with costs.
  async day(institutionId: string, storeId: string, dayValue: unknown) {
    const store = await kitchenStore(institutionId, storeId);
    const day = date(dayValue || todayBd(), "Date") as string;
    const { rows } = await postgresService.query(
      `WITH eff AS (${EFFECTIVE} AND m.created_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
       SELECT i.id, i.name, i.sku, i.unit, i.category,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day < $3::date), 0) AS opening,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day = $3::date AND eff.k IN ${IN_KINDS}), 0) AS received,
         COALESCE(SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day = $3::date AND eff.k IN ${IN_KINDS}), 0) AS received_value,
         COALESCE(-SUM(eff.quantity) FILTER (WHERE eff.day = $3::date AND eff.k = 'CONSUMPTION'), 0) AS consumed,
         COALESCE(-SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day = $3::date AND eff.k = 'CONSUMPTION'), 0) AS consumed_value,
         COALESCE(-SUM(eff.quantity) FILTER (WHERE eff.day = $3::date AND eff.k IN ${WASTE_KINDS}), 0) AS wasted,
         COALESCE(-SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day = $3::date AND eff.k IN ${WASTE_KINDS}), 0) AS wasted_value,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day = $3::date AND eff.k IN ${OTHER_KINDS}), 0) AS other
       FROM eff JOIN inv_items i ON i.id = eff.item_id
       GROUP BY i.id ORDER BY i.name`, [institutionId, store.id, day]);
    const items = rows.map((row: any) => {
      const opening = r3(Number(row.opening));
      const received = r3(Number(row.received));
      const consumed = r3(Number(row.consumed));
      const wasted = r3(Number(row.wasted));
      const other = r3(Number(row.other));
      return {
        itemId: row.id, name: row.name, sku: row.sku, unit: row.unit, category: row.category,
        opening, received, consumed, wasted, other, closing: r3(opening + received - consumed - wasted + other),
        receivedValue: r2(Number(row.received_value)), consumedValue: r2(Number(row.consumed_value)), wastedValue: r2(Number(row.wasted_value)),
      };
    }).filter((row: any) => row.opening !== 0 || row.received !== 0 || row.consumed !== 0 || row.wasted !== 0 || row.other !== 0);

    const byMeal = (await postgresService.query(
      `WITH eff AS (${EFFECTIVE} AND (m.created_at AT TIME ZONE 'Asia/Dhaka')::date = $3::date)
       SELECT meal, -SUM(quantity * unit_cost) AS value FROM eff WHERE k = 'CONSUMPTION' GROUP BY meal`, [institutionId, store.id, day])).rows;
    const served = (await mealsServed(institutionId, store.id, day, day))[day] || {};
    const meals = MEALS.map((meal) => {
      const cost = r2(Number(byMeal.find((row: any) => row.meal === meal)?.value ?? 0));
      const count = served[meal];
      return { meal, cost, served: count?.served ?? null, source: count?.source ?? null, costPerMeal: count && count.served > 0 ? r2(cost / count.served) : null };
    }).filter((row) => row.cost !== 0 || row.served !== null);
    const unassigned = r2(Number(byMeal.find((row: any) => !row.meal)?.value ?? 0));
    const totals = {
      receivedValue: r2(items.reduce((sum: number, row: any) => sum + row.receivedValue, 0)),
      consumedValue: r2(items.reduce((sum: number, row: any) => sum + row.consumedValue, 0)),
      wastedValue: r2(items.reduce((sum: number, row: any) => sum + row.wastedValue, 0)),
      mealsServed: Object.values(served).reduce((sum, row) => sum + row.served, 0),
    };
    return {
      store: { id: store.id, name: store.name, code: store.code, kind: store.kind },
      date: day, items, meals, unassignedCost: unassigned,
      totals: { ...totals, costPerMeal: totals.mealsServed > 0 ? r2(totals.consumedValue / totals.mealsServed) : null },
    };
  },

  // A month (or any range of days) of one store: per item how much there was at the start, how much
  // was bought and at what price, used, wasted and left at the end; and day by day, meals and cost per meal.
  async month(institutionId: string, storeId: string, query: { month?: unknown; from?: unknown; to?: unknown }) {
    const store = await kitchenStore(institutionId, storeId);
    const { month, from, to, days } = periodOf(query);
    const daily = (await postgresService.query(
      `WITH eff AS (${EFFECTIVE} AND (m.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $3::date AND $4::date)
       SELECT to_char(day, 'YYYY-MM-DD') AS day,
         COALESCE(SUM(quantity * unit_cost) FILTER (WHERE k IN ${IN_KINDS}), 0) AS received,
         COALESCE(-SUM(quantity * unit_cost) FILTER (WHERE k = 'CONSUMPTION'), 0) AS consumed,
         COALESCE(-SUM(quantity * unit_cost) FILTER (WHERE k IN ${WASTE_KINDS}), 0) AS wasted
       FROM eff GROUP BY day`, [institutionId, store.id, from, to])).rows;
    // Everything up to the end of the period, so the opening balance comes from the rows before it.
    // "Bought" is stock that came in: purchases, opening stock, returns and transfers in.
    const itemRows = (await postgresService.query(
      `WITH eff AS (${EFFECTIVE} AND m.created_at < ($4::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
       SELECT i.id, i.name, i.sku, i.unit, i.category,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day < $3::date), 0) AS opening,
         COALESCE(SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day < $3::date), 0) AS opening_value,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day >= $3::date AND eff.k IN ${IN_KINDS}), 0) AS received,
         COALESCE(SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day >= $3::date AND eff.k IN ${IN_KINDS}), 0) AS received_value,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day >= $3::date AND eff.k = 'RECEIPT'), 0) AS purchased,
         COALESCE(SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day >= $3::date AND eff.k = 'RECEIPT'), 0) AS purchased_value,
         COALESCE(-SUM(eff.quantity) FILTER (WHERE eff.day >= $3::date AND eff.k = 'CONSUMPTION'), 0) AS consumed,
         COALESCE(-SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day >= $3::date AND eff.k = 'CONSUMPTION'), 0) AS consumed_value,
         COALESCE(-SUM(eff.quantity) FILTER (WHERE eff.day >= $3::date AND eff.k IN ${WASTE_KINDS}), 0) AS wasted,
         COALESCE(-SUM(eff.quantity * eff.unit_cost) FILTER (WHERE eff.day >= $3::date AND eff.k IN ${WASTE_KINDS}), 0) AS wasted_value,
         COALESCE(SUM(eff.quantity) FILTER (WHERE eff.day >= $3::date AND eff.k IN ${OTHER_KINDS}), 0) AS other,
         COALESCE(SUM(eff.quantity * eff.unit_cost), 0) AS closing_value
       FROM eff JOIN inv_items i ON i.id = eff.item_id GROUP BY i.id
       ORDER BY i.name`, [institutionId, store.id, from, to])).rows;
    // The rate of use counts only the days that have passed, not the rest of the current month.
    const lastDay = to < todayBd() ? to : todayBd();
    const elapsed = Math.max(1, Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
    const items = itemRows.map((row: any) => {
      const opening = r3(Number(row.opening));
      const received = r3(Number(row.received));
      const purchased = r3(Number(row.purchased));
      const consumed = r3(Number(row.consumed));
      const wasted = r3(Number(row.wasted));
      const other = r3(Number(row.other));
      const purchasedValue = r2(Number(row.purchased_value));
      return {
        itemId: row.id, name: row.name, sku: row.sku, unit: row.unit, category: row.category,
        opening, openingValue: r2(Number(row.opening_value)),
        received, receivedValue: r2(Number(row.received_value)),
        purchased, purchasedValue, avgPurchasePrice: purchased > 0 ? r2(purchasedValue / purchased) : null,
        consumed, consumedValue: r2(Number(row.consumed_value)),
        wasted, wastedValue: r2(Number(row.wasted_value)),
        other, closing: r3(opening + received - consumed - wasted + other), closingValue: r2(Number(row.closing_value)),
        // Days the closing stock lasts at this period's rate of use.
        daysLeft: consumed > 0 ? Math.floor((opening + received - consumed - wasted + other) / (consumed / elapsed)) : null,
      };
    }).filter((row: any) => row.opening !== 0 || row.received !== 0 || row.consumed !== 0 || row.wasted !== 0 || row.other !== 0 || row.closing !== 0);
    const served = await mealsServed(institutionId, store.id, from, to);
    const rows: { date: string; received: number; consumed: number; wasted: number; mealsServed: number; costPerMeal: number | null }[] = [];
    for (let d = 0; d < days; d += 1) {
      const day = addDays(from, d);
      const row = daily.find((entry: any) => entry.day === day);
      const meals = Object.values(served[day] || {}).reduce((sum, entry) => sum + entry.served, 0);
      const consumed = r2(Number(row?.consumed ?? 0));
      rows.push({ date: day, received: r2(Number(row?.received ?? 0)), consumed, wasted: r2(Number(row?.wasted ?? 0)), mealsServed: meals, costPerMeal: meals > 0 ? r2(consumed / meals) : null });
    }
    const total = (key: "received" | "consumed" | "wasted" | "mealsServed") => r2(rows.reduce((sum, row) => sum + row[key], 0));
    const consumed = total("consumed");
    const mealsTotal = total("mealsServed");
    const activeDays = rows.filter((row) => row.consumed > 0).length;
    return {
      store: { id: store.id, name: store.name, code: store.code, kind: store.kind },
      month, from, to, days: rows, items,
      totals: {
        received: total("received"), consumed, wasted: total("wasted"), mealsServed: mealsTotal,
        purchased: r2(items.reduce((sum: number, row: any) => sum + row.purchasedValue, 0)),
        opening: r2(items.reduce((sum: number, row: any) => sum + row.openingValue, 0)),
        closing: r2(items.reduce((sum: number, row: any) => sum + row.closingValue, 0)),
        costPerMeal: mealsTotal > 0 ? r2(consumed / mealsTotal) : null,
        costPerDay: activeDays > 0 ? r2(consumed / activeDays) : null,
      },
    };
  },
};
