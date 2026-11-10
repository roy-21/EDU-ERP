// Needs PostgreSQL. Finance (fees, invoices, payments), notices, library and HR/payroll.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");

let server;
let baseUrl;
const clients = [];

const today = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

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
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, data: json.data, error: json.error };
};

const ok = (res, status = 201) => {
  assert.strictEqual(res.status, status, res.error);
  return res.data;
};

const signInAs = async (username) => {
  await postgresService.query("UPDATE erp_users SET password_hash = $2, must_change_password = FALSE WHERE LOWER(username) = LOWER($1)", [username, await bcrypt.hash("Known-pass-1", 4)]);
  const login = await request("POST", "/auth/login", { username, password: "Known-pass-1" });
  assert.strictEqual(login.status, 200, login.error);
  return (method, path, body) => request(method, path, body, login.data.token);
};

// Two programs, one section each, and students in them.
const school = async (ctx) => {
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  const dept = ok(await ctx.call("POST", "/academics/departments", { code: `D${suffix}`, name: "Science" }));
  const cse = ok(await ctx.call("POST", "/academics/programs", { code: `CSE${suffix}`, name: "BSc CSE", departmentId: dept.id, termCount: 8 }));
  const bba = ok(await ctx.call("POST", "/academics/programs", { code: `BBA${suffix}`, name: "BBA", departmentId: dept.id, termCount: 8 }));
  const session = ok(await ctx.call("POST", "/academics/sessions", { name: `S-${suffix}`, startsOn: shift(today(), -30), endsOn: shift(today(), 150), isCurrent: true }));
  const cseA = ok(await ctx.call("POST", "/academics/sections", { programId: cse.id, sessionId: session.id, termNo: 1, name: "A", capacity: 10 }));
  const bbaA = ok(await ctx.call("POST", "/academics/sections", { programId: bba.id, sessionId: session.id, termNo: 1, name: "A", capacity: 10 }));
  const admit = async (name, program, section) => ok(await ctx.call("POST", "/students", { fullName: name, email: `${name.split(" ")[0].toLowerCase()}${suffix}@example.com`, programId: program.id, sectionId: section.id }));
  const s1 = await admit("Arif Hasan", cse, cseA);
  const s2 = await admit("Mitu Akter", cse, cseA);
  const s3 = await admit("Rana Kabir", bba, bbaA);
  const teacher = ok(await ctx.call("POST", "/teachers", { employeeNo: `T${suffix}`, fullName: "Rafiq Ahmed", email: `t${suffix}@example.com`, departmentId: dept.id }));
  return { suffix, dept, cse, bba, session, cseA, bbaA, s1, s2, s3, teacher };
};

