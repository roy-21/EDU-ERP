// Needs PostgreSQL. Academic structure, students, teachers, attendance, exams and results.
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

// Signs in as an account the API made, by giving it a known password.
const signInAs = async (username) => {
  await postgresService.query("UPDATE erp_users SET password_hash = $2, must_change_password = FALSE WHERE LOWER(username) = LOWER($1)", [username, await bcrypt.hash("Known-pass-1", 4)]);
  const login = await request("POST", "/auth/login", { username, password: "Known-pass-1" });
  assert.strictEqual(login.status, 200, login.error);
  return (method, path, body) => request(method, path, body, login.data.token);
};

// A department, program, current session, one section, two courses and their classes.
const school = async (ctx, capacity = 3) => {
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  const dept = ok(await ctx.call("POST", "/academics/departments", { code: `CSE${suffix}`, name: "Computer Science" }));
  const program = ok(await ctx.call("POST", "/academics/programs", { code: `BSC${suffix}`, name: "BSc in CSE", departmentId: dept.id, termCount: 8 }));
  const session = ok(await ctx.call("POST", "/academics/sessions", { name: `2026-${suffix}`, startsOn: shift(today(), -60), endsOn: shift(today(), 120), isCurrent: true }));
  const section = ok(await ctx.call("POST", "/academics/sections", { programId: program.id, sessionId: session.id, termNo: 1, name: "A", capacity }));
  const teacherA = ok(await ctx.call("POST", "/teachers", { employeeNo: `T1${suffix}`, fullName: "Rafiq Ahmed", email: `a${suffix}@example.com`, departmentId: dept.id }));
  const teacherB = ok(await ctx.call("POST", "/teachers", { employeeNo: `T2${suffix}`, fullName: "Nusrat Jahan", email: `b${suffix}@example.com` }));
  const algo = ok(await ctx.call("POST", "/academics/courses", { code: `C101${suffix}`, title: "Algorithms", departmentId: dept.id, credits: 3 }));
  const lab = ok(await ctx.call("POST", "/academics/courses", { code: `C102${suffix}`, title: "Lab", departmentId: dept.id, credits: 1.5, courseType: "LAB" }));
  const classA = ok(await ctx.call("POST", "/academics/classes", { courseId: algo.id, sectionId: section.id, teacherId: teacherA.id }));
  const classB = ok(await ctx.call("POST", "/academics/classes", { courseId: lab.id, sectionId: section.id, teacherId: teacherB.id }));
  return { suffix, dept, program, session, section, teacherA, teacherB, algo, lab, classA, classB };
};

const admit = async (ctx, s, name, extra = {}) => ok(await ctx.call("POST", "/students", { fullName: name, programId: s.program.id, sectionId: s.section.id, ...extra }));

test("structure: codes are unique, records stay in their tenant, used records cannot be deleted", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  assert.strictEqual((await ctx.call("POST", "/academics/departments", { code: s.dept.code, name: "Again" })).status, 409);
  assert.strictEqual((await ctx.call("POST", "/academics/sections", { programId: s.program.id, sessionId: s.session.id, termNo: 9, name: "Z" })).status, 400, "term beyond the program");
  assert.strictEqual((await ctx.call("POST", "/academics/classes", { courseId: s.algo.id, sectionId: s.section.id })).status, 409, "one class per course and section");
  assert.strictEqual((await ctx.call("PUT", `/academics/classes/${s.classA.id}`, { sectionId: "x" })).status, 409, "class keeps its section");
  assert.strictEqual((await ctx.call("PUT", `/academics/classes/${s.classA.id}`, { teacherId: s.teacherB.id })).data.teacherName, "Nusrat Jahan");
  await ctx.call("PUT", `/academics/classes/${s.classA.id}`, { teacherId: s.teacherA.id });
  assert.strictEqual((await ctx.call("DELETE", `/academics/departments/${s.dept.id}`)).status, 409, "programs depend on it");
  const spare = ok(await ctx.call("POST", "/academics/departments", { code: `X${s.suffix}`, name: "Spare" }));
  assert.strictEqual((await ctx.call("DELETE", `/academics/departments/${spare.id}`)).status, 200);

  // Only one current session.
  const next = ok(await ctx.call("POST", "/academics/sessions", { name: `2027-${s.suffix}`, startsOn: "2027-01-01", endsOn: "2027-12-31", isCurrent: true }));
  const sessions = (await ctx.call("GET", "/academics/sessions")).data;
  assert.deepStrictEqual(sessions.filter((item) => item.isCurrent).map((item) => item.id), [next.id]);
  await ctx.call("PUT", `/academics/sessions/${s.session.id}`, { isCurrent: true });

  const other = tenant();
  assert.strictEqual((await other.call("GET", "/academics/departments")).data.length, 0);
  assert.strictEqual((await other.call("POST", "/academics/programs", { code: "P", name: "P", departmentId: s.dept.id, termCount: 2 })).status, 400, "cannot use another tenant's department");
  assert.strictEqual((await ctx.call("POST", "/academics/departments", { code: "T", name: "T" }, "TEACHER")).status, 403);
  assert.strictEqual((await ctx.call("GET", "/academics/sections", undefined, "TEACHER")).status, 200, "teachers can read the lists they need");
  assert.strictEqual((await ctx.call("GET", "/academics/nope")).status, 404);
}));

