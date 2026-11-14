// Needs PostgreSQL. The AI knowledge assistant end to end: documents, grounded answers,
// forwarding unknown questions, admin review before learning, live read-only ERP answers,
// refusal of changes, and isolation between institutions.
// The Voice & Message Assistant Backend and the SMS provider are small fake servers here, so the test checks the
// Core ERP's side of each contract; the assistant backend has its own tests.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { assistantEngine } = require("../dist/modules/assistant/assistant-engine.client");
const { intentOf, chunkText, termsOf } = require("../dist/modules/assistant/assistant-text");
const { createClient, ensureUser, live, removeInstitutions } = require("./hostel-helpers");

let server;
let baseUrl;
const clients = [];

// ---- Fake AI Backend -------------------------------------------------------------------
const ai = { llm: false, down: false, answers: [], extractCalls: 0 };
let aiServer;
// ---- Fake SMS provider ------------------------------------------------------------------
const sms = { fail: false, sent: [] };
let smsServer;

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => resolve(data ? JSON.parse(data) : {}));
});

test.before(async () => {
  await postgresService.initialize();
  aiServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (ai.down) return json(res, 503, { detail: "down for the test" });
    if (req.url.endsWith("/voice/assistant/status")) return json(res, 200, { data: { llm: ai.llm, embeddings: false, model: ai.llm ? "claude-opus-5-5" : "", extract: ["pdf", "docx"] } });
    if (req.url.endsWith("/voice/assistant/extract")) {
      ai.extractCalls += 1;
      return json(res, 200, { data: { text: "Exam rules. Calculators are not allowed in the exam hall. Mobile phones must be switched off." } });
    }
    if (req.url.endsWith("/voice/assistant/answer")) {
      ai.answers.push(body);
      // The fake model "answers" only when a passage mentions the library.
      const passage = body.passages.find((item) => /library/i.test(item.text));
      return json(res, 200, { data: passage
        ? { answerable: true, answer: "The library is open until 8 pm on weekdays.", used_source_ids: [passage.id], model: "claude-opus-5-5" }
        : { answerable: false, answer: "", used_source_ids: [], model: "claude-opus-5-5" } });
    }
    if (req.url.endsWith("/voice/assistant/draft")) return json(res, 200, { data: { draft: `Draft: ${body.received_answer}` } });
    return json(res, 404, {});
  });
  await new Promise((resolve) => aiServer.listen(0, "127.0.0.1", resolve));
  process.env.VOICE_API_URL = `http://127.0.0.1:${aiServer.address().port}/api/v1`;

  smsServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (sms.fail) return json(res, 500, { error: "provider down" });
    sms.sent.push(body);
    return json(res, 200, { id: `sms-${sms.sent.length}` });
  });
  await new Promise((resolve) => smsServer.listen(0, "127.0.0.1", resolve));
  process.env.ASSISTANT_SMS_API_URL = `http://127.0.0.1:${smsServer.address().port}/send`;
  delete process.env.ASSISTANT_CALL_API_URL;

  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  if (postgresService.isLive()) await removeInstitutions(clients.map((client) => client.institution));
  await new Promise((resolve) => server.close(resolve));
  aiServer.close();
  smsServer.close();
  setTimeout(() => process.exit(), 200).unref();
});

const tenant = () => {
  const client = createClient(() => baseUrl);
  clients.push(client);
  return client;
};

const ok = (res, status = 200) => {
  assert.strictEqual(res.status, status, res.error);
  return res.data;
};

const setAi = (changes) => {
  Object.assign(ai, changes);
  assistantEngine.resetStatus();
};

const upload = (ctx, fileName, textOrBuffer, title) => ctx.call("POST", "/assistant/documents", {
  title, fileName, contentBase64: Buffer.isBuffer(textOrBuffer) ? textOrBuffer.toString("base64") : Buffer.from(textOrBuffer).toString("base64"),
});