test("finance: fee structure drives generated invoices, reruns skip, payments and reversals keep balances right", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  const tuition = ok(await ctx.call("POST", "/finance/fee-heads", { code: "TUI", name: "Tuition", defaultAmount: 20000 }));
  const lab = ok(await ctx.call("POST", "/finance/fee-heads", { code: "LAB", name: "Lab fee", category: "LAB", defaultAmount: 3000 }));
  assert.strictEqual((await ctx.call("POST", "/finance/fee-heads", { code: "tui", name: "Again" })).status, 409, "codes are unique (case-insensitive)");
  assert.strictEqual((await ctx.call("POST", "/finance/fee-heads", { code: "X", name: "Bad", defaultAmount: 1.234 })).status, 400);

  // BBA pays less tuition and no lab fee.
  ok(await ctx.call("PUT", "/finance/fee-structure", { feeHeadId: tuition.id, programId: s.bba.id, amount: 15000 }), 200);
  ok(await ctx.call("PUT", "/finance/fee-structure", { feeHeadId: lab.id, programId: s.bba.id, amount: 0 }), 200);
  const structure = ok(await ctx.call("GET", "/finance/fee-structure"), 200);
  assert.strictEqual(structure.rates.length, 2);

  const dueDate = shift(today(), 20);
  const cseRun = ok(await ctx.call("POST", "/finance/invoices/generate", { title: "Spring Term Fees", dueDate, feeHeadIds: [tuition.id, lab.id], target: "SECTION", sectionId: s.cseA.id }));
  assert.deepStrictEqual([cseRun.created, cseRun.total], [2, 46000]);
  const again = ok(await ctx.call("POST", "/finance/invoices/generate", { title: "spring term fees", dueDate, feeHeadIds: [tuition.id, lab.id], target: "PROGRAM", programId: s.cse.id }));
  assert.deepStrictEqual([again.created, again.skipped], [0, 2], "running it again bills nobody twice");
  const bbaRun = ok(await ctx.call("POST", "/finance/invoices/generate", { title: "Spring Term Fees", dueDate, feeHeadIds: [tuition.id, lab.id], target: "STUDENTS", studentIds: [s.s3.id] }));
  assert.strictEqual(bbaRun.total, 15000, "program rate replaces the default, a zero line is still listed");

  const invoices = ok(await ctx.call("GET", `/finance/invoices?search=${s.s1.studentNo}`), 200);
  assert.strictEqual(invoices.length, 1);
  const invoice = ok(await ctx.call("GET", `/finance/invoices/${invoices[0].id}`), 200);
  assert.deepStrictEqual([invoice.items.length, invoice.amountDue, invoice.state], [2, 23000, "UNPAID"]);

  // Payments: validated, capped at what is owed, idempotent, reference unique.
  assert.strictEqual((await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 30000, method: "CASH" })).status, 400, "more than owed");
  assert.strictEqual((await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 100, method: "BKASH" })).status, 400, "non-cash needs a reference");
  assert.strictEqual((await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 100, method: "CASH", paidOn: shift(today(), 2) })).status, 400, "no future dates");
  const key = randomUUID();
  const first = ok(await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 10000, method: "BKASH", reference: `TRX${s.suffix}`, idempotencyKey: key }));
  const repeat = ok(await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 10000, method: "BKASH", reference: `TRX${s.suffix}`, idempotencyKey: key }));
  assert.strictEqual(repeat.id, first.id, "a retried request does not pay twice");
  assert.match(first.receiptNumber, /^FRC-\d{6}-\d{6}$/);
  assert.strictEqual((await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 1, method: "BKASH", reference: `trx${s.suffix}` })).status, 409, "same reference twice");
  assert.strictEqual(ok(await ctx.call("GET", `/finance/invoices/${invoice.id}`), 200).state, "PARTIAL");

  // A waiver needs approval rights and cannot push the amount below what is paid.
  assert.strictEqual((await ctx.call("POST", `/finance/invoices/${invoice.id}/adjustments`, { kind: "WAIVER", amount: 2000, reason: "Merit" }, "ACCOUNTANT")).status, 403);
  assert.strictEqual((await ctx.call("POST", `/finance/invoices/${invoice.id}/adjustments`, { kind: "WAIVER", amount: 20000, reason: "Too much" })).status, 400);
  const waived = ok(await ctx.call("POST", `/finance/invoices/${invoice.id}/adjustments`, { kind: "WAIVER", amount: 3000, reason: "Merit" }));
  assert.deepStrictEqual([waived.amountDue, waived.outstanding], [20000, 10000]);

  // The accountant can collect; paying the rest makes it PAID.
  const rest = ok(await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 10000, method: "CASH" }, "ACCOUNTANT"));
  assert.strictEqual(ok(await ctx.call("GET", `/finance/invoices/${invoice.id}`), 200).state, "PAID");
  assert.strictEqual((await ctx.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 1, method: "CASH" })).status, 409);

  // Reversal needs approval, reopens the balance, and is final.
  assert.strictEqual((await ctx.call("POST", `/finance/payments/${rest.id}/reverse`, { reason: "Bounced" }, "ACCOUNTANT")).status, 403);
  ok(await ctx.call("POST", `/finance/payments/${rest.id}/reverse`, { reason: "Counted twice" }), 200);
  assert.strictEqual((await ctx.call("POST", `/finance/payments/${rest.id}/reverse`, { reason: "Again" })).status, 409);
  const reopened = ok(await ctx.call("GET", `/finance/invoices/${invoice.id}`), 200);
  assert.deepStrictEqual([reopened.outstanding, reopened.state], [10000, "PARTIAL"]);

  // An invoice with payments cannot be cancelled; an unpaid one can, and then it can be billed again.
  assert.strictEqual((await ctx.call("POST", `/finance/invoices/${invoice.id}/cancel`, { reason: "Wrong" })).status, 409);
  const other = (await ctx.call("GET", `/finance/invoices?search=${s.s2.studentNo}`)).data[0];
  ok(await ctx.call("POST", `/finance/invoices/${other.id}/cancel`, { reason: "Billed by mistake" }), 200);
  assert.strictEqual(ok(await ctx.call("GET", "/finance/invoices?state=CANCELLED"), 200).length, 1);
  const rebill = ok(await ctx.call("POST", "/finance/invoices", { studentId: s.s2.id, title: "Spring Term Fees", dueDate: shift(today(), -1), issuedOn: shift(today(), -5), items: [{ feeHeadId: tuition.id, amount: 18000 }, { description: "Late fine", amount: 500 }] }));
  assert.deepStrictEqual([rebill.amountDue, rebill.state], [18500, "OVERDUE"]);

  // The accountant finds students to bill without seeing their contact details.
  const found = ok(await ctx.call("GET", `/finance/students?search=${s.s1.studentNo}`, undefined, "ACCOUNTANT"), 200);
  assert.deepStrictEqual(Object.keys(found[0]).sort(), ["fullName", "id", "programCode", "status", "studentNo"]);
  assert.strictEqual(ok(await ctx.call("GET", "/finance/targets", undefined, "ACCOUNTANT"), 200).sections.length, 2);
  assert.strictEqual((await ctx.call("GET", "/students", undefined, "ACCOUNTANT")).status, 403);

  const summary = ok(await ctx.call("GET", "/finance/summary"), 200);
  assert.deepStrictEqual([summary.invoices, summary.collected, summary.overdue], [3, 10000, 18500]);
  assert.strictEqual(summary.defaulters[0].studentNo, s.s2.studentNo);
  assert.strictEqual(ok(await ctx.call("GET", "/finance/payments?status=CONFIRMED"), 200).length, 1);

  // Another tenant sees none of it; a teacher has no finance access.
  const outsider = tenant();
  assert.strictEqual((await outsider.call("GET", `/finance/invoices/${invoice.id}`)).status, 404);
  assert.strictEqual((await outsider.call("POST", "/finance/payments", { invoiceId: invoice.id, amount: 1, method: "CASH" })).status, 404);
  assert.strictEqual((await ctx.call("GET", "/finance/invoices", undefined, "TEACHER")).status, 403);

  // The student sees their own fees in the portal, nobody else's.
  const account = ok(await ctx.call("POST", `/students/${s.s1.id}/account`, {}));
  const student = await signInAs(account.username || account.user?.username);
  const fees = ok(await student("GET", "/portal/fees"), 200);
  assert.deepStrictEqual([fees.invoices.length, fees.totalOutstanding, fees.payments.length], [1, 10000, 1]);
  assert.strictEqual((await student("GET", "/finance/invoices")).status, 403);
}));

