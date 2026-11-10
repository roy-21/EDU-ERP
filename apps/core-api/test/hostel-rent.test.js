// Needs PostgreSQL (docker compose up -d erp-postgres). Skips when it is offline.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { generateInvoices } = require("../dist/modules/hostel/hostel-billing.service");
const {
  addMonths,
  daysBetween,
  dueDateFor,
  monthOf,
} = require("../dist/modules/hostel/hostel.common");
const { resolveDueDay } = require("../dist/modules/hostel/hostel-rent.repository");
const {
  deliverPending,
  queueDueReminders,
} = require("../dist/modules/hostel/hostel-notifications.service");
const { runRentCycle } = require("../dist/modules/hostel/hostel.scheduler");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");

let baseUrl;
let server;
let provider;
let providerAnswer = 200;
const providerCalls = [];

const main = createClient(() => baseUrl);
const other = createClient(() => baseUrl);
const { call, institution } = main;

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const shiftDays = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

let counter = 0;

const newSeat = async (change = {}) => {
  counter += 1;
  const room = await call("POST", "/hostel/rooms", {
    hostelName: change.hostelName || "Rent Hostel",
    building: change.building || "A",
    floor: "1st",
    roomNumber: `R${counter}`,
    capacity: change.capacity || 2,
  });
  assert.strictEqual(room.status, 201, room.error);
  const detail = await call("GET", `/hostel/rooms/${room.data.id}`);
  return { room: room.data, seats: detail.data.seats, seat: detail.data.seats[0] };
};

const allocationBody = (seatId, change = {}) => {
  counter += 1;
  return {
    seatId,
    studentId: `S-${counter}`,
    studentName: `Student ${counter}`,
    studentPhone: "01711111111",
    studentEmail: `s${counter}@example.com`,
    guardianName: "Guardian",
    guardianPhone: "01722222222",
    monthlyRent: 5000,
    startDate: `${today().slice(0, 7)}-01`,
    // Yesterday, so the first invoice is already overdue.
    firstDueDate: shiftDays(today(), -1),
    ...change,
  };
};

const allocate = async (change = {}, seatChange = {}) => {
  const { seat, room, seats } = await newSeat(seatChange);
  const res = await call("POST", "/hostel/allocations", allocationBody(seat.id, change));
  assert.strictEqual(res.status, 201, res.error);
  return { allocation: res.data, seat, room, seats };
};

const invoicesOf = async (allocationId) =>
  (await call("GET", `/hostel/ledger/${allocationId}`)).data.invoices;

const pay = (invoiceId, amount, change = {}) =>
  call("POST", `/hostel/invoices/${invoiceId}/payments`, {
    amount,
    paymentDate: today(),
    method: "Cash",
    ...change,
  });

test.before(async () => {
  await postgresService.initialize();
  await new Promise((resolve) => {
    server = createApp().listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
      resolve();
    });
  });
  await new Promise((resolve) => {
    provider = http
      .createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          // Seat confirmations are sent on every allocation; these tests count reminders.
          const message = JSON.parse(body);
          if (!/seat is confirmed/.test(message.subject)) providerCalls.push({ auth: req.headers.authorization, ...message });
          res.statusCode = providerAnswer;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ id: "provider-123" }));
        });
      })
      .listen(0, resolve);
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  if (postgresService.isLive()) {
    await removeInstitutions([institution, other.institution]);
  }
});

test("due dates handle short months", () => {
  assert.strictEqual(dueDateFor("2027-02-01", 31), "2027-02-28");
  assert.strictEqual(dueDateFor("2028-02-01", 31), "2028-02-29");
  assert.strictEqual(dueDateFor("2027-04-01", 31), "2027-04-30");
  assert.strictEqual(dueDateFor("2027-01-01", 31), "2027-01-31");
  assert.strictEqual(dueDateFor("2027-02-01", 10), "2027-02-10");
  assert.strictEqual(addMonths("2026-12-01", 1), "2027-01-01");
  assert.strictEqual(addMonths("2027-01-01", -1), "2026-12-01");
  assert.strictEqual(daysBetween("2027-02-27", "2027-03-01"), 2);
});

test("seat overrides building, and building overrides global", () => {
  assert.deepStrictEqual(resolveDueDay(20, 15, 10), { dueDay: 20, source: "SEAT" });
  assert.deepStrictEqual(resolveDueDay(null, 15, 10), { dueDay: 15, source: "BUILDING" });
  assert.deepStrictEqual(resolveDueDay(null, null, 10), { dueDay: 10, source: "GLOBAL" });
});

