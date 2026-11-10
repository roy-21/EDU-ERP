// Needs PostgreSQL. Sign-in, users, roles, overrides, subscriptions, forms, features and the student portal.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");
const { decodeMail, startFakeSmtp } = require("./fake-gateways");

let server;
let baseUrl;
let smtp;
const clients = [];
const registered = [];
const savedEnv = {};
const ENV = ["EMAIL_USER", "EMAIL_PASS", "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_SECURE", "TO_EMAIL"];

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const unique = () => randomUUID().slice(0, 8);

test.before(async () => {
  ENV.forEach((key) => { savedEnv[key] = process.env[key]; delete process.env[key]; });
  await postgresService.initialize();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  smtp = await startFakeSmtp();
  Object.assign(process.env, {
    EMAIL_USER: "sender@example.com", EMAIL_PASS: "smtp-pass", EMAIL_SMTP_HOST: "127.0.0.1",
    EMAIL_SMTP_PORT: String(smtp.port), EMAIL_SMTP_SECURE: "false",
  });
});

test.after(async () => {
  if (postgresService.isLive()) await removeInstitutions([...clients.map((client) => client.institution), ...registered]);
  await smtp?.close();
  await new Promise((resolve) => server.close(resolve));
  ENV.forEach((key) => (savedEnv[key] === undefined ? delete process.env[key] : (process.env[key] = savedEnv[key])));
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
  return { status: res.status, data: json.data, error: json.error, code: json.code, details: json.details };
};

const login = (identifier, password) => request("POST", "/auth/login", { username: identifier, password });

// The temporary password only ever exists in the email.
const passwordFor = (email) => {
  const mail = [...smtp.state.messages].reverse().find((item) => item.to.some((line) => line.toLowerCase().includes(email.toLowerCase())));
  assert.ok(mail, `an email reached ${email}`);
  const match = decodeMail(mail.raw).match(/Temporary password: (\S+)/);
  assert.ok(match, "the email carries the password");
  return match[1];
};

// Creates a user, signs in with the emailed password and sets a real one.
const activeUser = async (ctx, body) => {
  const made = await ctx.call("POST", "/system/users", body);
  assert.strictEqual(made.status, 201, made.error);
  assert.strictEqual(made.data.credentials.delivered, true, made.data.credentials.reason);
  const first = await login(made.data.user.username, passwordFor(body.email));
  assert.strictEqual(first.status, 200, first.error);
  const changed = await request("POST", "/auth/change-password", { username: made.data.user.username, currentPassword: passwordFor(body.email), newPassword: "Better-pass-1" });
  assert.strictEqual(changed.status, 200, changed.error);
  return { user: made.data.user, token: changed.data.token };
};

// ---- Sign-in ----------------------------------------------------------------

test("passwords are hashed, emailed once, changed on first sign-in, and old sessions end", live(async () => {
  const ctx = tenant();
  const email = `u${unique()}@example.com`;
  const made = await ctx.call("POST", "/system/users", { fullName: "Nadia Rahman", email, role: "STAFF" });
  assert.strictEqual(made.status, 201, made.error);
  assert.ok(!JSON.stringify(made.data).includes(passwordFor(email)), "the password is never in the response");
  const stored = await postgresService.query("SELECT password_hash FROM erp_users WHERE id = $1", [made.data.user.id]);
  assert.match(stored.rows[0].password_hash, /^\$2[aby]\$12\$/);

  const temp = passwordFor(email);
  const first = await login(made.data.user.username, temp);
  assert.strictEqual(first.status, 200, first.error);
  assert.strictEqual(first.data.mustChangePassword, true);
  const blocked = await request("GET", "/hostel/rooms", undefined, first.data.token);
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.code, "PASSWORD_CHANGE_REQUIRED");

  assert.strictEqual((await request("POST", "/auth/change-password", { username: made.data.user.username, currentPassword: temp, newPassword: "short" })).status, 400);
  assert.strictEqual((await request("POST", "/auth/change-password", { username: made.data.user.username, currentPassword: "wrong", newPassword: "Better-pass-1" })).status, 401);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const changed = await request("POST", "/auth/change-password", { username: made.data.user.username, currentPassword: temp, newPassword: "Better-pass-1" });
  assert.strictEqual(changed.status, 200, changed.error);
  assert.strictEqual((await request("GET", "/auth/me", undefined, first.data.token)).status, 401, "the old session ended");
  const me = await request("GET", "/auth/me", undefined, changed.data.token);
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.data.role, "STAFF");
  assert.strictEqual((await login(made.data.user.username, temp)).status, 401, "the temporary password stops working");
  assert.strictEqual((await login(email, "Better-pass-1")).status, 200, "email works as the sign-in name too");
}));

