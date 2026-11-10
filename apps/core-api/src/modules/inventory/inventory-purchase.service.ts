import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { date, email, fail, inTx, phone, text, todayBd } from "../academics/academics.common";
import {
  activeItem, activeStore, docNo, linesOf, listDocument, putIn, r2, r3, takeInAtCost,
} from "./inventory.service";

// Purchasing: an order is drafted, approved, then received in one or more goods received notes (GRNs).
// Stock only changes when goods are received, through the same ledger as every other movement.

// ---- Suppliers --------------------------------------------------------------------

const supplierFromRow = (row: any) => ({
  id: row.id,
  name: row.name,
  contactPerson: row.contact_person,
  phone: row.phone,
  email: row.email,
  address: row.address,
  isActive: row.is_active,
  openOrders: Number(row.open_orders ?? 0),
  totalOrdered: r2(Number(row.total_ordered ?? 0)),
  createdAt: toIso(row.created_at),
});

const SUPPLIER_SELECT = `SELECT s.*,
  (SELECT COUNT(*) FROM inv_purchase_orders o WHERE o.supplier_id = s.id AND o.status IN ('APPROVED', 'PARTIAL')) AS open_orders,
  (SELECT COALESCE(SUM(l.quantity * l.unit_cost), 0) FROM inv_purchase_orders o JOIN inv_po_lines l ON l.po_id = o.id
     WHERE o.supplier_id = s.id AND o.status NOT IN ('DRAFT', 'CANCELLED')) AS total_ordered
  FROM inv_suppliers s`;

const supplierInput = (body: any, existing?: any) => {
  const pick = (key: string, column: string, label: string, max: number, required = false) =>
    body?.[key] !== undefined || !existing ? text(body?.[key], label, max, required) : existing[column];
  return {
    name: pick("name", "name", "Supplier name", 200, true),
    contactPerson: pick("contactPerson", "contact_person", "Contact person", 150),
    phone: body?.phone !== undefined || !existing ? phone(body?.phone) || "" : existing.phone,
    email: body?.email !== undefined || !existing ? email(body?.email, "Supplier email") || "" : existing.email,
    address: pick("address", "address", "Address", 300),
    isActive: body?.isActive !== undefined ? body.isActive === true : existing ? existing.is_active : true,
  };
};