test("configuration priority works and falls back when removed", live(async () => {
  const buildingName = "Priority";
  const { seat, seats } = await newSeat({ building: buildingName });
  const effective = async (id) => (await call("GET", `/hostel/rent/seats/${id}/effective-due-day`)).data;
  const config = (await call("GET", "/hostel/rent/config")).data;
  const building = config.buildings.find((item) => item.name === buildingName);

  const settings = {
    ...config.settings,
    defaultDueDay: 10,
    reminderDaysBefore: [3, 1],
  };
  delete settings.updatedAt;
  assert.strictEqual((await call("PUT", "/hostel/rent/settings", settings)).status, 200);
  assert.deepStrictEqual(await effective(seat.id), { dueDay: 10, source: "GLOBAL" });

  await call("PUT", `/hostel/rent/buildings/${building.id}`, { dueDay: 15 });
  assert.deepStrictEqual(await effective(seat.id), { dueDay: 15, source: "BUILDING" });
  assert.deepStrictEqual(await effective(seats[1].id), { dueDay: 15, source: "BUILDING" });

  await call("PUT", `/hostel/rent/seats/${seat.id}`, { dueDay: 20 });
  assert.deepStrictEqual(await effective(seat.id), { dueDay: 20, source: "SEAT" });
  assert.deepStrictEqual(await effective(seats[1].id), { dueDay: 15, source: "BUILDING" });

  await call("PUT", `/hostel/rent/seats/${seat.id}`, { dueDay: null });
  assert.deepStrictEqual(await effective(seat.id), { dueDay: 15, source: "BUILDING" });
  await call("PUT", `/hostel/rent/buildings/${building.id}`, { dueDay: null });
  assert.deepStrictEqual(await effective(seat.id), { dueDay: 10, source: "GLOBAL" });

  assert.strictEqual((await call("PUT", `/hostel/rent/seats/${seat.id}`, { dueDay: 32 })).status, 400);
  assert.strictEqual((await call("PUT", "/hostel/rent/settings", { ...settings, timezone: "Mars/Base" })).status, 400);

  const audit = (await call("GET", "/hostel/audit?limit=20")).data;
  assert.ok(audit.some((row) => row.entityType === "Rent Config" && /due day set to 20/.test(row.summary)));
}));

test("allocating needs contact details, rent and a start date", live(async () => {
  const { seat } = await newSeat();
  const cases = [
    [{ studentPhone: "" }, /Student phone/],
    [{ guardianName: "" }, /Guardian name/],
    [{ guardianPhone: "" }, /Guardian phone/],
    [{ monthlyRent: 0 }, /Monthly rent/],
    [{ startDate: "" }, /start date/],
    [{ studentEmail: "not-an-email" }, /email/],
    [{ studentNid: "12" }, /NID/],
    [{ monthlyRent: -5 }, /Monthly rent/],
    [{ monthlyRent: 10.555 }, /decimal/],
    [{ startDate: "2026-02-30" }, /valid date/],
  ];
  for (const [change, message] of cases) {
    const res = await call("POST", "/hostel/allocations", allocationBody(seat.id, change));
    assert.strictEqual(res.status, 400, JSON.stringify(change));
    assert.match(res.error, message);
  }
}));

test("invoices are created once per month from the start date", live(async () => {
  const current = monthOf(today());
  const start = addMonths(current, -3);
  const { allocation } = await allocate({ startDate: start, firstDueDate: undefined });

  const invoices = await invoicesOf(allocation.id);
  assert.deepStrictEqual(
    invoices.map((item) => item.billingMonth),
    [current, addMonths(current, -1), addMonths(current, -2), start]
  );

  const repeat = await call("POST", "/hostel/invoices/generate");
  assert.strictEqual(repeat.status, 200);
  const again = await Promise.all([
    generateInvoices(institution),
    generateInvoices(institution),
    generateInvoices(institution),
  ]);
  assert.ok(again.every((run) => run.created === 0 && run.errors.length === 0));
  assert.strictEqual((await invoicesOf(allocation.id)).length, 4);

  assert.ok(invoices.every((item) => item.rentAmount === 5000));
  // Each invoice remembers what was unpaid when it was issued, without double counting.
  assert.strictEqual(invoices[3].previousOutstanding, 0);
  assert.strictEqual(invoices[2].previousOutstanding, 5000);
  assert.strictEqual(invoices[0].previousOutstanding, 15000);
  assert.strictEqual(invoices[0].totalPayable, 20000);
  assert.strictEqual((await call("GET", `/hostel/ledger/${allocation.id}`)).data.totalOutstanding, 20000);
}));

test("no invoice is created before an allocation starts", live(async () => {
  const start = addMonths(monthOf(today()), 2);
  const { allocation } = await allocate({ startDate: start, firstDueDate: undefined });
  assert.strictEqual((await invoicesOf(allocation.id)).length, 0);

  await generateInvoices(institution, { today: shiftDays(start, 3) });
  const [invoice] = await invoicesOf(allocation.id);
  assert.strictEqual(invoice.billingMonth, start);
}));

test("the first invoice is not due before the student moves in", live(async () => {
  const start = addMonths(monthOf(today()), 2);
  const moveIn = shiftDays(start, 19);
  const { allocation } = await allocate({ startDate: moveIn, firstDueDate: undefined });
  await generateInvoices(institution, { today: moveIn });
  const [invoice] = await invoicesOf(allocation.id);
  assert.strictEqual(invoice.dueDate, moveIn);
  assert.strictEqual(invoice.dueSource, "INITIAL");
}));

