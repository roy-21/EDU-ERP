const assert = require("node:assert");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");

const app = createApp();
let server;
let baseUrl;

test.before(async () => {
  await postgresService.initialize();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api/v1`;
      resolve();
    });
  });
});

// The form test writes to the demo institution, so it removes its own rows.
const removeTestForm = async () => {
  const { rows } = await postgresService.query("SELECT id FROM erp_forms WHERE institution_id = 'inst-001' AND slug = 'semester-feedback-form'");
  for (const row of rows) {
    await postgresService.query("DELETE FROM erp_audit_log WHERE entity_id = $1", [row.id]);
    await postgresService.query("DELETE FROM erp_forms WHERE id = $1", [row.id]);
  }
};

test.after(async () => {
  if (postgresService.isLive()) await removeTestForm();
  await new Promise((resolve) => server.close(resolve));
  setTimeout(() => process.exit(), 200).unref();
});

test("Core ERP Health Check Endpoint returns 200 HEALTHY", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.status, "HEALTHY");
  assert.strictEqual(body.data.service, "core-erp-backend");
});

test("Auth Login generates valid JWT token for Super Admin", async () => {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@institution.edu", password: "password123" })
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.ok(body.data.token);
  assert.strictEqual(body.data.user.role, "SUPER_ADMIN");
});

test("Dynamic Form Creation & Persistence works for Authenticated Institution Admin", async () => {
  // Login first
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@institution.edu", password: "password123" })
  });
  const { data: { token } } = await loginRes.json();

  await removeTestForm();
  // Create form
  const formRes = await fetch(`${baseUrl}/system/forms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      title: "Semester Feedback Form",
      formType: "temporary",
      schema: [{ id: "q1", type: "text", label: "Feedback comment", required: true }]
    })
  });

  assert.strictEqual(formRes.status, 201);
  const formBody = await formRes.json();
  assert.strictEqual(formBody.success, true);
  assert.strictEqual(formBody.data.title, "Semester Feedback Form");
  assert.strictEqual(formBody.data.slug, "semester-feedback-form");
});

test("Voice Assistant Service Token can create an Objection ticket directly in Core ERP", async () => {
  const res = await fetch(`${baseUrl}/objections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": "voice_service_internal_secret_key_8802",
      "X-Institution-Id": "inst-001"
    },
    body: JSON.stringify({
      source: "AI_VOICE_CALL",
      category: "GRADE_DISPUTE",
      severity: "HIGH",
      title: "Voice Call: Midterm marks dispute",
      description: "Caller student claims exam marks were incorrectly entered.",
      callSessionId: "call_session_9921"
    })
  });

  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.source, "AI_VOICE_CALL");
  assert.strictEqual(body.data.status, "OPEN");
});

