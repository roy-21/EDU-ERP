// Needs PostgreSQL. Role hierarchy, guardian portal, meal refunds, per-institution
// settings, grading and tables, maintenance mode and subscription billing.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { generateSubscriptionInvoices } = require("../dist/modules/identity/billing.service");
const { createClient, ensureUser, live, removeInstitutions } = require("./hostel-helpers");

let server;
let baseUrl;
const clients = [];
let counter = 0;

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

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

const request = async (method, path, body, token) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, data: json.data, error: json.error };
};

// A user with a known password, so the test can sign in as them.
const accountWithPassword = async (ctx, body) => {
  const made = await ctx.call("POST", "/system/users", body);
  assert.strictEqual(made.status, 201, made.error);
  await postgresService.query("UPDATE erp_users SET password_hash = $2, must_change_password = FALSE WHERE id = $1", [made.data.user.id, await bcrypt.hash("Known-pass-1", 4)]);
  const login = await request("POST", "/auth/login", { username: made.data.user.username, password: "Known-pass-1" });
  assert.strictEqual(login.status, 200, login.error);
  return { user: made.data.user, token: login.data.token };
};

const hostelSetup = async (ctx) => {
  counter += 1;
  const room = await ctx.call("POST", "/hostel/rooms", { hostelName: "West", building: `W${counter}`, floor: "1", roomNumber: `W${counter}`, capacity: 3 });
  const { seats } = (await ctx.call("GET", `/hostel/rooms/${room.data.id}`)).data;
  const allocate = async (seat, studentId) => {
    const res = await ctx.call("POST", "/hostel/allocations", {
      seatId: seat.id, studentId, studentName: `Name ${studentId}`, studentPhone: "01711111111",
      guardianName: "Guardian", guardianPhone: "01722222222", monthlyRent: 3000,
      startDate: `${today().slice(0, 7)}-01`, firstDueDate: today(),
    });
    assert.strictEqual(res.status, 201, res.error);
    return res.data;
  };
  return { seats, allocate };
};

// ---- Role hierarchy ------------------------------------------------------------

test("role hierarchy: a role inherits from its parent, changes flow down, no loops", live(async () => {
  const ctx = tenant();
  const base = await ctx.call("POST", "/system/roles", { name: "Desk Base", permissionKeys: ["hostel.view_rooms"] });
  const senior = await ctx.call("POST", "/system/roles", { name: "Desk Senior", permissionKeys: ["hostel.manage_visitors"], parentRoleId: base.data.id });
  assert.strictEqual(senior.status, 201, senior.error);
  assert.deepStrictEqual(senior.data.effectiveKeys, ["hostel.manage_visitors", "hostel.view_rooms"]);
  assert.deepStrictEqual(senior.data.inheritedKeys, ["hostel.view_rooms"]);

  const asSenior = (method, path) => ctx.call(method, path, undefined, senior.data.id);
  assert.strictEqual((await asSenior("GET", "/hostel/rooms")).status, 200, "inherited");
  assert.strictEqual((await asSenior("GET", "/hostel/meals")).status, 403);
  await ctx.call("PUT", `/system/roles/${base.data.id}`, { permissionKeys: ["hostel.view_rooms", "hostel.manage_meals"] });
  assert.strictEqual((await asSenior("GET", "/hostel/meals")).status, 200, "a parent's change reaches the child at once");

  assert.strictEqual((await ctx.call("PUT", `/system/roles/${base.data.id}`, { parentRoleId: senior.data.id })).status, 409, "no loops");
  assert.strictEqual((await ctx.call("PUT", `/system/roles/${base.data.id}`, { parentRoleId: base.data.id })).status, 409);
  assert.strictEqual((await ctx.call("POST", "/system/roles", { name: "Bad", parentRoleId: "ADMIN" })).status, 400, "cannot build on admin");
  assert.strictEqual((await ctx.call("DELETE", `/system/roles/${base.data.id}`)).status, 409, "a parent cannot be deleted");

  // Built on a built-in staff role.
  const night = await ctx.call("POST", "/system/roles", { name: "Night Warden", permissionKeys: ["hostel.manage_fees"], parentRoleId: "HOSTEL_WARDEN" });
  assert.strictEqual(night.status, 201, night.error);
  assert.ok(night.data.effectiveKeys.includes("hostel.manage_visitors") && night.data.effectiveKeys.includes("hostel.manage_fees"));
  assert.strictEqual((await ctx.call("GET", "/hostel/visitors", undefined, night.data.id)).status, 200);

  // A limited manager cannot give a role a parent stronger than themselves.
  const manager = await ctx.call("POST", "/system/roles", { name: "Role Clerk", permissionKeys: ["system.manage_roles", "hostel.view_rooms"] });
  assert.strictEqual((await ctx.call("POST", "/system/roles", { name: "Sneaky", parentRoleId: "HOSTEL_WARDEN" }, manager.data.id)).status, 403);
  assert.strictEqual((await ctx.call("POST", "/system/roles", { name: "Okay", parentRoleId: base.data.id }, manager.data.id)).status, 403, "base now holds manage_meals");
}));