test("notices: drafts stay private, the feed follows audience and dates, publishing needs approval", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  assert.strictEqual((await ctx.call("POST", "/notices", { title: "No body" })).status, 400);
  const draft = ok(await ctx.call("POST", "/notices", { title: "Exam routine", body: "Exams start on Sunday.", audience: "STUDENTS", category: "EXAM" }));
  assert.strictEqual(draft.status, "DRAFT");
  const staff = ok(await ctx.call("POST", "/notices", { title: "Staff meeting", body: "At 3 pm.", audience: "STAFF", publish: true }));
  ok(await ctx.call("POST", "/notices", { title: "Old", body: "Gone", publish: true, publishAt: new Date(Date.now() - 86_400_000 * 3).toISOString(), expiresAt: new Date(Date.now() - 86_400_000).toISOString() }));
  ok(await ctx.call("POST", "/notices", { title: "Later", body: "Soon", publish: true, publishAt: new Date(Date.now() + 86_400_000).toISOString() }));
  assert.strictEqual((await ctx.call("POST", "/notices", { title: "Bad", body: "x", publishAt: "2026-05-02T00:00:00Z", expiresAt: "2026-05-01T00:00:00Z" })).status, 400);

  const account = ok(await ctx.call("POST", `/students/${s.s1.id}/account`, {}));
  const student = await signInAs(account.username || account.user?.username);
  assert.strictEqual(ok(await student("GET", "/portal/notices"), 200).length, 0, "a draft is not shown");
  ok(await ctx.call("POST", `/notices/${draft.id}/publish`, {}), 200);
  const feed = ok(await student("GET", "/portal/notices"), 200);
  assert.deepStrictEqual(feed.map((n) => n.title), ["Exam routine"], "audience, start and end dates all apply");
  assert.deepStrictEqual(ok(await ctx.call("GET", "/notices/feed"), 200).map((n) => n.title), ["Staff meeting"]);
  assert.strictEqual((await student("GET", "/notices")).status, 403, "students cannot list drafts");

  // A teacher reads the feed but cannot write. Archiving takes a notice off the feed.
  assert.strictEqual((await ctx.call("POST", "/notices", { title: "x", body: "y" }, "TEACHER")).status, 403);
  assert.strictEqual((await ctx.call("GET", "/notices/feed", undefined, "TEACHER")).status, 200);
  ok(await ctx.call("POST", `/notices/${staff.id}/archive`, {}), 200);
  assert.strictEqual(ok(await ctx.call("GET", "/notices/feed"), 200).length, 0);
  assert.strictEqual((await tenant().call("PUT", `/notices/${draft.id}`, { title: "Hijack" })).status, 404);
  ok(await ctx.call("DELETE", `/notices/${staff.id}`), 200);
}));