test("partial payments and carry forward match the worked example", live(async () => {
  const { allocation } = await allocate();
  const [november] = await invoicesOf(allocation.id);
  assert.strictEqual(november.status, "Overdue");

  const payment = await pay(november.id, 2000);
  assert.strictEqual(payment.status, 201, payment.error);

  const [paidNovember] = await invoicesOf(allocation.id);
  assert.strictEqual(paidNovember.rentAmount, 5000);
  assert.strictEqual(paidNovember.paidAmount, 2000);
  assert.strictEqual(paidNovember.outstandingAmount, 3000);
  assert.strictEqual(paidNovember.status, "Overdue");
  assert.ok(paidNovember.overdueDays >= 1);

  await generateInvoices(institution, { today: shiftDays(addMonths(monthOf(today()), 1), 1) });
  const [december, stillNovember] = await invoicesOf(allocation.id);
  assert.strictEqual(december.previousOutstanding, 3000);
  assert.strictEqual(december.rentAmount, 5000);
  assert.strictEqual(december.totalPayable, 8000);
  assert.strictEqual(december.outstandingAmount, 5000);
  assert.strictEqual(stillNovember.outstandingAmount, 3000);
  assert.strictEqual((await call("GET", `/hostel/ledger/${allocation.id}`)).data.totalOutstanding, 8000);

  assert.strictEqual((await pay(stillNovember.id, 3000)).status, 201);
  const [, settled] = await invoicesOf(allocation.id);
  assert.strictEqual(settled.status, "Paid");
  assert.strictEqual(settled.overdueDays, 0);
}));

test("status is Unpaid or Partially Paid before the due date", live(async () => {
  const { allocation } = await allocate({ firstDueDate: shiftDays(today(), 5) });
  const [invoice] = await invoicesOf(allocation.id);
  assert.strictEqual(invoice.status, "Unpaid");
  await pay(invoice.id, 1000);
  assert.strictEqual((await invoicesOf(allocation.id))[0].status, "Partially Paid");
}));

test("invalid and duplicate payments are refused", live(async () => {
  const { allocation } = await allocate();
  const [invoice] = await invoicesOf(allocation.id);

  assert.strictEqual((await pay(invoice.id, 0)).status, 400);
  assert.strictEqual((await pay(invoice.id, -1)).status, 400);
  assert.strictEqual((await pay(invoice.id, 5000.01)).status, 400);
  assert.strictEqual((await pay(invoice.id, 100, { method: "Gold" })).status, 400);
  assert.strictEqual((await pay(invoice.id, 100, { paymentDate: shiftDays(today(), 2) })).status, 400);
  assert.strictEqual((await pay("missing", 100)).status, 404);

  const reference = `TXN-${counter}-${Date.now()}`;
  assert.strictEqual((await pay(invoice.id, 100, { transactionReference: reference })).status, 201);
  const duplicate = await pay(invoice.id, 100, { transactionReference: reference.toLowerCase() });
  assert.strictEqual(duplicate.status, 409);
  assert.match(duplicate.error, /transaction reference/);

  const key = `key-${Date.now()}`;
  const first = await pay(invoice.id, 100, { idempotencyKey: key });
  const repeated = await pay(invoice.id, 100, { idempotencyKey: key });
  assert.strictEqual(first.status, 201);
  assert.strictEqual(repeated.status, 200);
  assert.strictEqual(repeated.data.id, first.data.id);
  assert.strictEqual((await invoicesOf(allocation.id))[0].paidAmount, 200);
}));

test("simultaneous payments cannot overpay an invoice", live(async () => {
  const { allocation } = await allocate();
  const [invoice] = await invoicesOf(allocation.id);
  const results = await Promise.all([1, 2, 3, 4].map(() => pay(invoice.id, 2000)));
  assert.deepStrictEqual(results.map((r) => r.status).sort(), [201, 201, 400, 400]);
  const [after] = await invoicesOf(allocation.id);
  assert.strictEqual(after.paidAmount, 4000);
  assert.strictEqual(after.outstandingAmount, 1000);
}));

test("a reversal restores the balance and keeps the record", live(async () => {
  const { allocation } = await allocate();
  const [invoice] = await invoicesOf(allocation.id);
  const reference = `REV-${Date.now()}`;
  const payment = (await pay(invoice.id, 5000, { transactionReference: reference })).data;
  assert.strictEqual((await invoicesOf(allocation.id))[0].status, "Paid");

  assert.strictEqual((await call("POST", `/hostel/payments/${payment.id}/reverse`, {})).status, 400);
  const reversed = await call("POST", `/hostel/payments/${payment.id}/reverse`, { reason: "Bounced" });
  assert.strictEqual(reversed.data.status, "Reversed");
  assert.strictEqual((await call("POST", `/hostel/payments/${payment.id}/reverse`, { reason: "Again" })).status, 409);

  const ledger = (await call("GET", `/hostel/ledger/${allocation.id}`)).data;
  assert.strictEqual(ledger.invoices[0].paidAmount, 0);
  assert.strictEqual(ledger.invoices[0].status, "Overdue");
  assert.strictEqual(ledger.payments[0].reversalReason, "Bounced");
  assert.ok(ledger.payments[0].receiptNumber);

  // The same reference can be used for the real payment.
  assert.strictEqual((await pay(invoice.id, 5000, { transactionReference: reference })).status, 201);
  const receipt = await call("GET", `/hostel/payments/${payment.id}/receipt`);
  assert.strictEqual(receipt.data.invoiceNumber, invoice.invoiceNumber);
}));

