// Needs PostgreSQL. Uses local fakes for bKash and SMTP, so a pass here shows how
// our code behaves. It does not show that real bKash or Gmail accept our requests.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { deliverPending, queueDueReminders, queueNewInvoices } = require("../dist/modules/hostel/hostel-notifications.service");
const { hostelGatewayService } = require("../dist/modules/hostel/hostel-online-payment.service");
const { listJobStatus, runRentCycle } = require("../dist/modules/hostel/hostel.scheduler");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");
const { decodeMail, startFakeBkash, startFakeSmtp } = require("./fake-gateways");

let server;
let baseUrl;
let bkash;
let smtp;
const clients = [];
let counter = 0;

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const shiftDays = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const ENV_KEYS = ["HOSTEL_SECRET_KEY", "BKASH_ALLOW_TEST_BASE_URL", "EMAIL_USER", "EMAIL_PASS", "TO_EMAIL",
  "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_SECURE", "API_PUBLIC_URL", "APP_PUBLIC_URL",
  "HOSTEL_ALLOW_BKASH_PRODUCTION", "HOSTEL_SMS_API_URL", "HOSTEL_EMAIL_API_URL"];
const savedEnv = {};

test.before(async () => {
  ENV_KEYS.forEach((key) => { savedEnv[key] = process.env[key]; delete process.env[key]; });
  await postgresService.initialize();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  bkash = await startFakeBkash();
  smtp = await startFakeSmtp();
  Object.assign(process.env, {
    HOSTEL_SECRET_KEY: "test-key-test-key-test-key-test-key-123",
    BKASH_ALLOW_TEST_BASE_URL: "true",
    EMAIL_USER: "sender@example.com",
    EMAIL_PASS: "smtp-pass-value",
    TO_EMAIL: "admin@example.com",
    EMAIL_SMTP_HOST: "127.0.0.1",
    EMAIL_SMTP_PORT: String(smtp.port),
    EMAIL_SMTP_SECURE: "false",
    API_PUBLIC_URL: `http://127.0.0.1:${server.address().port}`,
    APP_PUBLIC_URL: "http://app.test",
  });
});

test.after(async () => {
  if (postgresService.isLive()) await removeInstitutions(clients.map((client) => client.institution));
  await bkash?.close();
  await smtp?.close();
  await new Promise((resolve) => server.close(resolve));
  ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
  await postgresService.close?.();
  setTimeout(() => process.exit(), 200).unref();
});

test.beforeEach(() => {
  Object.assign(bkash.state, {
    executeDown: false, queryDown: false, createDown: false, executeError: null, forceAmount: null,
    grantFails: false, executeLosesAnswer: false, expiresIn: 3600,
  });
  smtp.state.down = false;
  smtp.state.messages.length = 0;
});

const newClient = () => {
  const client = createClient(() => baseUrl);
  clients.push(client);
  return client;
};

const gatewayBody = (change = {}) => ({
  environment: "sandbox",
  enabled: true,
  apiBaseUrl: bkash.baseUrl,
  ...bkash.state.credentials,
  ...change,
});

// One student with one invoice of 5000, with bKash switched on.
const setup = async ({ partial = false, change = {}, gateway = true } = {}) => {
  const client = newClient();
  const { call } = client;
  counter += 1;
  const room = await call("POST", "/hostel/rooms", { hostelName: "North", building: "A", floor: "1", roomNumber: `R${counter}`, capacity: 3 });
  assert.strictEqual(room.status, 201, room.error);
  const detail = await call("GET", `/hostel/rooms/${room.data.id}`);
  const allocation = await call("POST", "/hostel/allocations", {
    seatId: detail.data.seats[0].id,
    studentId: `ST-${counter}`,
    studentName: `Student ${counter}`,
    studentPhone: "01711111111",
    studentEmail: `student${counter}@example.com`,
    studentNid: "1234567890123",
    guardianName: "Guardian",
    guardianPhone: "01722222222",
    monthlyRent: 5000,
    startDate: `${today().slice(0, 7)}-01`,
    firstDueDate: shiftDays(today(), 5),
    ...change,
  });
  assert.strictEqual(allocation.status, 201, allocation.error);

  const settings = (await call("GET", "/hostel/rent/config")).data.settings;
  const saved = await call("PUT", "/hostel/rent/settings", { ...settings, channels: ["IN_APP", "EMAIL"], allowPartialOnline: partial, brandName: "North Hostel" });
  assert.strictEqual(saved.status, 200, saved.error);
  if (gateway) {
    const config = await call("PUT", "/hostel/gateway/config", gatewayBody());
    assert.strictEqual(config.status, 200, config.error);
  }

  const ledger = async () => (await call("GET", `/hostel/ledger/${allocation.data.id}`)).data;
  const invoice = (await ledger()).invoices.at(-1);
  const link = await call("POST", `/hostel/invoices/${invoice.id}/payment-link`);
  assert.strictEqual(link.status, 201, link.error);
  const token = link.data.url.split("/").pop();
  return { ...client, allocation: allocation.data, invoice, token, ledger, seats: detail.data.seats };
};

