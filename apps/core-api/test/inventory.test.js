// Needs PostgreSQL. Inventory: stores, items, the stock ledger, transfers, assets and permissions.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");

let server;
let baseUrl;
const clients = [];

test.before(async () => {
  await postgresService.initialize();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  if (postgresService.isLive()) await removeInstitutions(clients.map((client) => client.institution));
  await new Promise((resolve) => server.close(resolve));
  setTimeout(() => process.exit(), 200).unref();
});

const tenant = () => {
  const client = createClient(() => baseUrl);
  clients.push(client);
  return client;
};

const ok = (res, status = 201) => {
  assert.strictEqual(res.status, status, res.error);
  return res.data;
};

const setup = async (ctx) => {
  const central = ok(await ctx.call("POST", "/inventory/stores", { code: "cs", name: "Central Store" }));
  const lab = ok(await ctx.call("POST", "/inventory/stores", { code: "LAB", name: "Chemistry Lab Store" }));
  return { central, lab };
};

const onHand = async (ctx, itemId) => ok(await ctx.call("GET", `/inventory/items/${itemId}`), 200);

test("inventory: opening stock, receipts at weighted average cost, issues never go below zero", live(async () => {
  const ctx = tenant();
  const { central, lab } = await setup(ctx);
  assert.strictEqual(central.code, "CS");
  assert.strictEqual((await ctx.call("POST", "/inventory/stores", { code: "Cs", name: "Again" })).status, 409, "store codes are unique, any case");

  const paper = ok(await ctx.call("POST", "/inventory/items", {
    name: "A4 Paper", unit: "Ream", category: "Printing", reorderLevel: 20, maxLevel: 200, openingQuantity: 100, unitCost: 400, storeId: central.id,
  }));
  assert.ok(paper.sku.startsWith("ITM-"), "an SKU is made when none is given");
  assert.strictEqual(paper.barcode, paper.sku, "the barcode defaults to the SKU");
  assert.strictEqual(paper.onHand, 100);
  assert.strictEqual(paper.avgCost, 400);
  assert.strictEqual((await ctx.call("POST", "/inventory/items", { name: "Dup", sku: paper.sku.toLowerCase() })).status, 409, "SKUs are unique, any case");
  assert.strictEqual((await ctx.call("POST", "/inventory/items", { name: "Bad", reorderLevel: 50, maxLevel: 10 })).status, 400);
  assert.strictEqual((await ctx.call("POST", "/inventory/items", { name: "Bad", reorderLevel: -1 })).status, 400);

  // 100 at 400 + 50 at 460 = 150 at 420.
  const grn = ok(await ctx.call("POST", "/inventory/stock/receive", {
    storeId: central.id, supplier: "Paper World", reference: "INV-77", lines: [{ itemId: paper.id, quantity: 50, unitCost: 460 }],
  }));
  assert.ok(grn.docNo.startsWith("GRN-"));
  let item = await onHand(ctx, paper.id);
  assert.strictEqual(item.onHand, 150);
  assert.strictEqual(item.avgCost, 420);
  assert.strictEqual(item.stockValue, 63000);

  // Issues go out at the average cost and cannot take more than the store holds.
  ok(await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "CSE Department", lines: [{ itemId: paper.id, quantity: 30 }] }));
  const tooMuch = await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "EEE", lines: [{ itemId: paper.id, quantity: 121 }] });
  assert.strictEqual(tooMuch.status, 409, tooMuch.error);
  assert.match(tooMuch.error, /Only 120 Ream/);
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/issue", { storeId: lab.id, issuedTo: "EEE", lines: [{ itemId: paper.id, quantity: 1 }] })).status, 409, "nothing in the lab store");
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, lines: [{ itemId: paper.id, quantity: 1 }] })).status, 400, "who it was issued to is required");
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "X", lines: [{ itemId: paper.id, quantity: 0 }] })).status, 400);
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "X", lines: [{ itemId: paper.id, quantity: 1 }, { itemId: paper.id, quantity: 1 }] })).status, 400, "an item once per document");

  item = await onHand(ctx, paper.id);
  assert.strictEqual(item.onHand, 120);
  assert.strictEqual(item.avgCost, 420, "issues do not change the average cost");
  const issue = item.movements.find((m) => m.kind === "ISSUE");
  assert.strictEqual(issue.quantity, -30);
  assert.strictEqual(issue.unitCost, 420);
  assert.strictEqual(issue.balanceAfter, 120);

  // A multi-line document fails as a whole: the first line is not taken out on its own.
  const pens = ok(await ctx.call("POST", "/inventory/items", { name: "Blue Pen", openingQuantity: 10, unitCost: 10, storeId: central.id }));
  const mixed = await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "Exam Cell", lines: [{ itemId: paper.id, quantity: 5 }, { itemId: pens.id, quantity: 11 }] });
  assert.strictEqual(mixed.status, 409);
  assert.strictEqual((await onHand(ctx, paper.id)).onHand, 120);
  assert.strictEqual((await onHand(ctx, pens.id)).onHand, 10);

  // Returned stock comes back.
  ok(await ctx.call("POST", "/inventory/stock/return", { storeId: central.id, returnedBy: "CSE Department", lines: [{ itemId: paper.id, quantity: 5 }] }));
  assert.strictEqual((await onHand(ctx, paper.id)).onHand, 125);
}));