test("students: generated IDs, section capacity, fixed ID, status turns sign-in off, guardian accounts", live(async () => {
  const ctx = tenant();
  const s = await school(ctx, 2);
  const a = await admit(ctx, s, "Imran Hossain", { email: `imran${s.suffix}@example.com`, guardian: { name: "Karim", email: `karim${s.suffix}@example.com`, relationship: "Father" } });
  assert.match(a.studentNo, new RegExp(`^${s.program.code}-\\d{4}-0001$`));
  const b = await admit(ctx, s, "Sadia Akter", { studentNo: `X-${s.suffix}`, guardian: { name: "Karim", email: `karim${s.suffix}@example.com` } });
  assert.strictEqual((await ctx.call("POST", "/students", { fullName: "Third", programId: s.program.id, sectionId: s.section.id })).status, 409, "section is full");
  assert.strictEqual((await ctx.call("POST", "/students", { fullName: "Dup", programId: s.program.id, studentNo: b.studentNo.toLowerCase() })).status, 409);
  assert.strictEqual((await ctx.call("PUT", `/students/${a.id}`, { studentNo: "NEW-1" })).status, 409, "the ID is fixed");

  const account = ok(await ctx.call("POST", `/students/${a.id}/account`));
  assert.ok(account.username);
  const dropped = await ctx.call("POST", `/students/${a.id}/status`, { status: "DROPPED", reason: "Left" });
  assert.strictEqual(dropped.data.status, "DROPPED");
  const login = await postgresService.query("SELECT status FROM erp_users WHERE linked_type = 'STUDENT' AND linked_id = $1", [a.studentNo]);
  assert.strictEqual(login.rows[0].status, "INACTIVE", "a dropped student cannot sign in");
  assert.strictEqual((await ctx.call("POST", `/students/${a.id}/status`, { status: "SUSPENDED" })).status, 400, "a reason is needed");
  ok(await ctx.call("POST", `/students/${a.id}/status`, { status: "ACTIVE" }), 200);

  // One guardian for two children: the second link reuses the first account.
  const g1 = ok(await ctx.call("POST", `/students/${a.id}/guardian-account`));
  const g2 = ok(await ctx.call("POST", `/students/${b.id}/guardian-account`));
  assert.strictEqual(g1.existing, false);
  assert.strictEqual(g2.existing, true);
  assert.strictEqual(g2.username, g1.username);
  const detail = ok(await ctx.call("GET", `/students/${b.studentNo}`), 200);
  assert.strictEqual(detail.guardians[0].username, g1.username);

  // Moving to a new section.
  const next = ok(await ctx.call("POST", "/academics/sections", { programId: s.program.id, sessionId: s.session.id, termNo: 2, name: "A", capacity: 1 }));
  assert.strictEqual((await ctx.call("POST", "/students/move", { studentIds: [a.id, b.id], toSectionId: next.id })).status, 409, "no room for two");
  assert.strictEqual(ok(await ctx.call("POST", "/students/move", { studentIds: [a.id], toSectionId: next.id }), 200).moved, 1);

  const list = (await ctx.call("GET", `/students?search=Sadia`)).data;
  assert.deepStrictEqual(list.map((item) => item.id), [b.id]);
  assert.strictEqual((await tenant().call("GET", `/students/${a.id}`)).status, 404);
  assert.strictEqual((await ctx.call("POST", "/students", { fullName: "X", programId: s.program.id }, "TEACHER")).status, 403);
}));