const publicCall = async (method, path, body) => {
  const res = await fetch(`${baseUrl}/public/hostel${path}`, {
    method,
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* a redirect or file */ }
  return { status: res.status, data: json.data, error: json.error, text, location: res.headers.get("location"), headers: res.headers };
};

const pay = async (token, amount) => {
  const res = await publicCall("POST", `/pay/${token}/bkash`, { amount });
  return res;
};

const checkoutOf = (res) => {
  assert.strictEqual(res.status, 200, res.error);
  const id = res.data.checkoutUrl.split("/").pop();
  return { id, payment: bkash.state.payments.get(id) };
};

const secretOf = (payment) => payment.callbackURL.split("/").pop();

const callback = (payment, status, paymentId = payment.id) =>
  publicCall("GET", `/bkash/callback/${secretOf(payment)}?paymentID=${paymentId}&status=${status}`);

const approveAndReturn = async (token, amount) => {
  const { id, payment } = checkoutOf(await pay(token, amount));
  bkash.approve(id);
  const back = await callback(payment, "success");
  assert.strictEqual(back.status, 303, back.error);
  return { id, payment, secret: secretOf(payment) };
};

const waitFor = async (check, label) => {
  for (let i = 0; i < 40; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for: ${label}`);
};

const transactions = async (client) => (await client.call("GET", "/hostel/gateway/transactions")).data;
const mailsTo = (address) =>
  smtp.state.messages.filter((mail) => mail.to.some((line) => line.includes(address))).map((mail) => ({ ...mail, text: decodeMail(mail.raw) }));

test("gateway credentials are encrypted and never returned", live(async () => {
  const client = newClient();
  const { call, institution } = client;
  const noKey = process.env.HOSTEL_SECRET_KEY;

  delete process.env.HOSTEL_SECRET_KEY;
  assert.strictEqual((await call("PUT", "/hostel/gateway/config", gatewayBody())).status, 503, "no key, no saving");
  process.env.HOSTEL_SECRET_KEY = noKey;

  const saved = await call("PUT", "/hostel/gateway/config", gatewayBody());
  assert.strictEqual(saved.status, 200, saved.error);
  const tested = await call("POST", "/hostel/gateway/test");
  assert.strictEqual(tested.data.health, "Connected", tested.data.lastTestMessage);

  const { password, appKey, appSecret, username } = bkash.state.credentials;
  const visible = JSON.stringify([saved.data, tested.data, (await call("GET", "/hostel/gateway/config")).data, (await call("GET", "/hostel/audit")).data]);
  [password, appKey, appSecret, username].forEach((secret) => assert.ok(!visible.includes(secret), "not in any API answer or audit row"));
  assert.strictEqual(saved.data.hasAppSecret, true);

  const { rows } = await postgresService.query("SELECT * FROM hostel_gateway_config WHERE institution_id = $1", [institution]);
  const stored = JSON.stringify(rows[0]);
  [password, appKey, appSecret, "id-token"].forEach((secret) => assert.ok(!stored.includes(secret), "encrypted at rest"));

  // An empty field keeps the saved value.
  const keep = await call("PUT", "/hostel/gateway/config", gatewayBody({ password: "", appSecret: "" }));
  assert.strictEqual(keep.data.hasPassword, true);
  assert.strictEqual((await call("POST", "/hostel/gateway/test")).data.health, "Connected");
}));

test("production and foreign API addresses are blocked", live(async () => {
  const { call } = newClient();
  const blocked = await call("PUT", "/hostel/gateway/config", gatewayBody({ environment: "production" }));
  assert.strictEqual(blocked.status, 400);
  assert.match(blocked.error, /Production is blocked/);

  delete process.env.BKASH_ALLOW_TEST_BASE_URL;
  try {
    const foreign = await call("PUT", "/hostel/gateway/config", gatewayBody({ apiBaseUrl: "https://evil.example.com" }));
    assert.strictEqual(foreign.status, 400, "credentials cannot be pointed at another server");
  } finally {
    process.env.BKASH_ALLOW_TEST_BASE_URL = "true";
  }
  assert.strictEqual((await call("PUT", "/hostel/gateway/config", gatewayBody({ environment: "bad" }))).status, 400);
}));

test("the token is reused, refreshed, and bad logins respect the grant limit", live(async () => {
  const { call, institution } = newClient();
  await call("PUT", "/hostel/gateway/config", gatewayBody());
  const before = bkash.state.grants;
  await call("POST", "/hostel/gateway/test");
  await call("POST", "/hostel/gateway/test");
  await call("POST", "/hostel/gateway/test");
  assert.strictEqual(bkash.state.grants - before, 1, "one grant, then the saved token");

  const refreshes = bkash.state.refreshes;
  await postgresService.query("UPDATE hostel_gateway_config SET token_expires_at = NOW() + INTERVAL '1 minute' WHERE institution_id = $1", [institution]);
  await call("POST", "/hostel/gateway/test");
  assert.strictEqual(bkash.state.refreshes - refreshes, 1, "a nearly expired token is refreshed");
  assert.strictEqual(bkash.state.grants - before, 1);

  const failing = newClient();
  await failing.call("PUT", "/hostel/gateway/config", gatewayBody());
  bkash.state.grantFails = true;
  const startGrants = bkash.state.grants;
  const results = [];
  for (let i = 0; i < 4; i += 1) results.push((await failing.call("POST", "/hostel/gateway/test")).data);
  assert.strictEqual(bkash.state.grants - startGrants, 2, "never a third grant call in an hour");
  assert.strictEqual(results[3].health, "Error");
  assert.match(results[3].lastTestMessage, /twice this hour/);
}));

test("a verified payment updates every record, once", live(async () => {
  const ctx = await setup();
  await ctx.call("PUT", `/hostel/invoices/${ctx.invoice.id}/x`).catch(() => {});
  await postgresService.query("UPDATE hostel_invoices SET due_date = $2 WHERE id = $1", [ctx.invoice.id, shiftDays(today(), -2)]);
  assert.strictEqual((await ctx.call("GET", "/hostel/due-rent/count")).data.students, 1);

  const page = await publicCall("GET", `/pay/${ctx.token}`);
  assert.strictEqual(page.status, 200, page.error);
  assert.strictEqual(page.data.invoice.outstandingAmount, 5000);
  assert.strictEqual(page.data.online.bkash, true);
  assert.strictEqual(page.headers.get("cache-control"), "no-store");

  const { secret, payment } = await approveAndReturn(ctx.token, 5000);
  assert.strictEqual(payment.amount, "5000.00");

  const [invoice] = (await ctx.ledger()).invoices;
  assert.strictEqual(invoice.status, "Paid");
  assert.strictEqual(invoice.paidAmount, 5000);
  assert.strictEqual(invoice.outstandingAmount, 0);

  const ledger = await ctx.ledger();
  assert.strictEqual(ledger.payments.length, 1);
  assert.strictEqual(ledger.payments[0].method, "bKash");
  assert.strictEqual(ledger.payments[0].transactionReference, payment.trx);
  assert.match(ledger.payments[0].receiptNumber, /^RCP-/);
  assert.strictEqual((await ctx.call("GET", "/hostel/due-rent/count")).data.students, 0, "the due count falls");

  const dashboard = (await ctx.call("GET", "/hostel/rent/dashboard")).data;
  assert.strictEqual(dashboard.collected, 5000);
  assert.strictEqual(dashboard.paidStudents, 1);
  assert.strictEqual(dashboard.onlineSuccessful, 1);

  const result = await publicCall("GET", `/payment-result/${secret}`);
  assert.strictEqual(result.data.status, "Completed");
  assert.strictEqual(result.data.trxId, payment.trx);
  assert.strictEqual(result.data.remainingBalance, 0);

  const mail = await waitFor(() => mailsTo(ctx.allocation.studentEmail).find((item) => /payment received/i.test(item.text)), "confirmation email");
  assert.match(mail.text, /application\/pdf/, "the receipt is attached");
  assert.ok(!mailsTo("admin@example.com").length, "student mail does not go to the admin");

  const pdf = await fetch(`${baseUrl}/public/hostel/payment-result/${secret}/receipt`);
  assert.strictEqual(pdf.headers.get("content-type"), "application/pdf");
  assert.strictEqual(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");

  // Repeated callbacks, in sequence and together, change nothing.
  await callback(payment, "success");
  await Promise.all([callback(payment, "success"), callback(payment, "success"), callback(payment, "cancel")]);
  const again = await ctx.ledger();
  assert.strictEqual(again.payments.length, 1, "no duplicate payment");
  assert.strictEqual(again.invoices[0].paidAmount, 5000);
  assert.strictEqual((await transactions(ctx))[0].status, "Completed");

  // The page now refuses another payment.
  assert.strictEqual((await pay(ctx.token, 5000)).status, 409);
  await postgresService.query("UPDATE hostel_invoices SET due_date = $2 WHERE id = $1", [ctx.invoice.id, shiftDays(today(), 5)]);
}));

test("concurrent callbacks on a fresh payment post exactly one payment", live(async () => {
  const ctx = await setup();
  const { id, payment } = checkoutOf(await pay(ctx.token, 5000));
  bkash.approve(id);
  await Promise.all(Array.from({ length: 5 }, () => callback(payment, "success")));
  assert.strictEqual((await ctx.ledger()).payments.length, 1);
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 5000);
}));

test("a browser redirect alone never marks a payment as paid", live(async () => {
  const ctx = await setup();
  const { id, payment } = checkoutOf(await pay(ctx.token, 5000));

  // A forged success, before the student approved anything at bKash.
  const forged = await callback(payment, "success");
  assert.strictEqual(forged.status, 303);
  assert.strictEqual((await ctx.ledger()).payments.length, 0);
  assert.strictEqual((await transactions(ctx))[0].status, "Initiated");

  // A wrong payment ID on a real callback address is ignored.
  bkash.approve(id);
  await callback(payment, "success", "TR-WRONG");
  assert.strictEqual((await ctx.ledger()).payments.length, 0);

  // An unknown callback address changes nothing.
  const unknown = await publicCall("GET", `/bkash/callback/${"x".repeat(43)}?paymentID=${id}&status=success`);
  assert.strictEqual(unknown.status, 303);
  assert.strictEqual((await ctx.ledger()).payments.length, 0);
  assert.strictEqual((await publicCall("GET", `/payment-result/${"x".repeat(43)}`)).status, 404);

  // A receipt does not exist before verification.
  const early = await publicCall("GET", `/payment-result/${secretOf(payment)}/receipt`);
  assert.strictEqual(early.status, 404);
}));

test("failed and cancelled payments record nothing", live(async () => {
  const ctx = await setup();

  const cancelled = checkoutOf(await pay(ctx.token, 5000));
  await callback(cancelled.payment, "cancel");
  assert.strictEqual((await transactions(ctx))[0].status, "Cancelled");
  assert.strictEqual((await publicCall("GET", `/payment-result/${secretOf(cancelled.payment)}`)).data.status, "Cancelled");

  const failed = checkoutOf(await pay(ctx.token, 5000));
  await callback(failed.payment, "failure");
  assert.strictEqual((await transactions(ctx))[0].status, "Failed");
  await waitFor(() => mailsTo(ctx.allocation.studentEmail).find((item) => /did not go through/.test(item.text)), "failure email");

  bkash.state.executeError = "2023";
  const declined = checkoutOf(await pay(ctx.token, 5000));
  bkash.approve(declined.id);
  await callback(declined.payment, "success");
  assert.strictEqual((await transactions(ctx))[0].status, "Failed");
  assert.match((await transactions(ctx))[0].statusMessage, /Insufficient/);

  const ledger = await ctx.ledger();
  assert.strictEqual(ledger.payments.length, 0);
  assert.strictEqual(ledger.invoices[0].outstandingAmount, 5000);

  // A forged cancel on a payment bKash completed still gets recorded.
  bkash.state.executeError = null;
  const completed = checkoutOf(await pay(ctx.token, 5000));
  bkash.state.payments.get(completed.id).status = "Completed";
  bkash.state.payments.get(completed.id).trx = `TRXC${Date.now()}`;
  await callback(completed.payment, "cancel");
  assert.strictEqual((await ctx.ledger()).invoices[0].status !== "Unpaid", true);
  assert.strictEqual((await ctx.ledger()).payments.length, 1);
}));

test("a closed browser and gateway outages are recovered by reconciliation", live(async () => {
  const ctx = await setup({ partial: true });
  const force = () => postgresService.query("UPDATE hostel_gateway_transactions SET next_check_at = NOW() WHERE institution_id = $1", [ctx.institution]);
  const reconcile = async () => { await force(); return hostelGatewayService.reconcileOpen({ institutionId: ctx.institution }); };

  // The student approved at bKash, then closed the tab. No callback ever came.
  const closed = checkoutOf(await pay(ctx.token, 1000));
  bkash.approve(closed.id);
  await reconcile();
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 1000);
  await reconcile();
  assert.strictEqual((await ctx.ledger()).payments.length, 1, "repeat runs change nothing");

  // A student who has not approved is left alone, and stays open.
  const waiting = checkoutOf(await pay(ctx.token, 500));
  await reconcile();
  assert.strictEqual((await transactions(ctx))[0].status, "Initiated");
  bkash.approve(waiting.id);
  await callback(waiting.payment, "success");

  // bKash took the money but its answer to execute was lost. The query decides.
  bkash.state.executeLosesAnswer = true;
  const lost = checkoutOf(await pay(ctx.token, 500));
  bkash.approve(lost.id);
  await callback(lost.payment, "success");
  bkash.state.executeLosesAnswer = false;
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 2000);

  // bKash is fully down: nothing changes, then it is settled later.
  const down = checkoutOf(await pay(ctx.token, 1000));
  bkash.approve(down.id);
  bkash.state.executeDown = true;
  bkash.state.queryDown = true;
  await callback(down.payment, "success");
  await reconcile();
  assert.strictEqual((await transactions(ctx))[0].status, "Initiated");
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 2000);
  bkash.state.executeDown = false;
  bkash.state.queryDown = false;
  await reconcile();
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 3000);

  // The scheduled job reaches the same logic.
  const viaJob = checkoutOf(await pay(ctx.token, 500));
  bkash.approve(viaJob.id);
  await force();
  await runRentCycle();
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 3500);
  const jobs = await listJobStatus();
  assert.ok(jobs.find((job) => job.job === "payment-reconciliation").finishedAt);
  assert.strictEqual(jobs.length, 6);

  // A long-abandoned checkout is closed, with no money moved.
  const old = checkoutOf(await pay(ctx.token, 500));
  await postgresService.query("UPDATE hostel_gateway_transactions SET created_at = NOW() - INTERVAL '49 hours' WHERE gateway_payment_id = $1", [old.id]);
  await reconcile();
  const row = (await transactions(ctx)).find((item) => item.status === "Expired");
  assert.ok(row, "an old checkout expires");
}));

test("answers that do not match are held for review, not applied", live(async () => {
  const ctx = await setup();

  bkash.state.forceAmount = "1.00";
  const wrong = checkoutOf(await pay(ctx.token, 5000));
  bkash.approve(wrong.id);
  await callback(wrong.payment, "success");
  bkash.state.forceAmount = null;
  const [row] = await transactions(ctx);
  assert.strictEqual(row.status, "Review");
  assert.match(row.reviewReason, /requested/);
  assert.strictEqual((await ctx.ledger()).payments.length, 0);
  await waitFor(() => mailsTo("admin@example.com").find((item) => /needs review/.test(item.text)), "admin alert");

  // Money taken beyond what is owed, because a manual payment landed first.
  const open = checkoutOf(await pay(ctx.token, 5000));
  bkash.approve(open.id);
  const manual = await ctx.call("POST", `/hostel/invoices/${ctx.invoice.id}/payments`, { amount: 5000, paymentDate: today(), method: "Cash" });
  assert.strictEqual(manual.status, 201, manual.error);
  await callback(open.payment, "success");
  const [late] = await transactions(ctx);
  assert.strictEqual(late.status, "Review");
  assert.match(late.reviewReason, /refund/);
  assert.strictEqual((await ctx.ledger()).invoices[0].paidAmount, 5000, "not paid twice");
  assert.strictEqual((await ctx.call("POST", `/hostel/gateway/transactions/${late.id}/verify`)).status, 409);
}));

test("a transaction ID already used cannot be applied again", live(async () => {
  const ctx = await setup({ partial: true });
  const first = await approveAndReturn(ctx.token, 1000);
  const second = checkoutOf(await pay(ctx.token, 1000));
  const fake = bkash.state.payments.get(second.id);
  fake.status = "Completed";
  fake.trx = first.payment.trx;
  await callback(second.payment, "cancel");
  const [row] = await transactions(ctx);
  assert.strictEqual(row.status, "Review");
  assert.match(row.reviewReason, /already/);
  assert.strictEqual((await ctx.ledger()).payments.length, 1);
}));

test("amount rules: partial, overpayment, settled, and open checkouts", live(async () => {
  const fullOnly = await setup();
  const refused = await pay(fullOnly.token, 2000);
  assert.strictEqual(refused.status, 400);
  assert.match(refused.error, /Part payment is not enabled/);

  const ctx = await setup({ partial: true });
  assert.strictEqual((await pay(ctx.token, 6000)).status, 400, "more than owed");
  assert.strictEqual((await pay(ctx.token, 0)).status, 400);
  assert.strictEqual((await pay(ctx.token, -5)).status, 400);
  assert.strictEqual((await pay(ctx.token, "abc")).status, 400);
  assert.strictEqual((await pay(ctx.token, 10.555)).status, 400);

  await approveAndReturn(ctx.token, 2000);
  const [invoice] = (await ctx.ledger()).invoices;
  assert.strictEqual(invoice.status, "Partially Paid");
  assert.strictEqual(invoice.paidAmount, 2000);
  assert.strictEqual(invoice.outstandingAmount, 3000);
  await waitFor(() => mailsTo(ctx.allocation.studentEmail).find((item) => /Part payment received/.test(item.text)), "part payment email");

  // A second tab cannot start a payment that, with the first, would overpay.
  const open = await pay(ctx.token, 2000);
  assert.strictEqual(open.status, 200);
  const clash = await pay(ctx.token, 2000);
  assert.strictEqual(clash.data.checkoutUrl, open.data.checkoutUrl, "the same amount continues the same checkout");
  const overlap = await pay(ctx.token, 1500);
  assert.strictEqual(overlap.status, 409);
  assert.match(overlap.error, /in progress/);

  // bKash being down leaves no open hold behind.
  const third = await setup();
  bkash.state.createDown = true;
  assert.strictEqual((await pay(third.token, 5000)).status, 503);
  bkash.state.createDown = false;
  assert.strictEqual((await transactions(third))[0].status, "Failed");
  assert.strictEqual((await pay(third.token, 5000)).status, 200);
}));

test("payment links expose little and fail safely", live(async () => {
  const ctx = await setup();

  for (const bad of ["short", "x".repeat(43), "' OR 1=1 --".padEnd(43, "-")]) {
    const res = await publicCall("GET", `/pay/${encodeURIComponent(bad)}`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.error, "This payment link is not valid.");
    assert.strictEqual((await pay(encodeURIComponent(bad), 5000)).status, 404);
  }

  const page = await publicCall("GET", `/pay/${ctx.token}`);
  const body = JSON.stringify(page.data);
  ["1234567890123", "01711111111", "01722222222", "Guardian", ctx.allocation.studentEmail, ctx.allocation.id, ctx.invoice.id].forEach((value) =>
    assert.ok(!body.includes(value), `the page must not show ${value}`)
  );

  // Only a hash is stored.
  const { rows } = await postgresService.query("SELECT token_hash FROM hostel_payment_links WHERE institution_id = $1", [ctx.institution]);
  assert.ok(rows.every((row) => row.token_hash !== ctx.token));

  // Another student's receipt cannot be opened with this link.
  const other = await setup();
  const paid = await approveAndReturn(other.token, 5000);
  const otherPayment = (await other.ledger()).payments[0];
  assert.strictEqual((await publicCall("GET", `/pay/${ctx.token}/receipts/${otherPayment.id}`)).status, 404);
  const own = await fetch(`${baseUrl}/public/hostel/pay/${other.token}/receipts/${otherPayment.id}`);
  assert.strictEqual(own.status, 200);
  assert.ok(paid);

  // Another student's invoice cannot be paid with this link.
  const crossed = await publicCall("POST", `/pay/${ctx.token}/bkash`, { amount: 5000, invoiceNumber: other.invoice.invoiceNumber });
  assert.strictEqual(crossed.status, 404);

  // An expired link stops working, and a new one goes only to the address on file.
  await postgresService.query("UPDATE hostel_payment_links SET expires_at = NOW() - INTERVAL '1 hour' WHERE institution_id = $1", [ctx.institution]);
  assert.strictEqual((await publicCall("GET", `/pay/${ctx.token}`)).status, 410);
  assert.strictEqual((await pay(ctx.token, 5000)).status, 410);
  smtp.state.messages.length = 0;
  const renew = await publicCall("POST", `/pay/${ctx.token}/renew`);
  assert.strictEqual(renew.status, 200);
  assert.ok(!JSON.stringify(renew.data).includes("@"), "the address is not revealed");
  const mail = await waitFor(() => mailsTo(ctx.allocation.studentEmail)[0], "new link email");
  const fresh = /http:\/\/app\.test\/hostel\/payment\/([\w-]{43})/.exec(mail.text)[1];
  assert.notStrictEqual(fresh, ctx.token);
  assert.strictEqual((await publicCall("GET", `/pay/${fresh}`)).status, 200);
  await publicCall("POST", `/pay/${ctx.token}/renew`);
  assert.strictEqual(mailsTo(ctx.allocation.studentEmail).length, 1, "at most one new link a day");
}));

test("a link cannot be used when bKash is off, and the API needs a login", live(async () => {
  const ctx = await setup({ gateway: false });
  assert.strictEqual((await publicCall("GET", `/pay/${ctx.token}`)).data.online.bkash, false);
  assert.strictEqual((await pay(ctx.token, 5000)).status, 409);

  for (const [method, path] of [
    ["GET", "/hostel/gateway/config"],
    ["PUT", "/hostel/gateway/config"],
    ["POST", "/hostel/gateway/test"],
    ["PUT", "/hostel/payment-methods/Cash"],
    ["GET", "/hostel/jobs"],
    ["POST", "/hostel/email/test"],
  ]) {
    const body = method === "GET" ? undefined : {};
    assert.strictEqual((await ctx.call(method, path, body, "TEACHER")).status, 403, `${method} ${path} teacher`);
    assert.strictEqual((await ctx.call(method, path, body, "HOSTEL_WARDEN")).status, 403, `${method} ${path} warden`);
    assert.strictEqual((await ctx.call(method, path, body, null)).status, 401, `${method} ${path} no login`);
  }
  assert.strictEqual((await ctx.call("GET", "/hostel/rent/dashboard", undefined, "HOSTEL_WARDEN")).status, 200);
  assert.strictEqual((await ctx.call("GET", "/hostel/rent/dashboard", undefined, "TEACHER")).status, 403);
  assert.strictEqual((await ctx.call("POST", `/hostel/invoices/${ctx.invoice.id}/payment-link`, {}, "TEACHER")).status, 403);

  const other = newClient();
  assert.strictEqual((await other.call("POST", `/hostel/invoices/${ctx.invoice.id}/payment-link`)).status, 404, "another institution");
}));

test("email: student address, full details, HTML, link and failures", live(async () => {
  // The worked example: 5000 rent, 2000 still owed from before, 1000 paid. 6000 remains.
  const lastMonth = new Date(Date.parse(`${today().slice(0, 7)}-15T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 7);
  const ctx = await setup({ partial: true, change: { startDate: `${lastMonth}-01`, firstDueDate: `${lastMonth}-20` } });
  const { invoices } = await ctx.ledger();
  const [current, previous] = invoices;
  assert.ok(previous, "two months billed");
  await ctx.call("POST", `/hostel/invoices/${previous.id}/payments`, { amount: 3000, paymentDate: today(), method: "Cash", transactionReference: `C${Date.now()}` });
  await ctx.call("POST", `/hostel/invoices/${current.id}/payments`, { amount: 1000, paymentDate: today(), method: "Cash", transactionReference: `D${Date.now()}` });
  const after = await ctx.ledger();
  assert.strictEqual(after.totalOutstanding, 6000, "outstanding across months");
  await new Promise((resolve) => setTimeout(resolve, 500)); // Lets the payment confirmations finish.
  smtp.state.messages.length = 0;
  await postgresService.query("DELETE FROM hostel_notifications WHERE institution_id = $1", [ctx.institution]);

  assert.strictEqual((await queueNewInvoices(ctx.institution)).queued, 2, "one per channel");
  assert.strictEqual((await queueNewInvoices(ctx.institution)).queued, 0, "never twice");
  await deliverPending({ institutionId: ctx.institution });

  const mail = mailsTo(ctx.allocation.studentEmail).find((item) => /rent invoice for/.test(item.text));
  assert.ok(mail, "sent to the student's own address");
  assert.ok(!mailsTo("admin@example.com").length);
  assert.match(mail.text, /text\/html/);
  [ctx.allocation.studentName, ctx.allocation.studentId, "North", "Monthly Rent", "Previous Outstanding Balance",
    "BDT 2,000", "BDT 7,000", "BDT 1,000", "BDT 6,000", "Payment Due Date", "North Hostel"].forEach((text) =>
    assert.ok(mail.text.includes(text), `email has ${text}`)
  );
  const link = /http:\/\/app\.test\/hostel\/payment\/([\w-]{43})/.exec(mail.text);
  assert.ok(link, "a working pay link");
  assert.strictEqual((await publicCall("GET", `/pay/${link[1]}`)).status, 200);
  assert.ok(smtp.state.logins.length > 0, "it logged in");

  // The log never holds a working link or the SMTP password.
  const log = JSON.stringify((await ctx.call("GET", "/hostel/notifications")).data);
  assert.ok(!log.includes(link[1]));
  assert.ok(!log.includes("smtp-pass-value"));
  assert.ok(JSON.parse(log).some((row) => row.channel === "EMAIL" && row.recipient === ctx.allocation.studentEmail && row.status === "Sent" && row.sentAt && row.invoiceId));
}));