test("inventory: parallel issues of the last units cannot oversell", live(async () => {
  const ctx = tenant();
  const { central } = await setup(ctx);
  const chalk = ok(await ctx.call("POST", "/inventory/items", { name: "Chalk Box", openingQuantity: 5, unitCost: 50, storeId: central.id }));
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: `Room ${index}`, lines: [{ itemId: chalk.id, quantity: 1 }] })));
  assert.strictEqual(attempts.filter((res) => res.status === 201).length, 5, attempts.map((res) => res.error).join(" | "));
  assert.ok(attempts.filter((res) => res.status !== 201).every((res) => res.status === 409));
  const after = await onHand(ctx, chalk.id);
  assert.strictEqual(after.onHand, 0);
  assert.strictEqual(after.stockStatus, "OUT");
}));

test("inventory: counts, write-offs and reversals keep an append-only ledger", live(async () => {
  const ctx = tenant();
  const { central } = await setup(ctx);
  const acid = ok(await ctx.call("POST", "/inventory/items", { name: "Sulphuric Acid", unit: "Litre", openingQuantity: 20, unitCost: 300, storeId: central.id }));

  assert.strictEqual((await ctx.call("POST", "/inventory/stock/count", { storeId: central.id, itemId: acid.id, countedQuantity: 18 })).status, 400, "a reason is required");
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/count", { storeId: central.id, itemId: acid.id, countedQuantity: 20, reason: "Monthly count" })).status, 400, "nothing to adjust");
  ok(await ctx.call("POST", "/inventory/stock/count", { storeId: central.id, itemId: acid.id, countedQuantity: 18.5, reason: "Monthly count" }));
  assert.strictEqual((await onHand(ctx, acid.id)).onHand, 18.5);
  ok(await ctx.call("POST", "/inventory/stock/write-off", { storeId: central.id, itemId: acid.id, kind: "DAMAGE", quantity: 2.5, reason: "Bottle broke" }));
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/write-off", { storeId: central.id, itemId: acid.id, kind: "LOSS", quantity: 99, reason: "x" })).status, 409);

  // Receive 10 at 420, then reverse it: stock and average cost go back.
  const grn = ok(await ctx.call("POST", "/inventory/stock/receive", { storeId: central.id, lines: [{ itemId: acid.id, quantity: 10, unitCost: 420 }] }));
  let item = await onHand(ctx, acid.id);
  assert.strictEqual(item.onHand, 26);
  assert.ok(item.avgCost > 300);
  const receipt = grn.movements[0];
  assert.strictEqual((await ctx.call("POST", `/inventory/movements/${receipt.id}/reverse`, {})).status, 400, "a reason is required");
  const reversal = ok(await ctx.call("POST", `/inventory/movements/${receipt.id}/reverse`, { reason: "Wrong supplier invoice" }));
  assert.strictEqual(reversal.movements[0].kind, "REVERSAL");
  assert.strictEqual(reversal.movements[0].quantity, -10);
  item = await onHand(ctx, acid.id);
  assert.strictEqual(item.onHand, 16);
  assert.strictEqual(item.avgCost, 300);
  assert.strictEqual((await ctx.call("POST", `/inventory/movements/${receipt.id}/reverse`, { reason: "again" })).status, 409, "reversed only once");
  assert.strictEqual((await ctx.call("POST", `/inventory/movements/${reversal.movements[0].id}/reverse`, { reason: "again" })).status, 409, "a reversal is not reversed");

  const ledger = ok(await ctx.call("GET", `/inventory/movements?itemId=${acid.id}`), 200);
  assert.deepStrictEqual(ledger.map((m) => m.kind).sort(), ["ADJUSTMENT", "DAMAGE", "OPENING", "RECEIPT", "REVERSAL"]);
  assert.ok(ledger.find((m) => m.id === receipt.id).isReversed);
  const sum = Math.round(ledger.reduce((total, m) => total + m.quantity, 0) * 1000) / 1000;
  assert.strictEqual(sum, 16, "the ledger adds up to the balance");

  // History cannot be edited, even directly in the database.
  await assert.rejects(postgresService.query("UPDATE inv_movements SET quantity = 999 WHERE id = $1", [receipt.id]), /cannot be edited/);

  // Items with history are archived, not deleted; and only once their stock is gone.
  assert.strictEqual((await ctx.call("DELETE", `/inventory/items/${acid.id}`)).status, 409);
  assert.strictEqual((await ctx.call("POST", `/inventory/items/${acid.id}/archive`)).status, 409, "stock still on hand");
  ok(await ctx.call("POST", "/inventory/stock/write-off", { storeId: central.id, itemId: acid.id, kind: "LOSS", quantity: 16, reason: "Expired" }));
  assert.strictEqual(ok(await ctx.call("POST", `/inventory/items/${acid.id}/archive`), 200).status, "ARCHIVED");
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/receive", { storeId: central.id, lines: [{ itemId: acid.id, quantity: 1 }] })).status, 409, "archived items take no stock");
  const fresh = ok(await ctx.call("POST", "/inventory/items", { name: "Unused" }));
  ok(await ctx.call("DELETE", `/inventory/items/${fresh.id}`), 200);

  // An item entered by mistake with opening stock only is deleted with that stock, and then a
  // store that held nothing else can be deleted too.
  const branch = ok(await ctx.call("POST", "/inventory/stores", { code: "BR1", name: "Branch" }));
  const typo = ok(await ctx.call("POST", "/inventory/items", { name: "Laptop", unit: "Piece", openingQuantity: 2, unitCost: 450000, storeId: branch.id }));
  assert.strictEqual((await ctx.call("DELETE", `/inventory/stores/${branch.id}`)).status, 409, "the store holds the opening stock");
  ok(await ctx.call("DELETE", `/inventory/items/${typo.id}`), 200);
  const left = await postgresService.query("SELECT COUNT(*)::int AS n FROM inv_movements WHERE item_id = $1", [typo.id]);
  assert.strictEqual(left.rows[0].n, 0, "its opening stock is gone");
  ok(await ctx.call("DELETE", `/inventory/stores/${branch.id}`), 200);
}));

