// Needs PostgreSQL. Inventory for any organisation: setup, requisitions, kitchen use and wastage,
// room assets taken from stock, spending by purpose and reorder suggestions.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
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

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

test("inventory setup: an organisation picks the parts it uses", live(async () => {
  const ctx = tenant();
  const before = ok(await ctx.call("GET", "/inventory/settings"), 200);
  assert.strictEqual(before.profile, "SCHOOL");
  assert.strictEqual(before.isSetUp, false);
  assert.ok(!before.features.includes("KITCHEN"));

  const hostel = ok(await ctx.call("PUT", "/inventory/setup", { profile: "HOSTEL" }), 200);
  assert.deepStrictEqual(hostel.features, ["PURCHASING", "BATCHES", "ASSETS", "REQUISITIONS", "KITCHEN", "ROOMS"], "a profile brings its usual parts");
  const custom = ok(await ctx.call("PUT", "/inventory/setup", { profile: "CUSTOM", features: ["ROOMS", "KITCHEN"] }), 200);
  assert.deepStrictEqual(custom.features, ["KITCHEN", "ROOMS"]);
  assert.strictEqual((await ctx.call("PUT", "/inventory/setup", { profile: "CUSTOM", features: ["SALES"] })).status, 400);
  assert.strictEqual((await ctx.call("PUT", "/inventory/setup", { profile: "SPACESHIP" })).status, 400);
  // Alert settings saved later keep the setup.
  ok(await ctx.call("PUT", "/inventory/settings", { expiryWarningDays: 10 }), 200);
  assert.deepStrictEqual(ok(await ctx.call("GET", "/inventory/settings"), 200).features, ["KITCHEN", "ROOMS"]);
}));