const waitForDocument = async (ctx, id, wanted = ["READY", "FAILED"]) => {
  for (let i = 0; i < 100; i += 1) {
    const doc = ok(await ctx.call("GET", `/assistant/documents/${id}`));
    if (wanted.includes(doc.status)) return doc;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Document ${id} never reached ${wanted.join("/")}`);
};

const ask = (ctx, question, role = "ADMIN") => ctx.call("POST", "/assistant/ask", { question }, role);

const HOSTEL_RULES = `Hostel rules

The hostel gate closes at 10 pm every night. Students returning later must sign the late register at the warden's office.

Visitors are allowed from 4 pm to 6 pm on Fridays only, in the common room.`;

// ---- Unit-level checks of the deterministic parts ----------------------------------------

test("assistant text: change requests, live questions and knowledge questions are told apart", () => {
  const kind = (q) => {
    const intent = intentOf(q);
    return intent.kind === "LIVE_DATA" ? intent.topic : intent.kind;
  };
  for (const q of ["Change my attendance to present", "Please delete my fine", "Can you mark me present for today?", "Create a new user for my brother",
    "amar result change kore dao", "আমার হাজিরা পরিবর্তন করে দাও", "Approve my leave application"]) {
    assert.strictEqual(kind(q), "ACTION", q);
  }
  assert.strictEqual(kind("How many meals have I had today?"), "MEAL_COUNT");
  assert.strictEqual(kind("What is today's meal menu?"), "MEAL_MENU");
  assert.strictEqual(kind("At what time does today's lunch end?"), "MEAL_TIME");
  assert.strictEqual(kind("What is my current result?"), "RESULT");
  assert.strictEqual(kind("What is my current CGPA?"), "RESULT");
  assert.strictEqual(kind("What is my attendance percentage?"), "ATTENDANCE");
  assert.strictEqual(kind("How much payment is pending?"), "FEES_DUE");
  assert.strictEqual(kind("What is my application status?"), "APPLICATION");
  assert.strictEqual(kind("আমার হাজিরা কত?"), "ATTENDANCE");
  // Questions about rules are knowledge, not live data, and asking how is not asking to do.
  assert.strictEqual(kind("What is the minimum attendance required to sit the exam?"), "KNOWLEDGE");
  assert.strictEqual(kind("How can I change my password?"), "KNOWLEDGE");
  assert.strictEqual(kind("When does the hostel gate close?"), "KNOWLEDGE");

  const chunks = chunkText(`${"Long paragraph sentence about rules. ".repeat(60)}\n\nShort tail.`);
  assert.ok(chunks.length >= 2 && chunks.every((chunk) => chunk.length <= 1100));
  assert.ok(termsOf("হোস্টেলের গেট কখন বন্ধ হয়?").includes("হোস্টেল"), "Bangla words are found without their endings");
});

test("database read-only scope refuses every write", live(async () => {
  await assert.rejects(
    postgresService.readOnly(() => postgresService.query("CREATE TEMP TABLE ai_write_probe (x int)")),
    /read-only transaction/
  );
  await assert.rejects(postgresService.readOnly(() => postgresService.transaction((tx) => tx.query("CREATE TEMP TABLE ai_write_probe2 (x int)"))), /read-only/);
  const { rows } = await postgresService.readOnly(() => postgresService.query("SELECT 1 AS one"));
  assert.strictEqual(rows[0].one, 1);
}));

// ---- Documents and answers -------------------------------------------------------------

test("documents: uploaded, read in the background, answered from, and kept to their institution", live(async () => {
  setAi({ llm: false, down: false });
  const ctx = tenant();
  const other = tenant();

  assert.strictEqual((await upload(ctx, "old.doc", "x")).status, 400, ".doc is refused with advice");
  assert.strictEqual((await upload(ctx, "fake.pdf", "not a pdf")).status, 400);
  assert.strictEqual((await ctx.call("POST", "/assistant/documents", { fileName: "a.txt", contentBase64: Buffer.from("x").toString("base64") }, "STUDENT")).status, 403,
    "a student cannot upload knowledge");

  const doc = ok(await upload(ctx, "hostel-rules.txt", HOSTEL_RULES, "Hostel rules"), 201);
  assert.strictEqual(doc.status, "QUEUED");
  const ready = await waitForDocument(ctx, doc.id);
  assert.strictEqual(ready.status, "READY", ready.error);
  assert.ok(ready.chunkCount >= 1);
  assert.strictEqual(ready.embeddedChunks, 0, "no embedding provider in this test");

  // No language model: the answer is the document's own sentence, with its source.
  const answer = ok(await ask(ctx, "When does the hostel gate close?", "STUDENT"), 201);
  assert.strictEqual(answer.status, "ANSWERED");
  assert.strictEqual(answer.answerSource, "DOCUMENT");
  assert.strictEqual(answer.mode, "EXTRACTIVE");
  assert.match(answer.answer, /closes at 10 pm/);
  assert.strictEqual(answer.sources[0].title, "Hostel rules");

  // Another institution never sees this document.
  const elsewhere = ok(await ask(other, "When does the hostel gate close?"), 201);
  assert.strictEqual(elsewhere.status, "ESCALATED");

  // A question the document does not cover is not guessed.
  const unknown = ok(await ask(ctx, "What is the hostel wifi password?"), 201);
  assert.strictEqual(unknown.status, "ESCALATED");
  assert.match(unknown.answer, /forwarded to the responsible person/);

  // PDF goes through the AI Backend; when it is down the document waits and is tried again.
  setAi({ down: true });
  const pdf = ok(await upload(ctx, "exam.pdf", Buffer.from("%PDF-1.4 fake"), "Exam rules"), 201);
  let waiting;
  for (let i = 0; i < 50; i += 1) {
    waiting = ok(await ctx.call("GET", `/assistant/documents/${pdf.id}`));
    if (waiting.attempts >= 1 && waiting.status === "QUEUED") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.strictEqual(waiting.status, "QUEUED");
  assert.match(waiting.error, /assistant service/);
  setAi({ down: false });
  await postgresService.query("UPDATE ai_documents SET next_attempt_at = NOW() WHERE id = $1", [pdf.id]);
  const { processNextDocument } = require("../dist/modules/assistant/assistant-knowledge.service");
  await processNextDocument();
  const readPdf = await waitForDocument(ctx, pdf.id);
  assert.strictEqual(readPdf.status, "READY", readPdf.error);
  assert.match(ok(await ask(ctx, "Are calculators allowed in the exam hall?"), 201).answer, /Calculators are not allowed/);

  // Removing a document removes what the assistant knows from it.
  ok(await ctx.call("DELETE", `/assistant/documents/${doc.id}`));
  assert.strictEqual(ok(await ask(ctx, "When does the hostel gate close?"), 201).status, "ESCALATED");
}));

test("language model answers only from the passages it is given", live(async () => {
  setAi({ llm: true, down: false, answers: [] });
  const ctx = tenant();
  const doc = ok(await upload(ctx, "library.txt", "Library hours. The library is open from 9 am until 8 pm on weekdays and closed on Fridays.", "Library guide"), 201);
  await waitForDocument(ctx, doc.id);

  const answer = ok(await ask(ctx, "Until when is the library open on weekdays?"), 201);
  assert.strictEqual(answer.status, "ANSWERED");
  assert.strictEqual(answer.mode, "LLM");
  assert.strictEqual(answer.answer, "The library is open until 8 pm on weekdays.");
  const sent = ai.answers[ai.answers.length - 1];
  assert.ok(sent.passages.every((passage) => passage.text.includes("library") || passage.text.includes("Library")), "only this institution's passages are sent");
  assert.strictEqual(answer.sources[0].title, "Library guide");

  // The model says the passages do not answer it: the question is forwarded, not guessed.
  const forwarded = ok(await ask(ctx, "Is the library open on public holidays?"), 201);
  assert.strictEqual(forwarded.status, "ESCALATED");
  setAi({ llm: false });
}));

// ---- Unknown questions, review and learning -------------------------------------------

test("unknown questions go to the responsible person and are learnt only after admin approval", live(async () => {
  setAi({ llm: false, down: false });
  sms.sent = [];
  sms.fail = false;
  const ctx = tenant();
  await ensureUser("TEACHER", ctx.institution);

  // Who answers what.
  assert.strictEqual((await ctx.call("POST", "/assistant/contacts", { name: "Officer", channels: ["SMS"] })).status, 400, "SMS needs a phone");
  const officer = ok(await ctx.call("POST", "/assistant/contacts", {
    name: "Scholarship Officer", title: "Student Affairs", phone: "01711000000", topics: "scholarship, stipend", channels: ["SMS", "CALL"],
  }), 201);
  ok(await ctx.call("POST", "/assistant/contacts", { name: "Front Desk", phone: "01711000001", channels: ["SMS"], isDefault: true }), 201);

  const asked = ok(await ask(ctx, "What is the deadline for the merit scholarship application?", "STUDENT"), 201);
  assert.strictEqual(asked.status, "ESCALATED");
  let [escalation] = ok(await ctx.call("GET", "/assistant/escalations"));
  assert.strictEqual(escalation.contactName, "Scholarship Officer", "routed by topic");
  assert.strictEqual(escalation.status, "SENT");
  assert.strictEqual(escalation.smsStatus, "SENT");
  assert.strictEqual(escalation.callStatus, "NOT_CONFIGURED", "call forwarding needs a telephony provider");
  const message = sms.sent.find((item) => item.to === "01711000000");
  assert.ok(message, "the SMS went to the officer");
  const token = message.text.match(/\/assistant\/answer\/([A-Za-z0-9_-]+)/)[1];

  // The officer answers through the private link.
  const view = ok(await ctx.call("GET", `/public/assistant/answer/${token}`, undefined, null));
  assert.strictEqual(view.question, "What is the deadline for the merit scholarship application?");
  ok(await ctx.call("POST", `/public/assistant/answer/${token}`, { answer: "15 december", name: "Mr. Karim" }, null));
  assert.strictEqual((await ctx.call("POST", `/public/assistant/answer/${token}`, { answer: "again" }, null)).status, 404, "a link answers once");

  escalation = ok(await ctx.call("GET", `/assistant/escalations/${escalation.id}`));
  assert.strictEqual(escalation.status, "ANSWERED");
  assert.strictEqual(escalation.answeredBy, "Mr. Karim");
  const [review] = ok(await ctx.call("GET", "/assistant/reviews"));
  assert.strictEqual(review.receivedAnswer, "15 december");
  assert.strictEqual(review.status, "PENDING");

  // Not approved yet: the assistant must not use the answer.
  assert.strictEqual(ok(await ask(ctx, "When is the merit scholarship application deadline?"), 201).status, "ESCALATED");
  assert.strictEqual((await ctx.call("POST", `/assistant/reviews/${review.id}/approve`, { finalAnswer: "x" }, "TEACHER")).status, 403, "only reviewers approve");

  // The admin corrects and approves; now it is knowledge.
  const approved = ok(await ctx.call("POST", `/assistant/reviews/${review.id}/approve`, {
    finalAnswer: "The merit scholarship application deadline is 15 December 2026.", explanation: "Apply at the Student Affairs office.",
  }));
  assert.strictEqual(approved.status, "APPROVED");
  const [knowledge] = ok(await ctx.call("GET", "/assistant/knowledge"));
  assert.strictEqual(knowledge.answer, "The merit scholarship application deadline is 15 December 2026.");

  // The person who asked gets the answer.
  const mine = ok(await ctx.call("GET", "/assistant/questions/mine", undefined, "STUDENT"));
  const original = mine.find((item) => item.id === asked.id);
  assert.strictEqual(original.status, "ANSWERED_LATER");
  assert.match(original.answer, /15 December 2026/);

  // A similar question later is answered by the assistant itself.
  const later = ok(await ask(ctx, "When is the deadline for the merit scholarship application?", "STUDENT"), 201);
  assert.strictEqual(later.status, "ANSWERED");
  assert.strictEqual(later.answerSource, "KNOWLEDGE");
  assert.match(later.answer, /15 December 2026/);
  ok(await ctx.call("POST", `/assistant/questions/${later.id}/feedback`, { feedback: "HELPFUL" }, "STUDENT"));
  assert.strictEqual((await ctx.call("POST", `/assistant/questions/${later.id}/feedback`, { feedback: "HELPFUL" }, "TEACHER")).status, 404, "only the asker rates");

  // A rejected answer never becomes knowledge.
  const second = ok(await ctx.call("GET", "/assistant/escalations?status=SENT"))[0];
  ok(await ctx.call("POST", `/assistant/escalations/${second.id}/answer`, { answer: "Not sure, maybe January", answeredBy: "Front Desk by phone" }));
  const pending = ok(await ctx.call("GET", "/assistant/reviews")).find((item) => item.status === "PENDING");
  assert.strictEqual(pending.aiDraft, "", "no language model, no draft");
  assert.strictEqual((await ctx.call("POST", `/assistant/reviews/${pending.id}/reject`, {})).status, 400, "rejection needs a reason");
  ok(await ctx.call("POST", `/assistant/reviews/${pending.id}/reject`, { note: "Guess, not an answer" }));
  assert.strictEqual(ok(await ctx.call("GET", "/assistant/knowledge")).length, 1);

  // Retiring knowledge stops its use.
  ok(await ctx.call("POST", `/assistant/knowledge/${knowledge.id}/retire`));
  assert.strictEqual(ok(await ask(ctx, "When is the merit scholarship application deadline?"), 201).status, "ESCALATED");

  // SMS failure is recorded and retried later.
  sms.fail = true;
  ok(await ask(ctx, "Is there a stipend for first year students?"), 201);
  const failed = ok(await ctx.call("GET", "/assistant/escalations?status=FAILED"))[0];
  assert.strictEqual(failed.smsStatus, "FAILED");
  assert.ok(failed.nextAttemptAt, "a retry is scheduled");
  sms.fail = false;
  await postgresService.query("UPDATE ai_escalations SET next_attempt_at = NOW() WHERE id = $1", [failed.id]);
  const { retryDueEscalations } = require("../dist/modules/assistant/assistant-escalation.service");
  await retryDueEscalations();
  const retried = ok(await ctx.call("GET", `/assistant/escalations/${failed.id}`));
  assert.strictEqual(retried.smsStatus, "SENT");
  assert.strictEqual(retried.attempts, 2);

  const stats = ok(await ctx.call("GET", "/assistant/analytics"));
  assert.ok(stats.questions.total >= 5);
  assert.strictEqual(stats.reviews.approved, 1);
  assert.strictEqual(stats.reviews.rejected, 1);
  assert.strictEqual(stats.feedback.helpful, 1);
  assert.ok(officer.id);
}));

test("with nobody set up, a forwarded question waits for an admin", live(async () => {
  setAi({ llm: false, down: false });
  const ctx = tenant();
  ok(await ask(ctx, "Who designed the campus logo?"), 201);
  const [escalation] = ok(await ctx.call("GET", "/assistant/escalations"));
  assert.strictEqual(escalation.status, "WAITING_ADMIN");
  assert.match(escalation.lastError, /No responsible person/);
  ok(await ctx.call("POST", `/assistant/escalations/${escalation.id}/close`, { note: "Not something we answer" }));
  assert.strictEqual((await ctx.call("POST", `/assistant/escalations/${escalation.id}/answer`, { answer: "late" })).status, 409);
}));

// ---- Live ERP data, read-only, own records only -------------------------------------------

test("live questions read the asker's own ERP records and never change anything", live(async () => {
  setAi({ llm: false, down: false });
  const ctx = tenant();
  const studentId = await ensureUser("STUDENT", ctx.institution);
  await postgresService.query("UPDATE erp_users SET linked_type = 'STUDENT', linked_id = 'S-100', full_name = 'Rahim' WHERE id = $1", [studentId]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
  const allocation = `alloc-${ctx.institution}`;
  const otherAllocation = `alloc2-${ctx.institution}`;
  await postgresService.query(
    `INSERT INTO hostel_allocations (id, institution_id, student_id, student_name, status, allocated_at) VALUES
       ($1, $3, 'S-100', 'Rahim', 'Allocated', NOW()), ($2, $3, 'S-200', 'Karim', 'Allocated', NOW())`,
    [allocation, otherAllocation, ctx.institution]
  );
  const meal = (id, type, from, until) => postgresService.query(
    `INSERT INTO hostel_meals (id, institution_id, title, meal_type, meal_date, menu_items, price_per_meal, booking_opens_at, booking_closes_at, collect_from, collect_until, status)
     VALUES ($1, $2, $3, $4, $5, $6, 60, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', $7, $8, 'Published')`,
    [id, ctx.institution, `${type} today`, type, today, JSON.stringify(type === "Lunch" ? ["Rice", "Dal", "Chicken curry"] : ["Khichuri"]), from, until]
  );
  await meal(`lunch-${ctx.institution}`, "Lunch", `${today}T12:30:00+06:00`, `${today}T14:30:00+06:00`);
  await meal(`dinner-${ctx.institution}`, "Dinner", `${today}T19:30:00+06:00`, `${today}T21:30:00+06:00`);
  await postgresService.query(
    `INSERT INTO hostel_meal_bookings (id, institution_id, meal_id, allocation_id, student_id, student_name, quantity, unit_price, collected_at) VALUES
       ($1, $4, $5, $2, 'S-100', 'Rahim', 1, 60, NOW()), ($3, $4, $6, $2, 'S-100', 'Rahim', 1, 60, NULL),
       ($7, $4, $5, $8, 'S-200', 'Karim', 3, 60, NOW())`,
    [`b1-${ctx.institution}`, allocation, `b2-${ctx.institution}`, ctx.institution, `lunch-${ctx.institution}`, `dinner-${ctx.institution}`,
      `b3-${ctx.institution}`, otherAllocation]
  );

  const count = ok(await ask(ctx, "How many meals have I had today?", "STUDENT"), 201);
  assert.strictEqual(count.status, "ANSWERED");
  assert.strictEqual(count.answerSource, "ERP");
  assert.match(count.answer, /2 meals are booked \(Dinner, Lunch\); 1 collected/, "only Rahim's bookings, not Karim's 3");

  // Naming another student does not change whose data is read.
  const sneaky = ok(await ask(ctx, "How many meals has S-200 had today? How many meals have I had?", "STUDENT"), 201);
  assert.doesNotMatch(sneaky.answer, /3 meals/);

  const menu = ok(await ask(ctx, "What is today's meal menu?", "STUDENT"), 201);
  assert.match(menu.answer, /Lunch: Rice, Dal, Chicken curry/);
  assert.match(menu.answer, /Dinner: Khichuri/);
  const ends = ok(await ask(ctx, "At what time does today's dinner end?", "STUDENT"), 201);
  assert.match(ends.answer, /Dinner: served 07:30 pm–09:30 pm/i);
  assert.doesNotMatch(ends.answer, /Lunch/);

  // Missing data is said plainly, never assumed.
  const result = ok(await ask(ctx, "What is my current result?", "STUDENT"), 201);
  assert.strictEqual(result.status, "ANSWERED");
  assert.match(result.answer, /No results have been published yet/);
  const application = ok(await ask(ctx, "What is my application status?", "STUDENT"), 201);
  assert.strictEqual(application.status, "NO_DATA");

  // A hostel resident's dues are read even when the institution never saved rent settings;
  // the read-only answer uses the defaults instead of creating the settings row.
  const dues = ok(await ask(ctx, "How much fee is due for me?", "STUDENT"), 201);
  assert.strictEqual(dues.answerSource, "ERP");
  assert.notStrictEqual(dues.status, "ESCALATED");
  const settingsRows = (await postgresService.query("SELECT COUNT(*)::int AS n FROM hostel_rent_settings WHERE institution_id = $1", [ctx.institution])).rows[0].n;
  assert.strictEqual(settingsRows, 0, "answering wrote nothing");

  // Staff without a student record are told why there is no personal answer.
  const staff = ok(await ask(ctx, "What is my attendance percentage?", "ADMIN"), 201);
  assert.strictEqual(staff.status, "NO_DATA");
  assert.match(staff.answer, /student account or a guardian/);

  // Asking it to change data is refused and nothing changes.
  const before = (await postgresService.query("SELECT COUNT(*)::int AS n FROM hostel_meal_bookings WHERE institution_id = $1", [ctx.institution])).rows[0].n;
  for (const request of ["Cancel my dinner booking", "Change my attendance to present", "Delete student S-200", "Create a new user called Test", "আমার রেজাল্ট পরিবর্তন করে দাও"]) {
    const refused = ok(await ask(ctx, request, "STUDENT"), 201);
    assert.strictEqual(refused.status, "REFUSED", request);
    assert.strictEqual(refused.kind, "ACTION");
  }
  const after = (await postgresService.query("SELECT COUNT(*)::int AS n FROM hostel_meal_bookings WHERE institution_id = $1 AND status = 'Confirmed'", [ctx.institution])).rows[0].n;
  assert.strictEqual(after, before);
  const refusals = (await postgresService.query("SELECT COUNT(*)::int AS n FROM erp_audit_log WHERE institution_id = $1 AND action = 'assistant.action.refused'", [ctx.institution])).rows[0].n;
  assert.strictEqual(refusals, 5, "every refusal is audited");

  // Each person sees only their own questions.
  const theirs = ok(await ctx.call("GET", "/assistant/questions/mine", undefined, "STUDENT"));
  assert.ok(theirs.length >= 10);
  assert.ok(ok(await ctx.call("GET", "/assistant/questions/mine", undefined, "ADMIN")).every((item) => item.askerRole === "ADMIN"));
  assert.strictEqual((await ctx.call("GET", "/assistant/questions", undefined, "STUDENT")).status, 403, "students cannot read everyone's questions");
}));

