import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { date, fail, inTx, text, todayBd } from "../academics/academics.common";
import { activeItem, activeStore, docNo, expenseCategoryOf, linesOf, listDocument, quantity, r3, takeOut } from "./inventory.service";

// Internal requisitions: a department, room, kitchen or person asks the store for stock.
//   SUBMITTED  -> an approver approves all, part or none of each line (REJECTED)
//   APPROVED   -> the store issues it, in one go (ISSUED) or in parts (PARTIAL)
//   ISSUED     -> the requester confirms it arrived (RECEIVED)
// A requisition with nothing issued yet can be CANCELLED; a part-issued one can be CLOSED short.
// Issuing posts ordinary ISSUE entries to the ledger, linked back to the requisition.

const REQ_SELECT = `SELECT r.*, s.name AS store_name, s.code AS store_code,
  COALESCE((SELECT json_agg(json_build_object('itemId', l.item_id, 'requested', l.requested, 'approved', l.approved, 'issued', l.issued,
      'name', i.name, 'sku', i.sku, 'unit', i.unit,
      'onHand', (SELECT COALESCE(SUM(b.quantity), 0) FROM inv_balances b WHERE b.item_id = i.id)) ORDER BY i.name)
    FROM inv_requisition_lines l JOIN inv_items i ON i.id = l.item_id WHERE l.requisition_id = r.id), '[]') AS lines
  FROM inv_requisitions r LEFT JOIN inv_stores s ON s.id = r.store_id`;

const fromRow = (row: any) => {
  const lines = (row.lines || []).map((line: any) => ({
    ...line,
    requested: Number(line.requested),
    approved: Number(line.approved),
    issued: Number(line.issued),
    onHand: Number(line.onHand),
    toIssue: r3(Number(line.approved) - Number(line.issued)),
  }));
  return {
    id: row.id,
    reqNo: row.req_no,
    destination: row.destination,
    purpose: row.purpose,
    expenseCategory: row.expense_category,
    neededBy: row.needed_by,
    status: row.status,
    storeId: row.store_id,
    storeName: row.store_name || "",
    requesterId: row.requester_id,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decidedAt: toIso(row.decided_at),
    decisionNote: row.decision_note,
    receivedBy: row.received_by,
    receivedAt: toIso(row.received_at),
    receiveNote: row.receive_note,
    createdAt: toIso(row.created_at),
    lines,
  };
};

const lockRequisition = async (tx: PoolClient, institutionId: string, id: string) => {
  const row = (await tx.query("SELECT * FROM inv_requisitions WHERE institution_id = $1 AND id = $2 FOR UPDATE", [institutionId, id])).rows[0];
  if (!row) fail(404, "Requisition not found.");
  return row;
};

const can = (actor: Actor, key: string) => actor.permissions.includes(key);
const isRequester = (actor: Actor, row: any) => Boolean(actor.userId) && row.requester_id === actor.userId;
// People who only raise requisitions see their own; the store and approvers see all of them.
const seesAll = (actor: Actor) => can(actor, "inventory.read");

const statusAfterIssue = async (tx: PoolClient, id: string) => {
  const totals = (await tx.query("SELECT SUM(issued) AS issued, SUM(approved) AS approved FROM inv_requisition_lines WHERE requisition_id = $1", [id])).rows[0];
  return Number(totals.issued) >= Number(totals.approved) ? "ISSUED" : Number(totals.issued) > 0 ? "PARTIAL" : "APPROVED";
};