test("library: copies, borrower limits, overdue blocks, fines fixed on return and settled once", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  assert.strictEqual((await ctx.call("POST", "/library/books", { title: "Bad", isbn: "123" })).status, 400);
  const book = ok(await ctx.call("POST", "/library/books", { title: "Introduction to Algorithms", author: "CLRS", isbn: "978-0262046305", totalCopies: 1 }));
  const other = ok(await ctx.call("POST", "/library/books", { title: "Clean Code", totalCopies: 3 }));
  assert.strictEqual((await ctx.call("POST", "/library/books", { title: "Dup", isbn: "9780262046305" })).status, 409);
  ok(await ctx.call("PUT", "/library/settings", { loanDays: 7, finePerDay: 10, maxLoans: 2, maxRenewals: 1 }), 200);

  const loan = ok(await ctx.call("POST", "/library/loans", { bookId: book.id, borrowerType: "STUDENT", borrower: s.s1.studentNo }));
  assert.strictEqual(loan.dueOn, shift(today(), 7));
  assert.strictEqual((await ctx.call("POST", "/library/loans", { bookId: book.id, borrowerType: "STUDENT", borrower: s.s2.studentNo })).status, 409, "no copies left");
  assert.strictEqual((await ctx.call("PUT", `/library/books/${book.id}`, { totalCopies: 0 })).status, 409, "cannot drop below copies on loan");
  ok(await ctx.call("POST", "/library/loans", { bookId: other.id, borrowerType: "TEACHER", borrower: s.teacher.employeeNo }));
  assert.strictEqual((await ctx.call("POST", "/library/loans", { bookId: other.id, borrowerType: "TEACHER", borrower: s.teacher.employeeNo })).status, 409, "one copy of a title each");
  ok(await ctx.call("POST", "/library/loans", { bookId: other.id, borrowerType: "STUDENT", borrower: s.s1.studentNo }));
  assert.strictEqual((await ctx.call("POST", "/library/loans", { bookId: other.id, borrowerType: "STUDENT", borrower: s.s1.studentNo })).status, 409, "borrower limit");

  const renewed = ok(await ctx.call("POST", `/library/loans/${loan.id}/renew`, {}), 200);
  assert.strictEqual(renewed.dueOn, shift(today(), 14));
  assert.strictEqual((await ctx.call("POST", `/library/loans/${loan.id}/renew`, {})).status, 409, "renewal limit");

  // Make it 3 days overdue: the borrower is blocked and the fine is 30 when returned.
  await postgresService.query("UPDATE lib_loans SET issued_on = $2, due_on = $3 WHERE id = $1", [loan.id, shift(today(), -10), shift(today(), -3)]);
  const third = ok(await ctx.call("POST", "/library/books", { title: "Refactoring", totalCopies: 1 }));
  const [overdue] = ok(await ctx.call("GET", "/library/loans?state=OVERDUE"), 200);
  assert.deepStrictEqual([overdue.lateDays, overdue.fineAmount, overdue.fineStatus], [3, 30, "ACCRUING"]);
  const returned = ok(await ctx.call("POST", `/library/loans/${loan.id}/return`, {}), 200);
  assert.deepStrictEqual([returned.fineAmount, returned.fineStatus], [30, "DUE"]);
  assert.strictEqual((await ctx.call("POST", `/library/loans/${loan.id}/return`, {})).status, 409);
  assert.strictEqual((await ctx.call("POST", "/library/loans", { bookId: third.id, borrowerType: "STUDENT", borrower: s.s1.studentNo })).status, 409, "an unpaid fine blocks borrowing");

  assert.strictEqual((await ctx.call("POST", `/library/loans/${loan.id}/fine`, { action: "WAIVED" })).status, 400, "waiving needs a reason");
  ok(await ctx.call("POST", `/library/loans/${loan.id}/fine`, { action: "PAID" }), 200);
  assert.strictEqual((await ctx.call("POST", `/library/loans/${loan.id}/fine`, { action: "PAID" })).status, 409);
  const summary = ok(await ctx.call("GET", "/library/summary"), 200);
  assert.deepStrictEqual([summary.onLoan, summary.finesPaid, summary.finesDue], [2, 30, 0]);
  assert.strictEqual((await ctx.call("DELETE", `/library/books/${book.id}`)).status, 409, "books with history stay");

  // A teacher can browse but not lend; the student sees their loans in the portal.
  assert.strictEqual((await ctx.call("GET", "/library/books", undefined, "TEACHER")).status, 200);
  assert.strictEqual((await ctx.call("POST", "/library/loans", { bookId: third.id, borrowerType: "STUDENT", borrower: s.s2.studentNo }, "TEACHER")).status, 403);
  const account = ok(await ctx.call("POST", `/students/${s.s1.id}/account`, {}));
  const student = await signInAs(account.username || account.user?.username);
  assert.strictEqual(ok(await student("GET", "/portal/library"), 200).length, 2);
  assert.strictEqual((await tenant().call("POST", `/library/loans/${loan.id}/return`, {})).status, 404);
}));

