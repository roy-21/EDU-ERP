// Who did what inside an institution, read from the audit logs every module already writes
// (the shared erp_audit_log and the hostel's own log). Always scoped to one institution.
import { postgresService } from "../../database/postgres";
import { HostelError, toIso } from "../hostel/hostel.common";
import { SYSTEM_ROLES } from "./identity.catalog";
import { usersService } from "./identity.service";
import { describeDevice, describeIp } from "./user-agent";

const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

export type ActivityFilters = { userId?: string; roleId?: string; search?: string; before?: string; limit?: number };

const EVENTS = `
  SELECT id, actor_id, actor_email, action, entity_type, entity_id, summary, created_at, ip_address, user_agent, 'General' AS source
    FROM erp_audit_log WHERE institution_id = $1
  UNION ALL
  SELECT id, actor_id, actor_email, action, entity_type, entity_id, summary, created_at, ip_address, user_agent, 'Hostel' AS source
    FROM hostel_audit_log WHERE institution_id = $1`;

// Where an action came from. Entries older than this feature have neither.
const originOf = (ip: string, userAgent: string) =>
  ip || userAgent ? { ip: ip || null, network: describeIp(ip) || null, device: describeDevice(userAgent), userAgent: userAgent || null } : null;

const roleName = (role: string | null, customName: string | null) => (role ? SYSTEM_ROLES[role]?.name || customName || role : null);

const eventFromRow = (row: any) => ({
  id: row.id,
  at: toIso(row.created_at),
  action: row.action,
  area: row.source === "Hostel" ? `Hostel · ${row.entity_type}` : row.entity_type,
  entityId: row.entity_id,
  summary: row.summary,
  origin: originOf(row.ip_address, row.user_agent),
  actor: {
    id: row.actor_id || null,
    name: row.full_name || null,
    username: row.username || null,
    email: row.actor_email || null,
    role: row.role || null,
    roleName: roleName(row.role, row.role_name),
    // Someone outside the institution, such as the platform owner approving it.
    outside: !row.username,
  },
});