test("five wrong passwords lock the account; disabling and Not System User block sign-in", live(async () => {
  const ctx = tenant();
  const email = `l${unique()}@example.com`;
  const { user, token } = await activeUser(ctx, { fullName: "Lock Test", email, role: "STAFF" });

  for (let i = 0; i < 5; i += 1) assert.strictEqual((await login(user.username, "Wrong-pass-9")).status, 401);
  const locked = await login(user.username, "Better-pass-1");
  assert.strictEqual(locked.status, 423, "locked even with the right password");
  assert.strictEqual((await ctx.call("GET", `/system/users/${user.id}`)).data.isLocked, true);
  await ctx.call("PUT", `/system/users/${user.id}`, { unlock: true });
  assert.strictEqual((await login(user.username, "Better-pass-1")).status, 200);

  // Disabling ends the session on the very next request.
  assert.strictEqual((await request("GET", "/auth/me", undefined, token)).status, 200);
  await ctx.call("PUT", `/system/users/${user.id}`, { status: "INACTIVE" });
  assert.strictEqual((await request("GET", "/auth/me", undefined, token)).status, 401);
  assert.strictEqual((await login(user.username, "Better-pass-1")).status, 403);

  const record = await ctx.call("POST", "/system/users", { fullName: "Guardian Only", email: `g${unique()}@example.com`, role: "NOT_SYSTEM_USER" });
  assert.strictEqual(record.status, 201, record.error);
  assert.strictEqual(record.data.user.canLogIn, false);
  assert.strictEqual(record.data.credentials.delivered, false, "no password is made or sent");
  assert.strictEqual((await ctx.call("PUT", "/system/roles/NOT_SYSTEM_USER", { permissions: [{ moduleId: "hostel", canRead: true }] })).status, 403, "protected");
  assert.strictEqual((await ctx.call("DELETE", "/system/roles/NOT_SYSTEM_USER")).status, 403);
}));

// ---- Roles and overrides ---------------------------------------------------

test("custom roles: permission tree, no granting beyond your own, and safe delete", live(async () => {
  const ctx = tenant();
  const tree = (await ctx.call("GET", "/system/permissions/tree")).data;
  const hostel = tree.find((item) => item.id === "hostel");
  assert.ok(hostel.groups.some((group) => group.permissions.some((item) => item.key === "hostel.manage_meals")));

  const manager = await ctx.call("POST", "/system/roles", {
    name: "User Manager",
    permissionKeys: ["system.manage_users", "system.manage_roles", "hostel.view_rooms"],
  });
  assert.strictEqual(manager.status, 201, manager.error);
  assert.strictEqual((await ctx.call("POST", "/system/roles", { name: "user manager" })).status, 409, "names are unique, any case");
  assert.strictEqual((await ctx.call("POST", "/system/roles", { name: "Bad", permissionKeys: ["hostel.fly"] })).status, 400);

  const asManager = (method, path, body) => ctx.call(method, path, body, manager.data.id);
  // A user manager cannot make a role or a user stronger than themselves.
  assert.strictEqual((await asManager("POST", "/system/roles", { name: "Sneaky", permissionKeys: ["hostel.configure_rent"] })).status, 403);
  assert.strictEqual((await asManager("POST", "/system/roles", { name: "Viewer", permissionKeys: ["hostel.view_rooms"] })).status, 201);
  assert.strictEqual((await asManager("POST", "/system/users", { fullName: "Boss", role: "ADMIN" })).status, 403);
  assert.strictEqual((await asManager("POST", "/system/users", { fullName: "Warden", role: "HOSTEL_WARDEN" })).status, 403);

  const clone = await ctx.call("POST", "/system/roles/HOSTEL_WARDEN/clone", { name: "Night Warden" });
  assert.strictEqual(clone.status, 201, clone.error);
  assert.ok(clone.data.permissionKeys.includes("hostel.manage_visitors"));
  assert.strictEqual((await ctx.call("PUT", "/system/roles/HOSTEL_WARDEN", { name: "x" })).status, 403);

  const staff = await ctx.call("POST", "/system/users", { fullName: "Night Person", role: clone.data.id });
  assert.strictEqual(staff.status, 201, staff.error);
  assert.strictEqual((await ctx.call("DELETE", `/system/roles/${clone.data.id}`)).status, 409, "in use");
  await ctx.call("PUT", `/system/users/${staff.data.user.id}`, { role: "STAFF" });
  assert.strictEqual((await ctx.call("DELETE", `/system/roles/${clone.data.id}`)).status, 200);

  const other = tenant();
  assert.ok(!(await other.call("GET", "/system/roles")).data.some((role) => role.id === manager.data.id), "roles stay in their tenant");
  assert.strictEqual((await other.call("PUT", `/system/roles/${manager.data.id}`, { name: "Hijack" })).status, 404);
}));

