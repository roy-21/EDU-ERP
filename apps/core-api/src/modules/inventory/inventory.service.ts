import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { amount, date, fail, inTx, oneOf, text, todayBd } from "../academics/academics.common";

// Inventory has two kinds of things:
//  - stock items (consumables) counted per store, moved only through the stock ledger;
//  - assets, tracked one by one with a tag, a holder and a history.
// Every stock change locks the item row first and then the balance row, always in that
// order, so two desks working at once cannot deadlock or take stock below zero.

type Db = PoolClient | typeof postgresService;

export const r3 = (value: number) => Math.round(value * 1000) / 1000;
export const r4 = (value: number) => Math.round(value * 10000) / 10000;
// The average cost is kept to 8 decimals so that taking a receipt back restores it exactly.
const r8 = (value: number) => Math.round(value * 1e8) / 1e8;
export const r2 = (value: number) => Math.round(value * 100) / 100;

export const quantity = (value: unknown, label: string, allowZero = false): number => {
  const result = Number(value);
  if (value === "" || value === null || value === undefined || typeof value === "boolean" || !Number.isFinite(result) || result < 0 || result > 1_000_000_000 || (!allowZero && result === 0)) {
    fail(400, `${label} must be a number ${allowZero ? "of 0 or more" : "above 0"}.`);
  }
  if (Math.abs(Math.round(result * 1000) - result * 1000) > 1e-6) fail(400, `${label} may have at most three decimals.`);
  return r3(result);
};

export const unitCost = (value: unknown, label: string): number => {
  if (value === undefined || value === null || value === "") return 0;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 100_000_000) fail(400, `${label} must be an amount from 0 to 100000000.`);
  return r4(result);
};

export const skuOf = (value: unknown, label: string, max = 40) => {
  const result = text(value, label, max).toUpperCase();
  if (result && !/^[A-Z0-9][A-Z0-9._-]*$/.test(result)) fail(400, `${label} may use letters, numbers, dots, dashes and underscores.`);
  return result;
};

// Code 128 prints any visible ASCII character, so barcodes are kept to those.
const barcodeOf = (value: unknown) => {
  const result = text(value, "Barcode", 64);
  if (result && !/^[\x20-\x7E]+$/.test(result)) fail(400, "A barcode may only use plain letters, numbers and symbols.");
  return result;
};

export const shortCode = () => newId().replace(/-/g, "").slice(0, 6).toUpperCase();
export const docNo = (prefix: string) => `${prefix}-${todayBd().slice(2).replace(/-/g, "")}-${shortCode()}`;

const PREFIX: Record<string, string> = {
  OPENING: "OPN", RECEIPT: "GRN", ISSUE: "ISS", RETURN: "RTN", ADJUSTMENT: "ADJ", DAMAGE: "DMG", LOSS: "LOS", REVERSAL: "REV",
  CONSUMPTION: "CON", WASTAGE: "WST",
};

// What stock was used for, so spending can be reported by purpose.
export const expenseCategoryOf = (value: unknown) => text(value, "Expense category", 60);

export const STORE_KINDS = ["STORE", "WAREHOUSE", "KITCHEN", "DEPARTMENT", "LAB", "OFFICE", "OTHER"] as const;

// ---- Stores -----------------------------------------------------------------------

const storeFromRow = (row: any) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  kind: row.kind,
  location: row.location,
  manager: row.manager,
  isActive: row.is_active,
  itemCount: Number(row.item_count ?? 0),
  stockValue: r2(Number(row.stock_value ?? 0)),
  assetCount: Number(row.asset_count ?? 0),
  createdAt: toIso(row.created_at),
});

const STORE_SELECT = `SELECT s.*,
  (SELECT COUNT(*) FROM inv_balances b WHERE b.store_id = s.id AND b.quantity > 0) AS item_count,
  (SELECT COALESCE(SUM(b.quantity * i.avg_cost), 0) FROM inv_balances b JOIN inv_items i ON i.id = b.item_id WHERE b.store_id = s.id) AS stock_value,
  (SELECT COUNT(*) FROM inv_assets a WHERE a.store_id = s.id AND a.status <> 'DISPOSED') AS asset_count
  FROM inv_stores s`;

export const activeStore = async (db: Db, institutionId: string, id: unknown, label = "Store") => {
  if (typeof id !== "string" || !id) fail(400, `${label} is required.`);
  const { rows } = await db.query("SELECT * FROM inv_stores WHERE institution_id = $1 AND id = $2", [institutionId, id]);
  if (!rows[0]) fail(404, `${label} not found.`);
  if (!rows[0].is_active) fail(409, `${rows[0].name} is closed.`);
  return rows[0];
};