export const activityService = {
  // Newest first, one page at a time: pass the last item's time as `before` for the next page.
  async list(institutionId: string, filters: ActivityFilters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    let before: string | null = null;
    if (filters.before) {
      if (Number.isNaN(Date.parse(filters.before))) fail(400, "before must be a date and time.");
      before = new Date(filters.before).toISOString();
    }
    const search = (filters.search || "").trim().slice(0, 100);
    const { rows } = await postgresService.query(
      `SELECT e.*, u.full_name, u.username, u.role, r.name AS role_name
       FROM (${EVENTS}) e
       LEFT JOIN erp_users u ON u.id = e.actor_id AND u.institution_id = $1
       LEFT JOIN erp_roles r ON r.id = u.role AND r.institution_id = $1
       WHERE ($2 = '' OR e.actor_id = $2)
         AND ($3 = '' OR u.role = $3)
         AND ($4 = '' OR e.summary ILIKE '%' || $4 || '%' OR e.action ILIKE '%' || $4 || '%' OR e.entity_type ILIKE '%' || $4 || '%')
         AND ($5::timestamptz IS NULL OR e.created_at < $5::timestamptz)
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT $6`,
      [institutionId, filters.userId || "", filters.roleId || "", search, before, limit + 1]
    );
    const items = rows.slice(0, limit).map(eventFromRow);
    return { items, nextBefore: rows.length > limit ? items[items.length - 1].at : null };
  },

  // One person: their account, how active they are, what they set up, and what they did.
  async user(institutionId: string, userId: string, filters: ActivityFilters = {}) {
    const user = await usersService.get(institutionId, userId);
    const [stats, areas, createdUsers, createdRoles, activity, devices] = await Promise.all([
      postgresService.query(
        `SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last30,
           COUNT(*) FILTER (WHERE action = 'Signed In')::int AS sign_ins,
           MAX(created_at) AS last_at
         FROM (${EVENTS}) e WHERE e.actor_id = $2`,
        [institutionId, userId]
      ),
      postgresService.query(
        `SELECT CASE WHEN source = 'Hostel' THEN 'Hostel · ' || entity_type ELSE entity_type END AS area, COUNT(*)::int AS count
         FROM (${EVENTS}) e WHERE e.actor_id = $2 AND e.action <> 'Signed In'
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        [institutionId, userId]
      ),
      // Accounts and roles record who made them by their email.
      user.email
        ? postgresService.query(
          `SELECT u.id, u.full_name, u.username, u.role, r.name AS role_name, u.status, u.created_at, u.last_login_at
           FROM erp_users u LEFT JOIN erp_roles r ON r.id = u.role AND r.institution_id = u.institution_id
           WHERE u.institution_id = $1 AND LOWER(u.created_by) = LOWER($2) ORDER BY u.created_at DESC LIMIT 100`,
          [institutionId, user.email]
        )
        : Promise.resolve({ rows: [] as any[] }),
      user.email
        ? postgresService.query(
          `SELECT r.id, r.name, r.created_at, CARDINALITY(r.permissions) AS permissions,
             (SELECT COUNT(*) FROM erp_users x WHERE x.institution_id = r.institution_id AND x.role = r.id)::int AS users
           FROM erp_roles r WHERE r.institution_id = $1 AND LOWER(r.created_by) = LOWER($2) ORDER BY r.created_at DESC`,
          [institutionId, user.email]
        )
        : Promise.resolve({ rows: [] as any[] }),
      this.list(institutionId, { ...filters, userId }),
      // Each IP address and browser the person has used, most recent first.
      postgresService.query(
        `SELECT ip_address, user_agent, COUNT(*)::int AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
           COUNT(*) FILTER (WHERE action = 'Signed In')::int AS sign_ins
         FROM (${EVENTS}) e WHERE e.actor_id = $2 AND (ip_address <> '' OR user_agent <> '')
         GROUP BY ip_address, user_agent ORDER BY MAX(created_at) DESC LIMIT 20`,
        [institutionId, userId]
      ),
    ]);
    const s = stats.rows[0];
    return {
      user,
      stats: { total: s.total, last30Days: s.last30, signIns: s.sign_ins, lastActivityAt: toIso(s.last_at) },
      areas: areas.rows.map((row: any) => ({ area: row.area, count: row.count })),
      createdUsers: createdUsers.rows.map((row: any) => ({
        id: row.id, fullName: row.full_name, username: row.username, roleName: roleName(row.role, row.role_name), status: row.status,
        createdAt: toIso(row.created_at), lastLoginAt: toIso(row.last_login_at),
      })),
      devices: devices.rows.map((row: any) => ({
        ...originOf(row.ip_address, row.user_agent), actions: row.count, signIns: row.sign_ins, firstAt: toIso(row.first_at), lastAt: toIso(row.last_at),
      })),
      createdRoles: createdRoles.rows.map((row: any) => ({ id: row.id, name: row.name, permissions: Number(row.permissions) || 0, users: row.users, createdAt: toIso(row.created_at) })),
      activity,
    };
  },

  // A whole institution at a glance, for the platform owner.
  async tenantOverview(tenantId: string) {
    const tenant = await postgresService.query("SELECT id, code, name, status, owner_user_id, created_at FROM erp_tenants WHERE id = $1", [tenantId]);
    if (!tenant.rows[0]) fail(404, "Institution not found.");
    const t = tenant.rows[0];
    const [users, roles, modules, activity] = await Promise.all([
      postgresService.query(
        `SELECT u.id, u.full_name, u.username, u.email, u.role, r.name AS role_name, u.status, u.created_by, u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM (${EVENTS}) e WHERE e.actor_id = u.id AND e.created_at >= NOW() - INTERVAL '30 days')::int AS last30,
           (SELECT JSON_BUILD_OBJECT('ip', e.ip_address, 'ua', e.user_agent, 'at', e.created_at) FROM (${EVENTS}) e
              WHERE e.actor_id = u.id AND (e.ip_address <> '' OR e.user_agent <> '') ORDER BY e.created_at DESC LIMIT 1) AS last_seen
         FROM erp_users u LEFT JOIN erp_roles r ON r.id = u.role AND r.institution_id = u.institution_id
         WHERE u.institution_id = $1 ORDER BY (u.id = $2) DESC, u.created_at`,
        [tenantId, t.owner_user_id || ""]
      ),
      postgresService.query(
        `SELECT r.id, r.name, r.created_by, r.created_at, CARDINALITY(r.permissions) AS permissions,
           (SELECT COUNT(*) FROM erp_users x WHERE x.institution_id = r.institution_id AND x.role = r.id)::int AS users
         FROM erp_roles r WHERE r.institution_id = $1 ORDER BY r.created_at`,
        [tenantId]
      ),
      postgresService.query(
        `SELECT module_id FROM erp_tenant_modules WHERE tenant_id = $1 AND status = 'ACTIVE'
           AND starts_on <= CURRENT_DATE AND (ends_on IS NULL OR ends_on >= CURRENT_DATE) ORDER BY module_id`,
        [tenantId]
      ),
      this.list(tenantId, { limit: 50 }),
    ]);
    return {
      tenant: { id: t.id, code: t.code, name: t.name, status: t.status, createdAt: toIso(t.created_at) },
      modules: modules.rows.map((row: any) => row.module_id),
      users: users.rows.map((row: any) => ({
        id: row.id, fullName: row.full_name, username: row.username, email: row.email, role: row.role, roleName: roleName(row.role, row.role_name),
        status: row.status, isOwner: row.id === t.owner_user_id, createdBy: row.created_by, createdAt: toIso(row.created_at),
        lastLoginAt: toIso(row.last_login_at), actionsLast30Days: row.last30,
        lastSeenFrom: row.last_seen ? { ...originOf(row.last_seen.ip, row.last_seen.ua), at: toIso(row.last_seen.at) } : null,
      })),
      roles: roles.rows.map((row: any) => ({
        id: row.id, name: row.name, createdBy: row.created_by, createdAt: toIso(row.created_at), permissions: Number(row.permissions) || 0, users: row.users,
      })),
      activity,
    };
  },
};