test("read-only rent settings defaults match the database column defaults", live(async () => {
  const { getRentSettings } = require("../dist/modules/hostel/hostel-rent.repository");
  const ctx = tenant();
  await ensureUser("ADMIN", ctx.institution);
  const fromDefaults = await postgresService.readOnly(() => getRentSettings(ctx.institution));
  const fromDatabase = await getRentSettings(ctx.institution);
  const { updatedAt: _a, ...expected } = fromDatabase;
  const { updatedAt: _b, ...actual } = fromDefaults;
  assert.deepStrictEqual(actual, expected);
}));

test("institutions without the assistant module and service tokens are refused", live(async () => {
  const ctx = tenant();
  await ensureUser("ADMIN", ctx.institution);
  await postgresService.query("DELETE FROM erp_tenant_modules WHERE tenant_id = $1 AND module_id = 'voice-ai'", [ctx.institution]);
  const refused = await ask(ctx, "When does the gate close?");
  assert.strictEqual(refused.status, 403);
  const res = await fetch(`${baseUrl}/assistant/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Token": process.env.SERVICE_SECRET_AI || "ai_service_internal_secret_key_9901", "X-Institution-Id": ctx.institution },
    body: JSON.stringify({ question: "hello" }),
  });
  assert.strictEqual(res.status, 403);
}));