test("inventory: transfers are approved before stock leaves and received before it arrives", live(async () => {
  const ctx = tenant();
  const { central, lab } = await setup(ctx);
  const beaker = ok(await ctx.call("POST", "/inventory/items", { name: "Beaker 250ml", openingQuantity: 40, unitCost: 120, storeId: central.id }));
  assert.strictEqual((await ctx.call("POST", "/inventory/transfers", { fromStoreId: central.id, toStoreId: central.id, lines: [{ itemId: beaker.id, quantity: 1 }] })).status, 400);

  const transfer = ok(await ctx.call("POST", "/inventory/transfers", { fromStoreId: central.id, toStoreId: lab.id, note: "For practicals", lines: [{ itemId: beaker.id, quantity: 15 }] }));
  assert.strictEqual(transfer.status, "PENDING");
  assert.strictEqual((await onHand(ctx, beaker.id)).balances.find((b) => b.storeId === central.id).quantity, 40, "nothing moves while pending");
  assert.strictEqual((await ctx.call("POST", `/inventory/transfers/${transfer.id}/receive`)).status, 409, "must be approved first");

  // Stock issued meanwhile can make an approval fail; nothing is half moved.
  ok(await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "Physics", lines: [{ itemId: beaker.id, quantity: 30 }] }));
  assert.strictEqual((await ctx.call("POST", `/inventory/transfers/${transfer.id}/approve`)).status, 409);
  ok(await ctx.call("POST", "/inventory/stock/receive", { storeId: central.id, lines: [{ itemId: beaker.id, quantity: 20, unitCost: 120 }] }));

  const sent = ok(await ctx.call("POST", `/inventory/transfers/${transfer.id}/approve`), 200);
  assert.strictEqual(sent.status, "IN_TRANSIT");
  let item = await onHand(ctx, beaker.id);
  assert.strictEqual(item.balances.find((b) => b.storeId === central.id).quantity, 15);
  assert.strictEqual(item.onHand, 15, "stock in transit is not on hand anywhere");
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/summary"), 200).inTransit, 1);

  assert.strictEqual(ok(await ctx.call("POST", `/inventory/transfers/${transfer.id}/receive`), 200).status, "RECEIVED");
  item = await onHand(ctx, beaker.id);
  assert.strictEqual(item.balances.find((b) => b.storeId === lab.id).quantity, 15);
  assert.strictEqual(item.onHand, 30);
  assert.strictEqual((await ctx.call("POST", `/inventory/transfers/${transfer.id}/receive`)).status, 409, "received once");

  const second = ok(await ctx.call("POST", "/inventory/transfers", { fromStoreId: lab.id, toStoreId: central.id, lines: [{ itemId: beaker.id, quantity: 1 }] }));
  assert.strictEqual((await ctx.call("POST", `/inventory/transfers/${second.id}/reject`, {})).status, 400, "rejection needs a reason");
  assert.strictEqual(ok(await ctx.call("POST", `/inventory/transfers/${second.id}/reject`, { note: "Not needed" }), 200).status, "REJECTED");

  // A store with stock cannot be closed; an unused store can be deleted.
  assert.strictEqual((await ctx.call("PUT", `/inventory/stores/${lab.id}`, { isActive: false })).status, 409);
  assert.strictEqual((await ctx.call("DELETE", `/inventory/stores/${lab.id}`)).status, 409);
  const spare = ok(await ctx.call("POST", "/inventory/stores", { code: "SPARE", name: "Spare Room" }));
  ok(await ctx.call("DELETE", `/inventory/stores/${spare.id}`), 200);
}));