export const suppliersService = {
  async list(institutionId: string, filters: { search?: string } = {}) {
    const { rows } = await postgresService.query(
      `${SUPPLIER_SELECT} WHERE s.institution_id = $1 AND ($2 = '' OR s.name ILIKE '%' || $2 || '%' OR s.contact_person ILIKE '%' || $2 || '%' OR s.phone ILIKE '%' || $2 || '%')
       ORDER BY s.is_active DESC, s.name LIMIT 2000`, [institutionId, filters.search?.trim() || ""]);
    return rows.map(supplierFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${SUPPLIER_SELECT} WHERE s.institution_id = $1 AND s.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Supplier not found.");
    return supplierFromRow(rows[0]);
  },

  async create(actor: Actor, body: any) {
    const data = supplierInput(body);
    const id = newId();
    await inTx(async (tx) => {
      await tx.query(
        "INSERT INTO inv_suppliers (id, institution_id, name, contact_person, phone, email, address) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, actor.institutionId, data.name, data.contactPerson, data.phone, data.email, data.address]
      );
      await audit(tx, actor, "inventory.supplier.create", "supplier", id, `Added supplier ${data.name}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const current = (await tx.query("SELECT * FROM inv_suppliers WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Supplier not found.");
      const data = supplierInput(body, current);
      await tx.query(
        "UPDATE inv_suppliers SET name = $3, contact_person = $4, phone = $5, email = $6, address = $7, is_active = $8 WHERE institution_id = $1 AND id = $2",
        [actor.institutionId, id, data.name, data.contactPerson, data.phone, data.email, data.address, data.isActive]
      );
      await audit(tx, actor, "inventory.supplier.update", "supplier", id, `Edited supplier ${data.name}${data.isActive ? "" : " (inactive)"}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const current = (await tx.query("SELECT * FROM inv_suppliers WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Supplier not found.");
      if ((await tx.query("SELECT 1 FROM inv_purchase_orders WHERE supplier_id = $1 LIMIT 1", [id])).rows[0]) {
        fail(409, "This supplier has purchase orders. Mark it inactive instead of deleting it.");
      }
      await tx.query("DELETE FROM inv_suppliers WHERE id = $1", [id]);
      await audit(tx, actor, "inventory.supplier.delete", "supplier", id, `Deleted supplier ${current.name}.`);
      return { id };
    });
  },
};

// ---- Purchase orders -----------------------------------------------------------------

const ORDER_SELECT = `SELECT o.*, s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone,
  st.name AS store_name, st.code AS store_code,
  COALESCE((SELECT json_agg(json_build_object('itemId', l.item_id, 'name', i.name, 'sku', i.sku, 'unit', i.unit, 'trackBatches', i.track_batches,
      'quantity', l.quantity, 'unitCost', l.unit_cost, 'received', l.received) ORDER BY i.name)
    FROM inv_po_lines l JOIN inv_items i ON i.id = l.item_id WHERE l.po_id = o.id), '[]') AS lines
  FROM inv_purchase_orders o JOIN inv_suppliers s ON s.id = o.supplier_id JOIN inv_stores st ON st.id = o.store_id`;

const orderFromRow = (row: any) => {
  const lines = (row.lines || []).map((line: any) => {
    const qty = Number(line.quantity);
    const received = Number(line.received);
    return { ...line, quantity: qty, unitCost: Number(line.unitCost), received, remaining: r3(qty - received), value: r2(qty * Number(line.unitCost)) };
  });
  const ordered = lines.reduce((sum: number, line: any) => sum + line.quantity, 0);
  const received = lines.reduce((sum: number, line: any) => sum + line.received, 0);
  return {
    id: row.id,
    poNo: row.po_no,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierEmail: row.supplier_email,
    supplierPhone: row.supplier_phone,
    storeId: row.store_id,
    storeName: row.store_name,
    storeCode: row.store_code,
    status: row.status,
    orderedOn: row.ordered_on,
    expectedOn: row.expected_on,
    isLate: ["APPROVED", "PARTIAL"].includes(row.status) && Boolean(row.expected_on) && row.expected_on < todayBd(),
    note: row.note,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: toIso(row.approved_at),
    closedBy: row.closed_by,
    closedAt: toIso(row.closed_at),
    closeNote: row.close_note,
    createdAt: toIso(row.created_at),
    lines,
    total: r2(lines.reduce((sum: number, line: any) => sum + line.value, 0)),
    receivedShare: ordered > 0 ? Math.round((received / ordered) * 1000) / 1000 : 0,
  };
};

const lockOrder = async (tx: PoolClient, institutionId: string, id: string) => {
  const row = (await tx.query("SELECT * FROM inv_purchase_orders WHERE institution_id = $1 AND id = $2 FOR UPDATE", [institutionId, id])).rows[0];
  if (!row) fail(404, "Purchase order not found.");
  return row;
};

const activeSupplier = async (tx: PoolClient, institutionId: string, id: unknown) => {
  if (typeof id !== "string" || !id) fail(400, "Supplier is required.");
  const row = (await tx.query("SELECT * FROM inv_suppliers WHERE institution_id = $1 AND id = $2", [institutionId, id])).rows[0];
  if (!row) fail(404, "Supplier not found.");
  if (!row.is_active) fail(409, `${row.name} is inactive.`);
  return row;
};

// Header and lines of a draft. Each item appears once and has a price.
const orderInput = async (tx: PoolClient, actor: Actor, body: any) => {
  const supplier = await activeSupplier(tx, actor.institutionId, body?.supplierId);
  const store = await activeStore(tx, actor.institutionId, body?.storeId, "Delivery store");
  const orderedOn = date(body?.orderedOn, "Order date") || todayBd();
  const expectedOn = date(body?.expectedOn, "Expected delivery date");
  if (expectedOn && expectedOn < orderedOn) fail(400, "Delivery cannot be expected before the order date.");
  const lines = linesOf(body, true);
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) fail(400, "Each item can appear only once on an order.");
    seen.add(line.itemId);
    await activeItem(tx, actor.institutionId, line.itemId);
  }
  return { supplier, store, orderedOn, expectedOn, note: text(body?.note, "Note", 500), lines };
};

const writeLines = async (tx: PoolClient, orderId: string, lines: { itemId: string; quantity: number; unitCost: number | null }[]) => {
  await tx.query("DELETE FROM inv_po_lines WHERE po_id = $1", [orderId]);
  for (const line of lines) {
    await tx.query("INSERT INTO inv_po_lines (po_id, item_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)", [orderId, line.itemId, line.quantity, line.unitCost ?? 0]);
  }
};

export const purchaseOrdersService = {
  async list(institutionId: string, filters: { status?: string; supplierId?: string; search?: string } = {}) {
    const status = filters.status || "";
    const { rows } = await postgresService.query(
      `${ORDER_SELECT} WHERE o.institution_id = $1
         AND ($2 = '' OR ($2 = 'OPEN' AND o.status IN ('DRAFT', 'APPROVED', 'PARTIAL')) OR o.status = $2)
         AND ($3 = '' OR o.supplier_id = $3) AND ($4 = '' OR o.po_no ILIKE '%' || $4 || '%' OR s.name ILIKE '%' || $4 || '%')
       ORDER BY o.created_at DESC LIMIT 1000`,
      [institutionId, status, filters.supplierId || "", filters.search?.trim() || ""]
    );
    return rows.map(orderFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${ORDER_SELECT} WHERE o.institution_id = $1 AND o.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Purchase order not found.");
    const receipts = await postgresService.query(
      `SELECT m.doc_no, MIN(m.created_at) AS at, MIN(m.created_by) AS by, MIN(m.reference) AS reference, COUNT(*) AS line_count, SUM(m.quantity * m.unit_cost) AS value
       FROM inv_movements m WHERE m.purchase_order_id = $1 AND m.kind = 'RECEIPT' GROUP BY m.doc_no ORDER BY MIN(m.created_at)`, [id]);
    return {
      ...orderFromRow(rows[0]),
      receipts: receipts.rows.map((row: any) => ({ docNo: row.doc_no, at: toIso(row.at), by: row.by, reference: row.reference, lines: Number(row.line_count), value: r2(Number(row.value)) })),
    };
  },

  async create(actor: Actor, body: any) {
    const id = newId();
    const no = docNo("PO");
    await inTx(async (tx) => {
      const data = await orderInput(tx, actor, body);
      await tx.query(
        `INSERT INTO inv_purchase_orders (id, institution_id, po_no, supplier_id, store_id, ordered_on, expected_on, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, actor.institutionId, no, data.supplier.id, data.store.id, data.orderedOn, data.expectedOn, data.note, actor.email]
      );
      await writeLines(tx, id, data.lines);
      await audit(tx, actor, "inventory.po.create", "purchase_order", id, `Drafted ${no} to ${data.supplier.name} (${data.lines.length} item(s)).`);
    });
    return this.get(actor.institutionId, id);
  },

  // Only a draft is edited. Once approved, the order is what was sent to the supplier.
  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const order = await lockOrder(tx, actor.institutionId, id);
      if (order.status !== "DRAFT") fail(409, "Only a draft purchase order can be edited.");
      const data = await orderInput(tx, actor, body);
      await tx.query(
        "UPDATE inv_purchase_orders SET supplier_id = $2, store_id = $3, ordered_on = $4, expected_on = $5, note = $6, updated_at = NOW() WHERE id = $1",
        [id, data.supplier.id, data.store.id, data.orderedOn, data.expectedOn, data.note]
      );
      await writeLines(tx, id, data.lines);
      await audit(tx, actor, "inventory.po.update", "purchase_order", id, `Edited draft ${order.po_no}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async approve(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const order = await lockOrder(tx, actor.institutionId, id);
      if (order.status !== "DRAFT") fail(409, "Only a draft purchase order can be approved.");
      await activeSupplier(tx, actor.institutionId, order.supplier_id);
      const total = (await tx.query("SELECT COUNT(*) AS n, COALESCE(SUM(quantity * unit_cost), 0) AS value FROM inv_po_lines WHERE po_id = $1", [id])).rows[0];
      if (Number(total.n) === 0) fail(400, "This order has no items.");
      await tx.query("UPDATE inv_purchase_orders SET status = 'APPROVED', approved_by = $2, approved_at = NOW(), updated_at = NOW() WHERE id = $1", [id, actor.email]);
      await audit(tx, actor, "inventory.po.approve", "purchase_order", id, `Approved ${order.po_no} worth ${r2(Number(total.value))}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // Goods received against the order: partial deliveries are fine, more than ordered is not.
  async receive(actor: Actor, id: string, body: any) {
    const lines = linesOf(body);
    const reference = text(body?.reference, "Supplier invoice / challan number", 100);
    const note = text(body?.note, "Note", 500);
    const no = docNo("GRN");
    await inTx(async (tx) => {
      const order = await lockOrder(tx, actor.institutionId, id);
      if (!["APPROVED", "PARTIAL"].includes(order.status)) fail(409, "Goods can only be received against an approved, open purchase order.");
      const supplier = (await tx.query("SELECT name FROM inv_suppliers WHERE id = $1", [order.supplier_id])).rows[0];
      const store = await activeStore(tx, actor.institutionId, order.store_id, "Delivery store");
      const ordered = new Map<string, any>((await tx.query("SELECT * FROM inv_po_lines WHERE po_id = $1 FOR UPDATE", [id])).rows.map((row: any) => [row.item_id, row]));
      const taking = new Map<string, number>();
      for (const line of lines) {
        const row = ordered.get(line.itemId);
        if (!row) fail(400, "An item that is not on this order cannot be received against it.");
        taking.set(line.itemId, r3((taking.get(line.itemId) || 0) + line.quantity));
      }
      for (const [itemId, qty] of taking) {
        const row = ordered.get(itemId);
        const remaining = r3(Number(row.quantity) - Number(row.received));
        if (qty > remaining) {
          const item = (await tx.query("SELECT name, unit FROM inv_items WHERE id = $1", [itemId])).rows[0];
          fail(409, `Only ${remaining} ${item.unit} of "${item.name}" are still due on ${order.po_no}; ${qty} cannot be received.`);
        }
      }
      for (const line of lines) {
        const row = ordered.get(line.itemId);
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        // The order price applies unless the invoice says otherwise.
        const cost = line.unitCost ?? Number(row.unit_cost);
        await takeInAtCost(tx, item, line.quantity, cost);
        await putIn(tx, actor, item, store, line.quantity, { kind: "RECEIPT", unitCost: cost, docNo: no, party: supplier.name, reference: reference || order.po_no, note, purchaseOrderId: id }, line.batch);
        await tx.query("UPDATE inv_po_lines SET received = received + $3 WHERE po_id = $1 AND item_id = $2", [id, line.itemId, line.quantity]);
      }
      const totals = (await tx.query("SELECT SUM(received) AS got, SUM(quantity) AS ordered FROM inv_po_lines WHERE po_id = $1", [id])).rows[0];
      const status = Number(totals.got) >= Number(totals.ordered) ? "RECEIVED" : "PARTIAL";
      await tx.query("UPDATE inv_purchase_orders SET status = $2, updated_at = NOW() WHERE id = $1", [id, status]);
      await audit(tx, actor, "inventory.po.receive", "purchase_order", id, `${no}: received ${lines.length} line(s) against ${order.po_no}${status === "RECEIVED" ? " (complete)" : ""}.`);
    });
    return { order: await this.get(actor.institutionId, id), grn: await listDocument(actor.institutionId, no) };
  },

  // A partly delivered order whose rest will never come is closed short.
  async close(actor: Actor, id: string, body: any) {
    const reason = text(body?.note, "Reason", 500, true);
    await inTx(async (tx) => {
      const order = await lockOrder(tx, actor.institutionId, id);
      if (order.status !== "PARTIAL") fail(409, "Only a partly received order is closed. Cancel an order that has received nothing.");
      await tx.query("UPDATE inv_purchase_orders SET status = 'CLOSED', closed_by = $2, closed_at = NOW(), close_note = $3, updated_at = NOW() WHERE id = $1", [id, actor.email, reason]);
      await audit(tx, actor, "inventory.po.close", "purchase_order", id, `Closed ${order.po_no} short. ${reason}`);
    });
    return this.get(actor.institutionId, id);
  },

  async cancel(actor: Actor, id: string, body: any) {
    const reason = text(body?.note, "Reason", 500);
    await inTx(async (tx) => {
      const order = await lockOrder(tx, actor.institutionId, id);
      if (!["DRAFT", "APPROVED"].includes(order.status)) fail(409, "Only an order with nothing received can be cancelled.");
      const got = Number((await tx.query("SELECT COALESCE(SUM(received), 0) AS got FROM inv_po_lines WHERE po_id = $1", [id])).rows[0].got);
      if (got > 0) fail(409, "Goods were received against this order. Close it instead.");
      await tx.query("UPDATE inv_purchase_orders SET status = 'CANCELLED', closed_by = $2, closed_at = NOW(), close_note = $3, updated_at = NOW() WHERE id = $1", [id, actor.email, reason]);
      await audit(tx, actor, "inventory.po.cancel", "purchase_order", id, `Cancelled ${order.po_no}.${reason ? ` ${reason}` : ""}`);
    });
    return this.get(actor.institutionId, id);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const order = await lockOrder(tx, actor.institutionId, id);
      if (order.status !== "DRAFT") fail(409, "Only a draft can be deleted. Cancel an approved order instead.");
      await tx.query("DELETE FROM inv_purchase_orders WHERE id = $1", [id]);
      await audit(tx, actor, "inventory.po.delete", "purchase_order", id, `Deleted draft ${order.po_no}.`);
      return { id };
    });
  },
};

