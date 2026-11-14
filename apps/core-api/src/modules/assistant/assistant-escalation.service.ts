import { createHash, createHmac, randomBytes } from "crypto";
import { PoolClient } from "pg";
import { config } from "../../config/environment";
import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { isSmtpConfigured, renderEmailHtml, sendSmtpMail } from "../hostel/hostel-email.service";
import { Actor, audit } from "../identity/identity.service";
import { email as emailOf, fail, inTx, oneOf, phone as phoneOf, text } from "../academics/academics.common";
import { assistantEngine } from "./assistant-engine.client";
import { languageOf, termsOf } from "./assistant-text";

// Questions the assistant could not answer go to a responsible person. They answer through a
// private link (or an admin records an answer given by phone); the answer then waits for an
// admin's review before the assistant may use it.

const CHANNELS = ["SMS", "EMAIL", "CALL", "PANEL"] as const;
const MAX_ATTEMPTS = 5;
const LINK_DAYS = 14;
const PROVIDER_TIMEOUT_MS = 10_000;

// ---- Settings -------------------------------------------------------------------------

export const settingsService = {
  async get(institutionId: string) {
    const row = (await postgresService.query("SELECT * FROM ai_settings WHERE institution_id = $1", [institutionId])).rows[0];
    return {
      timezone: row?.timezone || "Asia/Dhaka",
      minConfidence: row ? Number(row.min_confidence) : 0.6,
      adminEmail: row?.admin_email || "",
      updatedBy: row?.updated_by || "",
      updatedAt: toIso(row?.updated_at || null),
    };
  },

  async save(actor: Actor, body: any) {
    const timezone = text(body?.timezone, "Time zone", 60) || "Asia/Dhaka";
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      fail(400, "Time zone is not valid. Use a name like Asia/Dhaka.");
    }
    const minConfidence = Number(body?.minConfidence ?? 0.6);
    if (!Number.isFinite(minConfidence) || minConfidence < 0.3 || minConfidence > 0.95) fail(400, "Confidence must be from 0.3 to 0.95.");
    const adminEmail = emailOf(body?.adminEmail, "Admin email") || "";
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO ai_settings (institution_id, timezone, min_confidence, admin_email, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (institution_id) DO UPDATE SET timezone = $2, min_confidence = $3, admin_email = $4, updated_by = $5, updated_at = NOW()`,
        [actor.institutionId, timezone, minConfidence, adminEmail, actor.email]
      );
      await audit(tx, actor, "assistant.settings.update", "ai_settings", actor.institutionId, `Assistant settings: ${timezone}, confidence ${minConfidence}.`);
    });
    return this.get(actor.institutionId);
  },
};

// ---- Delivery providers ---------------------------------------------------------------

type Provider = { url: string; key: string; from: string };
const providerOf = (prefixes: string[]): Provider | null => {
  for (const prefix of prefixes) {
    const url = process.env[`${prefix}_API_URL`];
    if (url) return { url, key: process.env[`${prefix}_API_KEY`] || "", from: process.env[`${prefix}_FROM`] || "" };
  }
  return null;
};
const smsProvider = () => providerOf(["ASSISTANT_SMS", "HOSTEL_SMS"]);
const emailProvider = () => providerOf(["ASSISTANT_EMAIL", "HOSTEL_EMAIL"]);
// Forwarding a call needs a telephony provider; it is reached through the same kind of
// HTTP hook as SMS, e.g. a small adapter in front of Twilio or a local SIP gateway.
const callProvider = () => providerOf(["ASSISTANT_CALL"]);

export const deliveryStatus = () => ({
  sms: Boolean(smsProvider()),
  email: isSmtpConfigured() || Boolean(emailProvider()),
  emailMode: isSmtpConfigured() ? "SMTP" : emailProvider() ? "HTTP" : "",
  call: Boolean(callProvider()),
  panel: true,
});

const postToProvider = async (provider: Provider, payload: Record<string, unknown>) => {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}) },
    body: JSON.stringify({ from: provider.from, ...payload }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Provider answered HTTP ${response.status}.`);
};

// ---- Reply links ----------------------------------------------------------------------