// ---- Guardian portal -------------------------------------------------------------

test("guardian portal: sees only linked students, can pay, cannot order", live(async () => {
  const ctx = tenant();
  const hostel = await hostelSetup(ctx);
  const ward = await hostel.allocate(hostel.seats[0], "GW-1");
  const stranger = await hostel.allocate(hostel.seats[1], "GW-2");
  const { user, token } = await accountWithPassword(ctx, { fullName: "Father Karim", email: `f${randomUUID().slice(0, 6)}@example.com`, role: "GUARDIAN" });
  const as = (method, path, body) => request(method, path, body, token);

  assert.strictEqual((await as("GET", "/portal/invoices")).status, 404, "no ward linked yet");
  assert.strictEqual((await ctx.call("PUT", `/system/users/${user.id}/wards`, { wards: [{ studentId: "NOPE" }] })).status, 400);
  const linked = await ctx.call("PUT", `/system/users/${user.id}/wards`, { wards: [{ studentId: "GW-1", relationship: "Father" }] });
  assert.strictEqual(linked.status, 200, linked.error);

  const me = (await as("GET", "/portal/me")).data;
  assert.strictEqual(me.isGuardian, true);
  assert.deepStrictEqual(me.wards.map((item) => item.studentId), ["GW-1"]);
  assert.strictEqual(me.hostel.allocationId, ward.id);
  const bills = (await as("GET", "/portal/invoices")).data.invoices;
  assert.ok(bills.length > 0 && bills.every((item) => item.allocationId === ward.id));
  assert.strictEqual((await as("GET", "/portal/invoices?student=GW-2")).status, 404, "not someone else's child");
  const theirs = (await ctx.call("GET", `/hostel/ledger/${stranger.id}`)).data.invoices[0];
  assert.strictEqual((await as("POST", `/portal/invoices/${theirs.id}/pay`)).status, 404);
  assert.strictEqual((await as("POST", `/portal/invoices/${bills[0].id}/pay`)).status, 200, "a guardian can pay");

  const meal = await ctx.call("POST", "/hostel/meals", {
    title: "Supper", mealType: "Dinner", mealDate: today(), menuItems: ["Rice"], pricePerMeal: 50,
    bookingOpensAt: inMinutes(-5), bookingClosesAt: inMinutes(60), collectFrom: inMinutes(90), collectUntil: inMinutes(180),
  });
  await ctx.call("POST", `/hostel/meals/${meal.data.meal.id}/publish`);
  assert.strictEqual((await as("GET", "/portal/meals")).data.canBook, false);
  assert.strictEqual((await as("POST", `/portal/meals/${meal.data.meal.id}/book`, { quantity: 1 })).status, 403, "only the student orders");
  assert.strictEqual((await ctx.call("PUT", `/system/users/${user.id}/wards`, { wards: [] })).status, 200);
  assert.strictEqual((await as("GET", "/portal/invoices")).status, 404, "unlinking takes effect at once");
  assert.strictEqual((await ctx.call("GET", `/system/users/${user.id}/wards`, undefined, "STAFF")).status, 403);
}));

// ---- Refunds ---------------------------------------------------------------------