test("adjustments are controlled and never mark an unpaid invoice as paid", live(async () => {
  const { allocation } = await allocate();
  const [invoice] = await invoicesOf(allocation.id);
  const adjust = (amount, reason = "Correction") =>
    call("POST", `/hostel/invoices/${invoice.id}/adjustments`, { amount, reason });

  await pay(invoice.id, 1000);
  assert.strictEqual((await call("POST", `/hostel/invoices/${invoice.id}/adjustments`, { amount: -100 })).status, 400);
  assert.strictEqual((await adjust(0)).status, 400);
  assert.strictEqual((await adjust(-4500)).status, 400, "cannot go below what was paid");

  assert.strictEqual((await adjust(-1000, "Discount")).status, 201);
  const [after] = await invoicesOf(allocation.id);
  assert.strictEqual(after.amountDue, 4000);
  assert.strictEqual(after.outstandingAmount, 3000);
  assert.strictEqual(after.rentAmount, 5000, "the original rent stays on record");

  const waived = await allocate();
  const [fresh] = await invoicesOf(waived.allocation.id);
  await call("POST", `/hostel/invoices/${fresh.id}/adjustments`, { amount: -5000, reason: "Waiver" });
  assert.strictEqual((await invoicesOf(waived.allocation.id))[0].status, "Waived");
  assert.strictEqual((await invoicesOf(waived.allocation.id))[0].overdueDays, 0);
}));

test("config and rent changes do not rewrite issued invoices", live(async () => {
  const buildingName = "Snapshot";
  const { allocation, seat } = await allocate({ firstDueDate: undefined }, { building: buildingName });
  const [before] = await invoicesOf(allocation.id);

  const config = (await call("GET", "/hostel/rent/config")).data;
  const building = config.buildings.find((item) => item.name === buildingName);
  await call("PUT", `/hostel/rent/buildings/${building.id}`, { dueDay: 25 });
  await call("PUT", `/hostel/rent/seats/${seat.id}`, { dueDay: 28 });
  const rentChange = await call("PUT", `/hostel/allocations/${allocation.id}`, { monthlyRent: 7000 });
  assert.strictEqual(rentChange.status, 200, rentChange.error);

  const [after] = await invoicesOf(allocation.id);
  assert.strictEqual(after.dueDate, before.dueDate);
  assert.strictEqual(after.rentAmount, 5000);

  const nextMonth = addMonths(monthOf(today()), 1);
  await generateInvoices(institution, { today: shiftDays(nextMonth, 1) });
  const [next, original] = await invoicesOf(allocation.id);
  assert.strictEqual(next.rentAmount, 7000);
  assert.strictEqual(next.dueDate, dueDateFor(nextMonth, 28));
  assert.strictEqual(next.dueSource, "SEAT");
  assert.strictEqual(original.rentAmount, 5000);
}));

test("edits change only what was sent, and history is protected", live(async () => {
  const { allocation } = await allocate({ studentNid: "1234567890", guardianNid: "9876543210", department: "CSE" });

  const list = (await call("GET", "/hostel/allocations")).data.find((item) => item.id === allocation.id);
  assert.strictEqual(list.studentNid, "•••••••890");

  const manager = (await call("GET", `/hostel/allocations/${allocation.id}`)).data;
  assert.strictEqual(manager.studentNid, "1234567890");

  const updated = await call("PUT", `/hostel/allocations/${allocation.id}`, { studentPhone: "01799999999" });
  assert.strictEqual(updated.status, 200, updated.error);
  assert.strictEqual(updated.data.studentPhone, "01799999999");
  assert.strictEqual(updated.data.department, "CSE");
  assert.strictEqual(updated.data.guardianName, "Guardian");
  assert.strictEqual(updated.data.monthlyRent, 5000);

  const blank = await call("PUT", `/hostel/allocations/${allocation.id}`, { guardianName: "" });
  assert.strictEqual(blank.status, 400);

  const newStart = await call("PUT", `/hostel/allocations/${allocation.id}`, { startDate: "2020-01-01" });
  assert.strictEqual(newStart.status, 409);

  const audit = (await call("GET", "/hostel/audit?limit=5")).data;
  assert.ok(audit.some((row) => /studentPhone/.test(row.summary)));
  assert.ok(!audit.some((row) => /1234567890/.test(row.summary)), "NID never reaches the audit log");

  assert.strictEqual((await call("DELETE", `/hostel/allocations/${allocation.id}`)).status, 409);
}));

test("inactive billing is not charged later", live(async () => {
  const start = monthOf(today());
  const { allocation } = await allocate({ startDate: start });
  await call("PUT", `/hostel/allocations/${allocation.id}`, { billingActive: false });

  await generateInvoices(institution, { today: shiftDays(addMonths(start, 2), 1) });
  assert.strictEqual((await invoicesOf(allocation.id)).length, 1, "nothing billed while inactive");

  const resumed = await call("PUT", `/hostel/allocations/${allocation.id}`, { billingActive: true });
  assert.strictEqual(resumed.data.billingActive, true);
  await generateInvoices(institution, { today: shiftDays(start, 1) });
  assert.strictEqual((await invoicesOf(allocation.id)).length, 1);
}));