test("requisitions: raised by staff, approved in part, issued in parts, confirmed", live(async () => {
  const ctx = tenant();
  const as = (role) => (method, path, body) => ctx.call(method, path, body, role);
  const teacher = as("TEACHER");
  const staff = as("STAFF");
  const keeper = as("STOREKEEPER");
  const store = ok(await ctx.call("POST", "/inventory/stores", { code: "CS", name: "Central Store" }));
  const paper = ok(await ctx.call("POST", "/inventory/items", { name: "A4 Paper", unit: "Ream", openingQuantity: 10, unitCost: 400, storeId: store.id }));
  const marker = ok(await ctx.call("POST", "/inventory/items", { name: "Marker", unit: "Piece", openingQuantity: 50, unitCost: 30, storeId: store.id }));

  // A teacher asks, but sees no costs and no other stock screens.
  assert.strictEqual((await teacher("GET", "/inventory/items")).status, 403);
  const catalog = ok(await teacher("GET", "/inventory/requisitions/catalog"), 200);
  assert.strictEqual(catalog.length, 2);
  assert.strictEqual(catalog[0].avgCost, undefined, "the catalog shows no costs");
  assert.strictEqual((await teacher("POST", "/inventory/requisitions", { destination: "Class 7", lines: [{ itemId: paper.id, quantity: 1 }] })).status, 400, "a purpose is required");
  const req = ok(await teacher("POST", "/inventory/requisitions", {
    destination: "CSE Department", purpose: "Mid-term question papers", expenseCategory: "Office supplies",
    lines: [{ itemId: paper.id, quantity: 8 }, { itemId: marker.id, quantity: 10 }],
  }));
  assert.ok(req.reqNo.startsWith("REQ-"));
  assert.strictEqual(req.status, "SUBMITTED");
  const other = ok(await staff("POST", "/inventory/requisitions", { destination: "Office", purpose: "Notices", lines: [{ itemId: paper.id, quantity: 1 }] }));

  // Requesters only see their own; the store sees all.
  assert.deepStrictEqual(ok(await teacher("GET", "/inventory/requisitions"), 200).map((r) => r.id), [req.id]);
  assert.strictEqual((await teacher("GET", `/inventory/requisitions/${other.id}`)).status, 404);
  assert.strictEqual((await staff("POST", `/inventory/requisitions/${req.id}/cancel`)).status, 403, "only the requester or an approver cancels");
  assert.strictEqual(ok(await keeper("GET", "/inventory/requisitions"), 200).length, 2);

  // Only an approver decides; nothing approved means reject instead.
  assert.strictEqual((await teacher("POST", `/inventory/requisitions/${req.id}/approve`)).status, 403);
  assert.strictEqual((await keeper("POST", `/inventory/requisitions/${req.id}/approve`)).status, 403);
  assert.strictEqual((await ctx.call("POST", `/inventory/requisitions/${req.id}/approve`, { lines: [{ itemId: paper.id, approved: 0 }, { itemId: marker.id, approved: 0 }] })).status, 400);
  assert.strictEqual((await ctx.call("POST", `/inventory/requisitions/${req.id}/approve`, { lines: [{ itemId: paper.id, approved: 9 }] })).status, 400, "no more than asked for");
  const approved = ok(await ctx.call("POST", `/inventory/requisitions/${req.id}/approve`, { lines: [{ itemId: paper.id, approved: 6 }], note: "Six is enough" }), 200);
  assert.strictEqual(approved.status, "APPROVED");
  assert.deepStrictEqual(approved.lines.map((l) => [l.name, l.approved]), [["A4 Paper", 6], ["Marker", 10]], "a line left out is approved in full");
  ok(await ctx.call("POST", `/inventory/requisitions/${other.id}/reject`, { note: "Use the notice board" }), 200);

  // The store issues in parts; never more than approved, never more than on hand.
  assert.strictEqual((await teacher("POST", `/inventory/requisitions/${req.id}/issue`, { storeId: store.id })).status, 403);
  assert.strictEqual((await keeper("POST", `/inventory/requisitions/${req.id}/issue`, { storeId: store.id, lines: [{ itemId: paper.id, quantity: 7 }] })).status, 400);
  const first = ok(await keeper("POST", `/inventory/requisitions/${req.id}/issue`, { storeId: store.id, lines: [{ itemId: paper.id, quantity: 4 }] }));
  assert.strictEqual(first.requisition.status, "PARTIAL");
  assert.strictEqual(first.document.movements[0].reference, req.reqNo);
  assert.strictEqual(first.document.movements[0].party, "CSE Department");
  assert.strictEqual(first.document.movements[0].expenseCategory, "Office supplies");
  assert.strictEqual((await ctx.call("GET", `/inventory/items/${paper.id}`)).data.onHand, 6);

  // Reversing that issue puts it back on the requisition.
  const issued = first.document.movements[0];
  ok(await ctx.call("POST", `/inventory/movements/${issued.id}/reverse`, { reason: "Wrong store" }));
  let current = ok(await teacher("GET", `/inventory/requisitions/${req.id}`), 200);
  assert.strictEqual(current.status, "APPROVED");
  assert.strictEqual(current.lines.find((l) => l.itemId === paper.id).issued, 0);

  const all = ok(await keeper("POST", `/inventory/requisitions/${req.id}/issue`, { storeId: store.id }));
  assert.strictEqual(all.requisition.status, "ISSUED");
  assert.strictEqual(all.document.movements.length, 2);
  assert.strictEqual((await teacher("POST", `/inventory/requisitions/${req.id}/cancel`)).status, 409, "issued stock cannot be cancelled");
  const received = ok(await teacher("POST", `/inventory/requisitions/${req.id}/receive`, { note: "All here" }), 200);
  assert.strictEqual(received.status, "RECEIVED");
  assert.strictEqual(received.issueDocs.length, 2);

  // Once received, a reversal is refused: the goods come back with Take Back.
  const later = all.document.movements.find((m) => m.itemId === paper.id);
  assert.strictEqual((await ctx.call("POST", `/inventory/movements/${later.id}/reverse`, { reason: "x" })).status, 409);

  // A part-issued requisition can be closed short.
  const third = ok(await teacher("POST", "/inventory/requisitions", { destination: "Lab", purpose: "Labels", lines: [{ itemId: marker.id, quantity: 20 }] }));
  ok(await ctx.call("POST", `/inventory/requisitions/${third.id}/approve`), 200);
  ok(await keeper("POST", `/inventory/requisitions/${third.id}/issue`, { storeId: store.id, lines: [{ itemId: marker.id, quantity: 5 }] }));
  assert.strictEqual(ok(await ctx.call("POST", `/inventory/requisitions/${third.id}/close`, { note: "Rest not needed" }), 200).status, "CLOSED");

  const alerts = ok(await ctx.call("GET", "/inventory/alerts"), 200);
  assert.ok(!alerts.some((a) => a.type === "PENDING_REQUISITION"), "nothing waits for approval now");
  ok(await staff("POST", "/inventory/requisitions", { destination: "Office", purpose: "Printing", lines: [{ itemId: paper.id, quantity: 1 }] }));
  assert.ok(ok(await ctx.call("GET", "/inventory/alerts"), 200).some((a) => a.type === "PENDING_REQUISITION"));
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/summary"), 200).requisitionsWaiting, 1);
}));