test("user overrides: an allow adds, a deny always wins, and it applies at once", live(async () => {
  const ctx = tenant();
  const role = await ctx.call("POST", "/system/roles", { name: "Desk", permissionKeys: ["hostel.view_rooms", "hostel.manage_visitors"] });
  const user = await ctx.call("POST", "/system/users", { fullName: "Desk Person", role: role.data.id });
  const id = user.data.user.id;
  const asDesk = (method, path, body) => ctx.call(method, path, body, role.data.id);

  // The test client signs in as a separate user with this role; give it the same overrides.
  const me = (await asDesk("GET", "/auth/me")).data;
  assert.strictEqual((await asDesk("GET", "/hostel/visitors")).status, 200);
  assert.strictEqual((await asDesk("GET", "/hostel/meals")).status, 403);

  const set = await ctx.call("PUT", `/system/users/${me.userId}/overrides`, {
    overrides: [
      { key: "hostel.manage_meals", effect: "ALLOW", reason: "Covers the kitchen on Fridays" },
      { key: "hostel.manage_visitors", effect: "DENY", reason: "Moved off the gate" },
    ],
  });
  assert.strictEqual(set.status, 200, set.error);
  assert.ok(set.data.effective.includes("hostel.manage_meals"));
  assert.ok(!set.data.effective.includes("hostel.manage_visitors"));
  assert.ok(set.data.fromRole.includes("hostel.manage_visitors"), "the role itself is unchanged");
  assert.strictEqual((await asDesk("GET", "/hostel/meals")).status, 200);
  assert.strictEqual((await asDesk("GET", "/hostel/visitors")).status, 403, "deny beats the role's allow");

  // Even if the role later grants it again, the deny still wins.
  await ctx.call("PUT", `/system/roles/${role.data.id}`, { permissionKeys: ["hostel.view_rooms", "hostel.manage_visitors", "hostel.manage_fees"] });
  assert.strictEqual((await asDesk("GET", "/hostel/visitors")).status, 403);
  assert.strictEqual((await asDesk("GET", "/hostel/fees")).status, 200, "role changes apply at once");

  assert.strictEqual((await ctx.call("PUT", `/system/users/${id}/overrides`, { overrides: [{ key: "nope.x", effect: "ALLOW" }] })).status, 400);
  const admin = (await ctx.call("GET", "/auth/me")).data;
  assert.strictEqual((await ctx.call("PUT", `/system/users/${admin.userId}/overrides`, { overrides: [] })).status, 403, "not on yourself");
  assert.strictEqual((await ctx.call("PUT", `/system/users/${admin.userId}`, { role: "STAFF" })).status, 403, "cannot demote yourself");
}));