test("inventory: assets are registered in bulk, assigned, returned and disposed with a history", live(async () => {
  const ctx = tenant();
  const { central } = await setup(ctx);
  const desks = ok(await ctx.call("POST", "/inventory/assets", { name: "Student Desk", category: "Furniture", assetTag: "desk", count: 3, purchaseCost: 4500, storeId: central.id }));
  assert.strictEqual(desks.created, 3);
  const listed = ok(await ctx.call("GET", "/inventory/assets?search=DESK-00"), 200);
  assert.deepStrictEqual(listed.map((a) => a.assetTag), ["DESK-001", "DESK-002", "DESK-003"]);
  assert.strictEqual((await ctx.call("POST", "/inventory/assets", { name: "Desk", assetTag: "desk-001" })).status, 409, "tags are unique");
  assert.strictEqual((await ctx.call("POST", "/inventory/assets", { name: "PC", count: 2, serialNo: "S1" })).status, 400, "one serial cannot fit many assets");
  assert.strictEqual((await ctx.call("POST", "/inventory/assets", { name: "PC", purchasedOn: "2026-01-10", warrantyUntil: "2025-01-01" })).status, 400);

  const laptop = ok(await ctx.call("POST", "/inventory/assets", { name: "HP ProBook 450", category: "Computer", serialNo: "HP450-002", purchaseCost: 92000, purchasedOn: "2026-02-15" }));
  assert.strictEqual(laptop.status, "AVAILABLE");
  assert.strictEqual((await ctx.call("POST", `/inventory/assets/${laptop.id}/action`, { action: "RETURN" })).status, 409, "not assigned yet");
  assert.strictEqual((await ctx.call("POST", `/inventory/assets/${laptop.id}/action`, { action: "ASSIGN" })).status, 400, "assigned to whom");
  const assigned = ok(await ctx.call("POST", `/inventory/assets/${laptop.id}/action`, { action: "ASSIGN", assignedTo: "Rahim Ahmed", department: "CSE", location: "Room 202" }), 200);
  assert.strictEqual(assigned.status, "ASSIGNED");
  assert.strictEqual(assigned.assignedTo, "Rahim Ahmed");
  assert.strictEqual((await ctx.call("POST", `/inventory/assets/${laptop.id}/action`, { action: "DISPOSE", note: "old" })).status, 409, "assigned assets are returned first");
  const back = ok(await ctx.call("POST", `/inventory/assets/${laptop.id}/action`, { action: "RETURN", condition: "FAIR" }), 200);
  assert.strictEqual(back.status, "AVAILABLE");
  assert.strictEqual(back.assignedTo, "");
  assert.strictEqual(back.condition, "FAIR");
  assert.strictEqual((await ctx.call("DELETE", `/inventory/assets/${laptop.id}`)).status, 409, "an asset with a history is disposed, not deleted");
  const scanned = ok(await ctx.call("GET", "/inventory/lookup?code=hp450-002"), 200);
  assert.strictEqual(scanned.type, "ASSET");
  assert.strictEqual(scanned.asset.id, laptop.id);
  const gone = ok(await ctx.call("POST", `/inventory/assets/${laptop.id}/action`, { action: "DISPOSE", note: "Beyond repair" }), 200);
  assert.strictEqual(gone.status, "DISPOSED");
  assert.deepStrictEqual(gone.history.map((h) => h.action), ["DISPOSE", "RETURN", "ASSIGN", "REGISTERED"]);
  assert.strictEqual((await ctx.call("PUT", `/inventory/assets/${laptop.id}`, { name: "x" })).status, 409);

  const summary = ok(await ctx.call("GET", "/inventory/summary"), 200);
  assert.strictEqual(summary.assets.total, 3);
  assert.strictEqual(summary.assets.disposed, 1);
}));