export const storesService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(`${STORE_SELECT} WHERE s.institution_id = $1 ORDER BY s.is_active DESC, s.name`, [institutionId]);
    return rows.map(storeFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${STORE_SELECT} WHERE s.institution_id = $1 AND s.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Store not found.");
    return storeFromRow(rows[0]);
  },

  async create(actor: Actor, body: any) {
    const code = skuOf(body?.code, "Store code", 20);
    if (!code) fail(400, "Store code is required.");
    const name = text(body?.name, "Store name", 120, true);
    const id = newId();
    await inTx(async (tx) => {
      await tx.query(
        "INSERT INTO inv_stores (id, institution_id, code, name, location, manager, kind) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, actor.institutionId, code, name, text(body?.location, "Location", 200), text(body?.manager, "Manager", 150),
          oneOf(body?.kind || undefined, "Store type", STORE_KINDS, "STORE")]
      );
      await audit(tx, actor, "inventory.store.create", "store", id, `Opened store ${code} (${name}).`);
    });
    return this.get(actor.institutionId, id);
  },

  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const current = (await tx.query("SELECT * FROM inv_stores WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Store not found.");
      const code = body?.code !== undefined ? skuOf(body.code, "Store code", 20) : current.code;
      if (!code) fail(400, "Store code is required.");
      const isActive = body?.isActive !== undefined ? body.isActive === true : current.is_active;
      if (!isActive && current.is_active) {
        const held = (await tx.query("SELECT 1 FROM inv_balances WHERE store_id = $1 AND quantity > 0 LIMIT 1", [id])).rows[0];
        if (held) fail(409, "This store still holds stock. Transfer or issue it before closing the store.");
        const moving = (await tx.query("SELECT 1 FROM inv_transfers WHERE (from_store_id = $1 OR to_store_id = $1) AND status IN ('PENDING', 'IN_TRANSIT') LIMIT 1", [id])).rows[0];
        if (moving) fail(409, "A transfer to or from this store is still open.");
      }
      await tx.query(
        "UPDATE inv_stores SET code = $3, name = $4, location = $5, manager = $6, is_active = $7, kind = $8 WHERE institution_id = $1 AND id = $2",
        [actor.institutionId, id, code,
          body?.name !== undefined ? text(body.name, "Store name", 120, true) : current.name,
          body?.location !== undefined ? text(body.location, "Location", 200) : current.location,
          body?.manager !== undefined ? text(body.manager, "Manager", 150) : current.manager,
          isActive,
          body?.kind ? oneOf(body.kind, "Store type", STORE_KINDS) : current.kind]
      );
      await audit(tx, actor, "inventory.store.update", "store", id, `Edited store ${code}${isActive ? "" : " (closed)"}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const store = (await tx.query("SELECT * FROM inv_stores WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!store) fail(404, "Store not found.");
      const used = (await tx.query(
        `SELECT EXISTS (SELECT 1 FROM inv_movements WHERE store_id = $1) OR EXISTS (SELECT 1 FROM inv_assets WHERE store_id = $1)
           OR EXISTS (SELECT 1 FROM inv_transfers WHERE from_store_id = $1 OR to_store_id = $1) AS used`, [id])).rows[0].used;
      if (used) fail(409, "This store has stock history or assets. Close it instead of deleting it.");
      await tx.query("DELETE FROM inv_balances WHERE store_id = $1", [id]);
      await tx.query("DELETE FROM inv_stores WHERE id = $1", [id]);
      await audit(tx, actor, "inventory.store.delete", "store", id, `Deleted store ${store.code}.`);
      return { id };
    });
  },
};

// ---- Items ------------------------------------------------------------------------

const stockStatus = (onHand: number, reorder: number, max: number) => {
  if (onHand <= 0) return "OUT";
  if (reorder > 0 && onHand <= reorder) return "LOW";
  if (max > 0 && onHand > max) return "OVER";
  return "OK";
};

const itemFromRow = (row: any) => {
  const onHand = r3(Number(row.on_hand ?? 0));
  const exactCost = Number(row.avg_cost);
  const avgCost = r4(exactCost);
  const reorderLevel = Number(row.reorder_level);
  const maxLevel = Number(row.max_level);
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    description: row.description,
    category: row.category,
    brand: row.brand,
    unit: row.unit,
    reorderLevel,
    maxLevel,
    avgCost,
    onHand,
    stockValue: r2(onHand * exactCost),
    stockStatus: stockStatus(onHand, reorderLevel, maxLevel),
    status: row.status,
    trackBatches: row.track_batches === true,
    lastMovementAt: toIso(row.last_movement_at ?? null),
    createdAt: toIso(row.created_at),
  };
};

const ITEM_SELECT = `SELECT i.*,
  (SELECT COALESCE(SUM(b.quantity), 0) FROM inv_balances b WHERE b.item_id = i.id) AS on_hand,
  (SELECT MAX(m.created_at) FROM inv_movements m WHERE m.item_id = i.id) AS last_movement_at
  FROM inv_items i`;

const itemInput = (body: any, existing?: any) => {
  const pick = (key: string, column: string, label: string, max: number, required = false) =>
    body?.[key] !== undefined || !existing ? text(body?.[key], label, max, required) : existing[column];
  const sku = body?.sku !== undefined || !existing ? skuOf(body?.sku, "SKU") : existing.sku;
  const data = {
    sku,
    barcode: body?.barcode !== undefined || !existing ? barcodeOf(body?.barcode) : existing.barcode,
    name: pick("name", "name", "Item name", 200, true),
    description: pick("description", "description", "Description", 1000),
    category: pick("category", "category", "Category", 100),
    brand: pick("brand", "brand", "Brand", 100),
    unit: (body?.unit !== undefined || !existing ? text(body?.unit, "Unit", 30) : existing.unit) || "Piece",
    reorderLevel: body?.reorderLevel !== undefined && body?.reorderLevel !== null && body?.reorderLevel !== "" ? quantity(body.reorderLevel, "Reorder level", true) : existing ? Number(existing.reorder_level) : 0,
    maxLevel: body?.maxLevel !== undefined && body?.maxLevel !== null && body?.maxLevel !== "" ? quantity(body.maxLevel, "Maximum stock", true) : existing ? Number(existing.max_level) : 0,
    trackBatches: body?.trackBatches !== undefined && body?.trackBatches !== null && body?.trackBatches !== ""
      ? [true, "true", "yes", "1", "y"].includes(typeof body.trackBatches === "string" ? body.trackBatches.trim().toLowerCase() : body.trackBatches)
      : existing ? existing.track_batches === true : false,
  };
  if (data.maxLevel > 0 && data.maxLevel < data.reorderLevel) fail(400, "Maximum stock cannot be below the reorder level.");
  return data;
};

export const lockItem = async (tx: PoolClient, institutionId: string, itemId: unknown) => {
  if (typeof itemId !== "string" || !itemId) fail(400, "Item is required.");
  const { rows } = await tx.query("SELECT * FROM inv_items WHERE institution_id = $1 AND id = $2 FOR UPDATE", [institutionId, itemId]);
  if (!rows[0]) fail(404, "Item not found.");
  return rows[0];
};

export const totalOnHand = async (tx: PoolClient, itemId: string) =>
  Number((await tx.query("SELECT COALESCE(SUM(quantity), 0) AS q FROM inv_balances WHERE item_id = $1", [itemId])).rows[0].q);

type Movement = {
  item: any;
  store: any;
  kind: string;
  quantity: number; // signed
  unitCost?: number;
  docNo: string;
  party?: string;
  reference?: string;
  note?: string;
  transferId?: string | null;
  reversesId?: string | null;
  purchaseOrderId?: string | null;
  requisitionId?: string | null;
  expenseCategory?: string;
  meal?: string;
  batch?: any; // a locked inv_batches row
};

// Posts one ledger row and changes the balance with it. The item row must already be locked.
// Stock never goes below zero: the check here gives a clear message, the table CHECK is the backstop.
const post = async (tx: PoolClient, actor: Actor, m: Movement) => {
  if (m.item.track_batches && !m.batch) fail(400, `"${m.item.name}" is tracked by batch, so every movement needs a batch.`);
  await tx.query(
    "INSERT INTO inv_balances (institution_id, item_id, store_id, quantity) VALUES ($1, $2, $3, 0) ON CONFLICT (item_id, store_id) DO NOTHING",
    [actor.institutionId, m.item.id, m.store.id]
  );
  const balance = Number((await tx.query("SELECT quantity FROM inv_balances WHERE item_id = $1 AND store_id = $2 FOR UPDATE", [m.item.id, m.store.id])).rows[0].quantity);
  const after = r3(balance + m.quantity);
  if (after < 0) {
    fail(409, `Only ${balance} ${m.item.unit} of "${m.item.name}" ${balance === 1 ? "is" : "are"} in ${m.store.name}; ${Math.abs(m.quantity)} cannot be taken out.`);
  }
  await tx.query("UPDATE inv_balances SET quantity = $3 WHERE item_id = $1 AND store_id = $2", [m.item.id, m.store.id, after]);
  if (m.batch) {
    const inBatch = Number(m.batch.quantity);
    const batchAfter = r3(inBatch + m.quantity);
    if (batchAfter < 0) fail(409, `Only ${inBatch} ${m.item.unit} of "${m.item.name}" are left in batch ${m.batch.batch_no}.`);
    await tx.query("UPDATE inv_batches SET quantity = $2 WHERE id = $1", [m.batch.id, batchAfter]);
    m.batch.quantity = batchAfter;
  }
  const id = newId();
  await tx.query(
    `INSERT INTO inv_movements (id, institution_id, doc_no, item_id, store_id, kind, quantity, unit_cost, balance_after, party, reference, note,
       transfer_id, reverses_id, created_by, batch_id, purchase_order_id, requisition_id, expense_category, meal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [id, actor.institutionId, m.docNo, m.item.id, m.store.id, m.kind, m.quantity, r4(m.unitCost ?? Number(m.item.avg_cost)), after,
      m.party || "", m.reference || "", m.note || "", m.transferId || null, m.reversesId || null, actor.email, m.batch?.id || null, m.purchaseOrderId || null,
      m.requisitionId || null, m.expenseCategory || "", m.meal || ""]
  );
  return { id, after };
};

// Stock bought in at a cost changes the weighted average cost of the item.
export const takeInAtCost = async (tx: PoolClient, item: any, qty: number, cost: number) => {
  const onHand = await totalOnHand(tx, item.id);
  const average = Number(item.avg_cost);
  const next = onHand + qty > 0 ? r8((onHand * average + qty * cost) / (onHand + qty)) : cost;
  await tx.query("UPDATE inv_items SET avg_cost = $2, updated_at = NOW() WHERE id = $1", [item.id, next]);
  item.avg_cost = next;
};

// ---- Batches ------------------------------------------------------------------------

export type BatchSpec = { batchNo: string; expiresOn: string | null };

export const batchSpecOf = (raw: any, label: string): BatchSpec | null => {
  const batchNo = text(raw?.batchNo, `${label} batch number`, 60);
  const expiresOn = date(raw?.expiresOn, `${label} expiry date`);
  if (!batchNo) {
    if (expiresOn) fail(400, `${label}: an expiry date needs a batch number.`);
    return null;
  }
  return { batchNo, expiresOn };
};

// The batch of this item in this store, created on first use and locked.
const batchFor = async (tx: PoolClient, actor: Actor, item: any, store: any, spec: BatchSpec) => {
  await tx.query(
    `INSERT INTO inv_batches (id, institution_id, item_id, store_id, batch_no, expires_on) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (item_id, store_id, batch_no) DO NOTHING`,
    [newId(), actor.institutionId, item.id, store.id, spec.batchNo, spec.expiresOn]
  );
  const batch = (await tx.query("SELECT * FROM inv_batches WHERE item_id = $1 AND store_id = $2 AND batch_no = $3 FOR UPDATE", [item.id, store.id, spec.batchNo])).rows[0];
  if (spec.expiresOn && batch.expires_on && batch.expires_on !== spec.expiresOn) {
    fail(409, `Batch ${spec.batchNo} of "${item.name}" already expires on ${batch.expires_on}, not ${spec.expiresOn}.`);
  }
  if (spec.expiresOn && !batch.expires_on) {
    await tx.query("UPDATE inv_batches SET expires_on = $2 WHERE id = $1", [batch.id, spec.expiresOn]);
    batch.expires_on = spec.expiresOn;
  }
  return batch;
};

type MovementBase = Omit<Movement, "item" | "store" | "quantity" | "batch">;

// Stock coming into a store: into its batch when the item tracks batches.
export const putIn = async (tx: PoolClient, actor: Actor, item: any, store: any, qty: number, base: MovementBase, spec: BatchSpec | null) => {
  if (!item.track_batches) return post(tx, actor, { ...base, item, store, quantity: qty });
  if (!spec) fail(400, `"${item.name}" is tracked by batch. Give its batch number.`);
  return post(tx, actor, { ...base, item, store, quantity: qty, batch: await batchFor(tx, actor, item, store, spec!) });
};

// Stock leaving a store. Batches go first-expiry-first-out; expired stock is only written off, never issued.
export const takeOut = async (tx: PoolClient, actor: Actor, item: any, store: any, qty: number, base: MovementBase,
  options: { batchId?: string | null; usableOnly?: boolean } = {}) => {
  if (!item.track_batches) return [await post(tx, actor, { ...base, item, store, quantity: -qty })];
  if (options.batchId) {
    const batch = (await tx.query("SELECT * FROM inv_batches WHERE id = $1 AND item_id = $2 AND store_id = $3 FOR UPDATE", [options.batchId, item.id, store.id])).rows[0];
    if (!batch) fail(404, `That batch of "${item.name}" is not in ${store.name}.`);
    if (options.usableOnly && batch.expires_on && batch.expires_on < todayBd()) fail(409, `Batch ${batch.batch_no} expired on ${batch.expires_on}. Write it off instead.`);
    return [await post(tx, actor, { ...base, item, store, quantity: -qty, batch })];
  }
  const today = todayBd();
  const batches = (await tx.query(
    "SELECT * FROM inv_batches WHERE item_id = $1 AND store_id = $2 AND quantity > 0 ORDER BY expires_on NULLS LAST, created_at, batch_no FOR UPDATE",
    [item.id, store.id])).rows;
  const usable = options.usableOnly ? batches.filter((batch: any) => !batch.expires_on || batch.expires_on >= today) : batches;
  const available = r3(usable.reduce((sum: number, batch: any) => sum + Number(batch.quantity), 0));
  if (available < qty) {
    const expired = r3(batches.reduce((sum: number, batch: any) => sum + Number(batch.quantity), 0) - available);
    fail(409, `Only ${available} ${item.unit} of "${item.name}" can be taken from ${store.name}${expired > 0 ? ` (${expired} more ${item.unit} have expired and can only be written off)` : ""}; ${qty} were asked for.`);
  }
  const posted = [];
  let left = qty;
  for (const batch of usable) {
    if (left <= 0) break;
    const take = r3(Math.min(left, Number(batch.quantity)));
    posted.push(await post(tx, actor, { ...base, item, store, quantity: -take, batch }));
    left = r3(left - take);
  }
  return posted;
};

export const MOVEMENT_SELECT = `SELECT m.*, i.name AS item_name, i.sku, i.unit, s.name AS store_name, s.code AS store_code,
  bt.batch_no, bt.expires_on,
  EXISTS (SELECT 1 FROM inv_movements r WHERE r.reverses_id = m.id) AS is_reversed
  FROM inv_movements m JOIN inv_items i ON i.id = m.item_id JOIN inv_stores s ON s.id = m.store_id
  LEFT JOIN inv_batches bt ON bt.id = m.batch_id`;

export const movementFromRow = (row: any) => ({
  id: row.id,
  docNo: row.doc_no,
  kind: row.kind,
  itemId: row.item_id,
  itemName: row.item_name,
  sku: row.sku,
  unit: row.unit,
  storeId: row.store_id,
  storeName: row.store_name,
  storeCode: row.store_code,
  quantity: Number(row.quantity),
  unitCost: r4(Number(row.unit_cost)),
  value: r2(Number(row.quantity) * Number(row.unit_cost)),
  balanceAfter: Number(row.balance_after),
  party: row.party,
  reference: row.reference,
  note: row.note,
  transferId: row.transfer_id,
  reversesId: row.reverses_id,
  batchId: row.batch_id,
  batchNo: row.batch_no || "",
  expiresOn: row.expires_on || null,
  purchaseOrderId: row.purchase_order_id,
  requisitionId: row.requisition_id,
  expenseCategory: row.expense_category || "",
  meal: row.meal || "",
  isReversed: row.is_reversed === true,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
});

export const itemsService = {
  async list(institutionId: string, filters: { search?: string; category?: string; status?: string; stock?: string } = {}) {
    const status = filters.status === "ALL" ? "" : filters.status || "ACTIVE";
    const { rows } = await postgresService.query(
      `${ITEM_SELECT} WHERE i.institution_id = $1
         AND ($2 = '' OR i.name ILIKE '%' || $2 || '%' OR i.sku ILIKE '%' || $2 || '%' OR i.barcode ILIKE '%' || $2 || '%' OR i.brand ILIKE '%' || $2 || '%')
         AND ($3 = '' OR i.category = $3) AND ($4 = '' OR i.status = $4)
       ORDER BY i.name LIMIT 5000`,
      [institutionId, filters.search?.trim() || "", filters.category || "", status]
    );
    const items = rows.map(itemFromRow);
    return filters.stock ? items.filter((item: any) => item.stockStatus === filters.stock) : items;
  },

  async categories(institutionId: string) {
    const { rows } = await postgresService.query(
      `SELECT category FROM inv_items WHERE institution_id = $1 AND category <> '' UNION SELECT category FROM inv_assets WHERE institution_id = $1 AND category <> '' ORDER BY 1`,
      [institutionId]
    );
    return rows.map((row: any) => row.category);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${ITEM_SELECT} WHERE i.institution_id = $1 AND i.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Item not found.");
    const balances = await postgresService.query(
      `SELECT b.store_id, b.quantity, s.name, s.code FROM inv_balances b JOIN inv_stores s ON s.id = b.store_id
       WHERE b.item_id = $1 AND b.quantity <> 0 ORDER BY s.name`, [id]);
    const recent = await postgresService.query(`${MOVEMENT_SELECT} WHERE m.institution_id = $1 AND m.item_id = $2 ORDER BY m.created_at DESC LIMIT 25`, [institutionId, id]);
    const batches = await batchesService.list(institutionId, { itemId: id });
    return {
      ...itemFromRow(rows[0]),
      batches,
      balances: balances.rows.map((row: any) => ({ storeId: row.store_id, storeName: row.name, storeCode: row.code, quantity: Number(row.quantity) })),
      movements: recent.rows.map(movementFromRow),
    };
  },

  // Finds an item or an asset by a scanned barcode, SKU, asset tag or serial number.
  async lookup(institutionId: string, scanned: string) {
    const value = scanned.trim();
    if (!value) fail(400, "Scan or type a code.");
    const item = (await postgresService.query(
      `${ITEM_SELECT} WHERE i.institution_id = $1 AND (i.barcode = $2 OR LOWER(i.sku) = LOWER($2)) LIMIT 1`, [institutionId, value])).rows[0];
    if (item) return { type: "ITEM", item: itemFromRow(item) };
    const asset = (await postgresService.query(
      `${ASSET_SELECT} WHERE a.institution_id = $1 AND (LOWER(a.asset_tag) = LOWER($2) OR (a.serial_no <> '' AND LOWER(a.serial_no) = LOWER($2))) LIMIT 1`, [institutionId, value])).rows[0];
    if (asset) return { type: "ASSET", asset: assetFromRow(asset) };
    fail(404, `Nothing has the code "${value}".`);
  },

  async create(actor: Actor, body: any) {
    const id = await inTx((tx) => createItem(tx, actor, body));
    return this.get(actor.institutionId, id);
  },

  // All rows are checked first; one bad row stops the whole import, so nothing is half done.
  async importMany(actor: Actor, body: any) {
    const rows = Array.isArray(body?.items) ? body.items : null;
    if (!rows || rows.length === 0) fail(400, "There are no rows to import.");
    if (rows.length > 1000) fail(400, "Import at most 1000 items at a time.");
    const ids = await inTx(async (tx) => {
      const created: string[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        try {
          created.push(await createItem(tx, actor, rows[index], false));
        } catch (err: any) {
          if (err.code === "23505") fail(409, `Row ${index + 1}: an item with this SKU or barcode already exists.`);
          fail(err.statusCode || 400, `Row ${index + 1}: ${err.message}`);
        }
      }
      await audit(tx, actor, "inventory.item.import", "item", created[0], `Imported ${created.length} items.`);
      return created;
    });
    return { imported: ids.length };
  },

  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const current = await lockItem(tx, actor.institutionId, id);
      const data = itemInput(body, current);
      if (!data.sku) fail(400, "SKU is required.");
      if (data.trackBatches !== (current.track_batches === true)) {
        const busy = (await tx.query(
          `SELECT EXISTS (SELECT 1 FROM inv_balances WHERE item_id = $1 AND quantity > 0)
             OR EXISTS (SELECT 1 FROM inv_transfer_lines l JOIN inv_transfers t ON t.id = l.transfer_id WHERE l.item_id = $1 AND t.status IN ('PENDING', 'IN_TRANSIT'))
             OR EXISTS (SELECT 1 FROM inv_po_lines l JOIN inv_purchase_orders o ON o.id = l.po_id WHERE l.item_id = $1 AND o.status IN ('APPROVED', 'PARTIAL')) AS busy`, [id])).rows[0].busy;
        if (busy) fail(409, "Batch tracking can only be switched while the item has no stock, no open transfer and no open purchase order.");
      }
      await tx.query(
        `UPDATE inv_items SET sku = $3, barcode = $4, name = $5, description = $6, category = $7, brand = $8, unit = $9,
           reorder_level = $10, max_level = $11, track_batches = $12, updated_at = NOW() WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, data.sku, data.barcode || data.sku, data.name, data.description, data.category, data.brand, data.unit, data.reorderLevel, data.maxLevel, data.trackBatches]
      );
      await audit(tx, actor, "inventory.item.update", "item", id, `Edited ${data.sku} "${data.name}".`);
    });
    return this.get(actor.institutionId, id);
  },

  // An item with stock on hand stays active, so its stock is never hidden from the balance.
  async setArchived(actor: Actor, id: string, archived: boolean) {
    await inTx(async (tx) => {
      const item = await lockItem(tx, actor.institutionId, id);
      if (archived && (await totalOnHand(tx, id)) > 0) fail(409, "This item still has stock. Issue or write it off before archiving.");
      if (archived && (await tx.query("SELECT 1 FROM inv_transfer_lines l JOIN inv_transfers t ON t.id = l.transfer_id WHERE l.item_id = $1 AND t.status IN ('PENDING', 'IN_TRANSIT') LIMIT 1", [id])).rows[0]) {
        fail(409, "This item is on an open transfer.");
      }
      await tx.query("UPDATE inv_items SET status = $2, updated_at = NOW() WHERE id = $1", [id, archived ? "ARCHIVED" : "ACTIVE"]);
      await audit(tx, actor, archived ? "inventory.item.archive" : "inventory.item.restore", "item", id, `${archived ? "Archived" : "Restored"} ${item.sku}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const item = await lockItem(tx, actor.institutionId, id);
      const used = (await tx.query(
        `SELECT EXISTS (SELECT 1 FROM inv_movements WHERE item_id = $1) OR EXISTS (SELECT 1 FROM inv_transfer_lines WHERE item_id = $1)
           OR EXISTS (SELECT 1 FROM inv_po_lines WHERE item_id = $1) OR EXISTS (SELECT 1 FROM inv_requisition_lines WHERE item_id = $1)
           OR EXISTS (SELECT 1 FROM inv_assets WHERE item_id = $1) AS used`, [id])).rows[0].used;
      if (used) fail(409, "This item has stock or purchase history. Archive it instead of deleting it.");
      await tx.query("DELETE FROM inv_batches WHERE item_id = $1", [id]);
      await tx.query("DELETE FROM inv_balances WHERE item_id = $1", [id]);
      await tx.query("DELETE FROM inv_items WHERE id = $1", [id]);
      await audit(tx, actor, "inventory.item.delete", "item", id, `Deleted ${item.sku} "${item.name}".`);
      return { id };
    });
  },
};