test("existing people are found instead of getting a second account", live(async () => {
  const ctx = tenant();
  const email = `d${unique()}@example.com`;
  const first = await ctx.call("POST", "/system/users", { fullName: "Rafi Hasan", email, phone: "01710000001", role: "TEACHER", linkedType: "TEACHER", linkedId: "T-77" });
  assert.strictEqual(first.status, 201, first.error);

  const again = await ctx.call("POST", "/system/users", { fullName: "Rafi H", email: email.toUpperCase(), role: "STAFF" });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.details.existing[0].id, first.data.user.id);
  assert.deepStrictEqual(again.details.existing[0].matchedOn, ["email"]);

  const byPhone = (await ctx.call("GET", "/system/users/lookup?phone=01710000001")).data;
  assert.strictEqual(byPhone[0].username, first.data.user.username);
  const byRecord = (await ctx.call("GET", "/system/users/lookup?linkedType=TEACHER&linkedId=T-77")).data;
  assert.strictEqual(byRecord.length, 1);

  // Another tenant can use the same email for its own person.
  const other = tenant();
  assert.strictEqual((await other.call("POST", "/system/users", { fullName: "Rafi Hasan", email, role: "STAFF" })).status, 201);
  assert.strictEqual((await other.call("GET", `/system/users/${first.data.user.id}`)).status, 404);

  assert.strictEqual((await ctx.call("GET", "/system/users", undefined, "TEACHER")).status, 403);
  const audit = (await ctx.call("GET", "/system/audit")).data;
  assert.ok(audit.some((item) => item.entityId === first.data.user.id && item.action === "Created"));
}));

// ---- Subscriptions ------------------------------------------------------------

test("a tenant only reaches the modules it subscribes to", live(async () => {
  const ctx = tenant();
  const platform = tenant();
  assert.strictEqual((await ctx.call("GET", "/hostel/rooms")).status, 200);

  assert.strictEqual((await ctx.call("PUT", `/platform/tenants/${ctx.institution}/modules`, { modules: [] })).status, 403, "only the platform owner");
  const off = await platform.call("PUT", `/platform/tenants/${ctx.institution}/modules`, { modules: [{ moduleId: "hostel", status: "SUSPENDED" }] }, "SUPER_ADMIN");
  assert.strictEqual(off.status, 200, off.error);
  assert.strictEqual((await ctx.call("GET", "/hostel/rooms")).status, 403, "even an admin loses an unpaid module");
  assert.ok(!(await ctx.call("GET", "/auth/me")).data.modules.includes("hostel"));
  assert.strictEqual((await platform.call("PUT", `/platform/tenants/${ctx.institution}/modules`, { modules: [{ moduleId: "system", status: "SUSPENDED" }] }, "SUPER_ADMIN")).status, 400, "core modules stay");

  const ended = await platform.call("PUT", `/platform/tenants/${ctx.institution}/modules`, { modules: [{ moduleId: "hostel", status: "ACTIVE", endsOn: "2020-01-01" }] }, "SUPER_ADMIN");
  assert.strictEqual(ended.status, 200);
  assert.strictEqual((await ctx.call("GET", "/hostel/rooms")).status, 403, "an expired module is off");

  // The institution asks for it back; the platform approves.
  const asked = await ctx.call("POST", "/tenant/subscription/requests", { moduleIds: ["hostel"], note: "Renew" });
  assert.strictEqual(asked.status, 201, asked.error);
  assert.strictEqual((await ctx.call("POST", "/tenant/subscription/requests", { moduleIds: ["hostel"] })).status, 409, "one request at a time");
  const approved = await platform.call("POST", `/platform/subscriptions/${asked.data.id}/approve`, { note: "Paid" }, "SUPER_ADMIN");
  assert.strictEqual(approved.status, 200, approved.error);
  assert.strictEqual((await ctx.call("GET", "/hostel/rooms")).status, 200);
  assert.strictEqual((await platform.call("POST", `/platform/subscriptions/${asked.data.id}/approve`, {}, "SUPER_ADMIN")).status, 409, "decided once");

  // A suspended institution is locked out entirely.
  await platform.call("POST", `/platform/tenants/${ctx.institution}/status`, { status: "SUSPENDED", reason: "Unpaid" }, "SUPER_ADMIN");
  assert.strictEqual((await ctx.call("GET", "/auth/me")).status, 403);
  await platform.call("POST", `/platform/tenants/${ctx.institution}/status`, { status: "ACTIVE" }, "SUPER_ADMIN");
  assert.strictEqual((await ctx.call("GET", "/auth/me")).status, 200);
}));