test("ending an allocation stops billing, keeps the debt, and frees the seat", live(async () => {
  const { allocation, seat } = await allocate();
  const end = today();
  assert.strictEqual((await call("POST", `/hostel/allocations/${allocation.id}/vacate`, { endDate: "2000-01-01" })).status, 400);
  const vacated = await call("POST", `/hostel/allocations/${allocation.id}/vacate`, { endDate: end });
  assert.strictEqual(vacated.data.status, "Vacated");
  assert.strictEqual(vacated.data.endDate, end);

  await generateInvoices(institution, { today: shiftDays(addMonths(monthOf(today()), 3), 1) });
  assert.strictEqual((await invoicesOf(allocation.id)).length, 1);

  const due = (await call("GET", `/hostel/due-rent?q=${encodeURIComponent(allocation.studentId)}`)).data;
  assert.strictEqual(due.rows.length, 1);

  const next = await call("POST", "/hostel/allocations", allocationBody(seat.id));
  assert.strictEqual(next.status, 201, next.error);
}));

test("deleting a room keeps invoices and payments", live(async () => {
  const { allocation, room } = await allocate();
  const [invoice] = await invoicesOf(allocation.id);
  await pay(invoice.id, 2000);
  assert.strictEqual((await call("DELETE", `/hostel/rooms/${room.id}`)).status, 409, "occupied");

  await call("POST", `/hostel/allocations/${allocation.id}/vacate`, {});
  assert.strictEqual((await call("DELETE", `/hostel/rooms/${room.id}`)).status, 200);

  const ledger = (await call("GET", `/hostel/ledger/${allocation.id}`)).data;
  assert.strictEqual(ledger.invoices[0].roomId, null);
  assert.strictEqual(ledger.invoices[0].roomNumber, room.roomNumber);
  assert.strictEqual(ledger.invoices[0].outstandingAmount, 3000);
  assert.strictEqual(ledger.payments[0].amount, 2000);
}));

test("due rent counts unique students and excludes settled invoices", live(async () => {
  const isolated = createClient(() => baseUrl);
  const api = isolated.call;
  try {
    const room = (await api("POST", "/hostel/rooms", { hostelName: "H", building: "B", floor: "1", roomNumber: "1", capacity: 4 })).data;
    const seats = (await api("GET", `/hostel/rooms/${room.id}`)).data.seats;
    const current = monthOf(today());

    // Two overdue months, one student.
    const twoMonths = (await api("POST", "/hostel/allocations", allocationBody(seats[0].id, {
      startDate: addMonths(current, -2),
      firstDueDate: addMonths(current, -2),
    }))).data;
    // Fully paid.
    const paid = (await api("POST", "/hostel/allocations", allocationBody(seats[1].id))).data;
    const paidInvoice = (await api("GET", `/hostel/ledger/${paid.id}`)).data.invoices[0];
    await api("POST", `/hostel/invoices/${paidInvoice.id}/payments`, { amount: 5000, paymentDate: today(), method: "Cash" });
    // Not yet due.
    await api("POST", "/hostel/allocations", allocationBody(seats[2].id, { firstDueDate: shiftDays(today(), 9) }));
    // Partly paid and overdue.
    const partial = (await api("POST", "/hostel/allocations", allocationBody(seats[3].id))).data;
    const partialInvoice = (await api("GET", `/hostel/ledger/${partial.id}`)).data.invoices[0];
    await api("POST", `/hostel/invoices/${partialInvoice.id}/payments`, { amount: 2000, paymentDate: today(), method: "Cash" });

    const twoMonthInvoices = (await api("GET", `/hostel/ledger/${twoMonths.id}`)).data.invoices;
    const overdueInTwoMonths = twoMonthInvoices.filter((item) => item.status === "Overdue");

    const count = (await api("GET", "/hostel/due-rent/count")).data;
    assert.strictEqual(count.students, 2);
    assert.strictEqual(count.invoices, overdueInTwoMonths.length + 1);
    assert.strictEqual(count.totalOutstanding, overdueInTwoMonths.length * 5000 + 3000);

    const list = (await api("GET", "/hostel/due-rent")).data;
    assert.ok(list.rows.every((row) => row.status === "Overdue" && row.outstandingAmount > 0));
    assert.ok(!list.rows.some((row) => row.allocationId === paid.id));

    const partialOnly = (await api("GET", "/hostel/due-rent?paymentState=Partially%20Paid")).data.rows;
    assert.deepStrictEqual(partialOnly.map((row) => row.allocationId), [partial.id]);
    assert.strictEqual(partialOnly[0].outstandingAmount, 3000);

    const byStudent = (await api("GET", `/hostel/due-rent?q=${partial.studentName}`)).data.rows;
    assert.strictEqual(byStudent.length, 1);
    const byMonth = (await api("GET", `/hostel/due-rent?month=${addMonths(current, -2)}`)).data.rows;
    assert.ok(byMonth.every((row) => row.billingMonth === addMonths(current, -2)));
    const byRoom = (await api("GET", "/hostel/due-rent?room=nope")).data.rows;
    assert.strictEqual(byRoom.length, 0);

    const exported = await api("GET", "/hostel/due-rent/export");
    assert.strictEqual(exported.data.length, list.rows.length);
  } finally {
    await removeInstitutions([isolated.institution]);
  }
}));

