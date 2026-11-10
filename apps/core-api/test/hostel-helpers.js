const { createHash, randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../dist/config/environment");
const { postgresService } = require("../dist/database/postgres");

// Tests never use the real mailbox from .env. Tests that check email start their own fake mail server.
for (const key of ["EMAIL_USER", "EMAIL_PASS", "TO_EMAIL", "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_SECURE"]) process.env[key] = "";

// Every request is checked against a real user row, so each test role gets one.
const ensured = new Set();
const ensureUser = async (role, institutionId) => {
  const id = `t-${createHash("sha1").update(`${role}|${institutionId}`).digest("hex").slice(0, 32)}`;
  if (ensured.has(id)) return id;
  await postgresService.query(
    "INSERT INTO erp_tenants (id, code, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
    [institutionId]
  );
  await postgresService.query(
    "INSERT INTO erp_tenant_modules (tenant_id, module_id) SELECT $1, id FROM erp_modules ON CONFLICT DO NOTHING",
    [institutionId]
  );
  await postgresService.query(
    `INSERT INTO erp_users (id, institution_id, username, email, full_name, password_hash, role, must_change_password,
       password_changed_at)
     VALUES ($1, $2, $1, $3, $4, '!test', $5, FALSE, NOW() - INTERVAL '1 hour')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
    [id, institutionId, role === "ADMIN" ? "test@example.com" : `${id}@example.com`, `Test ${role}`, role]
  );
  ensured.add(id);
  return id;
};

const tokenFor = async (role, institutionId) =>
  jwt.sign(
    { userId: await ensureUser(role, institutionId), institutionId, role, email: "test@example.com" },
    config.jwtSecret
  );

// Makes an API client bound to a test institution of its own.
const createClient = (getBaseUrl) => {
  const institution = `test-${randomUUID()}`;

  const call = async (method, path, body, role = "ADMIN", institutionId = institution) => {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(role ? { Authorization: `Bearer ${await tokenFor(role, institutionId)}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, data: json.data, error: json.error, details: json.details };
  };

  return { institution, call };
};

const removeInstitutions = async (ids) => {
  await postgresService.query(
    "DELETE FROM hostel_invoice_items WHERE invoice_id IN (SELECT id FROM hostel_invoices WHERE institution_id = ANY($1))",
    [ids]
  );
  for (const table of [
    "hostel_notifications",
    "hostel_meal_bookings",
    "hostel_meals",
    "hostel_visitor_documents",
    "hostel_visitors",
    "hostel_fee_assignments",
    "hostel_student_groups",
    "hostel_fee_types",
    "hostel_rent_changes",
    "hostel_gateway_transactions",
    "hostel_payment_links",
    "hostel_gateway_config",
    "hostel_payment_methods",
    "hostel_refunds",
    "hostel_payments",
    "hostel_invoice_adjustments",
    "hostel_invoices",
    "hostel_allocations",
    "hostel_maintenance_tickets",
    "hostel_rooms",
    "hostel_buildings",
    "hostel_rent_settings",
    "hostel_notification_templates",
    "hostel_audit_log",
  ]) {
    await postgresService.query(`DELETE FROM ${table} WHERE institution_id = ANY($1)`, [ids]);
  }
  await postgresService.query("DELETE FROM erp_audit_log WHERE institution_id = ANY($1)", [ids]);
  await postgresService.query("DELETE FROM erp_tenants WHERE id = ANY($1)", [ids]);
};

const live = (fn) => async (t) => {
  if (!postgresService.isLive()) return t.skip("PostgreSQL is offline");
  await fn(t);
};

module.exports = { createClient, ensureUser, live, removeInstitutions, tokenFor };