test("registration: priced by the server, reviewed, then the admin gets their sign-in by email", live(async () => {
  const plans = await request("GET", "/public/plans");
  assert.strictEqual(plans.status, 200);
  const hostel = plans.data.find((item) => item.id === "hostel");
  const quote = await request("POST", "/public/quote", { moduleIds: ["hostel"], billingCycle: "YEARLY" });
  assert.ok(quote.data.moduleIds.includes("system"), "core modules come included");
  assert.strictEqual(quote.data.periodTotal, Math.round(quote.data.monthlyTotal * 10 * 100) / 100);

  const code = `T${unique().toUpperCase()}`;
  const email = `admin${unique()}@example.com`;
  const body = { institutionName: "Test College", institutionCode: code, type: "College", contactName: "Principal Karim", email, phone: "01712345678", moduleIds: ["hostel"], monthlyTotal: 1 };
  const made = await request("POST", "/public/register", body);
  assert.strictEqual(made.status, 201, made.error);
  registered.push(made.data.tenantId);
  assert.strictEqual(made.data.status, "PENDING");
  assert.ok(made.data.monthlyTotal >= hostel.monthlyPrice, "the browser's price is ignored");
  assert.strictEqual((await request("POST", "/public/register", { ...body, email: `x${email}` })).status, 409, "codes are unique");
  assert.strictEqual((await request("POST", "/public/register", { ...body, institutionCode: "x" })).status, 400);

  // Nobody can sign in before approval.
  assert.strictEqual((await login(`admin.${code.toLowerCase()}`, "anything-1")).status, 401);

  const platform = tenant();
  const pending = (await platform.call("GET", "/platform/subscriptions?status=PENDING", undefined, "SUPER_ADMIN")).data;
  const request_ = pending.find((item) => item.tenantId === made.data.tenantId);
  assert.ok(request_);
  assert.strictEqual((await platform.call("POST", `/platform/subscriptions/${request_.id}/reject`, {}, "SUPER_ADMIN")).status, 400, "a rejection needs a reason");
  const approved = await platform.call("POST", `/platform/subscriptions/${request_.id}/approve`, { note: "Welcome" }, "SUPER_ADMIN");
  assert.strictEqual(approved.status, 200, approved.error);
  assert.strictEqual(approved.data.adminCredentials.delivered, true);
  assert.strictEqual(approved.data.tenant.status, "ACTIVE");

  const first = await login(`admin.${code.toLowerCase()}`, passwordFor(email));
  assert.strictEqual(first.status, 200, first.error);
  assert.strictEqual(first.data.mustChangePassword, true);
  assert.strictEqual(first.data.user.role, "ADMIN");
  assert.ok(first.data.user.modules.includes("hostel"));
  assert.ok(!first.data.user.modules.includes("library"), "only what they subscribed to");

  // If the email went astray, the platform admin sends new sign-in details. Only they can.
  const tenantId = made.data.tenantId;
  const oldPassword = passwordFor(email);
  assert.strictEqual((await platform.call("POST", `/platform/tenants/${tenantId}/resend-admin`, {}, "ADMIN")).status, 403);
  const resent = await platform.call("POST", `/platform/tenants/${tenantId}/resend-admin`, {}, "SUPER_ADMIN");
  assert.strictEqual(resent.status, 200, resent.error);
  assert.strictEqual(resent.data.email, email);
  const newPassword = passwordFor(email);
  assert.notStrictEqual(newPassword, oldPassword);
  assert.strictEqual((await login(`admin.${code.toLowerCase()}`, oldPassword)).status, 401, "the old password stops working");
  assert.strictEqual((await login(`admin.${code.toLowerCase()}`, newPassword)).status, 200);

  // With mail down, nothing changes: the password from the last email still works.
  const savedUser = process.env.EMAIL_USER;
  delete process.env.EMAIL_USER;
  const failed = await platform.call("POST", `/platform/tenants/${tenantId}/resend-admin`, {}, "SUPER_ADMIN");
  process.env.EMAIL_USER = savedUser;
  assert.strictEqual(failed.status, 409);
  assert.match(failed.error, /not changed/);
  assert.strictEqual((await login(`admin.${code.toLowerCase()}`, newPassword)).status, 200);
}));