test("a paid order on a cancelled meal becomes a refund that balances the books when paid", live(async () => {
  const ctx = tenant();
  const hostel = await hostelSetup(ctx);
  const student = await hostel.allocate(hostel.seats[0], "RF-1");
  const meal = await ctx.call("POST", "/hostel/meals", {
    title: "Feast", mealType: "Special Meal", mealDate: today(), menuItems: ["Biryani"], pricePerMeal: 200,
    bookingOpensAt: inMinutes(-5), bookingClosesAt: inMinutes(60), collectFrom: inMinutes(90), collectUntil: inMinutes(180),
  });
  const mealId = meal.data.meal.id;
  await ctx.call("POST", `/hostel/meals/${mealId}/publish`);
  const order = await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: student.id, quantity: 2 });
  const invoiceId = (await ctx.call("GET", `/hostel/ledger/${student.id}`)).data.invoices.find((item) => item.category === "MEAL").id;
  const paid = await ctx.call("POST", `/hostel/invoices/${invoiceId}/payments`, { amount: 400, paymentDate: today(), method: "Cash" });
  assert.strictEqual(paid.status, 201, paid.error);

  const cancelled = await ctx.call("POST", `/hostel/meals/${mealId}/cancel`, { reason: "Gas leak" });
  assert.strictEqual(cancelled.data.needsRefund[0].paid, 400);
  const [refund] = (await ctx.call("GET", "/hostel/refunds?status=DUE")).data;
  assert.strictEqual(refund.amount, 400);
  assert.strictEqual(refund.studentId, "RF-1");

  assert.strictEqual((await ctx.call("POST", `/hostel/refunds/${refund.id}/pay`, { method: "bKash" })).status, 400, "a reference is needed");
  assert.strictEqual((await ctx.call("POST", `/hostel/refunds/${refund.id}/pay`, { method: "Cash" }, "TEACHER")).status, 403);
  const done = await ctx.call("POST", `/hostel/refunds/${refund.id}/pay`, { method: "bKash", reference: "TRX-REFUND-1" });
  assert.strictEqual(done.status, 200, done.error);
  assert.strictEqual(done.data.status, "PAID");
  assert.strictEqual((await ctx.call("POST", `/hostel/refunds/${refund.id}/pay`, { method: "Cash" })).status, 409, "only once");

  const invoice = (await ctx.call("GET", `/hostel/ledger/${student.id}`)).data.invoices.find((item) => item.id === invoiceId);
  assert.strictEqual(invoice.paidAmount, 0, "the collected money is reversed");
  assert.strictEqual(invoice.outstandingAmount, 0, "and nothing is owed");
  assert.strictEqual((await ctx.call("GET", "/hostel/refunds", undefined, "TEACHER")).status, 403);
  assert.ok(order.data.id);
}));

// ---- Settings, grading, tables ---------------------------------------------------

test("settings are per institution, checked, and never store credentials", live(async () => {
  const a = tenant();
  const b = tenant();
  const saved = await a.call("PUT", "/settings/general", { systemName: "North ERP", supportEmail: "Help@North.edu", maintenanceMode: false });
  assert.strictEqual(saved.status, 200, saved.error);
  assert.strictEqual((await a.call("GET", "/settings/general")).data.supportEmail, "help@north.edu");
  assert.deepStrictEqual((await b.call("GET", "/settings/general")).data, {}, "another institution is untouched");
  assert.strictEqual((await a.call("PUT", "/settings/general", { hacker: 1 })).status, 400);
  assert.strictEqual((await a.call("PUT", "/settings/branding", { primaryColor: "red" })).status, 400);
  assert.strictEqual((await a.call("PUT", "/settings/smtp", { password: "secret" })).status, 409, "no credentials through settings");
  assert.strictEqual((await a.call("GET", "/settings/smtp")).data.managedElsewhere, true);
  assert.strictEqual((await a.call("PUT", "/settings/general", { systemName: "x" }, "TEACHER")).status, 403);
  const logo = { fileName: "logo.png", contentBase64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)]).toString("base64") };
  assert.strictEqual((await a.call("PUT", "/settings/logo", { logo })).status, 200);
  assert.strictEqual((await a.call("PUT", "/settings/logo", { logo: { fileName: "x.png", contentBase64: Buffer.from("<svg>").toString("base64") } })).status, 400);

  // Grading: overlapping ranges are refused; each institution keeps its own.
  const grading = (await a.call("GET", "/system/grading-config")).data;
  assert.strictEqual(grading.gradeRanges.length, 9, "starts from the standard scale");
  const overlap = [...grading.gradeRanges];
  overlap[1] = { ...overlap[1], maxMark: 85 };
  assert.strictEqual((await a.call("PUT", "/system/grading-config", { gradeRanges: overlap })).status, 400);
  const changed = await a.call("PUT", "/system/grading-config", { passMarks: 33 });
  assert.strictEqual(changed.status, 200, changed.error);
  assert.strictEqual((await a.call("GET", "/system/grading-config")).data.passMarks, 33);
  assert.strictEqual((await b.call("GET", "/system/grading-config")).data.passMarks, 40);

  // Tables: one primary key, real links, saved by key.
  const columns = [{ name: "id", type: "UUID", isPrimaryKey: true }, { name: "title", type: "String" }];
  assert.strictEqual((await a.call("POST", "/system/tables/schema", { tableName: "Books", columns: [{ name: "id", type: "UUID" }] })).status, 400);
  assert.strictEqual((await a.call("POST", "/system/tables/schema", { tableName: "Books", columns })).status, 201);
  assert.strictEqual((await a.call("POST", "/system/tables/schema", { tableName: "Loans", columns: [...columns, { name: "book", type: "UUID", isForeignKey: true, fkTable: "ghosts" }] })).status, 400);
  assert.strictEqual((await a.call("POST", "/system/tables/schema", { tableName: "Loans", columns: [...columns, { name: "book", type: "UUID", isForeignKey: true, fkTable: "books", fkColumn: "id" }] })).status, 201);
  assert.strictEqual((await a.call("POST", "/system/tables/schema", { tableName: "Books", columns: [...columns, { name: "isbn", type: "String" }] })).data.columns.length, 3, "saving again updates");
  assert.strictEqual((await a.call("GET", "/system/tables")).data.length, 2);
  assert.strictEqual((await b.call("GET", "/system/tables")).data.length, 0);
  assert.strictEqual((await a.call("DELETE", "/system/tables/books")).status, 409, "linked from loans");
}));