// Creates an item, and its opening stock when a quantity and store are given.
const createItem = async (tx: PoolClient, actor: Actor, body: any, withAudit = true) => {
  const data = itemInput(body);
  const id = newId();
  const sku = data.sku || `ITM-${shortCode()}`;
  const barcode = data.barcode || sku;
  await tx.query(
    `INSERT INTO inv_items (id, institution_id, sku, barcode, name, description, category, brand, unit, reorder_level, max_level, track_batches)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, actor.institutionId, sku, barcode, data.name, data.description, data.category, data.brand, data.unit, data.reorderLevel, data.maxLevel, data.trackBatches]
  );
  const opening = body?.openingQuantity === undefined || body?.openingQuantity === null || body?.openingQuantity === "" ? 0 : quantity(body.openingQuantity, "Opening stock", true);
  if (opening > 0) {
    const store = await activeStore(tx, actor.institutionId, body?.storeId, "Store for the opening stock");
    const cost = unitCost(body?.unitCost, "Unit cost");
    const item = (await tx.query("SELECT * FROM inv_items WHERE id = $1 FOR UPDATE", [id])).rows[0];
    await takeInAtCost(tx, item, opening, cost);
    await putIn(tx, actor, item, store, opening, { kind: "OPENING", unitCost: cost, docNo: docNo("OPN"), note: "Opening stock" }, batchSpecOf(body, "Opening stock"));
  }
  if (withAudit) await audit(tx, actor, "inventory.item.create", "item", id, `Added ${sku} "${data.name}"${opening > 0 ? ` with ${opening} ${data.unit} opening stock` : ""}.`);
  return id;
};

// ---- Stock documents ---------------------------------------------------------------

export type Line = { itemId: string; quantity: number; unitCost: number | null; batch: BatchSpec | null };

// Lines of one document: each item (or each batch of an item) once, sorted by item id so
// locks are always taken in the same order. A line without a cost has unitCost null.
export const linesOf = (body: any, withCost = false): Line[] => {
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  if (raw.length === 0) fail(400, "Add at least one item.");
  if (raw.length > 200) fail(400, "A document can have at most 200 lines.");
  const seen = new Set<string>();
  const lines = raw.map((line: any, index: number) => {
    if (typeof line?.itemId !== "string" || !line.itemId) fail(400, `Line ${index + 1}: choose an item.`);
    const batch = batchSpecOf(line, `Line ${index + 1}`);
    const key = `${line.itemId}|${batch?.batchNo.toLowerCase() || ""}`;
    if (seen.has(key)) fail(400, "Each item (or batch of an item) can appear only once in a document.");
    seen.add(key);
    const hasCost = line.unitCost !== undefined && line.unitCost !== null && line.unitCost !== "";
    return {
      itemId: line.itemId,
      quantity: quantity(line.quantity, `Line ${index + 1} quantity`),
      unitCost: hasCost ? unitCost(line.unitCost, `Line ${index + 1} unit cost`) : withCost ? 0 : null,
      batch,
    };
  });
  return lines.sort((a: Line, b: Line) => (a.itemId < b.itemId ? -1 : 1));
};

export const activeItem = async (tx: PoolClient, institutionId: string, itemId: string) => {
  const item = await lockItem(tx, institutionId, itemId);
  if (item.status !== "ACTIVE") fail(409, `"${item.name}" is archived. Restore it first.`);
  return item;
};

export const listDocument = async (institutionId: string, no: string) => {
  const { rows } = await postgresService.query(`${MOVEMENT_SELECT} WHERE m.institution_id = $1 AND m.doc_no = $2 ORDER BY i.name`, [institutionId, no]);
  return { docNo: no, movements: rows.map(movementFromRow) };
};

export const stockService = {
  async movements(institutionId: string, filters: { itemId?: string; storeId?: string; kind?: string; from?: string; to?: string; search?: string } = {}) {
    const { rows } = await postgresService.query(
      `${MOVEMENT_SELECT} WHERE m.institution_id = $1
         AND ($2 = '' OR m.item_id = $2) AND ($3 = '' OR m.store_id = $3) AND ($4 = '' OR m.kind = $4)
         AND ($5 = '' OR m.created_at >= ($5::date)::timestamp AT TIME ZONE 'Asia/Dhaka')
         AND ($6 = '' OR m.created_at < ($6::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
         AND ($7 = '' OR i.name ILIKE '%' || $7 || '%' OR i.sku ILIKE '%' || $7 || '%' OR m.party ILIKE '%' || $7 || '%'
              OR m.reference ILIKE '%' || $7 || '%' OR m.doc_no ILIKE '%' || $7 || '%')
       ORDER BY m.created_at DESC, m.doc_no LIMIT 2000`,
      [institutionId, filters.itemId || "", filters.storeId || "", filters.kind || "",
        date(filters.from, "From date") || "", date(filters.to, "To date") || "", filters.search?.trim() || ""]
    );
    return rows.map(movementFromRow);
  },

  // Goods received from a supplier, at the price paid. Updates the average cost.
  async receive(actor: Actor, body: any) {
    const lines = linesOf(body, true);
    const supplier = text(body?.supplier, "Supplier", 200);
    const reference = text(body?.reference, "Invoice or challan number", 100);
    const note = text(body?.note, "Note", 500);
    const no = docNo("GRN");
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await takeInAtCost(tx, item, line.quantity, line.unitCost ?? 0);
        await putIn(tx, actor, item, store, line.quantity, { kind: "RECEIPT", unitCost: line.unitCost ?? 0, docNo: no, party: supplier, reference, note }, line.batch);
      }
      await audit(tx, actor, "inventory.stock.receive", "stock", no, `Received ${lines.length} item(s) into ${store.name}${supplier ? ` from ${supplier}` : ""}.`);
    });
    return listDocument(actor.institutionId, no);
  },

  // Stock handed out to a department, lab or person.
  async issue(actor: Actor, body: any) {
    const lines = linesOf(body);
    const issuedTo = text(body?.issuedTo, "Issued to", 200, true);
    const reference = text(body?.reference, "Requisition number", 100);
    const note = text(body?.note, "Note", 500);
    const expenseCategory = expenseCategoryOf(body?.expenseCategory);
    const no = docNo("ISS");
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await takeOut(tx, actor, item, store, line.quantity, { kind: "ISSUE", docNo: no, party: issuedTo, reference, note, expenseCategory }, { usableOnly: true });
      }
      await audit(tx, actor, "inventory.stock.issue", "stock", no, `Issued ${lines.length} item(s) from ${store.name} to ${issuedTo}.`);
    });
    return listDocument(actor.institutionId, no);
  },

  // Unused stock coming back from a department. It returns at the current average cost.
  async takeBack(actor: Actor, body: any) {
    const lines = linesOf(body);
    const returnedBy = text(body?.returnedBy, "Returned by", 200, true);
    const note = text(body?.note, "Note", 500);
    const no = docNo("RTN");
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await putIn(tx, actor, item, store, line.quantity, { kind: "RETURN", docNo: no, party: returnedBy, reference: text(body?.reference, "Reference", 100), note }, line.batch);
      }
      await audit(tx, actor, "inventory.stock.return", "stock", no, `Took back ${lines.length} item(s) into ${store.name} from ${returnedBy}.`);
    });
    return listDocument(actor.institutionId, no);
  },

  // A physical count: the balance is set to what was counted and the difference is posted.
  async count(actor: Actor, body: any) {
    const counted = quantity(body?.countedQuantity, "Counted quantity", true);
    const reason = text(body?.reason, "Reason", 500, true);
    const no = docNo("ADJ");
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      const item = await activeItem(tx, actor.institutionId, body?.itemId);
      // A batch-tracked item is counted batch by batch.
      let batch: any = null;
      if (item.track_batches) {
        const spec = batchSpecOf(body, "Count");
        if (!spec) fail(400, `"${item.name}" is tracked by batch. Count one batch at a time and give its batch number.`);
        batch = await batchFor(tx, actor, item, store, spec!);
      }
      const current = batch ? Number(batch.quantity)
        : Number((await tx.query("SELECT quantity FROM inv_balances WHERE item_id = $1 AND store_id = $2", [item.id, store.id])).rows[0]?.quantity ?? 0);
      const difference = r3(counted - current);
      if (difference === 0) fail(400, `The count matches the balance (${current} ${item.unit}). Nothing to adjust.`);
      const where = batch ? ` batch ${batch.batch_no}` : "";
      await post(tx, actor, { item, store, kind: "ADJUSTMENT", quantity: difference, docNo: no, note: `Counted ${counted}, book ${current}${where}. ${reason}`, batch });
      await audit(tx, actor, "inventory.stock.adjust", "stock", no, `Count of ${item.sku}${where} in ${store.name}: ${current} → ${counted}. ${reason}`);
    });
    return listDocument(actor.institutionId, no);
  },

  // Damaged, lost or wasted stock leaves the books with a reason.
  async writeOff(actor: Actor, body: any) {
    const kind = oneOf(body?.kind, "Write-off type", ["DAMAGE", "LOSS", "WASTAGE"] as const);
    const qty = quantity(body?.quantity, "Quantity");
    const reason = text(body?.reason, "Reason", 500, true);
    const no = docNo(PREFIX[kind]);
    await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      const item = await activeItem(tx, actor.institutionId, body?.itemId);
      await takeOut(tx, actor, item, store, qty, { kind, docNo: no, note: reason, expenseCategory: expenseCategoryOf(body?.expenseCategory) }, { batchId: typeof body?.batchId === "string" && body.batchId ? body.batchId : null });
      await audit(tx, actor, `inventory.stock.${kind.toLowerCase()}`, "stock", no, `Wrote off ${qty} ${item.unit} of ${item.sku} in ${store.name} as ${kind.toLowerCase()}. ${reason}`);
    });
    return listDocument(actor.institutionId, no);
  },

  // Undoes one ledger row with an opposite row. The original stays in the history.
  async reverse(actor: Actor, id: string, body: any) {
    const reason = text(body?.reason, "Reason", 500, true);
    const no = docNo("REV");
    await inTx(async (tx) => {
      const original = (await tx.query("SELECT * FROM inv_movements WHERE institution_id = $1 AND id = $2", [actor.institutionId, id])).rows[0];
      if (!original) fail(404, "Ledger entry not found.");
      if (["TRANSFER_OUT", "TRANSFER_IN"].includes(original.kind)) fail(409, "Transfer entries are undone by moving the stock back with a new transfer.");
      if (original.kind === "REVERSAL") fail(409, "A reversal cannot itself be reversed. Record the entry again instead.");
      // Stock issued against a requisition goes back onto it as not yet issued. The requisition is
      // locked before the item, the same order issuing from a requisition uses.
      if (original.requisition_id && Number(original.quantity) < 0) await unissueRequisition(tx, original.requisition_id, original.item_id, -Number(original.quantity));
      const item = await lockItem(tx, actor.institutionId, original.item_id);
      const store = (await tx.query("SELECT * FROM inv_stores WHERE id = $1", [original.store_id])).rows[0];
      const qty = Number(original.quantity);
      const cost = Number(original.unit_cost);
      // Taking out stock that came in at a known cost takes its value out of the average as well.
      if (qty > 0 && ["OPENING", "RECEIPT"].includes(original.kind)) {
        const onHand = await totalOnHand(tx, item.id);
        const left = onHand - qty;
        const next = left > 0 ? Math.max(0, r8((onHand * Number(item.avg_cost) - qty * cost) / left)) : Number(item.avg_cost);
        await tx.query("UPDATE inv_items SET avg_cost = $2, updated_at = NOW() WHERE id = $1", [item.id, next]);
      }
      const batch = original.batch_id ? (await tx.query("SELECT * FROM inv_batches WHERE id = $1 FOR UPDATE", [original.batch_id])).rows[0] : null;
      if (item.track_batches && !batch) fail(409, "This entry was made before the item tracked batches. Correct it with a stock count instead.");
      // Goods received against a purchase order go back onto that order as not yet received.
      if (original.purchase_order_id && qty > 0) await unreceivePurchase(tx, original.purchase_order_id, item.id, qty);
      await post(tx, actor, { item, store, kind: "REVERSAL", quantity: -qty, unitCost: cost, docNo: no, party: original.party,
        reference: original.doc_no, note: reason, reversesId: original.id, batch: item.track_batches ? batch : null, purchaseOrderId: original.purchase_order_id,
        requisitionId: original.requisition_id, expenseCategory: original.expense_category, meal: original.meal });
      await audit(tx, actor, "inventory.stock.reverse", "stock", no, `Reversed ${original.doc_no} (${original.kind}) for ${item.sku}. ${reason}`);
    });
    return listDocument(actor.institutionId, no);
  },

  document: listDocument,
};

// ---- Transfers --------------------------------------------------------------------

const TRANSFER_SELECT = `SELECT t.*, f.name AS from_name, f.code AS from_code, d.name AS to_name, d.code AS to_code,
  COALESCE((SELECT json_agg(json_build_object('itemId', l.item_id, 'quantity', l.quantity, 'name', i.name, 'sku', i.sku, 'unit', i.unit) ORDER BY i.name)
    FROM inv_transfer_lines l JOIN inv_items i ON i.id = l.item_id WHERE l.transfer_id = t.id), '[]') AS lines
  FROM inv_transfers t JOIN inv_stores f ON f.id = t.from_store_id JOIN inv_stores d ON d.id = t.to_store_id`;

const transferFromRow = (row: any) => ({
  id: row.id,
  transferNo: row.transfer_no,
  fromStoreId: row.from_store_id,
  fromStore: row.from_name,
  fromCode: row.from_code,
  toStoreId: row.to_store_id,
  toStore: row.to_name,
  toCode: row.to_code,
  status: row.status,
  note: row.note,
  decisionNote: row.decision_note,
  requestedBy: row.requested_by,
  approvedBy: row.approved_by,
  approvedAt: toIso(row.approved_at),
  receivedBy: row.received_by,
  receivedAt: toIso(row.received_at),
  createdAt: toIso(row.created_at),
  lines: (row.lines || []).map((line: any) => ({ ...line, quantity: Number(line.quantity) })),
});

const lockTransfer = async (tx: PoolClient, institutionId: string, id: string) => {
  const row = (await tx.query("SELECT * FROM inv_transfers WHERE institution_id = $1 AND id = $2 FOR UPDATE", [institutionId, id])).rows[0];
  if (!row) fail(404, "Transfer not found.");
  return row;
};

const transferLines = async (tx: PoolClient, id: string) =>
  (await tx.query("SELECT item_id, quantity FROM inv_transfer_lines WHERE transfer_id = $1 ORDER BY item_id", [id])).rows;

export const transfersService = {
  async list(institutionId: string, filters: { status?: string } = {}) {
    const status = filters.status || "";
    const { rows } = await postgresService.query(
      `${TRANSFER_SELECT} WHERE t.institution_id = $1 AND ($2 = '' OR ($2 = 'OPEN' AND t.status IN ('PENDING', 'IN_TRANSIT')) OR t.status = $2)
       ORDER BY t.created_at DESC LIMIT 500`, [institutionId, status]);
    return rows.map(transferFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${TRANSFER_SELECT} WHERE t.institution_id = $1 AND t.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Transfer not found.");
    return transferFromRow(rows[0]);
  },

  async request(actor: Actor, body: any) {
    const lines = linesOf(body);
    const note = text(body?.note, "Note", 500);
    const id = newId();
    const no = docNo("TRF");
    await inTx(async (tx) => {
      const from = await activeStore(tx, actor.institutionId, body?.fromStoreId, "From store");
      const to = await activeStore(tx, actor.institutionId, body?.toStoreId, "To store");
      if (from.id === to.id) fail(400, "Choose two different stores.");
      await tx.query(
        "INSERT INTO inv_transfers (id, institution_id, transfer_no, from_store_id, to_store_id, note, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, actor.institutionId, no, from.id, to.id, note, actor.email]
      );
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await tx.query("INSERT INTO inv_transfer_lines (transfer_id, item_id, quantity) VALUES ($1, $2, $3)", [id, item.id, line.quantity]);
      }
      await audit(tx, actor, "inventory.transfer.request", "transfer", id, `Requested ${no}: ${lines.length} item(s) from ${from.name} to ${to.name}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // Approval sends the stock: it leaves the source store now and is in transit until received.
  async approve(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const transfer = await lockTransfer(tx, actor.institutionId, id);
      if (transfer.status !== "PENDING") fail(409, "Only a pending transfer can be approved.");
      const from = await activeStore(tx, actor.institutionId, transfer.from_store_id, "From store");
      await activeStore(tx, actor.institutionId, transfer.to_store_id, "To store");
      for (const line of await transferLines(tx, id)) {
        const item = await activeItem(tx, actor.institutionId, line.item_id);
        await takeOut(tx, actor, item, from, Number(line.quantity), { kind: "TRANSFER_OUT", docNo: transfer.transfer_no, transferId: id, note: "Sent on transfer" }, { usableOnly: true });
      }
      await tx.query("UPDATE inv_transfers SET status = 'IN_TRANSIT', approved_by = $2, approved_at = NOW(), decision_note = $3 WHERE id = $1",
        [id, actor.email, text(body?.note, "Note", 500)]);
      await audit(tx, actor, "inventory.transfer.approve", "transfer", id, `Approved and sent ${transfer.transfer_no}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async receive(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const transfer = await lockTransfer(tx, actor.institutionId, id);
      if (transfer.status !== "IN_TRANSIT") fail(409, "Only a transfer in transit can be received.");
      const to = (await tx.query("SELECT * FROM inv_stores WHERE id = $1", [transfer.to_store_id])).rows[0];
      for (const line of await transferLines(tx, id)) {
        const item = await lockItem(tx, actor.institutionId, line.item_id);
        const base = { kind: "TRANSFER_IN", docNo: transfer.transfer_no, transferId: id, note: "Received from transfer" };
        if (!item.track_batches) {
          await post(tx, actor, { ...base, item, store: to, quantity: Number(line.quantity) });
          continue;
        }
        // The same batches, with the same expiry, arrive that left the source store.
        const sent = (await tx.query(
          `SELECT -m.quantity AS qty, b.batch_no, b.expires_on FROM inv_movements m JOIN inv_batches b ON b.id = m.batch_id
           WHERE m.transfer_id = $1 AND m.item_id = $2 AND m.kind = 'TRANSFER_OUT' ORDER BY b.batch_no`, [id, item.id])).rows;
        for (const part of sent) {
          await putIn(tx, actor, item, to, Number(part.qty), base, { batchNo: part.batch_no, expiresOn: part.expires_on });
        }
      }
      await tx.query("UPDATE inv_transfers SET status = 'RECEIVED', received_by = $2, received_at = NOW() WHERE id = $1", [id, actor.email]);
      await audit(tx, actor, "inventory.transfer.receive", "transfer", id, `Received ${transfer.transfer_no} into ${to.name}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // A pending transfer is rejected by an approver or cancelled by whoever asked for it.
  async close(actor: Actor, id: string, outcome: "REJECTED" | "CANCELLED", body: any, canApprove: boolean) {
    await inTx(async (tx) => {
      const transfer = await lockTransfer(tx, actor.institutionId, id);
      if (transfer.status !== "PENDING") fail(409, "Only a pending transfer can be rejected or cancelled.");
      if (outcome === "CANCELLED" && !canApprove && transfer.requested_by !== actor.email) fail(403, "Only the person who asked for this transfer, or an approver, can cancel it.");
      const note = text(body?.note, "Reason", 500, outcome === "REJECTED");
      await tx.query("UPDATE inv_transfers SET status = $2, decision_note = $3, approved_by = $4, approved_at = NOW() WHERE id = $1", [id, outcome, note, actor.email]);
      await audit(tx, actor, `inventory.transfer.${outcome.toLowerCase()}`, "transfer", id, `${outcome === "REJECTED" ? "Rejected" : "Cancelled"} ${transfer.transfer_no}.${note ? ` ${note}` : ""}`);
    });
    return this.get(actor.institutionId, id);
  },
};

// ---- Assets -----------------------------------------------------------------------

export const ASSET_SELECT = `SELECT a.*, s.name AS store_name, s.code AS store_code,
  r.room_number, r.hostel_name, r.building
  FROM inv_assets a LEFT JOIN inv_stores s ON s.id = a.store_id LEFT JOIN hostel_rooms r ON r.id = a.room_id`;

// "Room 101 · North Hall, Block A": how a hostel room is named on assets and reports.
export const roomLabel = (row: { room_number?: string; hostel_name?: string; building?: string }) =>
  row.room_number ? `Room ${row.room_number} · ${[row.hostel_name, row.building].filter(Boolean).join(", ")}` : "";

// A hostel room of this institution.
export const roomOf = async (db: Db, institutionId: string, id: unknown) => {
  if (typeof id !== "string" || !id) fail(400, "Room is required.");
  const room = (await db.query("SELECT * FROM hostel_rooms WHERE institution_id = $1 AND id = $2", [institutionId, id])).rows[0];
  if (!room) fail(404, "Room not found.");
  return room;
};

export const assetFromRow = (row: any) => ({
  id: row.id,
  assetTag: row.asset_tag,
  name: row.name,
  category: row.category,
  brand: row.brand,
  model: row.model,
  serialNo: row.serial_no,
  storeId: row.store_id,
  storeName: row.store_name,
  storeCode: row.store_code,
  roomId: row.room_id || null,
  roomLabel: roomLabel(row),
  itemId: row.item_id || null,
  location: row.location,
  supplier: row.supplier,
  purchaseCost: r2(Number(row.purchase_cost)),
  purchasedOn: row.purchased_on,
  warrantyUntil: row.warranty_until,
  condition: row.condition,
  status: row.status,
  assignedTo: row.assigned_to,
  department: row.department,
  assignedOn: row.assigned_on,
  notes: row.notes,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR"] as const;

const assetInput = async (db: Db, institutionId: string, body: any, existing?: any) => {
  const pick = (key: string, column: string, label: string, max: number, required = false) =>
    body?.[key] !== undefined || !existing ? text(body?.[key], label, max, required) : existing[column];
  let storeId = existing ? existing.store_id : null;
  if (body?.storeId !== undefined) storeId = body.storeId ? (await activeStore(db, institutionId, body.storeId)).id : null;
  let roomId = existing ? existing.room_id : null;
  let location = body?.location !== undefined || !existing ? text(body?.location, "Location", 200) : existing.location;
  if (body?.roomId !== undefined) {
    const room = body.roomId ? await roomOf(db, institutionId, body.roomId) : null;
    roomId = room?.id || null;
    // A room is a location; the location text follows it unless a new one was typed.
    const typed = text(body?.location, "Location", 200);
    if (room && (!typed || typed === existing?.location)) location = roomLabel(room);
  }
  const data = {
    name: pick("name", "name", "Asset name", 200, true),
    category: pick("category", "category", "Category", 100),
    brand: pick("brand", "brand", "Brand", 100),
    model: pick("model", "model", "Model", 100),
    serialNo: pick("serialNo", "serial_no", "Serial number", 100),
    storeId,
    roomId,
    location,
    supplier: pick("supplier", "supplier", "Supplier", 200),
    purchaseCost: body?.purchaseCost !== undefined && body?.purchaseCost !== null && body?.purchaseCost !== "" ? amount(body.purchaseCost, "Purchase cost") : existing ? Number(existing.purchase_cost) : 0,
    purchasedOn: body?.purchasedOn !== undefined ? date(body.purchasedOn, "Purchase date") : existing ? existing.purchased_on : null,
    warrantyUntil: body?.warrantyUntil !== undefined ? date(body.warrantyUntil, "Warranty end") : existing ? existing.warranty_until : null,
    condition: body?.condition !== undefined ? oneOf(body.condition, "Condition", CONDITIONS, "GOOD") : existing ? existing.condition : "GOOD",
    notes: pick("notes", "notes", "Notes", 1000),
  };
  if (data.purchasedOn && data.purchasedOn > todayBd()) fail(400, "The purchase date cannot be in the future.");
  if (data.purchasedOn && data.warrantyUntil && data.warrantyUntil < data.purchasedOn) fail(400, "The warranty cannot end before the purchase date.");
  return data;
};

export const assetEvent = (tx: PoolClient, actor: Actor, assetId: string, action: string, detail: string) =>
  tx.query("INSERT INTO inv_asset_events (id, institution_id, asset_id, action, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
    [newId(), actor.institutionId, assetId, action, detail.slice(0, 500), actor.email]);

// What can happen to an asset in each state.
const ASSET_ACTIONS: Record<string, { from: string[]; to: string }> = {
  ASSIGN: { from: ["AVAILABLE"], to: "ASSIGNED" },
  RETURN: { from: ["ASSIGNED"], to: "AVAILABLE" },
  REPAIR: { from: ["AVAILABLE", "ASSIGNED"], to: "UNDER_REPAIR" },
  REPAIRED: { from: ["UNDER_REPAIR"], to: "AVAILABLE" },
  LOST: { from: ["AVAILABLE", "ASSIGNED"], to: "LOST" },
  FOUND: { from: ["LOST"], to: "AVAILABLE" },
  DISPOSE: { from: ["AVAILABLE", "UNDER_REPAIR", "LOST"], to: "DISPOSED" },
  MOVE: { from: ["AVAILABLE", "ASSIGNED"], to: "" },
};

export const assetsService = {
  async list(institutionId: string, filters: { search?: string; status?: string; category?: string; storeId?: string; roomId?: string } = {}) {
    const status = filters.status || "";
    const { rows } = await postgresService.query(
      `${ASSET_SELECT} WHERE a.institution_id = $1
         AND ($2 = '' OR ($2 = 'IN_SERVICE' AND a.status NOT IN ('DISPOSED', 'LOST')) OR a.status = $2)
         AND ($3 = '' OR a.category = $3) AND ($4 = '' OR a.store_id = $4) AND ($6 = '' OR a.room_id = $6)
         AND ($5 = '' OR a.name ILIKE '%' || $5 || '%' OR a.asset_tag ILIKE '%' || $5 || '%' OR a.serial_no ILIKE '%' || $5 || '%'
              OR a.assigned_to ILIKE '%' || $5 || '%' OR a.department ILIKE '%' || $5 || '%' OR a.location ILIKE '%' || $5 || '%' OR a.brand ILIKE '%' || $5 || '%')
       ORDER BY a.asset_tag LIMIT 5000`,
      [institutionId, status, filters.category || "", filters.storeId || "", filters.search?.trim() || "", filters.roomId || ""]
    );
    return rows.map(assetFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${ASSET_SELECT} WHERE a.institution_id = $1 AND a.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Asset not found.");
    const events = await postgresService.query("SELECT * FROM inv_asset_events WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 100", [id]);
    return {
      ...assetFromRow(rows[0]),
      history: events.rows.map((row: any) => ({ id: row.id, action: row.action, detail: row.detail, by: row.created_by, at: toIso(row.created_at) })),
    };
  },

  // Registers one asset, or several identical ones (30 desks) with tags numbered in a row.
  async create(actor: Actor, body: any) {
    const count = body?.count === undefined || body?.count === null || body?.count === "" ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) fail(400, "Number of assets must be a whole number from 1 to 500.");
    const prefix = skuOf(body?.assetTag, "Asset tag", count > 1 ? 36 : 40);
    if (count > 1 && text(body?.serialNo, "Serial number", 100)) fail(400, "Each asset has its own serial number. Register them one at a time, or leave the serial empty.");
    const ids = await inTx(async (tx) => {
      const data = await assetInput(tx, actor.institutionId, body);
      const created: string[] = [];
      const base = prefix || `AST-${shortCode()}`;
      for (let index = 1; index <= count; index += 1) {
        const id = newId();
        const tag = count === 1 ? base : `${base}-${String(index).padStart(3, "0")}`;
        await tx.query(
          `INSERT INTO inv_assets (id, institution_id, asset_tag, name, category, brand, model, serial_no, store_id, location, supplier,
             purchase_cost, purchased_on, warranty_until, condition, notes, room_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [id, actor.institutionId, tag, data.name, data.category, data.brand, data.model, data.serialNo, data.storeId, data.location,
            data.supplier, data.purchaseCost, data.purchasedOn, data.warrantyUntil, data.condition, data.notes, data.roomId]
        );
        await assetEvent(tx, actor, id, "REGISTERED", `Registered${data.location ? ` at ${data.location}` : ""}.`);
        created.push(id);
      }
      await audit(tx, actor, "inventory.asset.create", "asset", created[0], `Registered ${count} × "${data.name}" (${count === 1 ? base : `${base}-001…`}).`);
      return created;
    });
    return count === 1 ? this.get(actor.institutionId, ids[0]) : { created: ids.length };
  },

  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const current = (await tx.query("SELECT * FROM inv_assets WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Asset not found.");
      if (current.status === "DISPOSED") fail(409, "A disposed asset cannot be edited.");
      const tag = body?.assetTag !== undefined ? skuOf(body.assetTag, "Asset tag") : current.asset_tag;
      if (!tag) fail(400, "Asset tag is required.");
      const data = await assetInput(tx, actor.institutionId, body, current);
      await tx.query(
        `UPDATE inv_assets SET asset_tag = $3, name = $4, category = $5, brand = $6, model = $7, serial_no = $8, store_id = $9, location = $10,
           supplier = $11, purchase_cost = $12, purchased_on = $13, warranty_until = $14, condition = $15, notes = $16, room_id = $17, updated_at = NOW()
         WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, tag, data.name, data.category, data.brand, data.model, data.serialNo, data.storeId, data.location,
          data.supplier, data.purchaseCost, data.purchasedOn, data.warrantyUntil, data.condition, data.notes, data.roomId]
      );
      await assetEvent(tx, actor, id, "EDITED", "Details edited.");
      await audit(tx, actor, "inventory.asset.update", "asset", id, `Edited asset ${tag}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async act(actor: Actor, id: string, body: any) {
    const action = oneOf(body?.action, "Action", Object.keys(ASSET_ACTIONS));
    await inTx(async (tx) => {
      const asset = (await tx.query("SELECT * FROM inv_assets WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!asset) fail(404, "Asset not found.");
      const rule = ASSET_ACTIONS[action];
      if (!rule.from.includes(asset.status)) fail(409, `An asset that is ${asset.status.toLowerCase().replace("_", " ")} cannot be ${action === "MOVE" ? "moved" : `marked ${action.toLowerCase()}`}.`);
      const note = text(body?.note, "Note", 500, ["LOST", "DISPOSE"].includes(action));
      const condition = body?.condition ? oneOf(body.condition, "Condition", CONDITIONS) : asset.condition;
      let detail = note;
      // An asset can be given to a hostel room instead of a person: the room then holds it.
      const room = body?.roomId ? await roomOf(tx, actor.institutionId, body.roomId) : null;
      if (action === "ASSIGN") {
        const assignedTo = room && !body?.assignedTo ? roomLabel(room) : text(body?.assignedTo, "Assigned to", 150, true);
        const department = text(body?.department, "Department", 100);
        const location = room ? roomLabel(room) : body?.location ? text(body.location, "Location", 200) : asset.location;
        await tx.query("UPDATE inv_assets SET status = 'ASSIGNED', assigned_to = $2, department = $3, location = $4, assigned_on = $5, room_id = $6, updated_at = NOW() WHERE id = $1",
          [id, assignedTo, department, location, todayBd(), room ? room.id : asset.room_id]);
        detail = `Assigned to ${assignedTo}${department ? ` (${department})` : ""}${location && location !== assignedTo ? ` at ${location}` : ""}. ${note}`;
      } else if (action === "MOVE") {
        const location = room ? roomLabel(room) : text(body?.location, "New location", 200, true);
        const storeId = body?.storeId ? (await activeStore(tx, actor.institutionId, body.storeId)).id : asset.store_id;
        // Leaving a room for a plain location takes the asset out of the room.
        const roomId = room ? room.id : null;
        const fromRoom = asset.room_id ? roomLabel((await tx.query("SELECT * FROM hostel_rooms WHERE id = $1", [asset.room_id])).rows[0] || {}) : "";
        // An asset held by its room is now held by the new room.
        const holder = fromRoom && asset.assigned_to === fromRoom ? (room ? roomLabel(room) : location) : asset.assigned_to;
        await tx.query("UPDATE inv_assets SET location = $2, store_id = $3, room_id = $4, assigned_to = $5, updated_at = NOW() WHERE id = $1", [id, location, storeId, roomId, holder]);
        detail = `Moved from ${asset.location || "—"} to ${location}. ${note}`;
      } else {
        const clearHolder = rule.to !== "ASSIGNED" && action !== "REPAIR";
        await tx.query(
          `UPDATE inv_assets SET status = $2, condition = $3, updated_at = NOW()${clearHolder ? ", assigned_to = '', department = '', assigned_on = NULL, room_id = NULL" : ""}${body?.location ? ", location = $4" : ""} WHERE id = $1`,
          body?.location ? [id, rule.to, condition, text(body.location, "Location", 200)] : [id, rule.to, condition]
        );
        if (action === "RETURN") detail = `Returned by ${asset.assigned_to}. ${note}`;
        else if (clearHolder && asset.assigned_to) detail = `${note} (was with ${asset.assigned_to})`;
      }
      await assetEvent(tx, actor, id, action, detail.trim() || action);
      await audit(tx, actor, `inventory.asset.${action.toLowerCase()}`, "asset", id, `${asset.asset_tag}: ${detail.trim() || action}`);
    });
    return this.get(actor.institutionId, id);
  },

  // Only a mistaken entry is deleted. An asset that was ever used is disposed of instead.
  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const asset = (await tx.query("SELECT * FROM inv_assets WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!asset) fail(404, "Asset not found.");
      const used = (await tx.query("SELECT 1 FROM inv_asset_events WHERE asset_id = $1 AND action NOT IN ('REGISTERED', 'EDITED') LIMIT 1", [id])).rows[0];
      if (used) fail(409, "This asset has a history. Dispose of it instead of deleting it.");
      await tx.query("DELETE FROM inv_assets WHERE id = $1", [id]);
      await audit(tx, actor, "inventory.asset.delete", "asset", id, `Deleted asset ${asset.asset_tag}.`);
      return { id };
    });
  },
};

// ---- Batches, expiry and settings ----------------------------------------------------

// The parts of inventory an organisation can switch on. Items, stores and the stock ledger are always on.
export const FEATURES = ["PURCHASING", "BATCHES", "TRANSFERS", "ASSETS", "REQUISITIONS", "KITCHEN", "ROOMS"] as const;
export const PROFILES: Record<string, string[]> = {
  SCHOOL: ["PURCHASING", "BATCHES", "TRANSFERS", "ASSETS", "REQUISITIONS"],
  HOSTEL: ["PURCHASING", "BATCHES", "ASSETS", "REQUISITIONS", "KITCHEN", "ROOMS"],
  OFFICE: ["PURCHASING", "TRANSFERS", "ASSETS", "REQUISITIONS"],
  CUSTOM: [],
};

const SETTINGS_DEFAULTS = {
  emailAlerts: false, alertEmails: "", expiryWarningDays: 30, lastAlertOn: null as string | null,
  profile: "SCHOOL", features: PROFILES.SCHOOL, isSetUp: false,
};

export const settingsOf = async (institutionId: string) => {
  const row = (await postgresService.query("SELECT * FROM inv_settings WHERE institution_id = $1", [institutionId])).rows[0];
  if (!row) return { ...SETTINGS_DEFAULTS };
  return {
    emailAlerts: row.email_alerts, alertEmails: row.alert_emails, expiryWarningDays: Number(row.expiry_warning_days), lastAlertOn: row.last_alert_on,
    profile: row.profile, features: (row.features || []).filter((key: string) => (FEATURES as readonly string[]).includes(key)), isSetUp: true,
  };
};

const batchFromRow = (row: any, today: string, warnDays: number) => {
  const daysLeft = row.expires_on ? Math.round((Date.parse(`${row.expires_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    sku: row.sku,
    unit: row.unit,
    storeId: row.store_id,
    storeName: row.store_name,
    storeCode: row.store_code,
    batchNo: row.batch_no,
    expiresOn: row.expires_on,
    quantity: Number(row.quantity),
    value: r2(Number(row.quantity) * Number(row.avg_cost)),
    daysLeft,
    state: daysLeft === null ? "NO_EXPIRY" : daysLeft < 0 ? "EXPIRED" : daysLeft <= warnDays ? "EXPIRING" : "OK",
    createdAt: toIso(row.created_at),
  };
};

export const batchesService = {
  // Batches with stock; state EXPIRED, EXPIRING (within the warning window) or empty for all.
  async list(institutionId: string, filters: { itemId?: string; storeId?: string; state?: string; withEmpty?: boolean } = {}) {
    const today = todayBd();
    const { expiryWarningDays } = await settingsOf(institutionId);
    const { rows } = await postgresService.query(
      `SELECT b.*, i.name AS item_name, i.sku, i.unit, i.avg_cost, s.name AS store_name, s.code AS store_code
       FROM inv_batches b JOIN inv_items i ON i.id = b.item_id JOIN inv_stores s ON s.id = b.store_id
       WHERE b.institution_id = $1 AND ($2 = '' OR b.item_id = $2) AND ($3 = '' OR b.store_id = $3) AND ($4 OR b.quantity > 0)
         AND ($5 = '' OR ($5 = 'EXPIRED' AND b.expires_on < $6::date)
              OR ($5 = 'EXPIRING' AND b.expires_on >= $6::date AND b.expires_on <= $6::date + $7::int))
       ORDER BY b.expires_on NULLS LAST, i.name, b.batch_no LIMIT 5000`,
      [institutionId, filters.itemId || "", filters.storeId || "", filters.withEmpty === true, filters.state || "", today, expiryWarningDays]
    );
    return rows.map((row: any) => batchFromRow(row, today, expiryWarningDays));
  },
};

// A reversed goods receipt puts its quantity back on the purchase order as still to come.
const unreceivePurchase = async (tx: PoolClient, purchaseOrderId: string, itemId: string, qty: number) => {
  const order = (await tx.query("SELECT * FROM inv_purchase_orders WHERE id = $1 FOR UPDATE", [purchaseOrderId])).rows[0];
  if (!order) return;
  await tx.query("UPDATE inv_po_lines SET received = GREATEST(received - $3, 0) WHERE po_id = $1 AND item_id = $2", [purchaseOrderId, itemId, qty]);
  if (order.status === "CLOSED") return;
  const totals = (await tx.query("SELECT SUM(received) AS got, SUM(quantity) AS ordered FROM inv_po_lines WHERE po_id = $1", [purchaseOrderId])).rows[0];
  const status = Number(totals.got) <= 0 ? "APPROVED" : Number(totals.got) >= Number(totals.ordered) ? "RECEIVED" : "PARTIAL";
  await tx.query("UPDATE inv_purchase_orders SET status = $2, updated_at = NOW() WHERE id = $1", [purchaseOrderId, status]);
};

// A reversed issue puts its quantity back on the requisition as still to issue. Once the
// requester has confirmed receipt the requisition is finished, so the goods come back with Take Back.
const unissueRequisition = async (tx: PoolClient, requisitionId: string, itemId: string, qty: number) => {
  const req = (await tx.query("SELECT * FROM inv_requisitions WHERE id = $1 FOR UPDATE", [requisitionId])).rows[0];
  if (!req) return;
  if (["RECEIVED", "CLOSED"].includes(req.status)) fail(409, `${req.req_no} is already ${req.status === "RECEIVED" ? "received" : "closed"}. Use Take Back to bring the stock back instead.`);
  await tx.query("UPDATE inv_requisition_lines SET issued = GREATEST(issued - $3, 0) WHERE requisition_id = $1 AND item_id = $2", [requisitionId, itemId, qty]);
  const totals = (await tx.query("SELECT SUM(issued) AS issued, SUM(approved) AS approved FROM inv_requisition_lines WHERE requisition_id = $1", [requisitionId])).rows[0];
  const status = Number(totals.issued) <= 0 ? "APPROVED" : Number(totals.issued) >= Number(totals.approved) ? "ISSUED" : "PARTIAL";
  await tx.query("UPDATE inv_requisitions SET status = $2, updated_at = NOW() WHERE id = $1", [requisitionId, status]);
};

// ---- Dashboard and alerts -----------------------------------------------------------

// A write-off or count change worth this much, or this share of what was in the store, is flagged.
const UNUSUAL_VALUE = 10_000;
const UNUSUAL_SHARE = 0.25;
// Wastage of a tenth or more of what a store used, and use at twice the usual weekly rate, are flagged.
const HIGH_WASTAGE_SHARE = 0.1;
const HIGH_USE_FACTOR = 2;

export const insightsService = {
  async summary(institutionId: string) {
    const today = todayBd();
    const totals = (await postgresService.query(
      `WITH stock AS (
         SELECT i.id, i.reorder_level, i.max_level, i.avg_cost, COALESCE(SUM(b.quantity), 0) AS qty
         FROM inv_items i LEFT JOIN inv_balances b ON b.item_id = i.id
         WHERE i.institution_id = $1 AND i.status = 'ACTIVE' GROUP BY i.id)
       SELECT COUNT(*) AS items, COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(qty * avg_cost), 0) AS value,
         COUNT(*) FILTER (WHERE qty <= 0) AS out_of_stock,
         COUNT(*) FILTER (WHERE qty > 0 AND reorder_level > 0 AND qty <= reorder_level) AS low_stock,
         COUNT(*) FILTER (WHERE max_level > 0 AND qty > max_level) AS over_stock,
         (SELECT COUNT(*) FROM inv_stores WHERE institution_id = $1 AND is_active) AS stores,
         (SELECT COUNT(*) FROM inv_transfers WHERE institution_id = $1 AND status = 'PENDING') AS pending_transfers,
         (SELECT COUNT(*) FROM inv_transfers WHERE institution_id = $1 AND status = 'IN_TRANSIT') AS in_transit,
         (SELECT COALESCE(SUM(quantity), 0) FROM inv_movements WHERE institution_id = $1 AND quantity > 0 AND kind IN ('OPENING', 'RECEIPT', 'RETURN')
            AND (created_at AT TIME ZONE 'Asia/Dhaka')::date = $2::date) AS today_in,
         (SELECT COALESCE(-SUM(quantity), 0) FROM inv_movements WHERE institution_id = $1 AND kind IN ('ISSUE', 'CONSUMPTION')
            AND (created_at AT TIME ZONE 'Asia/Dhaka')::date = $2::date) AS today_out,
         (SELECT COUNT(*) FROM inv_requisitions WHERE institution_id = $1 AND status = 'SUBMITTED') AS requisitions_waiting,
         (SELECT COUNT(*) FROM inv_requisitions WHERE institution_id = $1 AND status IN ('APPROVED', 'PARTIAL')) AS requisitions_to_issue,
         (SELECT COALESCE(-SUM(quantity * unit_cost), 0) FROM inv_movements WHERE institution_id = $1 AND kind = 'CONSUMPTION'
            AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka') AS month_consumed,
         (SELECT COALESCE(-SUM(quantity * unit_cost), 0) FROM inv_movements WHERE institution_id = $1 AND kind IN ('WASTAGE', 'DAMAGE', 'LOSS')
            AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka') AS month_wasted
       FROM stock`, [institutionId, today])).rows[0];

    const assets = (await postgresService.query(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(purchase_cost), 0) AS cost FROM inv_assets WHERE institution_id = $1 GROUP BY status`, [institutionId])).rows;

    // Six months of stock in (receipts) and stock out (issues), by value, in Bangladesh time.
    const monthly = (await postgresService.query(
      `SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM') AS month,
         COALESCE(SUM(quantity * unit_cost) FILTER (WHERE kind IN ('OPENING', 'RECEIPT')), 0) AS in_value,
         COALESCE(-SUM(quantity * unit_cost) FILTER (WHERE kind IN ('ISSUE', 'CONSUMPTION')), 0) AS out_value
       FROM inv_movements WHERE institution_id = $1
         AND created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') - INTERVAL '5 months') AT TIME ZONE 'Asia/Dhaka'
       GROUP BY 1 ORDER BY 1`, [institutionId])).rows;
    const months: { month: string; inValue: number; outValue: number }[] = [];
    const [year, month] = today.split("-").map(Number);
    for (let back = 5; back >= 0; back -= 1) {
      const d = new Date(Date.UTC(year, month - 1 - back, 1));
      const key = d.toISOString().slice(0, 7);
      const row = monthly.find((item: any) => item.month === key);
      months.push({ month: key, inValue: r2(Number(row?.in_value ?? 0)), outValue: r2(Number(row?.out_value ?? 0)) });
    }

    const topIssued = (await postgresService.query(
      `SELECT i.id, i.name, i.sku, i.unit, -SUM(m.quantity) AS qty, -SUM(m.quantity * m.unit_cost) AS value
       FROM inv_movements m JOIN inv_items i ON i.id = m.item_id
       WHERE m.institution_id = $1 AND m.kind IN ('ISSUE', 'CONSUMPTION') AND m.created_at >= NOW() - INTERVAL '90 days'
       GROUP BY i.id ORDER BY qty DESC LIMIT 5`, [institutionId])).rows;

    const recent = (await postgresService.query(`${MOVEMENT_SELECT} WHERE m.institution_id = $1 ORDER BY m.created_at DESC LIMIT 10`, [institutionId])).rows;

    const byStatus = Object.fromEntries(assets.map((row: any) => [row.status, Number(row.n)]));
    const purchases = (await postgresService.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'DRAFT') AS drafts, COUNT(*) FILTER (WHERE status IN ('APPROVED', 'PARTIAL')) AS open
       FROM inv_purchase_orders WHERE institution_id = $1`, [institutionId])).rows[0];
    return {
      expiredBatches: (await batchesService.list(institutionId, { state: "EXPIRED" })).length,
      expiringBatches: (await batchesService.list(institutionId, { state: "EXPIRING" })).length,
      openPurchaseOrders: Number(purchases.open),
      draftPurchaseOrders: Number(purchases.drafts),
      items: Number(totals.items),
      totalQuantity: r3(Number(totals.qty)),
      stockValue: r2(Number(totals.value)),
      lowStock: Number(totals.low_stock),
      outOfStock: Number(totals.out_of_stock),
      overStock: Number(totals.over_stock),
      stores: Number(totals.stores),
      pendingTransfers: Number(totals.pending_transfers),
      inTransit: Number(totals.in_transit),
      todayIn: r3(Number(totals.today_in)),
      todayOut: r3(Number(totals.today_out)),
      requisitionsWaiting: Number(totals.requisitions_waiting),
      requisitionsToIssue: Number(totals.requisitions_to_issue),
      monthConsumed: r2(Number(totals.month_consumed)),
      monthWasted: r2(Number(totals.month_wasted)),
      roomAssets: Number((await postgresService.query("SELECT COUNT(*) AS n FROM inv_assets WHERE institution_id = $1 AND room_id IS NOT NULL AND status NOT IN ('DISPOSED', 'LOST')", [institutionId])).rows[0].n),
      assets: {
        total: assets.filter((row: any) => row.status !== "DISPOSED").reduce((sum: number, row: any) => sum + Number(row.n), 0),
        value: r2(assets.filter((row: any) => row.status !== "DISPOSED").reduce((sum: number, row: any) => sum + Number(row.cost), 0)),
        available: byStatus.AVAILABLE || 0,
        assigned: byStatus.ASSIGNED || 0,
        underRepair: byStatus.UNDER_REPAIR || 0,
        lost: byStatus.LOST || 0,
        disposed: byStatus.DISPOSED || 0,
      },
      monthly: months,
      topIssued: topIssued.map((row: any) => ({ id: row.id, name: row.name, sku: row.sku, unit: row.unit, quantity: r3(Number(row.qty)), value: r2(Number(row.value)) })),
      recent: recent.map(movementFromRow),
    };
  },

  // Things that need someone's attention now, worst first.
  async alerts(institutionId: string) {
    const alerts: { level: "danger" | "warning" | "info"; type: string; title: string; detail: string; link: string }[] = [];
    const items = await itemsService.list(institutionId);
    for (const item of items) {
      if (item.stockStatus === "OUT" && (item.reorderLevel > 0 || item.lastMovementAt)) {
        alerts.push({ level: "danger", type: "OUT_OF_STOCK", title: `${item.name} is out of stock`, detail: `${item.sku} · reorder level ${item.reorderLevel} ${item.unit}`, link: "/admin/inventory/items" });
      } else if (item.stockStatus === "LOW") {
        const suggest = r3(Math.max(item.maxLevel > 0 ? item.maxLevel - item.onHand : item.reorderLevel * 2 - item.onHand, 0));
        alerts.push({ level: "warning", type: "LOW_STOCK", title: `${item.name} is low`, detail: `${item.onHand} ${item.unit} left, reorder at ${item.reorderLevel}. Suggested order: ${suggest} ${item.unit}.`, link: "/admin/inventory/items" });
      } else if (item.stockStatus === "OVER") {
        alerts.push({ level: "info", type: "OVERSTOCK", title: `${item.name} is overstocked`, detail: `${item.onHand} ${item.unit} on hand, maximum ${item.maxLevel}.`, link: "/admin/inventory/items" });
      }
    }

    const transfers = (await postgresService.query(
      `SELECT transfer_no, status, created_at, approved_at FROM inv_transfers WHERE institution_id = $1 AND status IN ('PENDING', 'IN_TRANSIT') ORDER BY created_at`, [institutionId])).rows;
    for (const row of transfers) {
      alerts.push({ level: "info", type: row.status === "PENDING" ? "PENDING_TRANSFER" : "IN_TRANSIT", title: `${row.transfer_no} ${row.status === "PENDING" ? "waits for approval" : "is in transit"}`,
        detail: `Since ${toIso(row.status === "PENDING" ? row.created_at : row.approved_at)?.slice(0, 10)}`, link: "/admin/inventory/transfers" });
    }

    const unusual = (await postgresService.query(
      `SELECT m.doc_no, m.kind, m.quantity, m.unit_cost, m.balance_after, m.created_by, i.name, i.unit FROM inv_movements m JOIN inv_items i ON i.id = m.item_id
       WHERE m.institution_id = $1 AND m.kind IN ('ADJUSTMENT', 'DAMAGE', 'LOSS') AND m.created_at >= NOW() - INTERVAL '7 days'
         AND (ABS(m.quantity * m.unit_cost) >= $2 OR ABS(m.quantity) >= $3 * GREATEST(m.balance_after - m.quantity, 0.001))
       ORDER BY m.created_at DESC LIMIT 20`, [institutionId, UNUSUAL_VALUE, UNUSUAL_SHARE])).rows;
    for (const row of unusual) {
      alerts.push({ level: "warning", type: "UNUSUAL_ADJUSTMENT", title: `Large ${row.kind.toLowerCase()} on ${row.name}`,
        detail: `${row.doc_no}: ${Number(row.quantity)} ${row.unit} (≈ ৳${r2(Math.abs(Number(row.quantity) * Number(row.unit_cost)))}) by ${row.created_by}`, link: "/admin/inventory/stock" });
    }

    const warranty = (await postgresService.query(
      `SELECT asset_tag, name, warranty_until FROM inv_assets WHERE institution_id = $1 AND status NOT IN ('DISPOSED', 'LOST')
         AND warranty_until IS NOT NULL AND warranty_until BETWEEN $2::date AND $2::date + 30 ORDER BY warranty_until`, [institutionId, todayBd()])).rows;
    for (const row of warranty) {
      alerts.push({ level: "info", type: "WARRANTY_ENDING", title: `Warranty of ${row.asset_tag} ends ${row.warranty_until}`, detail: row.name, link: "/admin/inventory/assets" });
    }
    for (const batch of await batchesService.list(institutionId, { state: "EXPIRED" })) {
      alerts.push({ level: "danger", type: "EXPIRED", title: `${batch.itemName} batch ${batch.batchNo} expired on ${batch.expiresOn}`,
        detail: `${batch.quantity} ${batch.unit} in ${batch.storeName}. It cannot be issued; write it off.`, link: "/admin/inventory/batches" });
    }
    for (const batch of await batchesService.list(institutionId, { state: "EXPIRING" })) {
      alerts.push({ level: "warning", type: "EXPIRING", title: `${batch.itemName} batch ${batch.batchNo} expires in ${batch.daysLeft} day${batch.daysLeft === 1 ? "" : "s"}`,
        detail: `${batch.quantity} ${batch.unit} in ${batch.storeName}, expires ${batch.expiresOn}. Issue it first.`, link: "/admin/inventory/batches" });
    }
    const late = (await postgresService.query(
      `SELECT o.po_no, o.expected_on, s.name FROM inv_purchase_orders o JOIN inv_suppliers s ON s.id = o.supplier_id
       WHERE o.institution_id = $1 AND o.status IN ('APPROVED', 'PARTIAL') AND o.expected_on < $2::date ORDER BY o.expected_on`, [institutionId, todayBd()])).rows;
    for (const row of late) {
      alerts.push({ level: "warning", type: "LATE_PURCHASE", title: `${row.po_no} from ${row.name} is late`, detail: `Expected on ${row.expected_on}.`, link: "/admin/inventory/purchases" });
    }
    const repair = Number((await postgresService.query("SELECT COUNT(*) AS n FROM inv_assets WHERE institution_id = $1 AND status = 'UNDER_REPAIR'", [institutionId])).rows[0].n);
    if (repair > 0) alerts.push({ level: "info", type: "UNDER_REPAIR", title: `${repair} asset${repair === 1 ? " is" : "s are"} under repair`, detail: "Mark them repaired when they are back.", link: "/admin/inventory/assets" });

    const requisitions = (await postgresService.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'SUBMITTED') AS waiting, COUNT(*) FILTER (WHERE status IN ('APPROVED', 'PARTIAL')) AS to_issue,
         MIN(created_at) FILTER (WHERE status = 'SUBMITTED') AS oldest
       FROM inv_requisitions WHERE institution_id = $1`, [institutionId])).rows[0];
    if (Number(requisitions.waiting) > 0) {
      alerts.push({ level: "warning", type: "PENDING_REQUISITION", title: `${requisitions.waiting} requisition${Number(requisitions.waiting) === 1 ? " waits" : "s wait"} for approval`,
        detail: `Oldest since ${toIso(requisitions.oldest)?.slice(0, 10)}.`, link: "/admin/inventory/requisitions" });
    }
    if (Number(requisitions.to_issue) > 0) {
      alerts.push({ level: "info", type: "REQUISITION_TO_ISSUE", title: `${requisitions.to_issue} approved requisition${Number(requisitions.to_issue) === 1 ? " is" : "s are"} waiting to be issued`,
        detail: "Issue the stock from the store.", link: "/admin/inventory/requisitions" });
    }

    // Wastage that is a large share of what a store used in the last 7 days.
    const wastage = (await postgresService.query(
      `SELECT s.name, -SUM(m.quantity * m.unit_cost) FILTER (WHERE m.kind = 'WASTAGE') AS wasted,
         -SUM(m.quantity * m.unit_cost) FILTER (WHERE m.kind IN ('CONSUMPTION', 'ISSUE')) AS used
       FROM inv_movements m JOIN inv_stores s ON s.id = m.store_id
       WHERE m.institution_id = $1 AND m.kind IN ('WASTAGE', 'CONSUMPTION', 'ISSUE') AND m.created_at >= NOW() - INTERVAL '7 days'
       GROUP BY s.id HAVING COALESCE(-SUM(m.quantity * m.unit_cost) FILTER (WHERE m.kind = 'WASTAGE'), 0) > 0`, [institutionId])).rows;
    for (const row of wastage) {
      const wasted = r2(Number(row.wasted || 0));
      const used = r2(Number(row.used || 0));
      const share = used + wasted > 0 ? wasted / (used + wasted) : 1;
      if (share >= HIGH_WASTAGE_SHARE) {
        alerts.push({ level: "warning", type: "HIGH_WASTAGE", title: `High wastage in ${row.name}`,
          detail: `৳${wasted} wasted against ৳${used} used in the last 7 days (${Math.round(share * 100)}%).`, link: "/admin/inventory/kitchen" });
      }
    }

    // An item used much faster this week than its usual weekly rate over the 8 weeks before.
    const spikes = (await postgresService.query(
      `SELECT i.name, i.unit,
         COALESCE(-SUM(m.quantity) FILTER (WHERE m.created_at >= NOW() - INTERVAL '7 days'), 0) AS week,
         COALESCE(-SUM(m.quantity) FILTER (WHERE m.created_at < NOW() - INTERVAL '7 days'), 0) / 8.0 AS usual
       FROM inv_movements m JOIN inv_items i ON i.id = m.item_id
       WHERE m.institution_id = $1 AND m.kind IN ('ISSUE', 'CONSUMPTION') AND m.created_at >= NOW() - INTERVAL '63 days'
       GROUP BY i.id`, [institutionId])).rows;
    for (const row of spikes) {
      const week = r3(Number(row.week));
      const usual = r3(Number(row.usual));
      if (usual > 0 && week >= usual * HIGH_USE_FACTOR) {
        alerts.push({ level: "info", type: "HIGH_CONSUMPTION", title: `${row.name} used ${Math.round(week / usual)}× faster than usual`,
          detail: `${week} ${row.unit} this week; usually about ${usual} ${row.unit} a week.`, link: "/admin/inventory/reports" });
      }
    }

    const order = { danger: 0, warning: 1, info: 2 };
    return alerts.sort((a, b) => order[a.level] - order[b.level]);
  },

  // Issued quantity per item over a window, for fast, slow and dead moving stock.
  async movement(institutionId: string, days: number) {
    const { rows } = await postgresService.query(
      `SELECT i.id, COALESCE(-SUM(m.quantity) FILTER (WHERE m.kind IN ('ISSUE', 'CONSUMPTION') AND m.created_at >= NOW() - make_interval(days => $2::int)), 0) AS issued,
         MAX(m.created_at) FILTER (WHERE m.kind IN ('ISSUE', 'CONSUMPTION')) AS last_issue
       FROM inv_items i LEFT JOIN inv_movements m ON m.item_id = i.id
       WHERE i.institution_id = $1 AND i.status = 'ACTIVE' GROUP BY i.id`, [institutionId, days]);
    return Object.fromEntries(rows.map((row: any) => [row.id, { issued: r3(Number(row.issued)), lastIssueAt: toIso(row.last_issue) }]));
  },
};
