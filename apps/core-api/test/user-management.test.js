// Needs PostgreSQL. Role-first user creation from the role's form, the subscription owner kept apart,
// and per-user permission overrides that never touch the shared role.
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
const MAIL_ENV = ["EMAIL_USER", "EMAIL_PASS", "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_SECURE"];
const unique = () => randomUUID().slice(0, 8);

const mailOn = () => Object.assign(process.env, {
  EMAIL_USER: "sender@example.com", EMAIL_PASS: "smtp-pass", EMAIL_SMTP_HOST: "127.0.0.1",
  EMAIL_SMTP_PORT: String(smtp.port), EMAIL_SMTP_SECURE: "false",
});
const mailOff = () => MAIL_ENV.forEach((key) => { process.env[key] = ""; });

test.before(async () => {
  await postgresService.initialize();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  smtp = await startFakeSmtp();
  mailOn();
});

test.after(async () => {
  if (postgresService.isLive()) await removeInstitutions([...clients.map((client) => client.institution), ...registered]);
  await smtp?.close();
  await new Promise((resolve) => server.close(resolve));
  mailOff();
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

const passwordFor = (email) => {
  const mail = [...smtp.state.messages].reverse().find((item) => item.to.some((line) => line.toLowerCase().includes(email.toLowerCase())));
  assert.ok(mail, `an email reached ${email}`);
  const match = decodeMail(mail.raw).match(/Temporary password: (\S+)/);
  assert.ok(match, "the email carries the password");
  return match[1];
};

// Signs in with the emailed password and sets a real one, returning a full session.
const signIn = async (username, email) => {
  const temporary = passwordFor(email);
  const first = await request("POST", "/auth/login", { username, password: temporary });
  assert.strictEqual(first.status, 200, first.error);
  assert.strictEqual(first.data.mustChangePassword, true);
  const changed = await request("POST", "/auth/change-password", { username, currentPassword: temporary, newPassword: "Chosen-pass-123" });
  assert.strictEqual(changed.status, 200, changed.error);
  return changed.data.token;
};

const PROFILE_FIELDS = [
  { id: "full_name", type: "text", label: "Full name", required: true },
  { id: "work_email", type: "email", label: "Work email", required: true },
  { id: "mobile", type: "phone", label: "Mobile" },
  { id: "has_nid", type: "radio", label: "Has a national ID?", options: ["Yes", "No"], required: true },
  { id: "nid", type: "text", label: "NID number", required: true, showIf: { field: "has_nid", operator: "equals", value: "Yes" } },
];

const makeForm = async (ctx, title, extra = {}) => {
  const form = await ctx.call("POST", "/system/forms", { title, purpose: "USER_PROFILE", publish: true, fields: PROFILE_FIELDS, ...extra });
  assert.strictEqual(form.status, 201, form.error);
  return form.data.id;
};

test("the account that bought the subscription is the owner, not an operational user", live(async () => {
  const code = `O${unique().toUpperCase()}`;
  const email = `owner${unique()}@example.com`;
  const made = await request("POST", "/public/register", {
    institutionName: "Owner Hostel", institutionCode: code, type: "College", contactName: "Owner Person", email, phone: "01712345678", moduleIds: ["hostel"],
  });
  assert.strictEqual(made.status, 201, made.error);
  registered.push(made.data.tenantId);
  const { rows } = await postgresService.query(
    "SELECT t.owner_user_id, u.id, u.username FROM erp_tenants t JOIN erp_users u ON u.institution_id = t.id WHERE t.id = $1",
    [made.data.tenantId]
  );
  assert.strictEqual(rows.length, 1, "no duplicate owner account");
  assert.strictEqual(rows[0].owner_user_id, rows[0].id, "registration marks the owner");

  // In any tenant: the owner is kept out of the list and protected from other admins.
  const ctx = tenant();
  const owner = await ctx.call("POST", "/system/users", { fullName: "Real Owner", role: "ADMIN" });
  assert.strictEqual(owner.status, 201, owner.error);
  await postgresService.query("UPDATE erp_tenants SET owner_user_id = $2 WHERE id = $1", [ctx.institution, owner.data.user.id]);
  const list = (await ctx.call("GET", "/system/users")).data;
  assert.ok(!list.some((user) => user.id === owner.data.user.id), "1. the owner is not an ordinary user");
  assert.strictEqual((await ctx.call("GET", "/system/users/owner")).data.id, owner.data.user.id);
  assert.ok((await ctx.call("GET", "/system/users?includeOwner=true")).data.some((user) => user.id === owner.data.user.id));
  const id = owner.data.user.id;
  assert.strictEqual((await ctx.call("PUT", `/system/users/${id}`, { status: "INACTIVE" })).status, 403, "nobody else deactivates the owner");
  assert.strictEqual((await ctx.call("DELETE", `/system/users/${id}`)).status, 403, "nobody deletes the owner");
  assert.strictEqual((await ctx.call("PUT", `/system/users/${id}/overrides`, { overrides: [{ key: "hostel.read", effect: "DENY" }] })).status, 403);
  assert.strictEqual((await ctx.call("POST", `/system/users/${id}/reset-password`)).status, 403);
}));

test("role first: the role's own form is filled, checked on the server, and makes the account", live(async () => {
  const ctx = tenant();
  const other = tenant();

  // 2/3. A role without a form cannot register anyone.
  const bare = await ctx.call("GET", "/system/roles/HOSTEL_WARDEN/registration-form");
  assert.strictEqual(bare.status, 200, bare.error);
  assert.strictEqual(bare.data.form, null);
  assert.match(bare.data.problem, /No registration form/);
  assert.strictEqual((await ctx.call("POST", "/system/users/register", { role: "HOSTEL_WARDEN", answers: {} })).status, 409);

  // Only a published user-profile form of the same institution can be attached.
  const draft = await ctx.call("POST", "/system/forms", { title: "Draft", purpose: "USER_PROFILE", fields: PROFILE_FIELDS });
  assert.strictEqual((await ctx.call("PUT", "/system/roles/HOSTEL_WARDEN/form", { formId: draft.data.id })).status, 400, "unpublished");
  const general = await ctx.call("POST", "/system/forms", { title: "Survey", publish: true, fields: PROFILE_FIELDS });
  assert.strictEqual((await ctx.call("PUT", "/system/roles/HOSTEL_WARDEN/form", { formId: general.data.id })).status, 400, "not a profile form");
  const foreign = await makeForm(other, "Other tenant form");
  assert.strictEqual((await ctx.call("PUT", "/system/roles/HOSTEL_WARDEN/form", { formId: foreign })).status, 400, "another tenant's form");
  assert.strictEqual((await ctx.call("PUT", "/system/roles/HOSTEL_WARDEN/form", { formId: draft.data.id }, "STAFF")).status, 403);

  const wardenForm = await makeForm(ctx, "Hostel Manager Registration Form");
  const set = await ctx.call("PUT", "/system/roles/HOSTEL_WARDEN/form", { formId: wardenForm });
  assert.strictEqual(set.status, 200, set.error);
  assert.strictEqual(set.data.formId, wardenForm);
  const accountantForm = await ctx.call("POST", "/system/forms", {
    title: "Hostel Accountant Registration Form", purpose: "USER_PROFILE", publish: true,
    fields: [{ id: "name", type: "text", label: "Name", required: true }, { id: "email", type: "email", label: "Email", required: true }, { id: "bank", type: "text", label: "Bank account", required: true }],
  });
  await ctx.call("PUT", "/system/roles/ACCOUNTANT/form", { formId: accountantForm.data.id });

  const loaded = (await ctx.call("GET", "/system/roles/HOSTEL_WARDEN/registration-form")).data;
  assert.strictEqual(loaded.form.title, "Hostel Manager Registration Form", "3. the role's own form");
  assert.deepStrictEqual(loaded.accountFields, { fullName: "full_name", email: "work_email", phone: "mobile" });
  assert.strictEqual((await ctx.call("GET", "/system/roles/ACCOUNTANT/registration-form")).data.form.title, "Hostel Accountant Registration Form");

  // Server-side validation of the dynamic answers, including conditional fields.
  const email = `warden${unique()}@example.com`;
  const answers = { full_name: "Rahim Uddin", work_email: email, mobile: "01711000000", has_nid: "Yes" };
  assert.strictEqual((await ctx.call("POST", "/system/users/register", { role: "HOSTEL_WARDEN", answers })).status, 400, "NID shown, so required");

  // With mail down, nothing is created, and submitting again later is safe.
  mailOff();
  const down = await ctx.call("POST", "/system/users/register", { role: "HOSTEL_WARDEN", answers: { ...answers, nid: "1234567890" } });
  mailOn();
  assert.strictEqual(down.status, 409);
  assert.match(down.error, /No account was created/);
  assert.strictEqual((await ctx.call("GET", `/system/users?search=${email}`)).data.length, 0, "no half-made account");
  const failedLog = await postgresService.query("SELECT status FROM erp_email_log WHERE institution_id = $1 AND recipient = $2", [ctx.institution, email]);
  assert.deepStrictEqual(failedLog.rows.map((row) => row.status), ["FAILED"], "the failure is logged");

  // 4/5. The account is made, linked to the tenant and role, and the details are emailed.
  const made = await ctx.call("POST", "/system/users/register", { role: "HOSTEL_WARDEN", answers: { ...answers, nid: "1234567890", extra: "dropped" } });
  assert.strictEqual(made.status, 201, made.error);
  assert.strictEqual(made.data.credentials.delivered, true);
  const user = made.data.user;
  assert.strictEqual(user.role, "HOSTEL_WARDEN");
  assert.strictEqual(user.fullName, "Rahim Uddin");
  assert.strictEqual(user.email, email);
  assert.strictEqual(user.phone, "01711000000");
  assert.ok(user.credentialsSentAt);
  assert.deepStrictEqual(user.profile, { full_name: "Rahim Uddin", work_email: email, mobile: "01711000000", has_nid: "Yes", nid: "1234567890" });
  assert.strictEqual((await other.call("GET", `/system/users/${user.id}`)).status, 404, "other tenants cannot see it");
  const { rows } = await postgresService.query("SELECT institution_id FROM erp_users WHERE id = $1", [user.id]);
  assert.strictEqual(rows[0].institution_id, ctx.institution);

  const token = await signIn(user.username, email);
  const me = await request("GET", "/auth/me", undefined, token);
  assert.strictEqual(me.data.role, "HOSTEL_WARDEN");
  assert.strictEqual(me.data.institutionId, ctx.institution);

  // Unique usernames and emails.
  const twin = await ctx.call("POST", "/system/users/register", { role: "HOSTEL_WARDEN", answers: { ...answers, work_email: `twin${unique()}@example.com`, mobile: "01711000009", has_nid: "No" } });
  assert.strictEqual(twin.status, 201, twin.error);
  assert.notStrictEqual(twin.data.user.username, user.username);
  assert.strictEqual((await ctx.call("POST", "/system/users/register", { role: "ACCOUNTANT", answers: { name: "Same Mail", email: email.toUpperCase(), bank: "1" } })).status, 409);

  // The answers stay with the account: user managers see them, form builders do not.
  const details = (await ctx.call("GET", `/system/users/${user.id}/details`)).data;
  assert.strictEqual(details.profileFields.length, PROFILE_FIELDS.length);
  assert.strictEqual(details.emails[0].status, "SENT");
  assert.strictEqual((await ctx.call("GET", `/system/forms/${wardenForm}/submissions`)).data.length, 0);

  // A form cannot be archived while a built-in role registers with it.
  assert.strictEqual((await ctx.call("POST", `/system/forms/${wardenForm}/archive`)).status, 409);
}));

test("per-user overrides: one user changes, the other and the role do not", live(async () => {
  const ctx = tenant();
  const platform = tenant();
  const formId = await makeForm(ctx, "Meal Manager Registration Form");
  const role = await ctx.call("POST", "/system/roles", {
    name: "Meal Manager", formId, permissionKeys: ["hostel.read", "hostel.view_rooms", "hostel.manage_meals", "hostel.send_reminders"],
  });
  assert.strictEqual(role.status, 201, role.error);
  const register = async (name) => {
    const email = `${name.toLowerCase()}${unique()}@example.com`;
    const made = await ctx.call("POST", "/system/users/register", { role: role.data.id, answers: { full_name: `${name} Meal`, work_email: email, has_nid: "No" } });
    assert.strictEqual(made.status, 201, made.error);
    return { ...made.data.user, token: await signIn(made.data.user.username, email) };
  };
  const a = await register("Alpha");
  const b = await register("Beta");
  assert.strictEqual((await request("GET", "/hostel/meals/dues", undefined, a.token)).status, 200);

  // 6/7. Deny meals to A only.
  const denied = await ctx.call("PUT", `/system/users/${a.id}/overrides`, { overrides: [{ key: "hostel.manage_meals", effect: "DENY", reason: "Moved to the desk" }] });
  assert.strictEqual(denied.status, 200, denied.error);
  assert.ok(denied.data.fromRole.includes("hostel.manage_meals"), "the role still grants it");
  assert.ok(!denied.data.effective.includes("hostel.manage_meals"), "A loses it");
  assert.ok((await ctx.call("GET", `/system/users/${b.id}/permissions`)).data.effective.includes("hostel.manage_meals"), "B keeps it");
  const roleNow = (await ctx.call("GET", "/system/roles")).data.find((item) => item.id === role.data.id);
  assert.ok(roleNow.permissionKeys.includes("hostel.manage_meals"), "the role is unchanged");
  assert.ok(!(await request("GET", "/auth/me", undefined, a.token)).data.permissions.includes("hostel.manage_meals"), "applies to A's session at once");
  assert.ok((await request("GET", "/auth/me", undefined, b.token)).data.permissions.includes("hostel.manage_meals"));
  assert.strictEqual((await request("POST", "/hostel/meals", { name: "x" }, a.token)).status, 403, "and the backend enforces it");

  // 8. Removing the override brings back what the role gives.
  const restored = await ctx.call("DELETE", `/system/users/${a.id}/overrides/hostel.manage_meals`);
  assert.strictEqual(restored.status, 200, restored.error);
  assert.ok(restored.data.effective.includes("hostel.manage_meals"));
  assert.strictEqual(restored.data.overrides.length, 0);
  assert.strictEqual((await ctx.call("DELETE", `/system/users/${a.id}/overrides/hostel.manage_meals`)).status, 404);

  // An allow adds access beyond the role, but never past the subscription.
  const extra = await ctx.call("PUT", `/system/users/${b.id}/overrides`, { overrides: [{ key: "library.read", effect: "ALLOW" }] });
  assert.strictEqual(extra.status, 200, extra.error);
  assert.ok(extra.data.effective.includes("library.read"));
  const off = await platform.call("PUT", `/platform/tenants/${ctx.institution}/modules`, { modules: [{ moduleId: "library", status: "SUSPENDED" }] }, "SUPER_ADMIN");
  assert.strictEqual(off.status, 200, off.error);
  assert.ok(!(await ctx.call("GET", `/system/users/${b.id}/permissions`)).data.effective.includes("library.read"), "9. an unsubscribed module is off even with an allow");
  assert.strictEqual((await request("GET", "/library/books", undefined, b.token)).status, 403);
  const blocked = await ctx.call("PUT", `/system/users/${a.id}/overrides`, { overrides: [{ key: "library.read", effect: "ALLOW" }] });
  assert.strictEqual(blocked.status, 403);
  assert.match(blocked.error, /subscription does not include: library/);

  // 10. Calling the endpoints directly without the right permission is refused.
  for (const [method, path, body] of [
    ["POST", "/system/users/register", { role: role.data.id, answers: {} }],
    ["PUT", `/system/users/${a.id}/overrides`, { overrides: [] }],
    ["DELETE", `/system/users/${a.id}/overrides/hostel.read`],
    ["DELETE", `/system/users/${a.id}`],
    ["GET", `/system/users/${a.id}/details`],
    ["GET", `/system/roles/${role.data.id}/registration-form`],
  ]) {
    assert.strictEqual((await ctx.call(method, path, body, "STAFF")).status, 403, `${method} ${path}`);
    assert.strictEqual((await request(method, path, body, a.token)).status, 403, `${method} ${path} as a meal manager`);
  }
  assert.strictEqual((await platform.call("DELETE", `/system/users/${a.id}`)).status, 404, "another tenant's admin cannot reach it");
  // A hostel-only user reaches nothing in System, Institution, API, Guardian or Transport, even by calling the API.
  for (const [method, path] of [["GET", "/system/users"], ["GET", "/system/roles"], ["GET", "/system/forms"], ["GET", "/system/audit"], ["GET", "/campuses"],
    ["POST", "/campuses"], ["GET", "/institution/metadata/faculty"], ["GET", "/guardians"], ["GET", "/transport/routes"], ["GET", "/system/features"]]) {
    assert.strictEqual((await request(method, path, method === "POST" ? { code: "X", name: "X" } : undefined, a.token)).status, 403, `${method} ${path} without permission`);
  }

  // 11. A deactivated user cannot sign in, and their open session ends.
  assert.strictEqual((await ctx.call("PUT", `/system/users/${a.id}`, { status: "INACTIVE" })).status, 200);
  assert.strictEqual((await request("POST", "/auth/login", { username: a.username, password: "Chosen-pass-123" })).status, 403);
  assert.strictEqual((await request("GET", "/auth/me", undefined, a.token)).status, 401);

  // Delete removes the account and what belonged only to it.
  await ctx.call("PUT", `/system/users/${b.id}/overrides`, { overrides: [{ key: "hostel.send_reminders", effect: "DENY" }] });
  const gone = await ctx.call("DELETE", `/system/users/${b.id}`);
  assert.strictEqual(gone.status, 200, gone.error);
  assert.strictEqual((await ctx.call("GET", `/system/users/${b.id}`)).status, 404);
  assert.strictEqual((await request("POST", "/auth/login", { username: b.username, password: "Chosen-pass-123" })).status, 401);
  for (const table of ["erp_user_permission_overrides", "erp_form_submissions", "erp_email_log"]) {
    assert.strictEqual((await postgresService.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [b.id])).rows[0].n, 0, `${table} cleared`);
  }
}));

test("existing users and the older create path keep working", live(async () => {
  const ctx = tenant();
  // 12. A user made the old way, with no role form, is listed and signs in as before.
  const email = `legacy${unique()}@example.com`;
  const old = await ctx.call("POST", "/system/users", { fullName: "Legacy Staff", email, role: "STAFF" });
  assert.strictEqual(old.status, 201, old.error);
  assert.strictEqual(old.data.credentials.delivered, true);
  assert.ok((await ctx.call("GET", "/system/users")).data.some((user) => user.id === old.data.user.id));
  const token = await signIn(old.data.user.username, email);
  assert.strictEqual((await request("GET", "/auth/me", undefined, token)).data.role, "STAFF");

  // Undelivered details are visible, and "Send New Password" sends them as a first sign-in.
  mailOff();
  const quiet = await ctx.call("POST", "/system/users", { fullName: "Quiet Staff", email: `quiet${unique()}@example.com`, role: "STAFF" });
  mailOn();
  assert.strictEqual(quiet.data.credentials.delivered, false);
  assert.strictEqual(quiet.data.user.credentialsSentAt, null);
  const retry = await ctx.call("POST", `/system/users/${quiet.data.user.id}/reset-password`);
  assert.strictEqual(retry.status, 200, retry.error);
  assert.ok((await ctx.call("GET", `/system/users/${quiet.data.user.id}`)).data.credentialsSentAt);
  assert.strictEqual((await ctx.call("DELETE", `/system/users/${(await ctx.call("GET", "/auth/me")).data.userId}`)).status, 403, "not yourself");
}));

test("activity: the admin sees what each user and role did; the platform owner sees inside each institution", live(async () => {
  const ctx = tenant();
  const other = tenant();
  const platform = tenant();
  const formId = await makeForm(ctx, "Desk Registration");
  const role = await ctx.call("POST", "/system/roles", { name: "Room Desk", formId, permissionKeys: ["hostel.read", "hostel.view_rooms", "hostel.manage_rooms"] });
  assert.strictEqual(role.status, 201, role.error);
  const email = `desk${unique()}@example.com`;
  const made = await ctx.call("POST", "/system/users/register", { role: role.data.id, answers: { full_name: "Desk Person", work_email: email, has_nid: "No" } });
  assert.strictEqual(made.status, 201, made.error);
  const desk = made.data.user;
  const token = await signIn(desk.username, email);
  assert.strictEqual((await request("POST", "/auth/login", { username: desk.username, password: "wrong-pass-1" })).status, 401);
  const room = await request("POST", "/hostel/rooms", { hostelName: "Activity Hall", building: "A", floor: "1", roomNumber: `AC${unique()}`, capacity: 2 }, token);
  assert.strictEqual(room.status, 201, room.error);

  // A sign-in from a phone: its address and device go on the record.
  const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const fromPhone = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": PHONE }, body: JSON.stringify({ username: desk.username, password: "Chosen-pass-123" }) });
  assert.strictEqual(fromPhone.status, 200);

  // The admin: one user's activity, with sign-ins, failures and the work they did.
  const mine = await ctx.call("GET", `/system/users/${desk.id}/activity`);
  assert.strictEqual(mine.status, 200, mine.error);
  const actions = mine.data.activity.items.map((item) => item.action);
  assert.ok(actions.includes("Signed In"), "sign-ins are recorded");
  assert.ok(actions.includes("Sign-in Failed"), "failed attempts are recorded");
  assert.ok(mine.data.activity.items.some((item) => item.area.startsWith("Hostel")), "hostel work shows up");
  assert.ok(mine.data.activity.items.every((item) => item.actor.id === desk.id), "only this person's actions");
  assert.ok(mine.data.stats.signIns >= 2 && mine.data.stats.last30Days >= 3);
  assert.strictEqual(mine.data.activity.items[0].actor.roleName, "Room Desk");
  const phoneSignIn = mine.data.activity.items.find((item) => item.action === "Signed In" && item.origin?.userAgent === PHONE);
  assert.ok(phoneSignIn, "the sign-in records where it came from");
  assert.strictEqual(phoneSignIn.origin.ip, "127.0.0.1");
  assert.strictEqual(phoneSignIn.origin.network, "This server (local)");
  assert.deepStrictEqual(phoneSignIn.origin.device, { browser: "Chrome 126", os: "Android 14", type: "Mobile", summary: "Chrome 126 · Android 14 · Mobile" });
  assert.ok(mine.data.activity.items.some((item) => item.area.startsWith("Hostel") && item.origin?.ip === "127.0.0.1"), "hostel actions record it too");
  const phone = mine.data.devices.find((item) => item.userAgent === PHONE);
  assert.ok(phone && phone.signIns === 1 && phone.device.type === "Mobile", "each device and address used is listed");
  assert.ok(mine.data.devices.length >= 2, "the script client counts as another device");
  assert.strictEqual(/mac.?address/i.test(JSON.stringify(mine.data)), false, "no MAC address is claimed");

  // By role, with paging.
  const byRole = await ctx.call("GET", `/system/activity?roleId=${role.data.id}&limit=1`);
  assert.strictEqual(byRole.data.items.length, 1);
  assert.ok(byRole.data.nextBefore, "there is a next page");
  const next = await ctx.call("GET", `/system/activity?roleId=${role.data.id}&limit=50&before=${encodeURIComponent(byRole.data.nextBefore)}`);
  assert.ok(next.data.items.length >= 1 && next.data.items.every((item) => item.at <= byRole.data.nextBefore));
  assert.ok((await ctx.call("GET", "/system/activity?search=Room%20Desk")).data.items.some((item) => item.action === "Created"), "search finds the role being made");

  // Nobody else: not the user themselves, not another institution.
  assert.strictEqual((await request("GET", `/system/users/${desk.id}/activity`, undefined, token)).status, 403);
  assert.strictEqual((await request("GET", "/system/activity", undefined, token)).status, 403);
  assert.strictEqual((await other.call("GET", `/system/users/${desk.id}/activity`)).status, 404);
  assert.strictEqual((await other.call("GET", "/system/activity")).data.items.some((item) => item.actor.id === desk.id), false);

  // The platform owner: the institution's users, the roles it made, who made them, and what each one did.
  assert.strictEqual((await ctx.call("GET", `/platform/tenants/${ctx.institution}/overview`)).status, 403, "an institution admin cannot");
  const overview = await platform.call("GET", `/platform/tenants/${ctx.institution}/overview`, undefined, "SUPER_ADMIN");
  assert.strictEqual(overview.status, 200, overview.error);
  const listed = overview.data.users.find((user) => user.id === desk.id);
  assert.ok(listed && listed.actionsLast30Days >= 3 && listed.roleName === "Room Desk");
  assert.ok(listed.lastSeenFrom && listed.lastSeenFrom.ip === "127.0.0.1" && listed.lastSeenFrom.at, "the platform sees where each user was last seen from");
  assert.strictEqual(listed.createdBy, "test@example.com", "who made the account");
  const madeRole = overview.data.roles.find((item) => item.id === role.data.id);
  assert.ok(madeRole && madeRole.users === 1 && madeRole.createdBy === "test@example.com");
  assert.ok(overview.data.activity.items.length > 0);
  const deskSeen = await platform.call("GET", `/platform/tenants/${ctx.institution}/users/${desk.id}/activity`, undefined, "SUPER_ADMIN");
  assert.ok(deskSeen.data.activity.items.some((item) => item.action === "Signed In"));
  const adminId = overview.data.users.find((user) => user.role === "ADMIN").id;
  const adminSeen = await platform.call("GET", `/platform/tenants/${ctx.institution}/users/${adminId}/activity`, undefined, "SUPER_ADMIN");
  assert.ok(adminSeen.data.createdUsers.some((user) => user.id === desk.id), "what the admin created: users");
  assert.ok(adminSeen.data.createdRoles.some((item) => item.id === role.data.id), "and roles");
  assert.strictEqual((await platform.call("GET", `/platform/tenants/${ctx.institution}/users/${desk.id}/activity`)).status, 403, "only the platform owner");
  assert.strictEqual((await platform.call("GET", `/platform/tenants/${other.institution}/users/${desk.id}/activity`, undefined, "SUPER_ADMIN")).status, 404, "a user only within their own institution");
}));