test("hr: staff and teachers share payroll, leave has balances and overlap checks, unpaid leave is deducted", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  const clerk = ok(await ctx.call("POST", "/hr/staff", { employeeNo: `E${s.suffix}`, fullName: "Karim Mia", designation: "Accounts Clerk", department: "Accounts" }));
  assert.strictEqual((await ctx.call("POST", "/hr/staff", { employeeNo: `e${s.suffix}`, fullName: "Dup" })).status, 409);
  const employees = ok(await ctx.call("GET", "/hr/employees"), 200);
  assert.deepStrictEqual(employees.map((e) => e.personType).sort(), ["STAFF", "TEACHER"]);

  ok(await ctx.call("PUT", `/hr/salaries/STAFF/${clerk.id}`, { basic: 30000, houseRent: 15000, medical: 2000, tax: 1000, providentFund: 3000 }), 200);
  const teacher = ok(await ctx.call("PUT", `/hr/salaries/TEACHER/${s.teacher.id}`, { basic: 50000, houseRent: 20000 }), 200);
  assert.deepStrictEqual([teacher.salary.gross, teacher.salary.net], [70000, 70000]);
  assert.strictEqual((await ctx.call("PUT", `/hr/salaries/STAFF/${clerk.id}`, { basic: -5 })).status, 400);

  const casual = ok(await ctx.call("POST", "/hr/leave-types", { name: "Casual", daysPerYear: 10 }));
  const unpaid = ok(await ctx.call("POST", "/hr/leave-types", { name: "Unpaid", daysPerYear: 0, isPaid: false }));

  // The teacher applies for their own leave from their account.
  const login = ok(await ctx.call("POST", `/teachers/${s.teacher.id}/account`, {}));
  const me = await signInAs(login.username || login.user?.username);
  const year = today().slice(0, 4);
  const month = `${year}-03`;
  const first = ok(await me("POST", "/hr/me/leave", { leaveTypeId: casual.id, fromDate: `${year}-03-02`, toDate: `${year}-03-05`, reason: "Family event" }));
  assert.strictEqual(first.days, 4);
  assert.strictEqual((await me("POST", "/hr/me/leave", { leaveTypeId: casual.id, fromDate: `${year}-03-05`, toDate: `${year}-03-06`, reason: "Overlap" })).status, 409);
  assert.strictEqual((await me("POST", "/hr/me/leave", { leaveTypeId: casual.id, fromDate: `${year}-04-01`, toDate: `${year}-04-07`, reason: "Too long" })).status, 409, "only 6 casual days left");
  const unpaidLeave = ok(await me("POST", "/hr/me/leave", { leaveTypeId: unpaid.id, fromDate: `${year}-03-20`, toDate: `${year}-03-22`, reason: "Personal" }));
  assert.strictEqual((await me("POST", `/hr/leave/${first.id}/decide`, { decision: "APPROVED" })).status, 403, "cannot approve your own leave");
  ok(await ctx.call("POST", `/hr/leave/${first.id}/decide`, { decision: "APPROVED" }), 200);
  ok(await ctx.call("POST", `/hr/leave/${unpaidLeave.id}/decide`, { decision: "APPROVED" }), 200);
  assert.strictEqual((await ctx.call("POST", `/hr/leave/${first.id}/decide`, { decision: "REJECTED", note: "late" })).status, 409);
  const mine = ok(await me("GET", "/hr/me"), 200);
  assert.strictEqual(mine.balances.find((b) => b.name === "Casual").remaining, 6);

  // Payroll: the teacher loses 3 days of basic for the unpaid leave.
  const run = ok(await ctx.call("POST", "/hr/payroll", { month }));
  assert.strictEqual(run.payslips.length, 2);
  const slip = run.payslips.find((p) => p.personType === "TEACHER");
  const deduction = Math.round((50000 / 31) * 3 * 100) / 100;
  assert.deepStrictEqual([slip.unpaidLeaveDays, slip.leaveDeduction, slip.netPay], [3, deduction, Math.round((70000 - deduction) * 100) / 100]);
  assert.strictEqual(run.payslips.find((p) => p.personType === "STAFF").netPay, 43000);
  assert.strictEqual((await ctx.call("POST", `/hr/payroll/${run.id}/paid`, {})).status, 409, "approve first");
  assert.strictEqual(ok(await me("GET", "/hr/me"), 200).payslips.length, 0, "a draft is not shown to the employee");
  ok(await ctx.call("POST", `/hr/payroll/${run.id}/approve`, {}), 200);
  assert.strictEqual((await ctx.call("POST", "/hr/payroll", { month })).status, 409, "an approved month is fixed");
  assert.strictEqual((await ctx.call("DELETE", `/hr/payroll/${run.id}`)).status, 409);
  ok(await ctx.call("POST", `/hr/payroll/${run.id}/paid`, {}), 200);
  assert.strictEqual(ok(await me("GET", "/hr/me"), 200).payslips[0].netPay, slip.netPay);

  assert.strictEqual((await ctx.call("DELETE", `/hr/leave-types/${casual.id}`)).status, 409);
  assert.strictEqual((await ctx.call("DELETE", `/hr/staff/${clerk.id}`)).status, 409, "payroll history keeps the record");
  assert.strictEqual((await me("GET", "/hr/employees")).status, 403);
  assert.strictEqual((await tenant().call("GET", `/hr/payroll/${run.id}`)).status, 404);
}));