test("kitchen: consumption and wastage, the day sheet, meals served and cost per meal", live(async () => {
  const ctx = tenant();
  const keeper = (method, path, body) => ctx.call(method, path, body, "STOREKEEPER");
  const kitchen = ok(await ctx.call("POST", "/inventory/stores", { code: "KIT", name: "Main Kitchen", kind: "KITCHEN" }));
  assert.strictEqual(kitchen.kind, "KITCHEN");
  assert.strictEqual((await ctx.call("POST", "/inventory/stores", { code: "X", name: "X", kind: "GARAGE" })).status, 400);
  const rice = ok(await ctx.call("POST", "/inventory/items", { name: "Rice", unit: "KG", openingQuantity: 100, unitCost: 60, storeId: kitchen.id }));
  const dal = ok(await ctx.call("POST", "/inventory/items", { name: "Dal", unit: "KG", openingQuantity: 20, unitCost: 120, storeId: kitchen.id }));

  // Opening 100 (today's opening stock counts as received today), +20 bought, 15 used, 2 wasted.
  ok(await ctx.call("POST", "/inventory/stock/receive", { storeId: kitchen.id, supplier: "Karwan Bazar", lines: [{ itemId: rice.id, quantity: 20, unitCost: 60 }] }));
  const lunch = ok(await keeper("POST", "/inventory/consumption", { storeId: kitchen.id, meal: "Lunch", lines: [{ itemId: rice.id, quantity: 10 }, { itemId: dal.id, quantity: 2 }] }));
  assert.ok(lunch.docNo.startsWith("CON-"));
  assert.strictEqual(lunch.movements[0].kind, "CONSUMPTION");
  assert.strictEqual(lunch.movements[0].expenseCategory, "Kitchen & food", "kitchen use is a food cost by default");
  ok(await keeper("POST", "/inventory/consumption", { storeId: kitchen.id, meal: "Dinner", lines: [{ itemId: rice.id, quantity: 5 }] }));
  assert.strictEqual((await keeper("POST", "/inventory/consumption", { storeId: kitchen.id, meal: "Midnight", lines: [{ itemId: rice.id, quantity: 1 }] })).status, 400);
  assert.strictEqual((await keeper("POST", "/inventory/wastage", { storeId: kitchen.id, lines: [{ itemId: rice.id, quantity: 2 }] })).status, 400, "wastage needs a reason");
  ok(await keeper("POST", "/inventory/wastage", { storeId: kitchen.id, reason: "Burnt", lines: [{ itemId: rice.id, quantity: 2 }] }));
  assert.strictEqual((await ctx.call("POST", "/inventory/consumption", { storeId: kitchen.id, lines: [{ itemId: dal.id, quantity: 19 }] })).status, 409, "never below zero");
  assert.strictEqual((await ctx.call("POST", "/inventory/consumption", { storeId: kitchen.id, lines: [{ itemId: rice.id, quantity: 1 }] }, "TEACHER")).status, 403);

  let sheet = ok(await ctx.call("GET", `/inventory/kitchen/day?storeId=${kitchen.id}&date=${today()}`), 200);
  const riceRow = sheet.items.find((row) => row.itemId === rice.id);
  assert.deepStrictEqual([riceRow.opening, riceRow.received, riceRow.consumed, riceRow.wasted, riceRow.closing], [0, 120, 15, 2, 103]);
  assert.strictEqual((await ctx.call("GET", `/inventory/items/${rice.id}`)).data.onHand, 103, "the sheet agrees with the stock balance");
  assert.strictEqual(riceRow.consumedValue, 900);
  assert.strictEqual(sheet.totals.consumedValue, 900 + 240);
  assert.strictEqual(sheet.totals.wastedValue, 120);
  assert.strictEqual(sheet.totals.costPerMeal, null, "no meals counted yet");

  // Cost per meal from a hand count.
  assert.strictEqual((await keeper("PUT", "/inventory/kitchen/meal-count", { storeId: kitchen.id, date: today(), meal: "Lunch", served: -1 })).status, 400);
  ok(await keeper("PUT", "/inventory/kitchen/meal-count", { storeId: kitchen.id, date: today(), meal: "Lunch", served: 40 }), 200);
  sheet = ok(await keeper("PUT", "/inventory/kitchen/meal-count", { storeId: kitchen.id, date: today(), meal: "Dinner", served: 30 }), 200);
  const lunchRow = sheet.meals.find((row) => row.meal === "Lunch");
  assert.deepStrictEqual([lunchRow.cost, lunchRow.served, lunchRow.costPerMeal, lunchRow.source], [840, 40, 21, "COUNT"]);
  assert.strictEqual(sheet.totals.mealsServed, 70);
  assert.strictEqual(sheet.totals.costPerMeal, 16.29);

  // A reversed consumption comes off the sheet.
  const dinner = ok(await ctx.call("GET", `/inventory/movements?storeId=${kitchen.id}&kind=CONSUMPTION`), 200).find((m) => m.meal === "Dinner");
  ok(await ctx.call("POST", `/inventory/movements/${dinner.id}/reverse`, { reason: "Counted twice" }));
  sheet = ok(await ctx.call("GET", `/inventory/kitchen/day?storeId=${kitchen.id}&date=${today()}`), 200);
  assert.strictEqual(sheet.items.find((row) => row.itemId === rice.id).consumed, 10);
  assert.strictEqual(sheet.items.find((row) => row.itemId === rice.id).closing, 108);

  const month = ok(await ctx.call("GET", `/inventory/kitchen/month?storeId=${kitchen.id}&month=${today().slice(0, 7)}`), 200);
  const day = month.days.find((row) => row.date === today());
  assert.strictEqual(day.consumed, 840);
  assert.strictEqual(day.mealsServed, 70);
  assert.strictEqual(month.totals.wasted, 120);
  // Per item for the month: there at the start, bought, used, wasted and left.
  const riceMonth = month.items.find((row) => row.itemId === rice.id);
  assert.deepStrictEqual(
    [riceMonth.opening, riceMonth.received, riceMonth.purchased, riceMonth.purchasedValue, riceMonth.avgPurchasePrice, riceMonth.consumed, riceMonth.wasted, riceMonth.closing],
    [0, 120, 20, 1200, 60, 10, 2, 108], "opening stock counts as received, only the GRN as bought");
  assert.strictEqual(riceMonth.closingValue, 108 * 60);
  const daysSoFar = Number(today().slice(8, 10));
  assert.strictEqual(riceMonth.daysLeft, Math.floor(108 / (10 / daysSoFar)), "lasts at the rate of the days so far, not the whole month");
  assert.strictEqual(month.totals.purchased, 1200);

  // Any range of days; the opening of a later range is the closing before it.
  const tomorrow = new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const later = ok(await ctx.call("GET", `/inventory/kitchen/month?storeId=${kitchen.id}&from=${tomorrow}&to=${tomorrow}`), 200);
  const riceLater = later.items.find((row) => row.itemId === rice.id);
  assert.deepStrictEqual([riceLater.opening, riceLater.received, riceLater.consumed, riceLater.closing], [108, 0, 0, 108]);
  assert.strictEqual(later.days.length, 1);
  assert.strictEqual((await ctx.call("GET", `/inventory/kitchen/month?storeId=${kitchen.id}&from=${tomorrow}&to=${today()}`)).status, 400);
  assert.strictEqual((await ctx.call("GET", `/inventory/kitchen/month?storeId=${kitchen.id}&from=2024-01-01&to=2026-01-01`)).status, 400, "at most a year");

  // Heavy wastage against use is flagged.
  ok(await keeper("POST", "/inventory/wastage", { storeId: kitchen.id, reason: "Spoilt", lines: [{ itemId: dal.id, quantity: 5 }] }));
  assert.ok(ok(await ctx.call("GET", "/inventory/alerts"), 200).some((a) => a.type === "HIGH_WASTAGE"));

  // Spending by purpose: food use, then wastage.
  const spend = ok(await ctx.call("GET", `/inventory/reports/expenses?from=${today()}&to=${today()}`), 200);
  const byCategory = {};
  for (const row of spend) byCategory[row.category] = (byCategory[row.category] || 0) + row.value;
  assert.strictEqual(byCategory["Kitchen & food"], 840 + 120 + 600, "food use plus kitchen wastage, as a kitchen cost");
}));