// ---- Forms --------------------------------------------------------------------

test("forms: conditional fields, server-side checks and versioning", live(async () => {
  const ctx = tenant();
  const fields = [
    { id: "name", type: "text", label: "Full name", required: true },
    { id: "has_vehicle", type: "radio", label: "Do you bring a vehicle?", options: ["Yes", "No"], required: true },
    { id: "plate", type: "text", label: "Number plate", required: true, showIf: { field: "has_vehicle", operator: "equals", value: "Yes" } },
    { id: "age", type: "number", label: "Age", min: 16, max: 80 },
  ];
  assert.strictEqual((await ctx.call("POST", "/system/forms", { title: "Bad", fields: [{ id: "a", type: "text", label: "A", showIf: { field: "b", operator: "equals", value: 1 } }] })).status, 400, "conditions only look upward");
  const made = await ctx.call("POST", "/system/forms", { title: "Parking Request", fields });
  assert.strictEqual(made.status, 201, made.error);
  const id = made.data.id;
  assert.strictEqual((await ctx.call("POST", `/system/forms/${id}/submissions`, { data: { name: "A", has_vehicle: "No" } })).status, 409, "a draft takes no answers");

  await ctx.call("POST", `/system/forms/${id}/publish`);
  const submit = (data) => ctx.call("POST", `/system/forms/${id}/submissions`, { data }, "STAFF");
  assert.strictEqual((await submit({ name: "A", has_vehicle: "Yes" })).status, 400, "plate is required when shown");
  const hidden = await submit({ name: "A", has_vehicle: "No", plate: "DHAKA-1", extra: "x" });
  assert.strictEqual(hidden.status, 201, hidden.error);
  assert.deepStrictEqual(hidden.data.data, { name: "A", has_vehicle: "No" }, "hidden and unknown answers are dropped");
  assert.strictEqual((await submit({ name: "A", has_vehicle: "No", age: 5 })).status, 400);
  assert.strictEqual((await submit({ name: "A", has_vehicle: "Maybe" })).status, 400);

  // Editing a published form makes version 2 as a draft; answers keep using version 1 until it is published.
  const edited = await ctx.call("PUT", `/system/forms/${id}`, { fields: [...fields, { id: "phone", type: "phone", label: "Phone", required: true }] });
  assert.strictEqual(edited.data.latestVersion, 2);
  assert.strictEqual(edited.data.publishedVersion, 1);
  assert.strictEqual((await submit({ name: "B", has_vehicle: "No" })).data.version, 1);
  await ctx.call("POST", `/system/forms/${id}/publish`);
  assert.strictEqual((await submit({ name: "B", has_vehicle: "No" })).status, 400, "version 2 needs the phone");
  const v2 = await submit({ name: "B", has_vehicle: "No", phone: "01711111111" });
  assert.strictEqual(v2.data.version, 2);

  const saved = (await ctx.call("GET", `/system/forms/${id}/submissions`)).data;
  assert.deepStrictEqual(saved.map((item) => item.version).sort(), [1, 1, 2]);
  assert.strictEqual((await ctx.call("GET", `/system/forms/${id}/versions/1`)).data.fields.length, 4, "old versions are kept");
  assert.strictEqual((await ctx.call("POST", "/system/forms", { title: "X", fields }, "STAFF")).status, 403);
  assert.strictEqual((await tenant().call("GET", `/system/forms/${id}`)).status, 404);
}));

test("a role's form is filled when creating its users", live(async () => {
  const ctx = tenant();
  const form = await ctx.call("POST", "/system/forms", {
    title: "Driver Profile", purpose: "USER_PROFILE", publish: true,
    fields: [{ id: "licence", type: "text", label: "Licence number", required: true }, { id: "route", type: "select", label: "Route", options: ["North", "South"] }],
  });
  const role = await ctx.call("POST", "/system/roles", { name: "Driver", permissionKeys: ["transport.read"], formId: form.data.id });
  assert.strictEqual(role.status, 201, role.error);
  assert.strictEqual((await ctx.call("POST", "/system/users", { fullName: "Kalam", role: role.data.id, profile: { route: "North" } })).status, 400);
  const made = await ctx.call("POST", "/system/users", { fullName: "Kalam", role: role.data.id, profile: { licence: "DL-1", route: "North", salary: 9 } });
  assert.strictEqual(made.status, 201, made.error);
  assert.deepStrictEqual(made.data.user.profile, { licence: "DL-1", route: "North" });
  assert.strictEqual((await ctx.call("POST", `/system/forms/${form.data.id}/archive`)).status, 409, "in use by a role");
}));