test("email: paid students get no reminder, and failures are honest", live(async () => {
  const ctx = await setup();
  const run = (date) => queueDueReminders(ctx.institution, { today: date, ignoreHour: true });
  const due = ctx.invoice.dueDate;

  // Default schedule: 7, 3 and 1 days before, on the day, then overdue every 3 days.
  const defaults = (await ctx.call("GET", "/hostel/rent/config")).data.settings;
  assert.deepStrictEqual(defaults.reminderDaysBefore, [7, 3, 1]);
  assert.strictEqual(defaults.overdueIntervalDays, 3);

  assert.strictEqual((await run(shiftDays(due, -3))).queued, 2);
  await run(shiftDays(due, -1));
  const scenarios = (await ctx.call("GET", "/hostel/notifications")).data.map((row) => row.scenario);
  assert.ok(scenarios.includes("FINAL_REMINDER"));
  assert.ok(scenarios.includes("UPCOMING"));

  // Paid after the reminder was queued, before it was sent.
  await postgresService.query("UPDATE hostel_notifications SET status = 'Pending', next_attempt_at = NOW() + INTERVAL '1 hour' WHERE institution_id = $1", [ctx.institution]);
  const paid = await ctx.call("POST", `/hostel/invoices/${ctx.invoice.id}/payments`, { amount: 5000, paymentDate: today(), method: "Cash" });
  assert.strictEqual(paid.status, 201, paid.error);
  await waitFor(() => mailsTo(ctx.allocation.studentEmail).find((item) => /payment received/i.test(item.text)), "confirmation");
  await postgresService.query("UPDATE hostel_notifications SET next_attempt_at = NOW() WHERE institution_id = $1 AND status = 'Pending'", [ctx.institution]);
  smtp.state.messages.length = 0;
  await deliverPending({ institutionId: ctx.institution });
  const reminders = smtp.state.messages.filter((mail) => !/seat is confirmed/.test(decodeMail(mail.raw)));
  assert.strictEqual(reminders.length, 0, "no reminder after payment");
  const skipped = (await ctx.call("GET", "/hostel/notifications")).data.filter((row) => row.scenario === "UPCOMING");
  assert.ok(skipped.every((row) => row.status === "Skipped" && /Already paid/.test(row.lastError)));
  assert.strictEqual((await run(shiftDays(due, 1))).queued, 0, "nothing overdue");

  // A bad address fails at once. A server outage is retried.
  const bounce = await setup({ change: { studentEmail: "bounce@example.com" } });
  await bounce.call("POST", `/hostel/notifications/remind/${bounce.allocation.id}`);
  const rejected = (await bounce.call("GET", "/hostel/notifications")).data.find((row) => row.channel === "EMAIL");
  assert.strictEqual(rejected.status, "Failed");
  assert.strictEqual(rejected.attempts, 1, "not retried");
  assert.ok(rejected.lastError);

  const outage = await setup();
  smtp.state.down = true;
  await outage.call("POST", `/hostel/notifications/remind/${outage.allocation.id}`);
  const waiting = (await outage.call("GET", "/hostel/notifications")).data.find((row) => row.channel === "EMAIL");
  assert.strictEqual(waiting.status, "Pending", "kept for a retry");
  assert.ok(waiting.lastError);
  smtp.state.down = false;
  await postgresService.query("UPDATE hostel_notifications SET next_attempt_at = NOW() WHERE institution_id = $1 AND status = 'Pending'", [outage.institution]);
  await deliverPending({ institutionId: outage.institution });
  assert.strictEqual((await outage.call("GET", "/hostel/notifications")).data.find((row) => row.channel === "EMAIL").status, "Sent");

  // Without settings, nothing claims to be sent.
  const saved = process.env.EMAIL_USER;
  delete process.env.EMAIL_USER;
  const unset = await setup();
  await unset.call("POST", `/hostel/notifications/remind/${unset.allocation.id}`);
  const row = (await unset.call("GET", "/hostel/notifications")).data.find((item) => item.channel === "EMAIL");
  assert.strictEqual(row.status, "Skipped");
  assert.match(row.lastError, /not configured/);
  assert.strictEqual((await unset.call("POST", "/hostel/email/test", {})).status, 503);
  process.env.EMAIL_USER = saved;

  // The test email reports the server's answer.
  const sent = await unset.call("POST", "/hostel/email/test", {});
  assert.strictEqual(sent.status, 200, sent.error);
  assert.strictEqual(sent.data.to, "admin@example.com");
  const refused = await unset.call("POST", "/hostel/email/test", { to: "bounce@example.com" });
  assert.strictEqual(refused.status, 502);
}));

