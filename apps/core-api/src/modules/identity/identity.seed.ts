import { PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { MODULES } from "./identity.catalog";

// The two institutions the app has always run with. Every module is switched on for them.
const TENANTS = [
  { id: "inst-001", code: "DU", name: "Dhaka University Campus", type: "University" },
  { id: "inst-002", code: "BUET", name: "BUET Engineering Institute", type: "University" },
];

// Demo accounts for development only. Production gets one admin from the environment.
const DEMO_USERS = [
  { id: "u-superadmin", username: "admin", email: "admin@institution.edu", fullName: "Super Admin", role: "SUPER_ADMIN" },
  { id: "u-teacher1", username: "tchr.rafiqul", email: "teacher@institution.edu", fullName: "Dr. Rafiqul Islam", role: "TEACHER" },
  { id: "u-student1", username: "std.imran", email: "student@institution.edu", fullName: "Imran Ahmed", role: "STUDENT" },
  { id: "u-guardian1", username: "guardian.imran", email: "guardian@institution.edu", fullName: "Abdul Karim", role: "GUARDIAN" },
  { id: "u-staff1", username: "staff.kamal", email: "staff@institution.edu", fullName: "Shamsul Huda", role: "STAFF" },
];
const DEMO_PASSWORD = "password123";

export const seedIdentity = async (client: PoolClient) => {
  for (const [index, module] of MODULES.entries()) {
    await client.query(
      `INSERT INTO erp_modules (id, name, category, icon, monthly_price, is_core, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, icon = EXCLUDED.icon,
         is_core = EXCLUDED.is_core, sort_order = EXCLUDED.sort_order`,
      [module.id, module.name, module.category, module.icon, module.monthlyPrice, module.isCore, index]
    );
  }

  const tenants = await client.query("SELECT COUNT(*)::int AS count FROM erp_tenants WHERE id = ANY($1)", [TENANTS.map((item) => item.id)]);
  if (tenants.rows[0].count === 0) {
    for (const tenant of TENANTS) {
      await client.query(
        "INSERT INTO erp_tenants (id, code, name, type, status) VALUES ($1, $2, $3, $4, 'ACTIVE') ON CONFLICT DO NOTHING",
        [tenant.id, tenant.code, tenant.name, tenant.type]
      );
      await client.query(
        `INSERT INTO erp_tenant_modules (tenant_id, module_id, monthly_price)
         SELECT $1, id, monthly_price FROM erp_modules ON CONFLICT DO NOTHING`,
        [tenant.id]
      );
    }
    console.log("🌱 [Identity] Seeded the default institutions with every module.");
  }

  const users = await client.query("SELECT COUNT(*)::int AS count FROM erp_users WHERE institution_id = 'inst-001'");
  if (users.rows[0].count > 0) return;

  if (process.env.NODE_ENV === "production") {
    const email = process.env.ERP_ADMIN_EMAIL;
    const password = process.env.ERP_ADMIN_PASSWORD;
    if (!email || !password || password.length < 12) {
      console.warn("[Identity] No users yet. Set ERP_ADMIN_EMAIL and ERP_ADMIN_PASSWORD (12+ characters) to create the first admin.");
      return;
    }
    await client.query(
      `INSERT INTO erp_users (id, institution_id, username, email, full_name, password_hash, role, must_change_password, created_by)
       VALUES ('u-superadmin', 'inst-001', 'admin', $1, 'Super Admin', $2, 'SUPER_ADMIN', TRUE, 'seed')`,
      [email.toLowerCase(), await bcrypt.hash(password, 12)]
    );
    console.log("🌱 [Identity] Created the first super admin from the environment.");
    return;
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const user of DEMO_USERS) {
    await client.query(
      // An old start date, so sessions signed in before this table existed keep working.
      `INSERT INTO erp_users (id, institution_id, username, email, full_name, password_hash, role, must_change_password, created_by, password_changed_at)
       VALUES ($1, 'inst-001', $2, $3, $4, $5, $6, FALSE, 'seed', '2000-01-01') ON CONFLICT DO NOTHING`,
      [user.id, user.username, user.email, user.fullName, hash, user.role]
    );
  }
  console.log("🌱 [Identity] Seeded demo accounts (development only).");
};