test("attendance: a teacher marks their own class, every student, never the future; report counts late as present", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  const a = await admit(ctx, s, "Arif");
  const b = await admit(ctx, s, "Bina");
  const c = await admit(ctx, s, "Chaity");
  const teacher = await signInAs(ok(await ctx.call("POST", `/teachers/${s.teacherA.id}/account`)).username);
  const other = await signInAs(ok(await ctx.call("POST", `/teachers/${s.teacherB.id}/account`)).username);

  const mine = ok(await teacher("GET", "/teaching/classes"), 200);
  assert.deepStrictEqual(mine.map((item) => item.id), [s.classA.id], "a teacher sees only their classes");
  assert.strictEqual((await other("GET", `/attendance/classes/${s.classA.id}/sheet?date=${today()}`)).status, 403);

  const sheet = ok(await teacher("GET", `/attendance/classes/${s.classA.id}/sheet?date=${today()}`), 200);
  assert.strictEqual(sheet.students.length, 3);
  const marks = [{ studentId: a.id, status: "PRESENT" }, { studentId: b.id, status: "LATE" }, { studentId: c.id, status: "ABSENT" }];
  assert.strictEqual((await teacher("POST", `/attendance/classes/${s.classA.id}`, { heldOn: today(), marks: marks.slice(0, 2) })).status, 400, "everyone must be marked");
  assert.strictEqual((await teacher("POST", `/attendance/classes/${s.classA.id}`, { heldOn: shift(today(), 1), marks })).status, 400, "not the future");
  assert.strictEqual(ok(await teacher("POST", `/attendance/classes/${s.classA.id}`, { heldOn: today(), marks, topic: "Sorting" }), 200).absent, 1);
  ok(await teacher("POST", `/attendance/classes/${s.classA.id}`, { heldOn: shift(today(), -1), marks: marks.map((item) => ({ ...item, status: "PRESENT" })) }), 200);

  const report = ok(await teacher("GET", `/attendance/classes/${s.classA.id}/report`), 200);
  const byName = Object.fromEntries(report.students.map((item) => [item.fullName, item.percent]));
  assert.deepStrictEqual(byName, { Arif: 100, Bina: 100, Chaity: 50 });

  // Old days are locked for teachers, open to approvers.
  const old = shift(today(), -10);
  ok(await ctx.call("POST", `/attendance/classes/${s.classA.id}`, { heldOn: old, marks }), 200);
  assert.strictEqual((await teacher("POST", `/attendance/classes/${s.classA.id}`, { heldOn: old, marks })).status, 403);
  const summary = ok(await ctx.call("GET", `/students/${c.id}`), 200).attendance;
  assert.strictEqual(summary.classes[0].absent, 2);
}));