test("room assets: stock bought for rooms becomes assets held by each room", live(async () => {
  const ctx = tenant();
  const room = async (number) => {
    const id = randomUUID();
    await postgresService.query(
      "INSERT INTO hostel_rooms (id, institution_id, hostel_name, building, floor, room_number, capacity) VALUES ($1, $2, 'North Hall', 'Block A', '1', $3, 2)",
      [id, ctx.institution, number]);
    return id;
  };
  const r101 = await room("101");
  const r102 = await room("102");
  const store = ok(await ctx.call("POST", "/inventory/stores", { code: "CS", name: "Central Store" }));
  const fan = ok(await ctx.call("POST", "/inventory/items", { name: "Ceiling Fan", sku: "FAN", unit: "Piece", category: "Electrical" }));
  ok(await ctx.call("POST", "/inventory/stock/receive", { storeId: store.id, supplier: "Walton", lines: [{ itemId: fan.id, quantity: 20, unitCost: 3200 }] }));

  const keeper = (method, path, body) => ctx.call(method, path, body, "STOREKEEPER");
  const result = ok(await keeper("POST", "/inventory/assets/from-stock", {
    itemId: fan.id, storeId: store.id, warrantyUntil: "2028-12-31",
    allocations: [{ roomId: r101, quantity: 2 }, { roomId: r102, quantity: 3 }],
  }));
  assert.strictEqual(result.created, 5);
  assert.strictEqual((await ctx.call("GET", `/inventory/items/${fan.id}`)).data.onHand, 15, "13 + 2 left in the store");
  assert.strictEqual((await keeper("POST", "/inventory/assets/from-stock", { itemId: fan.id, storeId: store.id, allocations: [{ roomId: r101, quantity: 1.5 }] })).status, 400);
  assert.strictEqual((await keeper("POST", "/inventory/assets/from-stock", { itemId: fan.id, storeId: store.id, allocations: [{ quantity: 1 }] })).status, 400, "a room or a place");
  assert.strictEqual((await keeper("POST", "/inventory/assets/from-stock", { itemId: fan.id, storeId: store.id, allocations: [{ roomId: r101, quantity: 16 }] })).status, 409);

  const inRoom = ok(await ctx.call("GET", `/inventory/assets?roomId=${r101}`), 200);
  assert.deepStrictEqual(inRoom.map((a) => a.assetTag), ["FAN-001", "FAN-002"]);
  assert.strictEqual(inRoom[0].status, "ASSIGNED");
  assert.strictEqual(inRoom[0].assignedTo, "Room 101 · North Hall, Block A");
  assert.strictEqual(inRoom[0].purchaseCost, 3200);
  assert.strictEqual(inRoom[0].itemId, fan.id);

  // More fans later continue the numbering.
  ok(await keeper("POST", "/inventory/assets/from-stock", { itemId: fan.id, storeId: store.id, allocations: [{ location: "Common room", quantity: 1 }] }));
  const common = ok(await ctx.call("GET", "/inventory/assets?search=Common"), 200);
  assert.deepStrictEqual(common.map((a) => [a.assetTag, a.status, a.roomId]), [["FAN-006", "AVAILABLE", null]]);

  // Moving a fan from 101 to 102 moves who holds it.
  const moved = ok(await ctx.call("POST", `/inventory/assets/${inRoom[0].id}/action`, { action: "MOVE", roomId: r102, note: "Room 102 fan broke" }), 200);
  assert.strictEqual(moved.roomId, r102);
  assert.strictEqual(moved.assignedTo, "Room 102 · North Hall, Block A");
  assert.match(moved.history[0].detail, /Room 101.*Room 102/);

  const rooms = ok(await ctx.call("GET", "/inventory/rooms"), 200);
  const by = Object.fromEntries(rooms.map((r) => [r.roomNumber, r]));
  assert.strictEqual(by["101"].assetCount, 1);
  assert.strictEqual(by["102"].assetCount, 4);
  assert.deepStrictEqual(by["102"].assets, [{ name: "Ceiling Fan", count: 4, value: 12800, attention: 0 }]);

  // An asset can be put in a room by hand too, and the item with assets made from it cannot be deleted.
  const bed = ok(await ctx.call("POST", "/inventory/assets", { name: "Bed", roomId: r101 }));
  assert.strictEqual(bed.location, "Room 101 · North Hall, Block A");
  assert.strictEqual((await ctx.call("POST", "/inventory/assets", { name: "Bed", roomId: randomUUID() })).status, 404);
  assert.strictEqual((await ctx.call("DELETE", `/inventory/items/${fan.id}`)).status, 409);

  // The issue to the register is spending on fixed assets.
  const spend = ok(await ctx.call("GET", "/inventory/reports/expenses"), 200);
  assert.strictEqual(spend.filter((row) => row.category === "Fixed assets").reduce((sum, row) => sum + row.value, 0), 6 * 3200);
}));