// ---- Feature builder ----------------------------------------------------------

test("custom features: metadata, their own permissions, records and isolation", live(async () => {
  const ctx = tenant();
  const made = await ctx.call("POST", "/system/features", {
    moduleId: "hostel", key: "laundry", name: "Laundry Log",
    fields: [{ id: "student", type: "text", label: "Student", required: true }, { id: "bags", type: "number", label: "Bags", min: 1, max: 5, required: true }],
  });
  assert.strictEqual(made.status, 201, made.error);
  assert.strictEqual((await ctx.call("POST", "/system/features", { moduleId: "hostel", key: "laundry", name: "Again", fields: [{ type: "text", label: "x" }] })).status, 409);
  assert.strictEqual((await ctx.call("GET", "/features/hostel/laundry/records")).status, 403, "a draft has no permissions yet");

  await ctx.call("POST", `/system/features/${made.data.id}/publish`);
  const tree = (await ctx.call("GET", "/system/permissions/tree")).data;
  assert.ok(tree.find((item) => item.id === "hostel").groups.some((group) => group.permissions.some((item) => item.key === "hostel.feature.laundry.create")));

  const record = await ctx.call("POST", "/features/hostel/laundry/records", { data: { student: "Imran", bags: 2 } });
  assert.strictEqual(record.status, 201, record.error);
  assert.strictEqual((await ctx.call("POST", "/features/hostel/laundry/records", { data: { student: "Imran", bags: 9 } })).status, 400);

  const viewer = await ctx.call("POST", "/system/roles", { name: "Laundry Viewer", permissionKeys: ["hostel.feature.laundry.read"] });
  assert.strictEqual(viewer.status, 201, viewer.error);
  const asViewer = (method, path, body) => ctx.call(method, path, body, viewer.data.id);
  assert.strictEqual((await asViewer("GET", "/features/hostel/laundry/records")).data.records.length, 1);
  assert.strictEqual((await asViewer("POST", "/features/hostel/laundry/records", { data: { student: "X", bags: 1 } })).status, 403);
  assert.strictEqual((await asViewer("DELETE", `/features/hostel/laundry/records/${record.data.id}`)).status, 403);
  assert.deepStrictEqual((await asViewer("GET", "/features")).data.map((item) => [item.key, item.can.read, item.can.create]), [["laundry", true, false]]);
  assert.strictEqual((await ctx.call("GET", "/features/hostel/laundry/records", undefined, "STAFF")).status, 403);

  const other = tenant();
  assert.strictEqual((await other.call("GET", "/features/hostel/laundry/records")).status, 403, "no such permission in another tenant");
  assert.strictEqual((await ctx.call("DELETE", `/features/hostel/laundry/records/${record.data.id}`)).status, 200);
}));

// ---- Student portal -----------------------------------------------------------

