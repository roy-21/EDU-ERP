import { postgresService } from "../../database/postgres";
import { date, fail } from "../academics/academics.common";
import { r2, r3 } from "./inventory.service";

// Spending by purpose, and explainable reorder suggestions.

// Stock-out kinds that are spending. A reversal counts against the kind it reverses.
const SPEND_KINDS = "('ISSUE', 'CONSUMPTION', 'WASTAGE', 'DAMAGE', 'LOSS')";

// Stock this much below its run-out date is suggested for ordering.
const COVER_DAYS = 14;
// A suggestion without a maximum stock level orders this many days of use, on top of the reorder level.
const ORDER_DAYS = 30;

export const reportsService = {
  // What stock was used for, by month, purpose, kind, store and destination, at cost.
  async expenses(institutionId: string, filters: { from?: string; to?: string } = {}) {
    const from = date(filters.from, "From date");
    const to = date(filters.to, "To date");
    if (from && to && to < from) fail(400, "The end date is before the start date.");
    const { rows } = await postgresService.query(
      `WITH eff AS (
         SELECT m.*, CASE WHEN m.kind = 'REVERSAL' THEN o.kind ELSE m.kind END AS k
         FROM inv_movements m LEFT JOIN inv_movements o ON o.id = m.reverses_id
         WHERE m.institution_id = $1
           AND ($2 = '' OR m.created_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Dhaka')
           AND ($3 = '' OR m.created_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka'))
       SELECT to_char(date_trunc('month', eff.created_at AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM') AS month,
         COALESCE(NULLIF(eff.expense_category, ''),
           CASE WHEN eff.k = 'CONSUMPTION' AND s.kind = 'KITCHEN' THEN 'Kitchen & food'
                WHEN eff.k = 'CONSUMPTION' THEN 'Consumables used'
                WHEN eff.k = 'ISSUE' THEN 'Issued (no category)'
                ELSE 'Wastage, damage and loss' END) AS category,
         eff.k AS kind, s.id AS store_id, s.name AS store_name,
         CASE WHEN eff.k = 'ISSUE' THEN eff.party ELSE '' END AS destination,
         -SUM(eff.quantity * eff.unit_cost) AS value
       FROM eff JOIN inv_stores s ON s.id = eff.store_id
       WHERE eff.k IN ${SPEND_KINDS}
       GROUP BY 1, 2, 3, 4, 5, 6
       HAVING SUM(eff.quantity * eff.unit_cost) <> 0
       ORDER BY 1, 2`, [institutionId, from || "", to || ""]);
    return rows.map((row: any) => ({
      month: row.month, category: row.category, kind: row.kind, storeId: row.store_id, storeName: row.store_name, destination: row.destination, value: r2(Number(row.value)),
    }));
  },

  // Items that will run short, with how much to order and why. Nothing is ordered here:
  // a suggestion becomes a draft purchase order, which still needs approval.
  async reorder(institutionId: string, daysValue: unknown) {
    const days = Math.min(180, Math.max(7, Number(daysValue) || 30));
    const { rows } = await postgresService.query(
      `SELECT i.id, i.name, i.sku, i.unit, i.reorder_level, i.max_level, i.avg_cost,
         (SELECT COALESCE(SUM(b.quantity), 0) FROM inv_balances b WHERE b.item_id = i.id) AS on_hand,
         (SELECT COALESCE(-SUM(m.quantity), 0) FROM inv_movements m LEFT JOIN inv_movements o ON o.id = m.reverses_id
            WHERE m.item_id = i.id AND m.created_at >= NOW() - make_interval(days => $2::int)
              AND (m.kind IN ('ISSUE', 'CONSUMPTION') OR (m.kind = 'REVERSAL' AND o.kind IN ('ISSUE', 'CONSUMPTION')))) AS used,
         (SELECT COALESCE(SUM(l.quantity - l.received), 0) FROM inv_po_lines l JOIN inv_purchase_orders p ON p.id = l.po_id
            WHERE l.item_id = i.id AND p.status IN ('APPROVED', 'PARTIAL')) AS on_order,
         last.unit_cost AS last_cost, last.party AS last_supplier, best.unit_cost AS best_cost, best.party AS best_supplier
       FROM inv_items i
       LEFT JOIN LATERAL (SELECT unit_cost, party FROM inv_movements WHERE item_id = i.id AND kind = 'RECEIPT' AND unit_cost > 0
         ORDER BY created_at DESC LIMIT 1) last ON TRUE
       LEFT JOIN LATERAL (SELECT unit_cost, party FROM inv_movements WHERE item_id = i.id AND kind = 'RECEIPT' AND unit_cost > 0 AND party <> ''
         AND created_at >= NOW() - INTERVAL '365 days' ORDER BY unit_cost, created_at DESC LIMIT 1) best ON TRUE
       WHERE i.institution_id = $1 AND i.status = 'ACTIVE'
       ORDER BY i.name`, [institutionId, days]);
    const suggestions = [];
    for (const row of rows) {
      const onHand = r3(Number(row.on_hand));
      const used = r3(Math.max(0, Number(row.used)));
      const onOrder = r3(Number(row.on_order));
      const reorder = Number(row.reorder_level);
      const max = Number(row.max_level);
      const perDay = used / days;
      const coverDays = perDay > 0 ? Math.floor(onHand / perDay) : null;
      const low = reorder > 0 && onHand <= reorder;
      const runningOut = coverDays !== null && coverDays < COVER_DAYS;
      if (!low && !runningOut) continue;
      const target = max > 0 ? max : Math.max(reorder * 2, reorder + perDay * ORDER_DAYS);
      const suggest = Math.ceil(Math.max(0, target - onHand - onOrder));
      if (suggest <= 0) continue;
      const reasons = [];
      if (low) reasons.push(`${onHand} ${row.unit} on hand is at or below the reorder level of ${reorder}.`);
      if (perDay > 0) reasons.push(`Used ${r2(perDay)} ${row.unit} a day over the last ${days} days, so stock lasts about ${coverDays} day${coverDays === 1 ? "" : "s"}.`);
      if (onOrder > 0) reasons.push(`${onOrder} ${row.unit} are already on order.`);
      reasons.push(max > 0 ? `Orders up to the maximum stock of ${max}.` : `Orders ${ORDER_DAYS} days of use on top of the reorder level.`);
      const lastCost = row.last_cost !== null ? r2(Number(row.last_cost)) : null;
      const bestCost = row.best_cost !== null ? r2(Number(row.best_cost)) : null;
      suggestions.push({
        itemId: row.id, name: row.name, sku: row.sku, unit: row.unit, onHand, used, perDay: r3(perDay), coverDays, onOrder,
        reorderLevel: reorder, maxLevel: max, suggest, reasons,
        lastCost, lastSupplier: row.last_supplier || "", bestCost, bestSupplier: row.best_supplier || "",
        estimatedCost: r2(suggest * (lastCost ?? Number(row.avg_cost))),
        urgency: onHand <= 0 ? "OUT" : coverDays !== null && coverDays < 7 ? "HIGH" : "NORMAL",
      });
    }
    const order = { OUT: 0, HIGH: 1, NORMAL: 2 } as Record<string, number>;
    return { days, suggestions: suggestions.sort((a, b) => order[a.urgency] - order[b.urgency] || (a.coverDays ?? 1e9) - (b.coverDays ?? 1e9)) };
  },
};