test("documents are validated, private and scoped", live(async () => {
  const { allocation } = await allocate();
  const upload = (change = {}, role, institutionId) =>
    call("POST", `/hostel/allocations/${allocation.id}/documents`, {
      documentType: "STUDENT_NID",
      fileName: "..\\..\\nid<script>.png",
      contentBase64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64"),
      ...change,
    }, role, institutionId);

  const saved = await upload();
  assert.strictEqual(saved.status, 201, saved.error);
  assert.strictEqual(saved.data.mimeType, "image/png");
  assert.ok(!/[\\/<>]/.test(saved.data.fileName));
  assert.strictEqual(saved.data.contentBase64, undefined);

  assert.strictEqual((await upload({ contentBase64: Buffer.from("MZ not an image").toString("base64") })).status, 400);
  assert.strictEqual((await upload({ documentType: "OTHER" })).status, 400);
  assert.strictEqual((await upload({ contentBase64: "" })).status, 400);
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024)]).toString("base64");
  assert.strictEqual((await upload({ contentBase64: big })).status, 400);

  assert.strictEqual((await upload({ fileName: "new.png" })).status, 201);
  const documents = (await call("GET", `/hostel/allocations/${allocation.id}/documents`)).data;
  assert.strictEqual(documents.length, 1);
  assert.strictEqual(documents[0].fileName, "new.png");

  const file = await call("GET", `/hostel/documents/${documents[0].id}`);
  assert.ok(file.data.contentBase64);

  assert.strictEqual((await call("GET", `/hostel/documents/${documents[0].id}`, undefined, "TEACHER")).status, 403);
  assert.strictEqual((await call("GET", `/hostel/documents/${documents[0].id}`, undefined, "ADMIN", other.institution)).status, 404);
  assert.strictEqual((await upload({}, "ADMIN", other.institution)).status, 404);
}));

