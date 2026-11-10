// Needs PostgreSQL. Rent sync, allocation email, meals, visitors, fees and invoices.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { queueMealReminders } = require("../dist/modules/hostel/hostel-notifications.service");
const { billFees } = require("../dist/modules/hostel/hostel-fees.service");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");
const { decodeMail, startFakeSmtp } = require("./fake-gateways");

let server;
let baseUrl;
let smtp;
const clients = [];
let counter = 0;
const savedEnv = {};
const ENV = ["EMAIL_USER", "EMAIL_PASS", "TO_EMAIL", "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_SECURE", "HOSTEL_EMAIL_API_URL", "HOSTEL_SMS_API_URL"];

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const shiftDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

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
  if (postgresService.isLive()) await removeInstitutions(clients.map((client) => client.institution));
  await smtp?.close();
  await new Promise((resolve) => server.close(resolve));
  ENV.forEach((key) => (savedEnv[key] === undefined ? delete process.env[key] : (process.env[key] = savedEnv[key])));
  setTimeout(() => process.exit(), 200).unref();
});

const mails = (address) =>
  smtp.state.messages.filter((mail) => mail.to.some((line) => line.toLowerCase().includes(address.toLowerCase()))).map((mail) => decodeMail(mail.raw));

const waitFor = async (check, label) => {
  for (let i = 0; i < 40; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for: ${label}`);
};

const setup = async () => {
  const client = createClient(() => baseUrl);
  clients.push(client);
  counter += 1;
  const room = await client.call("POST", "/hostel/rooms", { hostelName: "North", building: `B${counter}`, floor: "1", roomNumber: `R${counter}`, capacity: 3 });
  assert.strictEqual(room.status, 201, room.error);
  const { seats } = (await client.call("GET", `/hostel/rooms/${room.data.id}`)).data;
  const allocate = async (seat, change = {}) => {
    counter += 1;
    const res = await client.call("POST", "/hostel/allocations", {
      seatId: seat.id, studentId: `ST-${counter}`, studentName: `Student ${counter}`, studentPhone: "01711111111",
      studentEmail: `st${counter}@example.com`, guardianName: "Guardian Name", guardianPhone: "01722222222",
      guardianRelationship: "Father", monthlyRent: 5000, startDate: `${today().slice(0, 7)}-01`,
      firstDueDate: shiftDays(today(), 5), ...change,
    });
    assert.strictEqual(res.status, 201, res.error);
    return res.data;
  };
  return { ...client, room: room.data, seats, allocate };
};

const ledgerOf = async (ctx, allocationId) => (await ctx.call("GET", `/hostel/ledger/${allocationId}`)).data;
const rentInvoices = async (ctx, allocationId) => (await ledgerOf(ctx, allocationId)).invoices.filter((item) => item.category === "RENT");

// ---- Rent synchronisation ------------------------------------------------

test("seat fee and allocation rent stay in step, from either side", live(async () => {
  const ctx = await setup();
  const [seat] = ctx.seats;

  // A vacant seat's fee is just the default.
  await ctx.call("PUT", `/hostel/seats/${seat.id}`, { monthlyFee: 4500 });
  assert.strictEqual((await ctx.call("GET", `/hostel/seats/${seat.id}/rent`)).data.seatFee, 4500);

  // Scenario B: allocating at 6000 sets the seat's fee to 6000.
  const allocation = await ctx.allocate(seat, { monthlyRent: 6000 });
  let rent = (await ctx.call("GET", `/hostel/seats/${seat.id}/rent`)).data;
  assert.strictEqual(rent.seatFee, 6000);
  assert.strictEqual(rent.contract.currentRent, 6000);
  const [issued] = await rentInvoices(ctx, allocation.id);
  assert.strictEqual(issued.rentAmount, 6000);

  // Scenario A: Edit Seat to 5000 changes the student's rent from the next month only.
  const edit = await ctx.call("PUT", `/hostel/seats/${seat.id}`, { monthlyFee: 5000 });
  assert.strictEqual(edit.status, 200, edit.error);
  assert.strictEqual(edit.data.monthlyFee, 5000);
  assert.strictEqual(edit.data.allocationRent, 5000);
  rent = (await ctx.call("GET", `/hostel/seats/${seat.id}/rent`)).data;
  assert.strictEqual(rent.contract.currentRent, 6000, "this month is already invoiced");
  assert.strictEqual(rent.contract.nextRent.rent, 5000);
  assert.ok(rent.contract.nextRent.effectiveMonth > `${today().slice(0, 7)}-01`);
  assert.strictEqual((await rentInvoices(ctx, allocation.id))[0].rentAmount, 6000, "issued invoices never change");
  assert.strictEqual((await ctx.call("GET", `/hostel/allocations/${allocation.id}`)).data.monthlyRent, 5000);

  // Scenario C: changing it from the allocation updates the seat.
  const fromAllocation = await ctx.call("PUT", `/hostel/allocations/${allocation.id}`, { monthlyRent: 5500 });
  assert.strictEqual(fromAllocation.status, 200, fromAllocation.error);
  const seats = (await ctx.call("GET", "/hostel/seats")).data;
  assert.strictEqual(seats.find((item) => item.id === seat.id).monthlyFee, 5500);

  // A rent change cannot reach back into invoiced months.
  const early = await ctx.call("PUT", `/hostel/seats/${seat.id}/rent`, { monthlyFee: 4000, effectiveMonth: today().slice(0, 7) });
  assert.strictEqual(early.status, 400);
  const later = await ctx.call("PUT", `/hostel/seats/${seat.id}/rent`, { monthlyFee: 4000, effectiveMonth: rent.contract.earliestChangeMonth.slice(0, 7) });
  assert.strictEqual(later.status, 200, later.error);

  // Every change is in one history, with who made it and from where.
  const history = (await ctx.call("GET", `/hostel/seats/${seat.id}/rent`)).data.history;
  assert.deepStrictEqual(history.map((item) => item.source).reverse(), ["SEAT", "ALLOCATED", "SEAT", "ALLOCATION", "SEAT"]);
  assert.ok(history.every((item) => item.changedBy === "test@example.com"));

  // Two people changing the rent at once both finish, and the two values still match.
  const results = await Promise.all([
    ctx.call("PUT", `/hostel/seats/${seat.id}`, { monthlyFee: 7000 }),
    ctx.call("PUT", `/hostel/allocations/${allocation.id}`, { monthlyRent: 7100 }),
    ctx.call("PUT", `/hostel/seats/${seat.id}`, { monthlyFee: 7200 }),
  ]);
  assert.ok(results.every((item) => item.status === 200), JSON.stringify(results.map((item) => item.error)));
  const finalSeat = (await ctx.call("GET", "/hostel/seats")).data.find((item) => item.id === seat.id);
  assert.strictEqual(finalSeat.monthlyFee, finalSeat.allocationRent, "still the same value");

  // After vacating, the seat keeps its fee as the next student's default.
  await ctx.call("POST", `/hostel/allocations/${allocation.id}/vacate`, {});
  const vacant = (await ctx.call("GET", "/hostel/seats")).data.find((item) => item.id === seat.id);
  assert.strictEqual(vacant.status, "Available");
  assert.strictEqual(vacant.monthlyFee, finalSeat.monthlyFee);
}));

// ---- Allocation email and deposit ------------------------------------------

test("allocation sends a full confirmation, once, and a deposit invoice", live(async () => {
  const ctx = await setup();
  const settings = (await ctx.call("GET", "/hostel/rent/config")).data.settings;
  await ctx.call("PUT", "/hostel/rent/settings", { ...settings, contactInfo: "Office 0170000000", hostelRules: "Gate closes at 10 PM." });
  const allocation = await ctx.allocate(ctx.seats[0], { securityDeposit: 3000 });

  const mail = await waitFor(() => mails(allocation.studentEmail).find((text) => /seat is confirmed/.test(text)), "allocation email");
  [allocation.studentName, allocation.studentId, "North", "Monthly Rent", "BDT 5,000", "Security Deposit", "BDT 3,000",
    "Guardian Name", "Office 0170000000", "Gate closes at 10 PM", "Payment Due Date"].forEach((text) =>
    assert.ok(mail.includes(text), `email has ${text}`));

  const resend = await ctx.call("POST", `/hostel/allocations/${allocation.id}/confirmation`);
  assert.strictEqual(resend.data.status, "Sent");
  const again = await ctx.call("POST", `/hostel/allocations/${allocation.id}/confirmation`);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(mails(allocation.studentEmail).filter((text) => /seat is confirmed/.test(text)).length, 2, "one automatic, one resend a day");

  const ledger = await ledgerOf(ctx, allocation.id);
  const deposit = ledger.invoices.find((item) => item.category === "DEPOSIT");
  assert.strictEqual(deposit.rentAmount, 3000);
  assert.strictEqual(deposit.title, "Security deposit");
  assert.strictEqual(ledger.totalOutstanding, 8000, "deposit and rent are both owed");
  assert.strictEqual((await ctx.call("GET", "/hostel/due-rent/count")).data.invoices, 0, "a deposit is not rent");

  // A failed email never undoes the allocation.
  smtp.state.down = true;
  const second = await ctx.allocate(ctx.seats[1]);
  assert.strictEqual(second.status, "Allocated");
  const row = await waitFor(async () =>
    (await ctx.call("GET", "/hostel/notifications")).data.find((item) => item.allocationId === second.id && item.scenario === "ALLOCATION"), "logged");
  assert.ok(["Pending", "Failed"].includes(row.status));
  smtp.state.down = false;

  // Without an email address, nothing is claimed as sent.
  const third = await ctx.allocate(ctx.seats[2], { studentEmail: "" });
  const skipped = await waitFor(async () =>
    (await ctx.call("GET", "/hostel/notifications")).data.find((item) => item.allocationId === third.id && item.scenario === "ALLOCATION"), "skipped");
  assert.strictEqual(skipped.status, "Skipped");
}));

// ---- Meals ---------------------------------------------------------------

const mealBody = (change = {}) => ({
  title: "Friday Lunch", mealType: "Lunch", mealDate: today(), category: "Regular", description: "Rice and curry",
  menuItems: ["Rice", "Chicken Curry", "Dal"], pricePerMeal: 80, additionalCharge: 10,
  bookingOpensAt: inMinutes(-60), bookingClosesAt: inMinutes(60), collectFrom: inMinutes(90), collectUntil: inMinutes(150),
  ...change,
});

test("meals: draft, publish lock, deadline, orders and money", live(async () => {
  const ctx = await setup();
  const a = await ctx.allocate(ctx.seats[0]);
  const b = await ctx.allocate(ctx.seats[1]);

  assert.strictEqual((await ctx.call("POST", "/hostel/meals", mealBody({ menuItems: [] }))).status, 400);
  assert.strictEqual((await ctx.call("POST", "/hostel/meals", mealBody({ bookingClosesAt: inMinutes(-90) }))).status, 400);
  const created = await ctx.call("POST", "/hostel/meals", mealBody());
  assert.strictEqual(created.status, 201, created.error);
  const mealId = created.data.meal.id;
  assert.strictEqual(created.data.meal.status, "Draft");
  assert.strictEqual(created.data.meal.unitPrice, 90);

  // A draft cannot be booked, and can be edited.
  assert.strictEqual((await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: a.id, quantity: 1 })).status, 409);
  const edited = await ctx.call("PUT", `/hostel/meals/${mealId}`, mealBody({ menuItems: ["Rice", "Fish", "Salad"] }));
  assert.deepStrictEqual(edited.data.meal.menuItems, ["Rice", "Fish", "Salad"]);

  const published = await ctx.call("POST", `/hostel/meals/${mealId}/publish`);
  assert.strictEqual(published.data.meal.status, "Booking Open");
  assert.strictEqual((await ctx.call("PUT", `/hostel/meals/${mealId}`, mealBody())).status, 409, "locked after publishing");
  assert.strictEqual((await ctx.call("POST", `/hostel/meals/${mealId}/publish`)).status, 409);

  // Orders become meal invoices.
  const orderA = await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: a.id, quantity: 2 });
  assert.strictEqual(orderA.status, 201, orderA.error);
  assert.strictEqual(orderA.data.totalPrice, 180);
  assert.strictEqual((await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: a.id, quantity: 1 })).status, 409, "one order per student");
  assert.strictEqual((await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: b.id, quantity: 0 })).status, 400);
  const orderB = await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: b.id, quantity: 1 });

  const changed = await ctx.call("PUT", `/hostel/meal-bookings/${orderA.data.id}`, { quantity: 3 });
  assert.strictEqual(changed.data.quantity, 3);
  let mealInvoice = (await ledgerOf(ctx, a.id)).invoices.find((item) => item.category === "MEAL");
  assert.strictEqual(mealInvoice.amountDue, 270);
  assert.strictEqual(mealInvoice.rentAmount, 180, "the original charge stays; the change is an adjustment");

  const detail = (await ctx.call("GET", `/hostel/meals/${mealId}`)).data;
  assert.strictEqual(detail.meal.totalOrders, 2);
  assert.strictEqual(detail.meal.totalMeals, 4);
  assert.strictEqual(detail.meal.expectedRevenue, 360);
  assert.strictEqual(detail.orders[0].roomNumber, ctx.room.roomNumber);

  // Partly paid, then the deadline passes. Nothing can change after it.
  const pay = await ctx.call("POST", `/hostel/invoices/${mealInvoice.id}/payments`, { amount: 100, paymentDate: today(), method: "Cash" });
  assert.strictEqual(pay.status, 201, pay.error);
  assert.strictEqual((await ctx.call("PUT", `/hostel/meal-bookings/${orderA.data.id}`, { quantity: 1 })).status, 409, "cannot cut below paid");
  await postgresService.query("UPDATE hostel_meals SET booking_closes_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [mealId]);
  const late = await ctx.call("POST", `/hostel/meals/${mealId}/bookings`, { allocationId: ctx.seats[2].id, quantity: 1 });
  assert.strictEqual(late.status, 409);
  const lateChange = await ctx.call("PUT", `/hostel/meal-bookings/${orderB.data.id}`, { quantity: 2 });
  assert.strictEqual(lateChange.status, 409);
  assert.match(lateChange.error, /closed/);
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${mealId}`)).data.meal.status, "Booking Closed");

  const collected = await ctx.call("POST", `/hostel/meal-bookings/${orderA.data.id}/collected`);
  assert.ok(collected.data.collectedAt);

  // The member's meal history adds up from orders and invoices.
  const member = (await ctx.call("GET", `/hostel/meals/members/${a.id}`)).data;
  assert.strictEqual(member.totalMealsOrdered, 3);
  assert.strictEqual(member.totalMealsCollected, 3);
  assert.strictEqual(member.totalCost, 270);
  assert.strictEqual(member.totalPaid, 100);
  assert.strictEqual(member.totalOutstanding, 170);

  // Meal charges are not rent.
  assert.strictEqual((await ctx.call("GET", "/hostel/due-rent/count")).data.invoices, 0);

  // Cancelling clears what is unpaid and lists what must be refunded.
  const cancelled = await ctx.call("POST", `/hostel/meals/${mealId}/cancel`, { reason: "Kitchen closed" });
  assert.strictEqual(cancelled.status, 200, cancelled.error);
  assert.deepStrictEqual(cancelled.data.needsRefund.map((item) => item.paid), [100]);
  mealInvoice = (await ledgerOf(ctx, a.id)).invoices.find((item) => item.category === "MEAL");
  assert.strictEqual(mealInvoice.outstandingAmount, 0);
  assert.strictEqual(mealInvoice.paidAmount, 100, "the payment is kept");
  assert.strictEqual((await ledgerOf(ctx, b.id)).invoices.find((item) => item.category === "MEAL").amountDue, 0);
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${mealId}`)).data.meal.status, "Cancelled");

  // A draft is simply deleted.
  const draft = await ctx.call("POST", "/hostel/meals", mealBody());
  assert.strictEqual((await ctx.call("POST", `/hostel/meals/${draft.data.meal.id}/cancel`, {})).data.deleted, true);
  assert.strictEqual((await ctx.call("GET", `/hostel/meals/${draft.data.meal.id}`)).status, 404);
}));

test("meal dues: threshold reminders, chosen students, no repeats", live(async () => {
  const ctx = await setup();
  const a = await ctx.allocate(ctx.seats[0]);
  const b = await ctx.allocate(ctx.seats[1]);
  const meal = await ctx.call("POST", "/hostel/meals", mealBody({ pricePerMeal: 300, additionalCharge: 0 }));
  await ctx.call("POST", `/hostel/meals/${meal.data.meal.id}/publish`);
  await ctx.call("POST", `/hostel/meals/${meal.data.meal.id}/bookings`, { allocationId: a.id, quantity: 2 });
  await ctx.call("POST", `/hostel/meals/${meal.data.meal.id}/bookings`, { allocationId: b.id, quantity: 1 });

  const dues = (await ctx.call("GET", "/hostel/meals/dues")).data;
  assert.deepStrictEqual(dues.map((item) => item.outstanding), [600, 300]);

  // Automatic: only those at or above the threshold of 500.
  smtp.state.messages.length = 0;
  const auto = await queueMealReminders(ctx.institution);
  assert.deepStrictEqual(auto.map((item) => item.allocationId), [a.id]);
  const mail = await waitFor(() => mails(a.studentEmail).find((text) => /unpaid meal bills/.test(text)), "meal email");
  assert.ok(mail.includes("BDT 600") && mail.includes("Friday Lunch"));
  assert.strictEqual((await queueMealReminders(ctx.institution)).length, 0, "not again within the interval");

  // Chosen by staff, including someone under the threshold. Once a day.
  const manual = await ctx.call("POST", "/hostel/meals/dues/remind", { allocationIds: [b.id] });
  assert.strictEqual(manual.data[0].queued, 2);
  const repeat = await ctx.call("POST", "/hostel/meals/dues/remind", { allocationIds: [b.id] });
  assert.strictEqual(repeat.data[0].queued, 0);
  assert.strictEqual((await ctx.call("POST", "/hostel/meals/dues/remind", { allocationIds: [] })).status, 400);
}));

// ---- Visitors ------------------------------------------------------------

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString("base64");

test("visitors: ticket, check-in once, check-out, expiry and documents", live(async () => {
  const ctx = await setup();
  const host = await ctx.allocate(ctx.seats[0]);
  const body = (change = {}) => ({
    allocationId: host.id, visitorName: "Karim Uddin", visitorPhone: "01811111111", visitorEmail: "visitor@example.com",
    visitorNid: "1234567890", relationship: "Uncle", purpose: "Family visit", visitDate: today(),
    expectedArrival: "00:00", expectedDeparture: "23:59", sendTicketTo: "both",
    documents: { PHOTO: { fileName: "face.png", contentBase64: PNG } }, ...change,
  });

  assert.strictEqual((await ctx.call("POST", "/hostel/visitors", body({ visitorPhone: "abc" }))).status, 400);
  assert.strictEqual((await ctx.call("POST", "/hostel/visitors", body({ expectedDeparture: "00:00", expectedArrival: "10:00" }))).status, 400);
  assert.strictEqual((await ctx.call("POST", "/hostel/visitors", body({ visitDate: shiftDays(today(), -1) }))).status, 400);
  assert.strictEqual((await ctx.call("POST", "/hostel/visitors", body({ documents: { PHOTO: { fileName: "x.png", contentBase64: Buffer.from("nope").toString("base64") } } }))).status, 400);

  const visit = await ctx.call("POST", "/hostel/visitors", body());
  assert.strictEqual(visit.status, 201, visit.error);
  assert.match(visit.data.ticketNumber, /^VT-[A-Z2-9]{8}$/);
  assert.strictEqual(visit.data.status, "Pending");
  assert.strictEqual(visit.data.hostName, host.studentName);
  assert.strictEqual(visit.data.visitorNid, "•••••••890", "NID is masked");
  assert.ok(visit.data.hasPhoto);
  await waitFor(() => mails("visitor@example.com").find((text) => text.includes(visit.data.ticketNumber)), "ticket to visitor");
  await waitFor(() => mails(host.studentEmail).find((text) => text.includes(visit.data.ticketNumber)), "ticket to host");

  const found = await ctx.call("GET", `/hostel/visitors/ticket/${visit.data.ticketNumber.toLowerCase()}`);
  assert.strictEqual(found.data.id, visit.data.id);
  assert.strictEqual((await ctx.call("GET", "/hostel/visitors/ticket/VT-NOPE")).status, 404);

  const photo = await ctx.call("GET", `/hostel/visitor-documents/${found.data.photoId}`);
  assert.strictEqual(photo.data.mimeType, "image/png");

  assert.strictEqual((await ctx.call("POST", `/hostel/visitors/${visit.data.id}/check-out`)).status, 409, "not in yet");
  const inside = await ctx.call("POST", `/hostel/visitors/${visit.data.id}/check-in`);
  assert.strictEqual(inside.data.status, "Checked In");
  assert.strictEqual(inside.data.checkedInBy, "test@example.com");
  assert.strictEqual((await ctx.call("POST", `/hostel/visitors/${visit.data.id}/check-in`)).status, 409, "no second entry");
  const out = await ctx.call("POST", `/hostel/visitors/${visit.data.id}/check-out`);
  assert.strictEqual(out.data.status, "Checked Out");
  assert.strictEqual((await ctx.call("POST", `/hostel/visitors/${visit.data.id}/check-in`)).status, 409, "a used ticket cannot be reused");
  const history = (await ctx.call("GET", `/hostel/visitors/${visit.data.id}`)).data.history.map((item) => item.action);
  assert.deepStrictEqual(history, ["Registered", "Checked In", "Checked Out"]);

  // A ticket for another day cannot be used today, and an old one expires.
  const tomorrow = await ctx.call("POST", "/hostel/visitors", body({ visitDate: shiftDays(today(), 1), sendTicketTo: "none", documents: {} }));
  const early = await ctx.call("POST", `/hostel/visitors/${tomorrow.data.id}/check-in`);
  assert.strictEqual(early.status, 409);
  assert.match(early.error, /not today/);
  await postgresService.query("UPDATE hostel_visitors SET visit_date = $2 WHERE id = $1", [tomorrow.data.id, shiftDays(today(), -1)]);
  assert.strictEqual((await ctx.call("GET", `/hostel/visitors/${tomorrow.data.id}`)).data.status, "Expired");
  assert.strictEqual((await ctx.call("POST", `/hostel/visitors/${tomorrow.data.id}/check-in`)).status, 409);

  // Cancelled and rejected tickets are refused.
  const third = await ctx.call("POST", "/hostel/visitors", body({ sendTicketTo: "none", documents: {} }));
  assert.strictEqual((await ctx.call("POST", `/hostel/visitors/${third.data.id}/status`, { status: "Cancelled" })).status, 400, "reason needed");
  await ctx.call("POST", `/hostel/visitors/${third.data.id}/status`, { status: "Cancelled", reason: "Not coming" });
  assert.strictEqual((await ctx.call("POST", `/hostel/visitors/${third.data.id}/check-in`)).status, 409);
}));

// ---- Fees and invoices ---------------------------------------------------

test("fees: assign by building, raise once, monthly by month, overview", live(async () => {
  const ctx = await setup();
  const a = await ctx.allocate(ctx.seats[0], { startDate: `${shiftDays(`${today().slice(0, 7)}-01`, -20).slice(0, 7)}-01` });
  const other = await setup();
  const outsider = await other.allocate(other.seats[0]);

  assert.strictEqual((await ctx.call("POST", "/hostel/fees", { name: "Bad", amount: 0, frequency: "ONE_TIME", effectiveDate: today() })).status, 400);
  const admission = await ctx.call("POST", "/hostel/fees", { name: "Admission Fee", amount: 1500, frequency: "ONE_TIME", dueDays: 7, effectiveDate: today() });
  assert.strictEqual(admission.status, 201, admission.error);
  const maintenance = await ctx.call("POST", "/hostel/fees", { name: "Maintenance Fee", amount: 200, frequency: "MONTHLY", dueDays: 10, effectiveDate: `${shiftDays(`${today().slice(0, 7)}-01`, -20).slice(0, 8)}01` });
  assert.strictEqual(maintenance.status, 201, maintenance.error);
  assert.strictEqual((await ctx.call("POST", "/hostel/fees", { name: "Admission Fee", amount: 1, frequency: "ONE_TIME", effectiveDate: today() })).status, 409);

  const assigned = await ctx.call("POST", "/hostel/fee-assignments", { feeTypeId: admission.data.id, scope: "BUILDING", targetIds: [ctx.seats[0].buildingId] });
  assert.strictEqual(assigned.status, 201, assigned.error);
  await ctx.call("POST", "/hostel/fee-assignments", { feeTypeId: maintenance.data.id, scope: "STUDENTS", targetIds: [a.id] });

  const fees = (await ledgerOf(ctx, a.id)).invoices.filter((item) => item.category === "FEE");
  assert.deepStrictEqual(fees.map((item) => item.rentAmount).sort((x, y) => x - y), [200, 200, 1500], "one admission, one maintenance per month");
  await billFees(ctx.institution);
  assert.strictEqual((await ledgerOf(ctx, a.id)).invoices.filter((item) => item.category === "FEE").length, 3, "never twice");
  assert.strictEqual((await ledgerOf(other, outsider.id)).invoices.filter((item) => item.category === "FEE").length, 0, "other tenants untouched");

  // A new amount applies only to new charges.
  await ctx.call("PUT", `/hostel/fees/${admission.data.id}`, { name: "Admission Fee", amount: 2000, frequency: "ONE_TIME", effectiveDate: today() });
  const b = await ctx.allocate(ctx.seats[1]);
  await billFees(ctx.institution);
  assert.strictEqual((await ledgerOf(ctx, b.id)).invoices.find((item) => item.category === "FEE").rentAmount, 2000);
  assert.strictEqual((await ledgerOf(ctx, a.id)).invoices.find((item) => item.title === "Admission Fee").rentAmount, 1500);

  // Stopping an assignment stops new charges.
  const assignments = (await ctx.call("GET", "/hostel/fees")).data.assignments;
  await ctx.call("POST", `/hostel/fee-assignments/${assignments.find((item) => item.feeName === "Admission Fee").id}/stop`, { reason: "Ended" });
  const c = await ctx.allocate(ctx.seats[2]);
  await billFees(ctx.institution);
  assert.strictEqual((await ledgerOf(ctx, c.id)).invoices.filter((item) => item.category === "FEE").length, 0);

  const overview = (await ctx.call("GET", "/hostel/fees")).data.overview;
  const categories = Object.fromEntries(overview.categories.map((item) => [item.category, item]));
  assert.strictEqual(categories.FEE.expected, 3900);
  assert.ok(categories.RENT.expected > 0);
  assert.strictEqual(overview.expected, overview.collected + overview.outstanding);
}));

test("invoices: category filter, lines, PDF, email and tenant isolation", live(async () => {
  const ctx = await setup();
  const a = await ctx.allocate(ctx.seats[0], { securityDeposit: 1000 });
  const all = (await ctx.call("GET", "/hostel/invoices")).data;
  assert.deepStrictEqual([...new Set(all.map((item) => item.category))].sort(), ["DEPOSIT", "RENT"]);
  const deposits = (await ctx.call("GET", "/hostel/invoices?category=DEPOSIT")).data;
  assert.strictEqual(deposits.length, 1);
  assert.strictEqual((await ctx.call("GET", `/hostel/invoices?from=${shiftDays(today(), 1)}`)).data.length, 0);
  assert.strictEqual((await ctx.call("GET", `/hostel/invoices?buildingId=${ctx.seats[0].buildingId}`)).data.length, 2);

  const detail = (await ctx.call("GET", `/hostel/invoices/${deposits[0].id}`)).data;
  assert.deepStrictEqual(detail.items.map((item) => item.amount), [1000]);
  const rent = all.find((item) => item.category === "RENT");
  assert.match((await ctx.call("GET", `/hostel/invoices/${rent.id}`)).data.items[0].description, /Seat rent/);

  const pdf = await ctx.call("GET", `/hostel/invoices/${rent.id}/pdf`);
  assert.strictEqual(Buffer.from(pdf.data.contentBase64, "base64").subarray(0, 4).toString(), "%PDF");

  smtp.state.messages.length = 0;
  const sent = await ctx.call("POST", `/hostel/invoices/${deposits[0].id}/email`);
  assert.strictEqual(sent.data.status, "Sent", sent.data.error);
  const mail = mails(a.studentEmail).find((text) => /Security deposit/.test(text));
  assert.ok(mail && /hostel\/payment\/[\w-]{43}/.test(mail), "a payment link is included");

  // Another institution sees none of it.
  const other = createClient(() => baseUrl);
  clients.push(other);
  for (const [method, path] of [
    ["GET", `/hostel/invoices/${rent.id}/pdf`], ["POST", `/hostel/invoices/${rent.id}/email`],
    ["GET", `/hostel/seats/${ctx.seats[0].id}/rent`], ["PUT", `/hostel/seats/${ctx.seats[0].id}/rent`],
    ["POST", `/hostel/allocations/${a.id}/confirmation`], ["GET", `/hostel/meals/members/${a.id}`],
  ]) {
    const res = await other.call(method, path, method === "GET" ? undefined : { monthlyFee: 1 });
    assert.ok([404, 400].includes(res.status) || (res.status === 200 && JSON.stringify(res.data).indexOf(a.studentName) === -1), `${method} ${path} leaked (${res.status})`);
  }
  assert.strictEqual((await other.call("GET", "/hostel/invoices")).data.length, 0);
  assert.strictEqual((await other.call("POST", `/hostel/meals/x/bookings`, { allocationId: a.id, quantity: 1 })).status, 404);
}));

test("permissions on the new features", live(async () => {
  const ctx = await setup();
  const checks = [
    ["GET", "/hostel/meals", { HOSTEL_WARDEN: 200, ACCOUNTANT: 200, TEACHER: 403 }],
    ["POST", "/hostel/meals", { HOSTEL_WARDEN: 400, ACCOUNTANT: 403, TEACHER: 403 }],
    ["GET", "/hostel/visitors", { HOSTEL_WARDEN: 200, ACCOUNTANT: 403, TEACHER: 403 }],
    ["POST", "/hostel/fees", { HOSTEL_WARDEN: 403, ACCOUNTANT: 400, TEACHER: 403 }],
    ["GET", "/hostel/fees", { HOSTEL_WARDEN: 200, ACCOUNTANT: 200, TEACHER: 403 }],
    ["PUT", `/hostel/seats/${ctx.seats[0].id}/rent`, { HOSTEL_WARDEN: 200, ACCOUNTANT: 403, TEACHER: 403 }],
  ];
  for (const [method, path, expected] of checks) {
    for (const [role, status] of Object.entries(expected)) {
      const res = await ctx.call(method, path, method === "GET" ? undefined : { monthlyFee: 100 }, role);
      assert.strictEqual(res.status, status, `${role} ${method} ${path}: ${res.error}`);
    }
    assert.strictEqual((await ctx.call(method, path, method === "GET" ? undefined : {}, null)).status, 401);
  }
}));

test("account provisioning needs an admin login and stays in their institution", live(async () => {
  const anonymous = await fetch(`${baseUrl}/auth/provision-user`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Mallory", role: "ADMIN", institutionId: "inst-002" }),
  });
  assert.strictEqual(anonymous.status, 401);
  const ctx = createClient(() => baseUrl);
  clients.push(ctx);
  assert.strictEqual((await ctx.call("POST", "/auth/provision-user", { fullName: "Eve", role: "ADMIN" }, "TEACHER")).status, 403);
  const made = await ctx.call("POST", "/auth/provision-user", { fullName: "New Staff", role: "STAFF", institutionId: "inst-002" });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.data.user.institutionId, ctx.institution, "cannot create users in another institution");
}));