test("inventory: dashboard, alerts and all-or-nothing import", live(async () => {
  const ctx = tenant();
  const { central } = await setup(ctx);
  const toner = ok(await ctx.call("POST", "/inventory/items", { name: "Toner", reorderLevel: 5, maxLevel: 20, openingQuantity: 8, unitCost: 2500, storeId: central.id }));
  ok(await ctx.call("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "Office", lines: [{ itemId: toner.id, quantity: 4 }] }));
  ok(await ctx.call("POST", "/inventory/stock/write-off", { storeId: central.id, itemId: toner.id, kind: "DAMAGE", quantity: 3, reason: "Leaked" }));

  const summary = ok(await ctx.call("GET", "/inventory/summary"), 200);
  assert.strictEqual(summary.items, 1);
  assert.strictEqual(summary.lowStock, 1);
  assert.strictEqual(summary.todayIn, 8);
  assert.strictEqual(summary.todayOut, 4);
  assert.strictEqual(summary.stockValue, 2500);
  assert.strictEqual(summary.monthly.length, 6);
  assert.strictEqual(summary.monthly[5].inValue, 20000);
  assert.strictEqual(summary.topIssued[0].id, toner.id);

  const alerts = ok(await ctx.call("GET", "/inventory/alerts"), 200);
  assert.ok(alerts.some((a) => a.type === "LOW_STOCK" && /Suggested order: 19/.test(a.detail)), JSON.stringify(alerts));
  assert.ok(alerts.some((a) => a.type === "UNUSUAL_ADJUSTMENT"), "3 of 4 written off is unusual");

  const bad = await ctx.call("POST", "/inventory/items/import", { items: [{ name: "Stapler", sku: "STP-1" }, { name: "", sku: "STP-2" }] });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.error, /Row 2/);
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/items?search=Stapler"), 200).length, 0, "nothing imported when a row is bad");
  const dup = await ctx.call("POST", "/inventory/items/import", { items: [{ name: "Stapler", sku: "STP-1" }, { name: "Stapler 2", sku: "stp-1" }] });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(ok(await ctx.call("POST", "/inventory/items/import", { items: [{ name: "Stapler", sku: "STP-1" }, { name: "Pins", sku: "STP-2", openingQuantity: 10, storeId: central.id }] })).imported, 2);
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/lookup?code=stp-2"), 200).item.onHand, 10);
}));

test("inventory: roles only do what they are allowed to", live(async () => {
  const ctx = tenant();
  const { central, lab } = await setup(ctx);
  const ink = ok(await ctx.call("POST", "/inventory/items", { name: "Ink", openingQuantity: 10, unitCost: 100, storeId: central.id }));
  const as = (role) => (method, path, body) => ctx.call(method, path, body, role);
  const keeper = as("STOREKEEPER");
  const teacher = as("TEACHER");

  assert.strictEqual((await teacher("GET", "/inventory/items")).status, 403);
  assert.strictEqual((await keeper("GET", "/inventory/items")).status, 200);
  assert.strictEqual((await keeper("POST", "/inventory/stock/receive", { storeId: central.id, lines: [{ itemId: ink.id, quantity: 5, unitCost: 100 }] })).status, 201);
  assert.strictEqual((await keeper("POST", "/inventory/stock/issue", { storeId: central.id, issuedTo: "Office", lines: [{ itemId: ink.id, quantity: 1 }] })).status, 201);
  assert.strictEqual((await keeper("POST", "/inventory/stock/count", { storeId: central.id, itemId: ink.id, countedQuantity: 1, reason: "x" })).status, 403, "counts need adjust rights");
  assert.strictEqual((await keeper("POST", "/inventory/items", { name: "New" })).status, 403);
  assert.strictEqual((await keeper("DELETE", `/inventory/stores/${lab.id}`)).status, 403);

  const transfer = await keeper("POST", "/inventory/transfers", { fromStoreId: central.id, toStoreId: lab.id, lines: [{ itemId: ink.id, quantity: 2 }] });
  assert.strictEqual(transfer.status, 201);
  assert.strictEqual((await keeper("POST", `/inventory/transfers/${transfer.data.id}/approve`)).status, 403, "the storekeeper cannot approve their own transfer");
  ok(await ctx.call("POST", `/inventory/transfers/${transfer.data.id}/approve`), 200);
  assert.strictEqual((await keeper("POST", `/inventory/transfers/${transfer.data.id}/receive`)).status, 200);

  const movement = ok(await ctx.call("GET", `/inventory/movements?itemId=${ink.id}&kind=ISSUE`), 200)[0];
  assert.strictEqual((await keeper("POST", `/inventory/movements/${movement.id}/reverse`, { reason: "x" })).status, 403);

  const pc = ok(await ctx.call("POST", "/inventory/assets", { name: "Desktop PC" }));
  assert.strictEqual((await keeper("POST", `/inventory/assets/${pc.id}/action`, { action: "ASSIGN", assignedTo: "Lab 1" })).status, 200);
  assert.strictEqual((await keeper("POST", `/inventory/assets/${pc.id}/action`, { action: "RETURN" })).status, 200);
  assert.strictEqual((await keeper("POST", `/inventory/assets/${pc.id}/action`, { action: "DISPOSE", note: "x" })).status, 403, "disposal needs approval rights");
}));