test("receipts for staff, payment methods, and the dashboard", live(async () => {
  const ctx = await setup({ partial: true });
  const { payment } = await approveAndReturn(ctx.token, 2000);
  const [saved] = (await ctx.ledger()).payments;

  const pdf = await ctx.call("GET", `/hostel/payments/${saved.id}/receipt-pdf`);
  assert.strictEqual(Buffer.from(pdf.data.contentBase64, "base64").subarray(0, 4).toString(), "%PDF");
  assert.strictEqual(pdf.data.fileName, `${saved.receiptNumber}.pdf`);
  assert.strictEqual((await ctx.call("GET", `/hostel/payments/${saved.id}/receipt-pdf`, undefined, "TEACHER")).status, 403);

  smtp.state.messages.length = 0;
  const emailed = await ctx.call("POST", `/hostel/payments/${saved.id}/email-receipt`);
  assert.strictEqual(emailed.data.status, "Sent", emailed.data.error);
  assert.match(mailsTo(ctx.allocation.studentEmail)[0].text, /application\/pdf/);

  // A reversal returns the money to the balance, and the trx cannot be reused by hand.
  const reused = await ctx.call("POST", `/hostel/invoices/${ctx.invoice.id}/payments`, { amount: 100, paymentDate: today(), method: "Cash", transactionReference: payment.trx });
  assert.strictEqual(reused.status, 409);

  // Disabled methods cannot be used for manual entries.
  const off = await ctx.call("PUT", "/hostel/payment-methods/Rocket", { enabled: false });
  assert.strictEqual(off.status, 200, off.error);
  const methods = (await ctx.call("GET", "/hostel/payment-methods")).data;
  assert.strictEqual(methods.find((item) => item.method === "Rocket").enabled, false);
  assert.strictEqual(methods.find((item) => item.method === "Cash").enabled, true);
  const refused = await ctx.call("POST", `/hostel/invoices/${ctx.invoice.id}/payments`, { amount: 100, paymentDate: today(), method: "Rocket" });
  assert.strictEqual(refused.status, 400);
  assert.match(refused.error, /disabled/);

  // A second student who has not paid, and a failed online attempt.
  const second = await ctx.call("POST", "/hostel/allocations", {
    seatId: ctx.seats[1].id, studentId: "ST-TWO", studentName: "Two", studentPhone: "01711111112", studentEmail: "two@example.com",
    guardianName: "G", guardianPhone: "01722222223", monthlyRent: 3000, startDate: `${today().slice(0, 7)}-01`, firstDueDate: shiftDays(today(), -1),
  });
  assert.strictEqual(second.status, 201, second.error);
  const failed = checkoutOf(await pay(ctx.token, 500));
  await callback(failed.payment, "failure");

  const data = (await ctx.call("GET", "/hostel/rent/dashboard")).data;
  assert.strictEqual(data.activeStudents, 2);
  assert.strictEqual(data.expected, 8000);
  assert.strictEqual(data.collected, 2000);
  assert.strictEqual(data.outstanding, 6000);
  assert.strictEqual(data.overdue, 3000);
  assert.strictEqual(data.partialStudents, 1);
  assert.strictEqual(data.unpaidStudents, 1);
  assert.strictEqual(data.paidStudents, 0);
  assert.strictEqual(data.overdueStudents, 1);
  assert.strictEqual(data.onlineSuccessful, 1);
  assert.strictEqual(data.onlineFailed, 1);

  const byStatus = (await ctx.call("GET", "/hostel/rent/dashboard?status=Overdue")).data;
  assert.strictEqual(byStatus.expected, 3000);
  const byMethod = (await ctx.call("GET", "/hostel/rent/dashboard?method=bKash")).data;
  assert.strictEqual(byMethod.collected, 2000);
  assert.strictEqual(byMethod.expected, 5000);
  const noMatch = (await ctx.call("GET", "/hostel/rent/dashboard?method=Cash")).data;
  assert.strictEqual(noMatch.collected, 0);
  const byMonth = (await ctx.call("GET", "/hostel/rent/dashboard?month=2020-01")).data;
  assert.strictEqual(byMonth.expected, 0);
}));