export const requisitionsService = {
  async list(actor: Actor, filters: { status?: string; mine?: boolean; search?: string } = {}) {
    const status = filters.status || "";
    const ownOnly = filters.mine || !seesAll(actor);
    const { rows } = await postgresService.query(
      `${REQ_SELECT} WHERE r.institution_id = $1
         AND ($2 = '' OR ($2 = 'OPEN' AND r.status IN ('SUBMITTED', 'APPROVED', 'PARTIAL', 'ISSUED')) OR r.status = $2)
         AND (NOT $3 OR r.requester_id = $4)
         AND ($5 = '' OR r.req_no ILIKE '%' || $5 || '%' OR r.destination ILIKE '%' || $5 || '%' OR r.purpose ILIKE '%' || $5 || '%' OR r.requested_by ILIKE '%' || $5 || '%')
       ORDER BY r.created_at DESC LIMIT 1000`,
      [actor.institutionId, status, ownOnly, actor.userId, filters.search?.trim() || ""]);
    return rows.map((row: any) => ({ ...fromRow(row), isMine: isRequester(actor, row) }));
  },

  async get(actor: Actor, id: string) {
    const { rows } = await postgresService.query(`${REQ_SELECT} WHERE r.institution_id = $1 AND r.id = $2`, [actor.institutionId, id]);
    if (!rows[0] || (!seesAll(actor) && !isRequester(actor, rows[0]))) fail(404, "Requisition not found.");
    const issues = await postgresService.query(
      "SELECT DISTINCT doc_no, MIN(created_at) AS at FROM inv_movements WHERE requisition_id = $1 AND kind = 'ISSUE' GROUP BY doc_no ORDER BY at", [id]);
    return { ...fromRow(rows[0]), isMine: isRequester(actor, rows[0]), issueDocs: issues.rows.map((row: any) => row.doc_no) };
  },

  // What a requester can ask for: active items and whether the stores have them. No costs.
  async catalog(institutionId: string) {
    const { rows } = await postgresService.query(
      `SELECT i.id, i.sku, i.name, i.unit, i.category, (SELECT COALESCE(SUM(b.quantity), 0) FROM inv_balances b WHERE b.item_id = i.id) AS on_hand
       FROM inv_items i WHERE i.institution_id = $1 AND i.status = 'ACTIVE' ORDER BY i.name LIMIT 5000`, [institutionId]);
    return rows.map((row: any) => ({ id: row.id, sku: row.sku, barcode: "", name: row.name, unit: row.unit, category: row.category, onHand: Number(row.on_hand), status: "ACTIVE" }));
  },

  async create(actor: Actor, body: any) {
    const lines = linesOf(body);
    const destination = text(body?.destination, "Needed for (department, room or place)", 200, true);
    const purpose = text(body?.purpose, "Purpose", 500, true);
    const neededBy = date(body?.neededBy, "Needed by");
    if (neededBy && neededBy < todayBd()) fail(400, "The needed-by date cannot be in the past.");
    const id = newId();
    const no = docNo("REQ");
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO inv_requisitions (id, institution_id, req_no, destination, purpose, expense_category, needed_by, requester_id, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, actor.institutionId, no, destination, purpose, expenseCategoryOf(body?.expenseCategory), neededBy, actor.userId, actor.email]);
      for (const line of lines) {
        const item = await activeItem(tx, actor.institutionId, line.itemId);
        await tx.query("INSERT INTO inv_requisition_lines (requisition_id, item_id, requested) VALUES ($1, $2, $3)", [id, item.id, line.quantity]);
      }
      await audit(tx, actor, "inventory.requisition.create", "requisition", id, `Raised ${no}: ${lines.length} item(s) for ${destination}.`);
    });
    return this.get(actor, id);
  },

  // The approver may cut any line down, or to nothing; at least one line must stay.
  async approve(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const req = await lockRequisition(tx, actor.institutionId, id);
      if (req.status !== "SUBMITTED") fail(409, "Only a submitted requisition can be approved.");
      const lines = (await tx.query("SELECT * FROM inv_requisition_lines WHERE requisition_id = $1 ORDER BY item_id", [id])).rows;
      const given = Array.isArray(body?.lines) ? body.lines : null;
      let kept = 0;
      for (const line of lines) {
        const choice = given?.find((entry: any) => entry?.itemId === line.item_id);
        const approved = choice ? quantity(choice.approved, "Approved quantity", true) : Number(line.requested);
        if (approved > Number(line.requested)) fail(400, "An approved quantity cannot be more than was asked for.");
        if (approved > 0) kept += 1;
        await tx.query("UPDATE inv_requisition_lines SET approved = $3 WHERE requisition_id = $1 AND item_id = $2", [id, line.item_id, approved]);
      }
      if (kept === 0) fail(400, "Nothing is approved. Reject the requisition instead.");
      const note = text(body?.note, "Note", 500);
      await tx.query("UPDATE inv_requisitions SET status = 'APPROVED', decided_by = $2, decided_at = NOW(), decision_note = $3, updated_at = NOW() WHERE id = $1",
        [id, actor.email, note]);
      await audit(tx, actor, "inventory.requisition.approve", "requisition", id, `Approved ${req.req_no}.${note ? ` ${note}` : ""}`);
    });
    return this.get(actor, id);
  },

  async reject(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const req = await lockRequisition(tx, actor.institutionId, id);
      if (req.status !== "SUBMITTED") fail(409, "Only a submitted requisition can be rejected.");
      const note = text(body?.note, "Reason", 500, true);
      await tx.query("UPDATE inv_requisitions SET status = 'REJECTED', decided_by = $2, decided_at = NOW(), decision_note = $3, updated_at = NOW() WHERE id = $1", [id, actor.email, note]);
      await audit(tx, actor, "inventory.requisition.reject", "requisition", id, `Rejected ${req.req_no}. ${note}`);
    });
    return this.get(actor, id);
  },

  // The requester (or an approver) withdraws a requisition before anything was issued.
  async cancel(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const req = await lockRequisition(tx, actor.institutionId, id);
      if (!isRequester(actor, req) && !can(actor, "inventory.approve")) fail(403, "Only the person who raised this requisition, or an approver, can cancel it.");
      if (!["SUBMITTED", "APPROVED"].includes(req.status)) fail(409, "Only a requisition with nothing issued yet can be cancelled.");
      const note = text(body?.note, "Reason", 500);
      await tx.query("UPDATE inv_requisitions SET status = 'CANCELLED', decision_note = CASE WHEN $2 = '' THEN decision_note ELSE $2 END, updated_at = NOW() WHERE id = $1", [id, note]);
      await audit(tx, actor, "inventory.requisition.cancel", "requisition", id, `Cancelled ${req.req_no}.${note ? ` ${note}` : ""}`);
    });
    return this.get(actor, id);
  },

  // The store issues what was approved, all of it or part. Lines left out are not issued now.
  async issue(actor: Actor, id: string, body: any) {
    const note = text(body?.note, "Note", 500);
    const no = docNo("ISS");
    await inTx(async (tx) => {
      const req = await lockRequisition(tx, actor.institutionId, id);
      if (!["APPROVED", "PARTIAL"].includes(req.status)) fail(409, "Only an approved requisition can be issued.");
      const store = await activeStore(tx, actor.institutionId, body?.storeId, "Store to issue from");
      const lines = (await tx.query("SELECT * FROM inv_requisition_lines WHERE requisition_id = $1 ORDER BY item_id", [id])).rows;
      const given = Array.isArray(body?.lines) ? body.lines : null;
      let issuedAny = false;
      for (const line of lines) {
        const left = r3(Number(line.approved) - Number(line.issued));
        const choice = given ? given.find((entry: any) => entry?.itemId === line.item_id) : null;
        const qty = given ? (choice ? quantity(choice.quantity, "Quantity to issue", true) : 0) : left;
        if (qty === 0) continue;
        const item = await activeItem(tx, actor.institutionId, line.item_id);
        if (qty > left) fail(400, `Only ${left} ${item.unit} of "${item.name}" are still to issue on ${req.req_no}.`);
        await takeOut(tx, actor, item, store, qty, {
          kind: "ISSUE", docNo: no, party: req.destination, reference: req.req_no, note: note || req.purpose,
          expenseCategory: req.expense_category, requisitionId: id,
        }, { usableOnly: true });
        await tx.query("UPDATE inv_requisition_lines SET issued = issued + $3 WHERE requisition_id = $1 AND item_id = $2", [id, line.item_id, qty]);
        issuedAny = true;
      }
      if (!issuedAny) fail(400, "Nothing to issue. Enter a quantity for at least one item.");
      const status = await statusAfterIssue(tx, id);
      await tx.query("UPDATE inv_requisitions SET status = $2, store_id = $3, updated_at = NOW() WHERE id = $1", [id, status, store.id]);
      await audit(tx, actor, "inventory.requisition.issue", "requisition", id, `Issued ${no} from ${store.name} against ${req.req_no}.`);
    });
    return { requisition: await this.get(actor, id), document: await listDocument(actor.institutionId, no) };
  },

  // The requester (or the store, on their behalf) confirms the goods arrived. Anything not
  // issued by then is no longer expected.
  async confirm(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const req = await lockRequisition(tx, actor.institutionId, id);
      if (!isRequester(actor, req) && !can(actor, "inventory.manage_stock")) fail(403, "Only the person who raised this requisition, or the store, can confirm receipt.");
      if (!["ISSUED", "PARTIAL"].includes(req.status)) fail(409, "Only an issued requisition can be confirmed as received.");
      const note = text(body?.note, "Note", 500);
      await tx.query("UPDATE inv_requisitions SET status = 'RECEIVED', received_by = $2, received_at = NOW(), receive_note = $3, updated_at = NOW() WHERE id = $1",
        [id, actor.email, note]);
      await audit(tx, actor, "inventory.requisition.receive", "requisition", id, `Confirmed receipt of ${req.req_no}.${note ? ` ${note}` : ""}`);
    });
    return this.get(actor, id);
  },

  // An approver ends a part-issued requisition: the rest will not be issued.
  async close(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const req = await lockRequisition(tx, actor.institutionId, id);
      if (req.status !== "PARTIAL") fail(409, "Only a part-issued requisition can be closed short.");
      const note = text(body?.note, "Reason", 500, true);
      await tx.query("UPDATE inv_requisitions SET status = 'CLOSED', decision_note = $2, updated_at = NOW() WHERE id = $1", [id, note]);
      await audit(tx, actor, "inventory.requisition.close", "requisition", id, `Closed ${req.req_no} short. ${note}`);
    });
    return this.get(actor, id);
  },
};