test("maintenance mode lets only admins in", live(async () => {
  const ctx = tenant();
  const { token } = await accountWithPassword(ctx, { fullName: "Desk Staff", email: `m${randomUUID().slice(0, 6)}@example.com`, role: "STAFF" });
  assert.strictEqual((await request("GET", "/auth/me", undefined, token)).status, 200);
  await ctx.call("PUT", "/settings/general", { maintenanceMode: true });
  assert.strictEqual((await request("GET", "/auth/me", undefined, token)).status, 503);
  assert.strictEqual((await ctx.call("GET", "/auth/me")).status, 200, "admins still work");
  await ctx.call("PUT", "/settings/general", { maintenanceMode: false });
  assert.strictEqual((await request("GET", "/auth/me", undefined, token)).status, 200);
}));

// ---- Subscription billing -----------------------------------------------------------

test("subscription billing: priced modules, once per period, payments and void", live(async () => {
  const ctx = tenant();
  const platform = tenant();
  await ensureUser("ADMIN", ctx.institution);
  await postgresService.query("UPDATE erp_tenant_modules SET monthly_price = CASE WHEN module_id = 'hostel' THEN 2500 WHEN module_id = 'library' THEN 800 ELSE 0 END WHERE tenant_id = $1", [ctx.institution]);

  assert.strictEqual((await generateSubscriptionInvoices({ tenantId: ctx.institution })).created, 0, "billing is off until turned on");
  assert.strictEqual((await ctx.call("POST", `/platform/tenants/${ctx.institution}/billing`, { enabled: true })).status, 403);
  const enabled = await platform.call("POST", `/platform/tenants/${ctx.institution}/billing`, { enabled: true }, "SUPER_ADMIN");
  assert.strictEqual(enabled.status, 200, enabled.error);
  const first = await generateSubscriptionInvoices({ tenantId: ctx.institution });
  assert.deepStrictEqual(first, { created: 1, errors: [] });
  assert.strictEqual((await generateSubscriptionInvoices({ tenantId: ctx.institution })).created, 0, "never twice");

  const [invoice] = (await platform.call("GET", `/platform/billing?tenantId=${ctx.institution}`, undefined, "SUPER_ADMIN")).data;
  assert.strictEqual(invoice.amount, 3300);
  assert.deepStrictEqual(invoice.lines.map((line) => line.moduleId).sort(), ["hostel", "library"]);
  assert.strictEqual(invoice.periodStart, `${new Date().toISOString().slice(0, 7)}-01`);
  // Billing turned on mid-month still gives ten days from today, never an invoice overdue at birth.
  const todayUtc = new Date().toISOString().slice(0, 10);
  assert.strictEqual(invoice.dueDate, new Date(Date.parse(`${todayUtc}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10));

  const pay = (body) => platform.call("POST", `/platform/billing/${invoice.id}/payments`, body, "SUPER_ADMIN");
  assert.strictEqual((await pay({ amount: 5000, method: "Bank Transfer", reference: "B-1" })).status, 400, "no overpaying");
  assert.strictEqual((await pay({ amount: 1000, method: "Bank Transfer", reference: "" })).status, 400);
  const part = await pay({ amount: 1300, method: "Bank Transfer", reference: `B-${randomUUID()}` });
  assert.strictEqual(part.status, 201, part.error);
  assert.strictEqual(part.data.status, "Partially Paid");
  assert.strictEqual((await platform.call("POST", `/platform/billing/${invoice.id}/void`, { reason: "Mistake" }, "SUPER_ADMIN")).status, 409, "paid invoices stay");
  const rest = await pay({ amount: 2000, method: "Cash" });
  assert.strictEqual(rest.data.status, "Paid");

  const mine = (await ctx.call("GET", "/tenant/subscription")).data.invoices;
  assert.strictEqual(mine.length, 1, "the institution sees its own invoices");
  assert.strictEqual(mine[0].status, "Paid");
  assert.strictEqual((await tenant().call("GET", "/tenant/subscription")).data.invoices.length, 0);
}));