test("student portal: own invoices and self-service meal booking only", live(async () => {
  const ctx = tenant();
  const room = await ctx.call("POST", "/hostel/rooms", { hostelName: "South", building: "S1", floor: "1", roomNumber: "S101", capacity: 2 });
  const { seats } = (await ctx.call("GET", `/hostel/rooms/${room.data.id}`)).data;
  const allocate = async (seat, n) => (await ctx.call("POST", "/hostel/allocations", {
    seatId: seat.id, studentId: `PS-${n}`, studentName: `Portal Student ${n}`, studentPhone: "01711111111",
    studentEmail: `ps${n}${unique()}@example.com`, guardianName: "Guardian Name", guardianPhone: "01722222222",
    monthlyRent: 3000, startDate: `${today().slice(0, 7)}-01`, firstDueDate: today(),
  })).data;
  const mine = await allocate(seats[0], 1);
  const theirs = await allocate(seats[1], 2);

  assert.strictEqual((await ctx.call("GET", `/hostel/allocations/${mine.id}/account`)).data, null);
  const account = await ctx.call("POST", `/hostel/allocations/${mine.id}/account`);
  assert.strictEqual(account.status, 201, account.error);
  assert.strictEqual(account.data.credentials.delivered, true);
  assert.strictEqual((await ctx.call("POST", `/hostel/allocations/${mine.id}/account`)).status, 409, "one account per student");

  const first = await login(account.data.user.username, passwordFor(mine.studentEmail));
  assert.strictEqual(first.data.home, "/portal");
  const changed = await request("POST", "/auth/change-password", { username: account.data.user.username, currentPassword: passwordFor(mine.studentEmail), newPassword: "Student-pass-1" });
  const token = changed.data.token;
  const as = (method, path, body) => request(method, path, body, token);

  const me = await as("GET", "/portal/me");
  assert.strictEqual(me.data.hostel.allocationId, mine.id);
  const invoices = (await as("GET", "/portal/invoices")).data.invoices;
  assert.ok(invoices.length > 0 && invoices.every((item) => item.allocationId === mine.id || item.studentId === "PS-1"));
  const theirInvoice = (await ctx.call("GET", `/hostel/ledger/${theirs.id}`)).data.invoices[0];
  assert.strictEqual((await as("POST", `/portal/invoices/${theirInvoice.id}/pay`)).status, 404, "not someone else's bill");
  const link = await as("POST", `/portal/invoices/${invoices[0].id}/pay`);
  assert.strictEqual(link.status, 200, link.error);
  assert.match(link.data.url, /\/hostel\/payment\//);

  // Staff screens stay closed.
  assert.strictEqual((await as("GET", "/hostel/rooms")).status, 403);
  assert.strictEqual((await as("GET", `/hostel/ledger/${theirs.id}`)).status, 403);
  assert.strictEqual((await as("GET", "/system/users")).status, 403);

  const meal = await ctx.call("POST", "/hostel/meals", {
    title: "Dinner", mealType: "Dinner", mealDate: today(), menuItems: ["Rice"], pricePerMeal: 60,
    bookingOpensAt: inMinutes(-5), bookingClosesAt: inMinutes(60), collectFrom: inMinutes(90), collectUntil: inMinutes(180),
  });
  const draft = await ctx.call("POST", "/hostel/meals", {
    title: "Secret", mealType: "Lunch", mealDate: today(), menuItems: ["Rice"], pricePerMeal: 60,
    bookingOpensAt: inMinutes(-5), bookingClosesAt: inMinutes(60), collectFrom: inMinutes(90), collectUntil: inMinutes(180),
  });
  await ctx.call("POST", `/hostel/meals/${meal.data.meal.id}/publish`);
  const listed = (await as("GET", "/portal/meals")).data;
  assert.deepStrictEqual(listed.meals.map((item) => item.id), [meal.data.meal.id], "drafts are hidden");
  assert.ok(!("expectedRevenue" in listed.meals[0]));
  assert.strictEqual((await as("POST", `/portal/meals/${draft.data.meal.id}/book`, { quantity: 1 })).status, 409);

  const booked = await as("POST", `/portal/meals/${meal.data.meal.id}/book`, { quantity: 2, allocationId: theirs.id });
  assert.strictEqual(booked.status, 201, booked.error);
  assert.strictEqual(booked.data.allocationId, mine.id, "the allocation comes from the account, not the request");
  assert.strictEqual((await as("PUT", `/portal/meal-bookings/${booked.data.id}`, { quantity: 1 })).data.quantity, 1);

  const staffOrder = await ctx.call("POST", `/hostel/meals/${meal.data.meal.id}/bookings`, { allocationId: theirs.id, quantity: 1 });
  assert.strictEqual((await as("POST", `/portal/meal-bookings/${staffOrder.data.id}/cancel`)).status, 404, "not someone else's order");
  assert.strictEqual((await as("POST", `/portal/meal-bookings/${booked.data.id}/cancel`)).status, 200);
  assert.strictEqual((await request("GET", "/portal/me", undefined, null)).status, 401);
  assert.strictEqual((await ctx.call("GET", "/portal/me")).status, 403, "admins are not students");
}));
