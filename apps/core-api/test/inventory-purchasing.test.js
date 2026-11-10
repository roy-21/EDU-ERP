// Needs PostgreSQL. Inventory purchasing (suppliers, purchase orders, GRNs), batches with expiry,
// and the alert email (through a local fake SMTP server, not a real mailbox).
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");
const { startFakeSmtp, decodeMail } = require("./fake-gateways");
const { runDailyDigests } = require("../dist/modules/inventory/inventory-alerts.service");

let server;
let baseUrl;
let smtp;
const clients = [];

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const shift = (days) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test.before(async () => {
  await postgresService.initialize();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  smtp = await startFakeSmtp();
});

test.after(async () => {
  for (const key of ["EMAIL_USER", "EMAIL_PASS", "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_SECURE"]) process.env[key] = "";
  if (postgresService.isLive()) await removeInstitutions(clients.map((client) => client.institution));
  await smtp?.close();
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

const item = async (ctx, itemId) => ok(await ctx.call("GET", `/inventory/items/${itemId}`), 200);

test("purchasing: draft, approve, partial and final GRNs, no over-receipt, reversal and short close", live(async () => {
  const ctx = tenant();
  const store = ok(await ctx.call("POST", "/inventory/stores", { code: "CS", name: "Central Store" }));
  const supplier = ok(await ctx.call("POST", "/inventory/suppliers", { name: "Paper World", phone: "01711-000000", email: "sales@paperworld.example" }));
  assert.strictEqual((await ctx.call("POST", "/inventory/suppliers", { name: "paper world" })).status, 409, "supplier names are unique");
  assert.strictEqual((await ctx.call("POST", "/inventory/suppliers", { name: "X", email: "nope" })).status, 400);
  const paper = ok(await ctx.call("POST", "/inventory/items", { name: "A4 Paper", unit: "Ream", openingQuantity: 10, unitCost: 400, storeId: store.id }));
  const toner = ok(await ctx.call("POST", "/inventory/items", { name: "Toner" }));
  const chalk = ok(await ctx.call("POST", "/inventory/items", { name: "Chalk" }));

  assert.strictEqual((await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, lines: [] })).status, 400);
  assert.strictEqual((await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, expectedOn: "2020-01-01", lines: [{ itemId: paper.id, quantity: 1 }] })).status, 400, "expected before ordered");
  let po = ok(await ctx.call("POST", "/inventory/purchase-orders", {
    supplierId: supplier.id, storeId: store.id, expectedOn: shift(7), lines: [{ itemId: paper.id, quantity: 100, unitCost: 460 }, { itemId: toner.id, quantity: 2, unitCost: 2500 }],
  }));
  assert.ok(po.poNo.startsWith("PO-"));
  assert.strictEqual(po.status, "DRAFT");
  assert.strictEqual(po.total, 51000);
  po = ok(await ctx.call("PUT", `/inventory/purchase-orders/${po.id}`, {
    supplierId: supplier.id, storeId: store.id, expectedOn: shift(7), lines: [{ itemId: paper.id, quantity: 50, unitCost: 460 }, { itemId: toner.id, quantity: 2, unitCost: 2500 }],
  }), 200);
  assert.strictEqual(po.total, 28000);
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { lines: [{ itemId: paper.id, quantity: 1 }] })).status, 409, "a draft takes no goods");
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/approve`, undefined, "STOREKEEPER")).status, 403, "approval needs approve rights");
  po = ok(await ctx.call("POST", `/inventory/purchase-orders/${po.id}/approve`), 200);
  assert.strictEqual(po.status, "APPROVED");
  assert.strictEqual((await ctx.call("PUT", `/inventory/purchase-orders/${po.id}`, { supplierId: supplier.id, storeId: store.id, lines: [{ itemId: paper.id, quantity: 1 }] })).status, 409, "approved orders are fixed");

  // First delivery: 30 reams at the order price, through the storekeeper.
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { lines: [{ itemId: chalk.id, quantity: 1 }] })).status, 400, "not on the order");
  const first = await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { reference: "INV-1", lines: [{ itemId: paper.id, quantity: 30 }] }, "STOREKEEPER");
  assert.strictEqual(first.status, 201, first.error);
  assert.strictEqual(first.data.order.status, "PARTIAL");
  assert.ok(first.data.grn.docNo.startsWith("GRN-"));
  assert.strictEqual(first.data.grn.movements[0].unitCost, 460);
  assert.strictEqual(first.data.grn.movements[0].party, "Paper World");
  let paperNow = await item(ctx, paper.id);
  assert.strictEqual(paperNow.onHand, 40);
  assert.strictEqual(paperNow.avgCost, 445, "10 at 400 + 30 at 460");

  const over = await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { lines: [{ itemId: paper.id, quantity: 21 }] });
  assert.strictEqual(over.status, 409);
  assert.match(over.error, /Only 20 Ream/);
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/cancel`, {})).status, 409, "goods already came");

  // Reversing the GRN line puts the 30 back on the order.
  const grnLine = first.data.grn.movements[0];
  ok(await ctx.call("POST", `/inventory/movements/${grnLine.id}/reverse`, { reason: "Wrong delivery" }));
  po = ok(await ctx.call("GET", `/inventory/purchase-orders/${po.id}`), 200);
  assert.strictEqual(po.status, "APPROVED");
  assert.strictEqual(po.lines.find((l) => l.itemId === paper.id).remaining, 50);
  assert.strictEqual((await item(ctx, paper.id)).avgCost, 400);

  ok(await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { lines: [{ itemId: paper.id, quantity: 50, unitCost: 450 }, { itemId: toner.id, quantity: 1 }] }));
  po = ok(await ctx.call("GET", `/inventory/purchase-orders/${po.id}`), 200);
  assert.strictEqual(po.status, "PARTIAL");
  assert.strictEqual(po.receipts.length, 2);
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/close`, {})).status, 400, "closing short needs a reason");
  po = ok(await ctx.call("POST", `/inventory/purchase-orders/${po.id}/close`, { note: "Supplier out of toner" }), 200);
  assert.strictEqual(po.status, "CLOSED");
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { lines: [{ itemId: toner.id, quantity: 1 }] })).status, 409);

  // A full delivery completes an order; an untouched one can be cancelled; drafts can be deleted.
  const full = ok(await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, lines: [{ itemId: chalk.id, quantity: 5, unitCost: 20 }] }));
  ok(await ctx.call("POST", `/inventory/purchase-orders/${full.id}/approve`), 200);
  assert.strictEqual(ok(await ctx.call("POST", `/inventory/purchase-orders/${full.id}/receive`, { lines: [{ itemId: chalk.id, quantity: 5 }] })).order.status, "RECEIVED");
  const unused = ok(await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, lines: [{ itemId: chalk.id, quantity: 1 }] }));
  ok(await ctx.call("POST", `/inventory/purchase-orders/${unused.id}/approve`), 200);
  assert.strictEqual(ok(await ctx.call("POST", `/inventory/purchase-orders/${unused.id}/cancel`, { note: "Not needed" }), 200).status, "CANCELLED");
  const draft = ok(await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, lines: [{ itemId: chalk.id, quantity: 1 }] }));
  ok(await ctx.call("DELETE", `/inventory/purchase-orders/${draft.id}`), 200);
  assert.strictEqual((await ctx.call("DELETE", `/inventory/suppliers/${supplier.id}`)).status, 409, "a supplier with orders is kept");
  assert.strictEqual((await ctx.call("DELETE", `/inventory/items/${chalk.id}`)).status, 409);

  // Late orders show up as alerts.
  const late = ok(await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, orderedOn: shift(-10), expectedOn: shift(-2), lines: [{ itemId: chalk.id, quantity: 1 }] }));
  ok(await ctx.call("POST", `/inventory/purchase-orders/${late.id}/approve`), 200);
  const alerts = ok(await ctx.call("GET", "/inventory/alerts"), 200);
  assert.ok(alerts.some((a) => a.type === "LATE_PURCHASE" && a.title.includes(late.poNo)));
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/summary"), 200).openPurchaseOrders, 1);
}));

test("batches: required for tracked items, issued first-expiry-first-out, expired stock only written off", live(async () => {
  const ctx = tenant();
  const store = ok(await ctx.call("POST", "/inventory/stores", { code: "CHEM", name: "Chemistry Store" }));
  const lab = ok(await ctx.call("POST", "/inventory/stores", { code: "LAB2", name: "Lab 2" }));
  const acid = ok(await ctx.call("POST", "/inventory/items", { name: "HCl 1L", unit: "Bottle", trackBatches: true }));
  assert.strictEqual(acid.trackBatches, true);
  assert.strictEqual((await ctx.call("POST", "/inventory/items", { name: "Bad", trackBatches: true, openingQuantity: 5, storeId: store.id })).status, 400, "opening stock needs a batch");

  const receive = (lines) => ctx.call("POST", "/inventory/stock/receive", { storeId: store.id, lines });
  assert.strictEqual((await receive([{ itemId: acid.id, quantity: 5, unitCost: 300 }])).status, 400, "no batch number");
  assert.strictEqual((await receive([{ itemId: acid.id, quantity: 5, expiresOn: shift(9) }])).status, 400, "an expiry needs a batch");
  ok(await receive([
    { itemId: acid.id, quantity: 10, unitCost: 300, batchNo: "B-LATE", expiresOn: shift(100) },
    { itemId: acid.id, quantity: 10, unitCost: 300, batchNo: "B-SOON", expiresOn: shift(9) },
    { itemId: acid.id, quantity: 4, unitCost: 300, batchNo: "B-OLD", expiresOn: shift(-1) },
  ]));
  assert.strictEqual((await receive([{ itemId: acid.id, quantity: 1, unitCost: 300, batchNo: "B-SOON", expiresOn: shift(50) }])).status, 409, "a batch has one expiry date");

  let now = await item(ctx, acid.id);
  assert.strictEqual(now.onHand, 24);
  assert.deepStrictEqual(now.batches.map((b) => [b.batchNo, b.state]), [["B-OLD", "EXPIRED"], ["B-SOON", "EXPIRING"], ["B-LATE", "OK"]]);

  // 12 out: all 10 of the soonest usable batch, then 2 of the next. The expired batch is skipped.
  const issued = ok(await ctx.call("POST", "/inventory/stock/issue", { storeId: store.id, issuedTo: "Chem Lab", lines: [{ itemId: acid.id, quantity: 12 }] }));
  assert.deepStrictEqual(issued.movements.map((m) => [m.batchNo, m.quantity]).sort(), [["B-LATE", -2], ["B-SOON", -10]]);
  const tooMuch = await ctx.call("POST", "/inventory/stock/issue", { storeId: store.id, issuedTo: "Chem Lab", lines: [{ itemId: acid.id, quantity: 9 }] });
  assert.strictEqual(tooMuch.status, 409);
  assert.match(tooMuch.error, /Only 8 Bottle .*4 more Bottle have expired/);

  // The expired batch is written off by itself.
  const old = now.batches.find((b) => b.batchNo === "B-OLD");
  ok(await ctx.call("POST", "/inventory/stock/write-off", { storeId: store.id, itemId: acid.id, kind: "DAMAGE", quantity: 4, reason: "Expired", batchId: old.id }));
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/batches?state=EXPIRED"), 200).length, 0);

  // Reversing the issue puts the stock back into the same batches.
  for (const m of issued.movements) ok(await ctx.call("POST", `/inventory/movements/${m.id}/reverse`, { reason: "Not used" }));
  now = await item(ctx, acid.id);
  assert.deepStrictEqual(now.batches.map((b) => [b.batchNo, b.quantity]), [["B-SOON", 10], ["B-LATE", 10]]);

  // Counted batch by batch.
  assert.strictEqual((await ctx.call("POST", "/inventory/stock/count", { storeId: store.id, itemId: acid.id, countedQuantity: 9, reason: "Count" })).status, 400);
  ok(await ctx.call("POST", "/inventory/stock/count", { storeId: store.id, itemId: acid.id, batchNo: "B-SOON", countedQuantity: 9, reason: "One broken" }));
  assert.strictEqual((await item(ctx, acid.id)).onHand, 19);

  // Transfers keep the batch and expiry.
  const transfer = ok(await ctx.call("POST", "/inventory/transfers", { fromStoreId: store.id, toStoreId: lab.id, lines: [{ itemId: acid.id, quantity: 12 }] }));
  ok(await ctx.call("POST", `/inventory/transfers/${transfer.id}/approve`), 200);
  ok(await ctx.call("POST", `/inventory/transfers/${transfer.id}/receive`), 200);
  const inLab = ok(await ctx.call("GET", `/inventory/batches?storeId=${lab.id}`), 200);
  assert.deepStrictEqual(inLab.map((b) => [b.batchNo, b.quantity, b.expiresOn]), [["B-SOON", 9, shift(9)], ["B-LATE", 3, shift(100)]]);

  // Tracking cannot be switched off while there is stock.
  assert.strictEqual((await ctx.call("PUT", `/inventory/items/${acid.id}`, { trackBatches: false })).status, 409);

  // Expiring stock shows up as alerts, within the warning window set in settings.
  let alerts = ok(await ctx.call("GET", "/inventory/alerts"), 200);
  // FEFO sent all of B-SOON to the lab, so only the lab holds it now.
  assert.deepStrictEqual(alerts.filter((a) => a.type === "EXPIRING").map((a) => a.detail.includes("Lab 2")), [true]);
  ok(await ctx.call("PUT", "/inventory/settings", { expiryWarningDays: 5 }), 200);
  alerts = ok(await ctx.call("GET", "/inventory/alerts"), 200);
  assert.strictEqual(alerts.filter((a) => a.type === "EXPIRING").length, 0);
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/summary"), 200).expiringBatches, 0);

  // Purchase orders receive batches too.
  const supplier = ok(await ctx.call("POST", "/inventory/suppliers", { name: "Chem Supply" }));
  const po = ok(await ctx.call("POST", "/inventory/purchase-orders", { supplierId: supplier.id, storeId: store.id, lines: [{ itemId: acid.id, quantity: 6, unitCost: 320 }] }));
  ok(await ctx.call("POST", `/inventory/purchase-orders/${po.id}/approve`), 200);
  assert.strictEqual((await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, { lines: [{ itemId: acid.id, quantity: 6 }] })).status, 400, "batch required");
  const grn = ok(await ctx.call("POST", `/inventory/purchase-orders/${po.id}/receive`, {
    lines: [{ itemId: acid.id, quantity: 4, batchNo: "PO-B1", expiresOn: shift(200) }, { itemId: acid.id, quantity: 2, batchNo: "PO-B2", expiresOn: shift(300) }],
  }));
  assert.strictEqual(grn.order.status, "RECEIVED");
  assert.strictEqual(grn.grn.movements.length, 2);
}));

test("alert email: settings are checked, the digest is sent once a day and logged", live(async () => {
  const ctx = tenant();
  const store = ok(await ctx.call("POST", "/inventory/stores", { code: "CS", name: "Central Store" }));
  ok(await ctx.call("POST", "/inventory/items", { name: "Toner", reorderLevel: 5, openingQuantity: 2, unitCost: 2500, storeId: store.id }));

  assert.strictEqual((await ctx.call("PUT", "/inventory/settings", { emailAlerts: true, alertEmails: "" })).status, 400, "needs an address");
  assert.strictEqual((await ctx.call("PUT", "/inventory/settings", { alertEmails: "store@example.com, not-an-email" })).status, 400);
  assert.strictEqual((await ctx.call("PUT", "/inventory/settings", { expiryWarningDays: 0 })).status, 400);
  assert.strictEqual((await ctx.call("PUT", "/inventory/settings", { emailAlerts: true, alertEmails: "store@example.com" }, "STOREKEEPER")).status, 403);
  const settings = ok(await ctx.call("PUT", "/inventory/settings", { emailAlerts: true, alertEmails: "Store@Example.com; head@example.com", expiryWarningDays: 45 }), 200);
  assert.strictEqual(settings.alertEmails, "store@example.com, head@example.com");

  // Without a mail server the attempt is logged as failed, with the reason.
  const unsent = ok(await ctx.call("POST", "/inventory/alerts/email"), 200);
  assert.strictEqual(unsent.sent, false);
  assert.match(unsent.reason, /not configured/);

  Object.assign(process.env, { EMAIL_USER: "sender@example.com", EMAIL_PASS: "x", EMAIL_SMTP_HOST: "127.0.0.1", EMAIL_SMTP_PORT: String(smtp.port), EMAIL_SMTP_SECURE: "false" });
  smtp.state.messages.length = 0;
  const sent = ok(await ctx.call("POST", "/inventory/alerts/email"), 200);
  assert.strictEqual(sent.sent, true, sent.reason);
  assert.strictEqual(smtp.state.messages.length, 1);
  const mail = smtp.state.messages[0];
  assert.strictEqual(mail.to.length, 2);
  assert.match(decodeMail(mail.raw), /Toner is low/);
  const log = ok(await ctx.call("GET", "/inventory/alerts/email-log"), 200);
  assert.deepStrictEqual(log.map((row) => row.status), ["SENT", "FAILED"]);

  // The daily job skips an institution already emailed today, and waits until 08:00 Dhaka time.
  smtp.state.messages.length = 0;
  const morning = Date.parse(`${today()}T03:00:00Z`); // 09:00 in Dhaka
  const mine = () => smtp.state.messages.filter((m) => m.to.some((line) => line.toLowerCase().includes("store@example.com")));
  await runDailyDigests(morning);
  assert.strictEqual(mine().length, 0, "already sent today");
  await postgresService.query("UPDATE inv_settings SET last_alert_on = $2 WHERE institution_id = $1", [ctx.institution, shift(-1)]);
  await runDailyDigests(Date.parse(`${today()}T01:00:00Z`)); // 07:00 in Dhaka
  assert.strictEqual(mine().length, 0, "too early");
  await runDailyDigests(morning);
  assert.strictEqual(mine().length, 1);
  assert.strictEqual(ok(await ctx.call("GET", "/inventory/settings"), 200).lastAlertOn, today());
}));