test("reorder suggestions say how much to order and why", live(async () => {
  const ctx = tenant();
  const store = ok(await ctx.call("POST", "/inventory/stores", { code: "CS", name: "Central Store" }));
  const ink = ok(await ctx.call("POST", "/inventory/items", { name: "Toner", unit: "Piece", reorderLevel: 5, maxLevel: 20 }));
  const chalk = ok(await ctx.call("POST", "/inventory/items", { name: "Chalk", unit: "Box", reorderLevel: 0 }));
  const pens = ok(await ctx.call("POST", "/inventory/items", { name: "Pens", unit: "Box", reorderLevel: 2 }));
  ok(await ctx.call("POST", "/inventory/stock/receive", { storeId: store.id, supplier: "Cheap Co", lines: [{ itemId: ink.id, quantity: 3, unitCost: 900 }, { itemId: chalk.id, quantity: 40, unitCost: 50 }, { itemId: pens.id, quantity: 50, unitCost: 100 }] }));
  ok(await ctx.call("POST", "/inventory/stock/receive", { storeId: store.id, supplier: "Dear Co", lines: [{ itemId: ink.id, quantity: 1, unitCost: 1100 }] }));
  // 30 boxes of chalk used in 30 days: 10 left lasts 10 days.
  ok(await ctx.call("POST", "/inventory/stock/issue", { storeId: store.id, issuedTo: "Classes", lines: [{ itemId: chalk.id, quantity: 30 }] }));

  const { suggestions } = ok(await ctx.call("GET", "/inventory/reports/reorder?days=30"), 200);
  const by = Object.fromEntries(suggestions.map((s) => [s.name, s]));
  assert.ok(!by.Pens, "plenty of pens and none used");
  assert.strictEqual(by.Toner.suggest, 16, "up to the maximum of 20");
  assert.strictEqual(by.Toner.lastCost, 1100);
  assert.deepStrictEqual([by.Toner.bestCost, by.Toner.bestSupplier], [900, "Cheap Co"]);
  assert.match(by.Toner.reasons[0], /reorder level of 5/);
  assert.strictEqual(by.Chalk.coverDays, 10);
  assert.strictEqual(by.Chalk.suggest, 20, "30 days of use, less the 10 on hand");
  assert.ok(by.Chalk.reasons.some((r) => /lasts about 10 days/.test(r)));
}));
