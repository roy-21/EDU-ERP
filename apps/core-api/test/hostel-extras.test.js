// Needs PostgreSQL. Meal photos, late fees and student groups.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { applyLateFees, billFees } = require("../dist/modules/hostel/hostel-fees.service");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");

let server;
let baseUrl;
const clients = [];
let counter = 0;

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const shiftDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);

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

const setup = async () => {
  const client = createClient(() => baseUrl);
  clients.push(client);
  counter += 1;
  const room = await client.call("POST", "/hostel/rooms", { hostelName: "East", building: `E${counter}`, floor: "1", roomNumber: `X${counter}`, capacity: 3 });
  assert.strictEqual(room.status, 201, room.error);
  const { seats } = (await client.call("GET", `/hostel/rooms/${room.data.id}`)).data;
  const allocate = async (seat, change = {}) => {
    counter += 1;
    const res = await client.call("POST", "/hostel/allocations", {
      seatId: seat.id, studentId: `EX-${counter}`, studentName: `Student ${counter}`, studentPhone: "01711111111",
      guardianName: "Guardian Name", guardianPhone: "01722222222", guardianRelationship: "Father", monthlyRent: 4000,
      startDate: `${today().slice(0, 7)}-01`, firstDueDate: shiftDays(today(), 5), ...change,
    });
    assert.strictEqual(res.status, 201, res.error);
    return res.data;
  };
  return { ...client, seats, allocate };
};

const invoicesOf = async (ctx, allocationId) => (await ctx.call("GET", `/hostel/ledger/${allocationId}`)).data.invoices;

const mealBody = (change = {}) => ({
  title: "Friday Lunch", mealType: "Lunch", mealDate: today(), menuItems: ["Rice", "Chicken"], pricePerMeal: 80,
  bookingOpensAt: inMinutes(-5), bookingClosesAt: inMinutes(60), collectFrom: inMinutes(90), collectUntil: inMinutes(180), ...change,
});

