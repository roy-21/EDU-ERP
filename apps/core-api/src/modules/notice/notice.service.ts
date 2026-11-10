import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { isSmtpConfigured, renderEmailHtml, sendSmtpMail } from "../hostel/hostel-email.service";
import { Actor, audit } from "../identity/identity.service";
import { fail, inTx, oneOf, text } from "../academics/academics.common";

export const NOTICE_CATEGORIES = ["GENERAL", "ACADEMIC", "EXAM", "EVENT", "HOLIDAY", "FINANCE", "URGENT"] as const;
export const NOTICE_AUDIENCES = ["ALL", "STUDENTS", "GUARDIANS", "TEACHERS", "STAFF"] as const;
const DISPLAYS = ["BOARD", "POPUP"] as const;

// Which audience a signed-in role belongs to. Everyone who is not a student, guardian or teacher is staff.
export const audienceOf = (role: string) =>
  role === "STUDENT" ? "STUDENTS" : role === "GUARDIAN" ? "GUARDIANS" : role === "TEACHER" ? "TEACHERS" : "STAFF";

const ROLES_OF: Record<string, string> = {
  STUDENTS: "u.role = 'STUDENT'",
  GUARDIANS: "u.role = 'GUARDIAN'",
  TEACHERS: "u.role = 'TEACHER'",
  STAFF: "u.role NOT IN ('STUDENT', 'GUARDIAN', 'TEACHER', 'NOT_SYSTEM_USER')",
  ALL: "u.role <> 'NOT_SYSTEM_USER'",
};

const fromRow = (row: any) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  category: row.category,
  audience: row.audience,
  display: row.display,
  isPinned: row.is_pinned,
  status: row.status,
  publishAt: toIso(row.publish_at),
  expiresAt: toIso(row.expires_at),
  publishedAt: toIso(row.published_at),
  emailedAt: toIso(row.emailed_at),
  emailedCount: Number(row.emailed_count || 0),
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const moment = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(400, `${label} must be a date and time.`);
  return new Date(value as string).toISOString();
};

const input = (body: any, existing?: any) => {
  const result = {
    title: body?.title !== undefined || !existing ? text(body?.title, "Title", 200, true) : existing.title,
    body: body?.body !== undefined || !existing ? text(body?.body, "Message", 20000, true) : existing.body,
    category: oneOf(body?.category, "Category", NOTICE_CATEGORIES, existing?.category || "GENERAL"),
    audience: oneOf(body?.audience, "Audience", NOTICE_AUDIENCES, existing?.audience || "ALL"),
    display: oneOf(body?.display, "Display", DISPLAYS, existing?.display || "BOARD"),
    isPinned: body?.isPinned !== undefined ? Boolean(body.isPinned) : Boolean(existing?.is_pinned),
    publishAt: body?.publishAt !== undefined ? moment(body.publishAt, "Show from") : existing ? toIso(existing.publish_at) : null,
    expiresAt: body?.expiresAt !== undefined ? moment(body.expiresAt, "Show until") : existing ? toIso(existing.expires_at) : null,
  };
  if (result.publishAt && result.expiresAt && result.expiresAt <= result.publishAt) fail(400, "\"Show until\" must be after \"Show from\".");
  return result;
};

const load = async (institutionId: string, id: string) => {
  const { rows } = await postgresService.query("SELECT * FROM notices WHERE institution_id = $1 AND id = $2", [institutionId, id]);
  if (!rows[0]) fail(404, "Notice not found.");
  return rows[0];
};