test("exams: weights to 100, marks within full marks, lock, results by the grading scale, publish, transcript and portal", live(async () => {
  const ctx = tenant();
  const s = await school(ctx);
  const a = await admit(ctx, s, "Arif", { email: `arif${s.suffix}@example.com` });
  const b = await admit(ctx, s, "Bina");
  const mid = ok(await ctx.call("POST", "/exams", { sessionId: s.session.id, name: "Midterm", weight: 40 }));
  assert.strictEqual(mid.classes, 2, "every class in the session gets it");
  assert.strictEqual((await ctx.call("POST", "/exams", { sessionId: s.session.id, name: "Final", weight: 70 })).status, 400, "over 100%");
  const final = ok(await ctx.call("POST", "/exams", { sessionId: s.session.id, name: "Final", weight: 60, defaultMaxMarks: 50 }));
  assert.strictEqual((await ctx.call("POST", "/exams", { sessionId: s.session.id, name: "X", weight: 1 }, "TEACHER")).status, 403);

  const teacher = await signInAs(ok(await ctx.call("POST", `/teachers/${s.teacherA.id}/account`)).username);
  const { assessments } = ok(await teacher("GET", `/exams/classes/${s.classA.id}/assessments`), 200);
  const [midA, finalA] = assessments;
  assert.strictEqual(finalA.maxMarks, 50);
  assert.strictEqual((await teacher("PUT", `/exams/assessments/${midA.id}/marks`, { marks: [{ studentId: a.id, marks: 101 }] })).status, 400);
  ok(await teacher("PUT", `/exams/assessments/${midA.id}/marks`, { marks: [{ studentId: a.id, marks: 90 }] }), 200);
  assert.strictEqual((await teacher("POST", `/exams/assessments/${midA.id}/lock`)).status, 409, "Bina has no mark yet");
  ok(await teacher("PUT", `/exams/assessments/${midA.id}/marks`, { marks: [{ studentId: b.id, isAbsent: true }] }), 200);
  ok(await teacher("POST", `/exams/assessments/${midA.id}/lock`), 200);
  assert.strictEqual((await teacher("PUT", `/exams/assessments/${midA.id}/marks`, { marks: [{ studentId: a.id, marks: 95 }] })).status, 409, "locked");
  assert.strictEqual((await teacher("POST", `/exams/assessments/${midA.id}/unlock`)).status, 403, "a teacher cannot unlock");

  ok(await teacher("PUT", `/exams/assessments/${finalA.id}/marks`, { marks: [{ studentId: a.id, marks: 40 }, { studentId: b.id, marks: 20 }] }), 200);
  let results = ok(await teacher("GET", `/exams/classes/${s.classA.id}/results`), 200);
  const arif = results.results.find((item) => item.fullName === "Arif");
  // 90/100 x 40 + 40/50 x 60 = 36 + 48 = 84% -> A+ on the standard scale.
  assert.strictEqual(arif.percent, 84);
  assert.strictEqual(arif.letter, "A+");
  const bina = results.results.find((item) => item.fullName === "Bina");
  assert.strictEqual(bina.percent, 24, "absent counts as zero");
  assert.strictEqual(bina.passed, false);

  assert.strictEqual((await ctx.call("POST", `/exams/classes/${s.classA.id}/publish`)).status, 409, "final not locked");
  ok(await teacher("POST", `/exams/assessments/${finalA.id}/lock`), 200);
  assert.strictEqual((await teacher("POST", `/exams/classes/${s.classA.id}/publish`)).status, 403, "publishing needs approve rights");
  results = ok(await ctx.call("POST", `/exams/classes/${s.classA.id}/publish`), 200);
  assert.ok(results.class.resultsPublishedAt);
  assert.strictEqual((await ctx.call("POST", `/exams/assessments/${midA.id}/unlock`)).status, 409, "published results keep marks locked");
  assert.strictEqual((await ctx.call("PUT", `/exams/${mid.id}`, { weight: 30 })).status, 409, "weights of published results are fixed");
  assert.strictEqual((await ctx.call("DELETE", `/exams/${mid.id}`)).status, 409);

  const transcript = ok(await ctx.call("GET", `/students/${a.id}`), 200).transcript;
  assert.strictEqual(transcript.terms.length, 1);
  assert.deepStrictEqual(transcript.terms[0].courses.map((item) => item.courseCode), [s.algo.code], "only published classes");
  assert.strictEqual(transcript.cgpa, 4);

  // The student sees the same in the portal.
  const student = await signInAs(ok(await ctx.call("POST", `/students/${a.id}/account`)).username);
  const portal = ok(await student("GET", "/portal/academics"), 200);
  assert.strictEqual(portal.enrolled, true);
  assert.strictEqual(portal.transcript.cgpa, 4);
  assert.strictEqual((await student("GET", `/exams/classes/${s.classA.id}/results`)).status, 403);
}));