test("reminders follow the schedule and never repeat", live(async () => {
  delete process.env.HOSTEL_EMAIL_API_URL;
  delete process.env.HOSTEL_SMS_API_URL;
  const isolated = createClient(() => baseUrl);
  const api = isolated.call;
  try {
    const room = (await api("POST", "/hostel/rooms", { hostelName: "H", building: "B", floor: "1", roomNumber: "1", capacity: 1 })).data;
    const [seat] = (await api("GET", `/hostel/rooms/${room.id}`)).data.seats;
    const dueDate = shiftDays(today(), 20);
    const allocation = (await api("POST", "/hostel/allocations", allocationBody(seat.id, { firstDueDate: dueDate, studentEmail: "" }))).data;
    const log = async () => (await api("GET", "/hostel/notifications")).data;
    const run = (date) => queueDueReminders(isolated.institution, { today: date, ignoreHour: true });

    assert.strictEqual((await run(shiftDays(dueDate, -5))).queued, 0, "not time yet");

    assert.strictEqual((await run(shiftDays(dueDate, -3))).queued, 3, "one per channel");
    assert.strictEqual((await run(shiftDays(dueDate, -3))).queued, 0, "same day never repeats");
    await deliverPending({ institutionId: isolated.institution });

    const first = await log();
    const byChannel = Object.fromEntries(first.map((row) => [row.channel, row]));
    assert.strictEqual(byChannel.IN_APP.status, "Sent");
    assert.strictEqual(byChannel.SMS.status, "Skipped", "an unconfigured provider is never reported as sent");
    assert.match(byChannel.SMS.lastError, /not configured/);
    assert.strictEqual(byChannel.EMAIL.status, "Skipped");
    assert.match(byChannel.EMAIL.lastError, /No email address/);
    assert.match(byChannel.IN_APP.body, new RegExp(allocation.studentName));
    assert.match(byChannel.IN_APP.body, /BDT 5,000/);
    assert.strictEqual(byChannel.IN_APP.scenario, "UPCOMING");

    await run(shiftDays(dueDate, -1));
    await run(dueDate);
    const scenarios = (await log()).map((row) => row.scenario);
    assert.ok(scenarios.includes("DUE_TODAY"));

    const [invoice] = (await api("GET", `/hostel/ledger/${allocation.id}`)).data.invoices;
    await api("POST", `/hostel/invoices/${invoice.id}/payments`, { amount: 1000, paymentDate: today(), method: "Cash" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok((await log()).some((row) => row.scenario === "PARTIAL_PAYMENT"));

    // Before the due date, a part-paid invoice gets the partial reminder.
    await postgresService.query("DELETE FROM hostel_notifications WHERE institution_id = $1", [isolated.institution]);
    await run(shiftDays(dueDate, -1));
    assert.ok((await log()).every((row) => row.scenario === "PARTIAL"));

    // Overdue: first reminder after one day, then every three days.
    const overdueDay = shiftDays(dueDate, 1);
    assert.strictEqual((await run(overdueDay)).queued, 3);
    assert.ok((await log()).some((row) => row.scenario === "OVERDUE"));
    await postgresService.query(
      "UPDATE hostel_notifications SET created_at = $2::date + INTERVAL '12 hours' WHERE institution_id = $1",
      [isolated.institution, overdueDay]
    );
    assert.strictEqual((await run(shiftDays(overdueDay, 1))).queued, 0, "inside the interval");
    assert.strictEqual((await run(shiftDays(overdueDay, 2))).queued, 0, "still inside the interval");
    assert.strictEqual((await run(shiftDays(overdueDay, 3))).queued, 3, "the interval has passed");
    assert.ok((await log()).some((row) => row.scenario === "OUTSTANDING"));
  } finally {
    await removeInstitutions([isolated.institution]);
  }
}));

test("providers get real requests, with retries and honest failures", live(async () => {
  const isolated = createClient(() => baseUrl);
  const api = isolated.call;
  try {
    const room = (await api("POST", "/hostel/rooms", { hostelName: "H", building: "B", floor: "1", roomNumber: "1", capacity: 2 })).data;
    const seats = (await api("GET", `/hostel/rooms/${room.id}`)).data.seats;
    const allocation = (await api("POST", "/hostel/allocations", allocationBody(seats[0].id))).data;
    const providerUrl = `http://127.0.0.1:${provider.address().port}/send`;
    process.env.HOSTEL_EMAIL_API_URL = providerUrl;
    process.env.HOSTEL_EMAIL_API_KEY = "secret-key";
    process.env.HOSTEL_EMAIL_FROM = "hostel@example.com";

    providerAnswer = 200;
    providerCalls.length = 0;
    const manual = await api("POST", `/hostel/notifications/remind/${allocation.id}`);
    assert.strictEqual(manual.status, 200, manual.error);
    const email = manual.data.channels.find((row) => row.channel === "EMAIL");
    assert.strictEqual(email.status, "Sent");
    assert.strictEqual(providerCalls.length, 1);
    assert.strictEqual(providerCalls[0].to, allocation.studentEmail);
    assert.strictEqual(providerCalls[0].auth, "Bearer secret-key");

    const repeat = await api("POST", `/hostel/notifications/remind/${allocation.id}`);
    assert.strictEqual(repeat.data.alreadySentToday, true);
    assert.strictEqual(providerCalls.length, 1, "a manual repeat does not send again");

    const second = (await api("POST", "/hostel/allocations", allocationBody(seats[1].id))).data;
    providerAnswer = 500;
    await api("POST", `/hostel/notifications/remind/${second.id}`);
    const failing = async () =>
      (await api("GET", "/hostel/notifications")).data.find(
        (row) => row.allocationId === second.id && row.channel === "EMAIL"
      );
    assert.strictEqual((await failing()).status, "Pending", "first failure waits for a retry");

    const force = () =>
      postgresService.query(
        "UPDATE hostel_notifications SET next_attempt_at = NOW() WHERE institution_id = $1 AND status = 'Pending'",
        [isolated.institution]
      );
    await force();
    await deliverPending({ institutionId: isolated.institution });
    await force();
    await deliverPending({ institutionId: isolated.institution });
    const failed = await failing();
    assert.strictEqual(failed.status, "Failed");
    assert.strictEqual(failed.attempts, 3);
    assert.match(failed.lastError, /HTTP 500/);

    providerAnswer = 200;
    const retried = await api("POST", `/hostel/notifications/${failed.id}/retry`);
    assert.strictEqual(retried.data.status, "Sent");
  } finally {
    delete process.env.HOSTEL_EMAIL_API_URL;
    delete process.env.HOSTEL_EMAIL_API_KEY;
    delete process.env.HOSTEL_EMAIL_FROM;
    await removeInstitutions([isolated.institution]);
  }
}));

test("templates can be customized", live(async () => {
  const save = await call("PUT", "/hostel/rent/templates/UPCOMING", { subject: "Pay soon", body: "Hi {{studentName}}" });
  assert.strictEqual(save.status, 200, save.error);
  const config = (await call("GET", "/hostel/rent/config")).data;
  assert.strictEqual(config.templates.find((t) => t.scenario === "UPCOMING").subject, "Pay soon");
  assert.strictEqual((await call("PUT", "/hostel/rent/templates/NOPE", { subject: "a", body: "b" })).status, 404);
  assert.strictEqual((await call("PUT", "/hostel/rent/templates/UPCOMING", { subject: "", body: "b" })).status, 400);
}));

test("the scheduled cycle is safe to repeat and to overlap", live(async () => {
  const { allocation } = await allocate();
  const before = (await invoicesOf(allocation.id)).length;

  const runs = await Promise.all([runRentCycle(), runRentCycle()]);
  assert.ok(runs.some((run) => run.skipped), "the second run backs off");
  assert.ok(runs.some((run) => run.institutions >= 1));
  assert.strictEqual((await invoicesOf(allocation.id)).length, before);

  const config = (await call("GET", "/hostel/rent/config")).data;
  assert.ok(config.lastJob);
}));

test("role permissions decide access, and changes apply immediately", live(async () => {
  const created = await call("POST", "/system/roles", {
    name: "Hostel Accounts",
    portalType: "STAFF",
    permissions: [{ moduleId: "hostel", canRead: true, canCreate: false, canUpdate: false, canDelete: false, canApprove: false, hostelPermissions: ["view_rooms", "view_due_rent"] }],
  });
  assert.strictEqual(created.status, 201, created.error);
  const roleId = created.data.id;

  {
    const asRole = (method, path, body) => call(method, path, body, roleId);
    const { allocation } = await allocate();
    const [invoice] = await invoicesOf(allocation.id);

    assert.deepStrictEqual((await asRole("GET", "/hostel/me/permissions")).data.permissions, ["view_rooms", "view_due_rent"]);
    assert.strictEqual((await asRole("GET", "/hostel/rooms")).status, 200);
    assert.strictEqual((await asRole("GET", "/hostel/due-rent")).status, 200);
    assert.strictEqual((await asRole("GET", "/hostel/due-rent/count")).status, 200);
    assert.strictEqual((await asRole("GET", `/hostel/ledger/${allocation.id}`)).data.documents.length, 0);

    // No permission for these yet.
    assert.strictEqual((await asRole("POST", `/hostel/invoices/${invoice.id}/payments`, { amount: 1, paymentDate: today(), method: "Cash" })).status, 403);
    assert.strictEqual((await asRole("GET", "/hostel/due-rent/export")).status, 403);
    assert.strictEqual((await asRole("GET", "/hostel/rent/config")).status, 403);
    assert.strictEqual((await asRole("POST", `/hostel/notifications/remind/${allocation.id}`)).status, 403);
    assert.strictEqual((await asRole("POST", "/hostel/rooms", {})).status, 403);

    // NID stays masked without the student permission.
    const masked = await allocate({ studentNid: "1234567890" });
    assert.strictEqual((await asRole("GET", `/hostel/ledger/${masked.allocation.id}`)).data.allocation.studentNid, "•••••••890");

    // An admin grants more through the existing role API.
    const update = await call("PUT", `/system/roles/${roleId}`, {
      permissions: [{ moduleId: "hostel", canRead: true, hostelPermissions: ["view_rooms", "manage_payments", "export_reports"] }],
    });
    assert.strictEqual(update.status, 200, update.error);
    assert.strictEqual((await asRole("POST", `/hostel/invoices/${invoice.id}/payments`, { amount: 1, paymentDate: today(), method: "Cash" })).status, 201);
    assert.strictEqual((await asRole("GET", "/hostel/due-rent/count")).status, 403, "removed permission stops working");
  }
}));

test("users without hostel permissions cannot reach rent data or change roles", live(async () => {
  const paths = [
    ["GET", "/hostel/rent/config"],
    ["PUT", "/hostel/rent/settings"],
    ["PUT", "/hostel/rent/buildings/x"],
    ["PUT", "/hostel/rent/seats/x"],
    ["GET", "/hostel/invoices"],
    ["POST", "/hostel/invoices/generate"],
    ["POST", "/hostel/invoices/x/payments"],
    ["POST", "/hostel/invoices/x/adjustments"],
    ["GET", "/hostel/payments"],
    ["POST", "/hostel/payments/x/reverse"],
    ["GET", "/hostel/due-rent"],
    ["GET", "/hostel/due-rent/count"],
    ["GET", "/hostel/due-rent/export"],
    ["GET", "/hostel/ledger/x"],
    ["POST", "/hostel/notifications/remind/x"],
    ["GET", "/hostel/notifications"],
    ["POST", "/hostel/jobs/run"],
    ["GET", "/hostel/documents/x"],
  ];
  for (const [method, path] of paths) {
    const body = method === "GET" ? undefined : {};
    assert.strictEqual((await call(method, path, body, "TEACHER")).status, 403, `${method} ${path}`);
    assert.strictEqual((await call(method, path, body, null)).status, 401, `${method} ${path}`);
  }

  assert.strictEqual((await call("PUT", "/system/roles/ADMIN", { permissions: [] }, "TEACHER")).status, 403);
  assert.strictEqual((await call("POST", "/system/roles", { name: "Hacker" }, "STUDENT")).status, 403);

  const warden = (await call("GET", "/hostel/me/permissions", undefined, "HOSTEL_WARDEN")).data.permissions;
  assert.ok(warden.includes("manage_payments") && !warden.includes("configure_rent"));
  assert.strictEqual((await call("GET", "/hostel/me/permissions", undefined, "TEACHER")).data.permissions.length, 0);
}));

test("another institution cannot see or change rent data", live(async () => {
  const { allocation, seat } = await allocate();
  const [invoice] = await invoicesOf(allocation.id);
  const payment = (await pay(invoice.id, 100)).data;
  const asOther = (method, path, body) => call(method, path, body, "ADMIN", other.institution);

  assert.strictEqual((await asOther("GET", "/hostel/invoices")).data.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/payments")).data.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/due-rent")).data.rows.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/due-rent/count")).data.students, 0);
  assert.strictEqual((await asOther("GET", "/hostel/notifications")).data.length, 0);
  assert.strictEqual((await asOther("GET", `/hostel/invoices/${invoice.id}`)).status, 404);
  assert.strictEqual((await asOther("GET", `/hostel/ledger/${allocation.id}`)).status, 404);
  assert.strictEqual((await asOther("POST", `/hostel/invoices/${invoice.id}/payments`, { amount: 1, paymentDate: today(), method: "Cash" })).status, 404);
  assert.strictEqual((await asOther("POST", `/hostel/invoices/${invoice.id}/adjustments`, { amount: 1, reason: "x" })).status, 404);
  assert.strictEqual((await asOther("POST", `/hostel/payments/${payment.id}/reverse`, { reason: "x" })).status, 404);
  assert.strictEqual((await asOther("GET", `/hostel/payments/${payment.id}/receipt`)).status, 404);
  assert.strictEqual((await asOther("PUT", `/hostel/rent/seats/${seat.id}`, { dueDay: 5 })).status, 404);
  assert.strictEqual((await asOther("GET", `/hostel/rent/seats/${seat.id}/effective-due-day`)).status, 404);
  assert.strictEqual((await asOther("POST", `/hostel/notifications/remind/${allocation.id}`)).status, 409);
}));