export const noticesService = {
  async list(institutionId: string, filters: { status?: string; search?: string } = {}) {
    const { rows } = await postgresService.query(
      `SELECT * FROM notices WHERE institution_id = $1 AND ($2 = '' OR status = $2)
         AND ($3 = '' OR title ILIKE '%' || $3 || '%' OR body ILIKE '%' || $3 || '%')
       ORDER BY is_pinned DESC, COALESCE(published_at, created_at) DESC LIMIT 500`,
      [institutionId, filters.status || "", filters.search?.trim() || ""]
    );
    return rows.map(fromRow);
  },

  // What one person sees now: published, within its dates, and meant for their audience.
  async feed(institutionId: string, role: string, display?: string) {
    const { rows } = await postgresService.query(
      `SELECT * FROM notices WHERE institution_id = $1 AND status = 'PUBLISHED'
         AND (publish_at IS NULL OR publish_at <= NOW()) AND (expires_at IS NULL OR expires_at > NOW())
         AND audience IN ('ALL', $2) AND ($3 = '' OR display = $3)
       ORDER BY is_pinned DESC, COALESCE(publish_at, published_at) DESC LIMIT 100`,
      [institutionId, audienceOf(role), display || ""]
    );
    return rows.map(fromRow);
  },

  async create(actor: Actor, body: any) {
    const data = input(body);
    const publish = Boolean(body?.publish);
    const id = newId();
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO notices (id, institution_id, title, body, category, audience, display, is_pinned, publish_at, expires_at, status, published_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, actor.institutionId, data.title, data.body, data.category, data.audience, data.display, data.isPinned, data.publishAt, data.expiresAt,
          publish ? "PUBLISHED" : "DRAFT", publish ? new Date().toISOString() : null, actor.email]
      );
      await audit(tx, actor, publish ? "notice.publish" : "notice.create", "notice", id, `${publish ? "Published" : "Drafted"} notice "${data.title}" for ${data.audience}.`);
    });
    return fromRow(await load(actor.institutionId, id));
  },

  async update(actor: Actor, id: string, body: any) {
    const existing = await load(actor.institutionId, id);
    const data = input(body, existing);
    await inTx(async (tx) => {
      await tx.query(
        `UPDATE notices SET title = $3, body = $4, category = $5, audience = $6, display = $7, is_pinned = $8, publish_at = $9, expires_at = $10, updated_at = NOW()
         WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, data.title, data.body, data.category, data.audience, data.display, data.isPinned, data.publishAt, data.expiresAt]
      );
      await audit(tx, actor, "notice.update", "notice", id, `Edited notice "${data.title}".`);
    });
    return fromRow(await load(actor.institutionId, id));
  },

  async setStatus(actor: Actor, id: string, status: "PUBLISHED" | "ARCHIVED" | "DRAFT") {
    const existing = await load(actor.institutionId, id);
    await inTx(async (tx) => {
      await tx.query(
        `UPDATE notices SET status = $3, published_at = CASE WHEN $3::varchar = 'PUBLISHED' THEN COALESCE(published_at, NOW()) ELSE published_at END, updated_at = NOW()
         WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, status]
      );
      await audit(tx, actor, `notice.${status.toLowerCase()}`, "notice", id, `Notice "${existing.title}" is now ${status.toLowerCase()}.`);
    });
    return fromRow(await load(actor.institutionId, id));
  },

  async remove(actor: Actor, id: string) {
    const existing = await load(actor.institutionId, id);
    await inTx(async (tx) => {
      await tx.query("DELETE FROM notices WHERE id = $1", [id]);
      await audit(tx, actor, "notice.delete", "notice", id, `Deleted notice "${existing.title}".`);
    });
    return { id };
  },

  // How many active accounts with an email this notice would reach.
  async recipients(institutionId: string, audience: string) {
    const { rows } = await postgresService.query(
      `SELECT u.email, u.full_name FROM erp_users u WHERE u.institution_id = $1 AND u.status = 'ACTIVE' AND u.email IS NOT NULL AND u.email <> ''
         AND ${ROLES_OF[audience] || ROLES_OF.ALL} ORDER BY u.email LIMIT 1000`,
      [institutionId]
    );
    return rows as { email: string; full_name: string }[];
  },

  // Emails a published notice to its audience's accounts. "Sent" means the mail server accepted it.
  async email(actor: Actor, id: string) {
    const notice = await load(actor.institutionId, id);
    if (notice.status !== "PUBLISHED") fail(409, "Publish the notice before emailing it.");
    if (!isSmtpConfigured()) fail(503, "Email is not configured on the server. Add EMAIL_USER and EMAIL_PASS to the API's .env file.");
    const people = await this.recipients(actor.institutionId, notice.audience);
    if (people.length === 0) fail(400, "No active accounts with an email address are in this audience.");
    const tenant = await postgresService.query("SELECT name FROM erp_tenants WHERE id = $1", [actor.institutionId]);
    const brand = tenant.rows[0]?.name || "Institution";
    let sent = 0;
    const failed: string[] = [];
    for (const person of people) {
      try {
        await sendSmtpMail({
          brand, to: person.email, subject: `[${brand}] ${notice.title}`, text: notice.body,
          html: renderEmailHtml({ brand, title: notice.title, body: notice.body, rows: [["Category", notice.category], ["Audience", notice.audience]] }),
        });
        sent += 1;
      } catch {
        failed.push(person.email);
      }
    }
    await postgresService.query("UPDATE notices SET emailed_at = NOW(), emailed_count = emailed_count + $2 WHERE id = $1", [id, sent]);
    await audit(postgresService, actor, "notice.email", "notice", id, `Emailed notice "${notice.title}": ${sent} accepted, ${failed.length} failed.`);
    return { sent, failed: failed.length, failedAddresses: failed.slice(0, 20) };
  },
};