test("a meal can carry a JPG or PNG photo, served only to staff", live(async () => {
  const ctx = await setup();
  const image = { fileName: "lunch.png", contentBase64: PNG.toString("base64") };

  const fake = await ctx.call("POST", "/hostel/meals", mealBody({ image: { fileName: "x.png", contentBase64: Buffer.from("<script>").toString("base64") } }));
  assert.strictEqual(fake.status, 400, "the bytes decide the type, not the name");
  const big = await ctx.call("POST", "/hostel/meals", mealBody({ image: { fileName: "big.png", contentBase64: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]).toString("base64") } }));
  assert.strictEqual(big.status, 400);

  const made = await ctx.call("POST", "/hostel/meals", mealBody({ image }));
  assert.strictEqual(made.status, 201, made.error);
  const { meal } = made.data;
  assert.strictEqual(meal.hasImage, true);
  assert.ok(!("image" in meal), "the list never carries the bytes");

  const served = await ctx.call("GET", `/hostel/meals/${meal.id}/image`);
  assert.strictEqual(served.data.mimeType, "image/png");
  assert.strictEqual(served.data.contentBase64, PNG.toString("base64"));
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${meal.id}/image`, undefined, "TEACHER")).status, 403);
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${meal.id}/image`, undefined, null)).status, 401);

  // Editing without the field keeps the photo; null removes it.
  await ctx.call("PUT", `/hostel/meals/${meal.id}`, mealBody({ title: "Renamed" }));
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${meal.id}`)).data.meal.hasImage, true);
  await ctx.call("PUT", `/hostel/meals/${meal.id}`, mealBody({ image: null }));
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${meal.id}`)).data.meal.hasImage, false);
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${meal.id}/image`)).status, 404);

  const other = await setup();
  assert.strictEqual((await other.call("GET", `/hostel/meals/${meal.id}/image`)).status, 404, "other tenants cannot read it");
}));

test("late fee: once per overdue rent invoice, after grace, never on old debts", live(async () => {
  const ctx = await setup();
  const old = await ctx.allocate(ctx.seats[0], { firstDueDate: shiftDays(today(), -2) });
  const settings = (await ctx.call("GET", "/hostel/rent/config")).data.settings;
  assert.strictEqual(settings.lateFeeType, "NONE");

  const bad = await ctx.call("PUT", "/hostel/rent/settings", { ...settings, lateFeeType: "PERCENT", lateFeeValue: 150 });
  assert.strictEqual(bad.status, 400);
  const saved = await ctx.call("PUT", "/hostel/rent/settings", { ...settings, lateFeeType: "PERCENT", lateFeeValue: 5, lateFeeGraceDays: 3 });
  assert.strictEqual(saved.status, 200, saved.error);
  assert.strictEqual(saved.data.lateFeeStartsOn, today(), "starts counting from the day it was turned on");

  const fresh = await ctx.allocate(ctx.seats[1]);
  const [rent] = (await invoicesOf(ctx, fresh.id)).filter((item) => item.category === "RENT");

  // Within the grace days nothing is charged.
  assert.strictEqual((await applyLateFees(ctx.institution, { today: shiftDays(rent.dueDate, 3) })).created, 0);
  const later = shiftDays(rent.dueDate, 4);
  assert.strictEqual((await applyLateFees(ctx.institution, { today: later })).created, 1, "only the new invoice, not the old debt");
  assert.strictEqual((await applyLateFees(ctx.institution, { today: later })).created, 0, "never twice");

  const fee = (await invoicesOf(ctx, fresh.id)).find((item) => item.title === `Late fee for ${rent.invoiceNumber}`);
  assert.ok(fee, "late fee invoice raised");
  assert.strictEqual(fee.category, "FEE");
  assert.strictEqual(fee.rentAmount, Math.round(rent.rentAmount * 5) / 100);
  assert.strictEqual((await invoicesOf(ctx, old.id)).filter((item) => /^Late fee/.test(item.title)).length, 0);

  // A paid invoice is not charged.
  const third = await ctx.allocate(ctx.seats[2]);
  const [thirdRent] = (await invoicesOf(ctx, third.id)).filter((item) => item.category === "RENT");
  const paid = await ctx.call("POST", `/hostel/invoices/${thirdRent.id}/payments`, { amount: thirdRent.rentAmount, paymentDate: today(), method: "Cash" });
  assert.strictEqual(paid.status, 201, paid.error);
  assert.strictEqual((await applyLateFees(ctx.institution, { today: later })).created, 0);

  // Turning it off stops new fees, and turning it on again starts a new count.
  const off = await ctx.call("PUT", "/hostel/rent/settings", { ...settings, lateFeeType: "NONE" });
  assert.strictEqual(off.data.lateFeeStartsOn, null);
}));

test("student groups: a fee assigned to a group bills its members only", live(async () => {
  const ctx = await setup();
  const a = await ctx.allocate(ctx.seats[0]);
  const b = await ctx.allocate(ctx.seats[1]);
  const c = await ctx.allocate(ctx.seats[2]);
  const other = await setup();
  const outsider = await other.allocate(other.seats[0]);

  assert.strictEqual((await ctx.call("POST", "/hostel/fee-groups", { name: "Bad", allocationIds: [outsider.id] })).status, 400, "another tenant's student");
  const group = await ctx.call("POST", "/hostel/fee-groups", { name: "Gym members", allocationIds: [a.id, b.id] });
  assert.strictEqual(group.status, 201, group.error);
  assert.strictEqual((await ctx.call("POST", "/hostel/fee-groups", { name: "Gym members" })).status, 409);

  const fee = await ctx.call("POST", "/hostel/fees", { name: "Gym Fee", amount: 300, frequency: "ONE_TIME", effectiveDate: today() });
  assert.strictEqual((await ctx.call("POST", "/hostel/fee-assignments", { feeTypeId: fee.data.id, scope: "GROUP", targetIds: ["nope"] })).status, 400);
  const assigned = await ctx.call("POST", "/hostel/fee-assignments", { feeTypeId: fee.data.id, scope: "GROUP", targetIds: [group.data.id] });
  assert.strictEqual(assigned.status, 201, assigned.error);

  const gymFees = async (allocation) => (await invoicesOf(ctx, allocation.id)).filter((item) => item.title === "Gym Fee").length;
  assert.deepStrictEqual([await gymFees(a), await gymFees(b), await gymFees(c)], [1, 1, 0]);

  // Adding a member bills them; nobody is billed twice.
  const updated = await ctx.call("PUT", `/hostel/fee-groups/${group.data.id}`, { name: "Gym members", allocationIds: [a.id, b.id, c.id] });
  assert.strictEqual(updated.status, 200, updated.error);
  await billFees(ctx.institution);
  assert.deepStrictEqual([await gymFees(a), await gymFees(b), await gymFees(c)], [1, 1, 1]);

  const listed = (await ctx.call("GET", "/hostel/fee-groups")).data;
  assert.strictEqual(listed[0].members.length, 3);
  assert.strictEqual((await other.call("GET", "/hostel/fee-groups")).data.length, 0);

  assert.strictEqual((await ctx.call("DELETE", `/hostel/fee-groups/${group.data.id}`)).status, 409, "in use by an active fee");
  await ctx.call("POST", `/hostel/fee-assignments/${assigned.data.id}/stop`, { reason: "Gym closed" });
  assert.strictEqual((await ctx.call("DELETE", `/hostel/fee-groups/${group.data.id}`)).status, 200);
  assert.strictEqual((await ctx.call("GET", "/hostel/fee-groups", undefined, "TEACHER")).status, 403);
}));