// The link token is derived from a secret and the escalation, so a retry can send the same
// link again; only its hash is stored, so the database alone cannot answer as the person.
const linkSecret = () => process.env.ASSISTANT_LINK_SECRET || config.jwtSecret;
const tokenFor = (escalationId: string, nonce: string) => createHmac("sha256", linkSecret()).update(`${escalationId}.${nonce}`).digest("base64url");
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const appUrl = () => (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
export const replyLink = (token: string) => `${appUrl()}/assistant/answer/${token}`;

// ---- Contacts -------------------------------------------------------------------------

const contactFromRow = (row: any) => ({
  id: row.id,
  name: row.name,
  title: row.title,
  phone: row.phone,
  email: row.email,
  userId: row.user_id,
  topics: row.topics || [],
  channels: row.channels || [],
  isDefault: row.is_default,
  isActive: row.is_active,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const contactInput = async (institutionId: string, body: any) => {
  const topics = (Array.isArray(body?.topics) ? body.topics : String(body?.topics || "").split(","))
    .map((item: unknown) => String(item).trim().toLowerCase()).filter(Boolean);
  if (topics.length > 40) fail(400, "Use at most 40 topics.");
  if (topics.some((item: string) => item.length > 60)) fail(400, "Each topic must be 60 characters or fewer.");
  const channels = (Array.isArray(body?.channels) ? body.channels : []).map((item: unknown) => oneOf(item, "Channel", CHANNELS));
  if (channels.length === 0) fail(400, "Pick at least one way to reach this person.");
  const phone = phoneOf(body?.phone) || "";
  const email = emailOf(body?.email) || "";
  const userId = text(body?.userId, "User", 64) || null;
  if (channels.includes("SMS") && !phone) fail(400, "A phone number is needed to send SMS.");
  if (channels.includes("CALL") && !phone) fail(400, "A phone number is needed to forward calls.");
  if (channels.includes("EMAIL") && !email) fail(400, "An email address is needed to send email.");
  if (channels.includes("PANEL") && !userId) fail(400, "Pick the person's user account to show questions in their panel.");
  if (userId) {
    const user = (await postgresService.query("SELECT 1 FROM erp_users WHERE institution_id = $1 AND id = $2", [institutionId, userId])).rows[0];
    if (!user) fail(400, "That user is not in this institution.");
  }
  return {
    name: text(body?.name, "Name", 150, true),
    title: text(body?.title, "Title", 150),
    phone,
    email,
    userId,
    topics: [...new Set(topics)] as string[],
    channels: [...new Set(channels)] as string[],
    isDefault: body?.isDefault === true,
    isActive: body?.isActive !== false,
  };
};

export const contactsService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query("SELECT * FROM ai_contacts WHERE institution_id = $1 ORDER BY is_default DESC, name", [institutionId]);
    return rows.map(contactFromRow);
  },

  async save(actor: Actor, id: string | null, body: any) {
    const data = await contactInput(actor.institutionId, body);
    const contactId = id || newId();
    await inTx(async (tx) => {
      if (id) {
        const current = (await tx.query("SELECT 1 FROM ai_contacts WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
        if (!current) fail(404, "Contact not found.");
      }
      // Only one fallback person per institution.
      if (data.isDefault) await tx.query("UPDATE ai_contacts SET is_default = FALSE WHERE institution_id = $1 AND id <> $2", [actor.institutionId, contactId]);
      await tx.query(
        `INSERT INTO ai_contacts (id, institution_id, name, title, phone, email, user_id, topics, channels, is_default, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET name = $3, title = $4, phone = $5, email = $6, user_id = $7, topics = $8, channels = $9,
           is_default = $10, is_active = $11, updated_at = NOW()`,
        [contactId, actor.institutionId, data.name, data.title, data.phone, data.email, data.userId, data.topics, data.channels, data.isDefault, data.isActive]
      );
      await audit(tx, actor, id ? "assistant.contact.update" : "assistant.contact.create", "ai_contact", contactId,
        `${id ? "Edited" : "Added"} responsible person ${data.name} (${data.channels.join(", ")}; topics: ${data.topics.join(", ") || "none"}).`);
    });
    const { rows } = await postgresService.query("SELECT * FROM ai_contacts WHERE id = $1", [contactId]);
    return contactFromRow(rows[0]);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const current = (await tx.query("SELECT name FROM ai_contacts WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Contact not found.");
      await tx.query("DELETE FROM ai_contacts WHERE id = $1", [id]);
      await audit(tx, actor, "assistant.contact.delete", "ai_contact", id, `Removed responsible person ${current.name}.`);
      return { id };
    });
  },
};

// The person whose topics best match the question, else the fallback person, else nobody.
export const responsibleFor = async (db: PoolClient, institutionId: string, question: string) => {
  const contacts = (await db.query("SELECT * FROM ai_contacts WHERE institution_id = $1 AND is_active = TRUE", [institutionId])).rows;
  const asked = new Set(termsOf(question));
  let best: any = null;
  let bestScore = 0;
  for (const contact of contacts) {
    let score = 0;
    for (const topic of contact.topics || []) {
      const words = termsOf(topic);
      if (words.length && words.every((word) => asked.has(word))) score += words.length;
    }
    if (score > bestScore) {
      best = contact;
      bestScore = score;
    }
  }
  return best || contacts.find((contact: any) => contact.is_default) || null;
};

// ---- Escalations ----------------------------------------------------------------------

const ESCALATION_SELECT = `SELECT e.*, q.question, q.asker_name, q.asker_role, q.language, q.created_at AS asked_at,
    c.name AS current_contact_name, c.title AS contact_title, c.phone AS contact_phone, c.email AS contact_email, c.channels AS contact_channels,
    c.user_id AS contact_user_id, r.id AS review_id, r.status AS review_status
  FROM ai_escalations e JOIN ai_questions q ON q.id = e.question_id
  LEFT JOIN ai_contacts c ON c.id = e.contact_id LEFT JOIN ai_reviews r ON r.escalation_id = e.id`;

const escalationFromRow = (row: any) => ({
  id: row.id,
  questionId: row.question_id,
  question: row.question,
  askerName: row.asker_name,
  askerRole: row.asker_role,
  askedAt: toIso(row.asked_at),
  contactId: row.contact_id,
  contactName: row.current_contact_name || row.contact_name,
  contactTitle: row.contact_title || "",
  status: row.status,
  smsStatus: row.sms_status,
  emailStatus: row.email_status,
  callStatus: row.call_status,
  attempts: Number(row.attempts),
  nextAttemptAt: toIso(row.next_attempt_at),
  lastError: row.last_error,
  answer: row.answer,
  answeredBy: row.answered_by,
  answeredVia: row.answered_via,
  answeredAt: toIso(row.answered_at),
  closedNote: row.closed_note,
  reviewId: row.review_id,
  reviewStatus: row.review_status,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

// Creates the escalation in the asker's transaction. Delivery happens after commit.
export const createEscalation = async (tx: PoolClient, institutionId: string, questionId: string, question: string) => {
  const contact = await responsibleFor(tx, institutionId, question);
  const id = newId();
  const nonce = randomBytes(16).toString("hex");
  const token = tokenFor(id, nonce);
  await tx.query(
    `INSERT INTO ai_escalations (id, institution_id, question_id, contact_id, contact_name, status, reply_nonce, reply_token_hash, token_expires_at,
       last_error, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 || ' days')::interval, $10, $11)`,
    [id, institutionId, questionId, contact?.id || null, contact?.name || "", contact ? "SENDING" : "WAITING_ADMIN", nonce, hashOf(token), String(LINK_DAYS),
      contact ? "" : "No responsible person is set up for this topic. An admin needs to answer it.", contact ? new Date() : null]
  );
  return { id, hasContact: Boolean(contact) };
};

const institutionName = async (institutionId: string) =>
  (await postgresService.query("SELECT name FROM erp_tenants WHERE id = $1", [institutionId])).rows[0]?.name || "Your institution";

// Sends the question to the responsible person on every channel they use. A channel that
// is not configured is recorded as such; a failure is retried with a growing wait.
export const deliverEscalation = async (escalationId: string) => {
  const row = (await postgresService.query(
    `SELECT e.*, q.question, q.asker_name, q.created_at AS asked_at, c.name AS person, c.phone, c.email, c.user_id, c.channels
     FROM ai_escalations e JOIN ai_questions q ON q.id = e.question_id LEFT JOIN ai_contacts c ON c.id = e.contact_id
     WHERE e.id = $1`, [escalationId])).rows[0];
  if (!row || !["SENDING", "FAILED"].includes(row.status)) return;
  if (!row.contact_id) {
    await postgresService.query("UPDATE ai_escalations SET status = 'WAITING_ADMIN', next_attempt_at = NULL, updated_at = NOW() WHERE id = $1", [escalationId]);
    return;
  }
  const brand = await institutionName(row.institution_id);
  const link = replyLink(tokenFor(row.id, row.reply_nonce));
  const channels: string[] = row.channels || [];
  const statuses: Record<string, string> = { SMS: row.sms_status, EMAIL: row.email_status, CALL: row.call_status };
  const errors: string[] = [];
  const message = `${brand}: a question needs your answer. "${row.question.slice(0, 200)}" Answer here: ${link}`;

  const attempt = async (channel: "SMS" | "EMAIL" | "CALL", send: () => Promise<void>, configured: boolean, address: string) => {
    if (!channels.includes(channel)) return void (statuses[channel] = "NOT_USED");
    if (statuses[channel] === "SENT") return; // already delivered on an earlier attempt
    if (!address) return void (statuses[channel] = "NO_ADDRESS");
    if (!configured) return void (statuses[channel] = "NOT_CONFIGURED");
    try {
      await send();
      statuses[channel] = "SENT";
    } catch (err: any) {
      statuses[channel] = "FAILED";
      errors.push(`${channel}: ${err.message}`);
    }
  };

  await attempt("SMS", () => postToProvider(smsProvider() as Provider, { channel: "SMS", to: row.phone, text: message, reference: row.id }), Boolean(smsProvider()), row.phone);
  await attempt("EMAIL", async () => {
    const subject = `Question for you from ${brand}'s assistant`;
    const textBody = `${row.person},\n\nSomeone asked the ${brand} assistant a question it could not answer:\n\n"${row.question}"\n\nPlease answer it here (the link works for ${LINK_DAYS} days): ${link}\n\nYour answer is reviewed by an admin before the assistant uses it.`;
    const html = renderEmailHtml({ brand, title: "A question needs your answer", body: `${row.person}, someone asked the assistant a question it could not answer. Your answer is reviewed by an admin before the assistant uses it.`,
      rows: [["Question", row.question.slice(0, 300)], ["Asked by", row.asker_name || "A user"]], actionUrl: link, actionLabel: "Answer the question" });
    if (isSmtpConfigured()) await sendSmtpMail({ brand, to: row.email, subject, text: textBody, html });
    else await postToProvider(emailProvider() as Provider, { channel: "EMAIL", to: row.email, subject, text: textBody, html, reference: row.id });
  }, isSmtpConfigured() || Boolean(emailProvider()), row.email);
  await attempt("CALL", () => postToProvider(callProvider() as Provider, { channel: "CALL", to: row.phone, text: `Question from ${brand}: ${row.question}`, reference: row.id }), Boolean(callProvider()), row.phone);

  const reached = Object.values(statuses).includes("SENT") || (channels.includes("PANEL") && Boolean(row.user_id));
  const failed = Object.values(statuses).includes("FAILED");
  const attempts = Number(row.attempts) + 1;
  let status = "SENT";
  let next: Date | null = null;
  let lastError = errors.join(" | ");
  if (failed && attempts < MAX_ATTEMPTS) {
    status = reached ? "SENT" : "FAILED";
    next = new Date(Date.now() + 2 ** attempts * 60_000);
  } else if (!reached) {
    status = "WAITING_ADMIN";
    lastError = lastError || "None of this person's channels is set up (check SMS, email and call settings). An admin needs to answer it.";
  }
  await postgresService.query(
    `UPDATE ai_escalations SET status = CASE WHEN status IN ('ANSWERED', 'CLOSED') THEN status ELSE $2 END, sms_status = $3, email_status = $4, call_status = $5,
       attempts = $6, next_attempt_at = $7, last_error = $8, updated_at = NOW() WHERE id = $1`,
    [escalationId, status, statuses.SMS, statuses.EMAIL, statuses.CALL, attempts, next, lastError.slice(0, 1000)]
  );
};

// Retries due deliveries. Run by the scheduler.
export const retryDueEscalations = async () => {
  const { rows } = await postgresService.query(
    "SELECT id FROM ai_escalations WHERE status IN ('SENDING', 'FAILED') AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 20"
  );
  for (const row of rows) await deliverEscalation(row.id).catch((err) => console.error("[Assistant] Delivery failed:", err.message));
  return rows.length;
};

// The answer of the responsible person becomes a review for an admin. Never knowledge yet.
const recordAnswer = async (tx: PoolClient, escalation: any, answer: string, answeredBy: string, via: "LINK" | "PANEL") => {
  if (["ANSWERED", "CLOSED"].includes(escalation.status)) fail(409, "This question has already been answered or closed.");
  await tx.query(
    `UPDATE ai_escalations SET status = 'ANSWERED', answer = $2, answered_by = $3, answered_via = $4, answered_at = NOW(), next_attempt_at = NULL,
       reply_token_hash = NULL, updated_at = NOW() WHERE id = $1`,
    [escalation.id, answer, answeredBy, via]
  );
  const reviewId = newId();
  await tx.query(
    `INSERT INTO ai_reviews (id, institution_id, question_id, escalation_id, question, received_answer, answered_by, final_answer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $6)`,
    [reviewId, escalation.institution_id, escalation.question_id, escalation.id, escalation.question, answer, answeredBy]
  );
  return reviewId;
};

// After the answer is saved, the AI Backend may suggest a cleaner wording for the admin.
const addDraft = async (reviewId: string, question: string, answer: string) => {
  try {
    const status = await assistantEngine.status();
    if (!status.llm) return;
    const draft = await assistantEngine.draft({ question, received_answer: answer, language: languageOf(question) });
    if (draft) await postgresService.query("UPDATE ai_reviews SET ai_draft = $2 WHERE id = $1 AND status = 'PENDING'", [reviewId, draft.slice(0, 8000)]);
  } catch (err: any) {
    console.warn("[Assistant] Draft suggestion failed:", err.message);
  }
};

const answerText = (value: unknown) => {
  const answer = text(value, "Answer", 5000, true);
  if (answer.length < 2) fail(400, "Write an answer.");
  return answer;
};

export const escalationsService = {
  async list(institutionId: string, filters: { status?: string } = {}) {
    const status = filters.status && filters.status !== "ALL" ? filters.status : null;
    const { rows } = await postgresService.query(
      `${ESCALATION_SELECT} WHERE e.institution_id = $1 AND ($2::text IS NULL OR e.status = $2) ORDER BY e.created_at DESC LIMIT 300`,
      [institutionId, status]
    );
    return rows.map(escalationFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${ESCALATION_SELECT} WHERE e.institution_id = $1 AND e.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Forwarded question not found.");
    return escalationFromRow(rows[0]);
  },

  // Questions forwarded to the signed-in user, for answering inside the panel.
  async assignedTo(institutionId: string, userId: string) {
    const { rows } = await postgresService.query(
      `${ESCALATION_SELECT} WHERE e.institution_id = $1 AND c.user_id = $2 AND e.status IN ('SENDING', 'SENT', 'FAILED', 'WAITING_ADMIN')
       ORDER BY e.created_at DESC LIMIT 100`,
      [institutionId, userId]
    );
    return rows.map(escalationFromRow);
  },

  // An admin, or the person it was forwarded to, records the answer (for example one given by phone).
  async answerInPanel(actor: Actor, id: string, body: any, canManage: boolean) {
    const answer = answerText(body?.answer);
    let reviewId = "";
    let question = "";
    await inTx(async (tx) => {
      const escalation = (await tx.query(
        `SELECT e.*, q.question, c.user_id AS contact_user_id FROM ai_escalations e JOIN ai_questions q ON q.id = e.question_id
         LEFT JOIN ai_contacts c ON c.id = e.contact_id WHERE e.institution_id = $1 AND e.id = $2 FOR UPDATE OF e`,
        [actor.institutionId, id]
      )).rows[0];
      if (!escalation) fail(404, "Forwarded question not found.");
      if (!canManage && escalation.contact_user_id !== actor.userId) fail(403, "This question was not forwarded to you.");
      const answeredBy = text(body?.answeredBy, "Answered by", 150) || actor.email;
      question = escalation.question;
      reviewId = await recordAnswer(tx, escalation, answer, answeredBy, "PANEL");
      await audit(tx, actor, "assistant.escalation.answer", "ai_escalation", id, `Recorded an answer from ${answeredBy} for review.`);
    });
    await addDraft(reviewId, question, answer);
    return this.get(actor.institutionId, id);
  },

  async resend(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const escalation = (await tx.query("SELECT * FROM ai_escalations WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!escalation) fail(404, "Forwarded question not found.");
      if (["ANSWERED", "CLOSED"].includes(escalation.status)) fail(409, "This question has already been answered or closed.");
      let contactId = escalation.contact_id;
      let contactName = escalation.contact_name;
      if (body?.contactId) {
        const contact = (await tx.query("SELECT id, name FROM ai_contacts WHERE institution_id = $1 AND id = $2 AND is_active = TRUE", [actor.institutionId, body.contactId])).rows[0];
        if (!contact) fail(400, "Pick an active responsible person.");
        contactId = contact.id;
        contactName = contact.name;
      }
      if (!contactId) fail(400, "Pick a responsible person to send this question to.");
      const nonce = randomBytes(16).toString("hex");
      await tx.query(
        `UPDATE ai_escalations SET contact_id = $2, contact_name = $3, status = 'SENDING', sms_status = 'NOT_USED', email_status = 'NOT_USED',
           call_status = 'NOT_USED', attempts = 0, next_attempt_at = NOW(), last_error = '', reply_token_hash = $4,
           token_expires_at = NOW() + ($5 || ' days')::interval, reply_nonce = $6, updated_at = NOW() WHERE id = $1`,
        [id, contactId, contactName, hashOf(tokenFor(id, nonce)), String(LINK_DAYS), nonce]
      );
      await audit(tx, actor, "assistant.escalation.resend", "ai_escalation", id, `Sent the question to ${contactName} again.`);
    });
    await deliverEscalation(id);
    return this.get(actor.institutionId, id);
  },

  async close(actor: Actor, id: string, body: any) {
    const note = text(body?.note, "Reason", 500, true);
    await inTx(async (tx) => {
      const escalation = (await tx.query("SELECT status FROM ai_escalations WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!escalation) fail(404, "Forwarded question not found.");
      if (["ANSWERED", "CLOSED"].includes(escalation.status)) fail(409, "This question has already been answered or closed.");
      await tx.query(
        "UPDATE ai_escalations SET status = 'CLOSED', closed_note = $2, next_attempt_at = NULL, reply_token_hash = NULL, updated_at = NOW() WHERE id = $1",
        [id, note]
      );
      await audit(tx, actor, "assistant.escalation.close", "ai_escalation", id, `Closed without an answer. ${note}`);
    });
    return this.get(actor.institutionId, id);
  },
};

// ---- The public reply page ---------------------------------------------------------

const byToken = async (db: PoolClient | typeof postgresService, token: string, lock = false) => {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(404, "This link is not valid.");
  const row = (await db.query(
    `SELECT e.*, q.question, q.created_at AS asked_at, t.name AS institution FROM ai_escalations e JOIN ai_questions q ON q.id = e.question_id
     JOIN erp_tenants t ON t.id = e.institution_id WHERE e.reply_token_hash = $1 ${lock ? "FOR UPDATE OF e" : ""}`,
    [hashOf(token)]
  )).rows[0];
  if (!row) fail(404, "This link is not valid or the question was already answered.");
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now()) fail(410, "This link has expired. Ask the institution to send the question again.");
  return row;
};

export const publicReplyService = {
  async view(token: string) {
    const row = await byToken(postgresService, token);
    return { institution: row.institution, question: row.question, askedAt: toIso(row.asked_at), contactName: row.contact_name, status: row.status };
  },

  async answer(token: string, body: any) {
    const answer = answerText(body?.answer);
    let reviewId = "";
    let question = "";
    await inTx(async (tx) => {
      const row = await byToken(tx, token, true);
      question = row.question;
      const answeredBy = text(body?.name, "Your name", 150) || row.contact_name || "Responsible person";
      reviewId = await recordAnswer(tx, row, answer, answeredBy, "LINK");
      await audit(tx, { institutionId: row.institution_id, userId: "", email: answeredBy }, "assistant.escalation.answer", "ai_escalation", row.id,
        `${answeredBy} answered a forwarded question through the private link. Waiting for admin review.`);
    });
    await addDraft(reviewId, question, answer);
    return { received: true };
  },
};
