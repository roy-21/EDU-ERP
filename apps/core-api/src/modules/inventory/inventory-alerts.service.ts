import { postgresService } from "../../database/postgres";
import { newId } from "../hostel/hostel.common";
import { isSmtpConfigured, renderEmailHtml, sendSmtpMail } from "../hostel/hostel-email.service";
import { Actor, audit } from "../identity/identity.service";
import { fail, oneOf, todayBd, whole } from "../academics/academics.common";
import { FEATURES, PROFILES, insightsService, settingsOf } from "./inventory.service";

// The daily inventory alert email: one digest per institution per day, to the addresses set here.
// The in-app alert list is the same list; email only carries it to people who are not looking.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 40;
const DIGEST_HOUR_BD = 8; // Sent from 08:00 Bangladesh time, once a day.
const JOB_LOCK = 7420201;
const JOB_INTERVAL_MS = 30 * 60_000;

const recipientsOf = (value: unknown): string[] => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(400, "Alert emails must be text.");
  const list = String(value || "").split(/[,;\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const bad = list.find((item) => !EMAIL.test(item));
  if (bad) fail(400, `"${bad}" is not an email address.`);
  if (list.length > 20) fail(400, "Send alerts to at most 20 addresses.");
  return [...new Set(list)];
};

export const alertSettingsService = {
  async get(institutionId: string) {
    return { ...(await settingsOf(institutionId)), smtpConfigured: isSmtpConfigured() };
  },

  async save(actor: Actor, body: any) {
    const current = await settingsOf(actor.institutionId);
    const emailAlerts = body?.emailAlerts !== undefined ? body.emailAlerts === true : current.emailAlerts;
    const recipients = body?.alertEmails !== undefined ? recipientsOf(body.alertEmails) : recipientsOf(current.alertEmails);
    const expiryWarningDays = body?.expiryWarningDays !== undefined && body?.expiryWarningDays !== null && body?.expiryWarningDays !== ""
      ? whole(body.expiryWarningDays, "Expiry warning days", 1, 365) : current.expiryWarningDays;
    if (emailAlerts && recipients.length === 0) fail(400, "Add at least one address to send alerts to.");
    await postgresService.query(
      `INSERT INTO inv_settings (institution_id, email_alerts, alert_emails, expiry_warning_days) VALUES ($1, $2, $3, $4)
       ON CONFLICT (institution_id) DO UPDATE SET email_alerts = $2, alert_emails = $3, expiry_warning_days = $4`,
      [actor.institutionId, emailAlerts, recipients.join(", "), expiryWarningDays]
    );
    await audit(postgresService, actor, "inventory.settings", "inventory", actor.institutionId,
      `Alert email ${emailAlerts ? `on to ${recipients.join(", ")}` : "off"}; expiry warning ${expiryWarningDays} days.`);
    return this.get(actor.institutionId);
  },

  // The kind of organisation and the parts of inventory it uses. Switching a part off only
  // hides it from the menus and dashboard; nothing is deleted, so it can be switched on again.
  async saveSetup(actor: Actor, body: any) {
    const profile = oneOf(body?.profile, "Organisation type", Object.keys(PROFILES));
    const raw = Array.isArray(body?.features) ? body.features : PROFILES[profile];
    const unknown = raw.find((key: unknown) => !(FEATURES as readonly unknown[]).includes(key));
    if (unknown !== undefined) fail(400, `Unknown inventory part "${unknown}".`);
    const features = FEATURES.filter((key) => raw.includes(key));
    await postgresService.query(
      `INSERT INTO inv_settings (institution_id, profile, features) VALUES ($1, $2, $3)
       ON CONFLICT (institution_id) DO UPDATE SET profile = $2, features = $3`,
      [actor.institutionId, profile, features]);
    await audit(postgresService, actor, "inventory.setup", "inventory", actor.institutionId, `Inventory set up for ${profile.toLowerCase()}: ${features.join(", ") || "core only"}.`);
    return this.get(actor.institutionId);
  },

  async log(institutionId: string) {
    const { rows } = await postgresService.query(
      "SELECT recipient, status, error, sent_by, created_at FROM erp_email_log WHERE institution_id = $1 AND kind = 'INVENTORY_ALERTS' ORDER BY created_at DESC LIMIT 20",
      [institutionId]);
    return rows.map((row: any) => ({ recipient: row.recipient, status: row.status, error: row.error, sentBy: row.sent_by, at: new Date(row.created_at).toISOString() }));
  },
};

// Builds and sends the digest. Returns what happened; a failure is logged, not thrown.
export const sendAlertDigest = async (institutionId: string, sentBy: string, options: { force?: boolean } = {}) => {
  const settings = await settingsOf(institutionId);
  const recipients = recipientsOf(settings.alertEmails);
  if (recipients.length === 0) return { sent: false, reason: "No alert email addresses are set.", alerts: 0 };
  const alerts = await insightsService.alerts(institutionId);
  if (alerts.length === 0 && !options.force) return { sent: false, reason: "Nothing needs attention.", alerts: 0 };

  const tenant = (await postgresService.query("SELECT name FROM erp_tenants WHERE id = $1", [institutionId])).rows[0];
  const brand = tenant?.name || "Inventory";
  const counts = {
    danger: alerts.filter((alert) => alert.level === "danger").length,
    warning: alerts.filter((alert) => alert.level === "warning").length,
  };
  const subject = alerts.length === 0 ? `Inventory: nothing needs attention (${todayBd()})`
    : `Inventory: ${alerts.length} alert${alerts.length === 1 ? "" : "s"}${counts.danger ? `, ${counts.danger} urgent` : ""} (${todayBd()})`;
  const shown = alerts.slice(0, MAX_ROWS);
  const more = alerts.length - shown.length;
  const body = alerts.length === 0 ? "All stock levels, expiry dates and orders are fine today."
    : `${counts.danger} urgent, ${counts.warning} warnings and ${alerts.length - counts.danger - counts.warning} notes.${more > 0 ? ` The first ${MAX_ROWS} are below; open Inventory for the rest.` : ""}`;
  const appUrl = (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
  const html = renderEmailHtml({
    brand,
    title: "Inventory needs attention",
    body: `${body}${appUrl ? `\n\nOpen: ${appUrl}/admin/inventory` : ""}`,
    rows: shown.map((alert) => [`${alert.level === "danger" ? "URGENT · " : alert.level === "warning" ? "Warning · " : ""}${alert.title}`, alert.detail]),
  });
  const text = [body, "", ...shown.map((alert) => `- ${alert.title}: ${alert.detail}`), ...(appUrl ? ["", `${appUrl}/admin/inventory`] : [])].join("\n");

  let delivered = false;
  let reason = "";
  if (!isSmtpConfigured()) reason = "Email is not configured on the server (EMAIL_USER and EMAIL_PASS).";
  else {
    try {
      await sendSmtpMail({ brand, to: recipients.join(", "), subject, text, html });
      delivered = true;
    } catch (err: any) {
      reason = err.message || "Sending failed.";
    }
  }
  await postgresService.query(
    `INSERT INTO erp_email_log (id, institution_id, user_id, kind, recipient, status, error, sent_by) VALUES ($1, $2, NULL, 'INVENTORY_ALERTS', $3, $4, $5, $6)`,
    [newId(), institutionId, recipients.join(", ").slice(0, 255), delivered ? "SENT" : "FAILED", reason.slice(0, 500), sentBy]
  );
  if (delivered) await postgresService.query("UPDATE inv_settings SET last_alert_on = $2 WHERE institution_id = $1", [institutionId, todayBd()]);
  return { sent: delivered, reason, alerts: alerts.length, recipients };
};

// Once a day after 08:00 Dhaka time, for every institution that switched alert emails on.
export const runDailyDigests = async (now = Date.now()) => {
  const hour = Number(new Date(now + 6 * 3_600_000).toISOString().slice(11, 13));
  // Without a mail server there is nothing to try; the settings screen says so instead of filling the log.
  if (hour < DIGEST_HOUR_BD || !isSmtpConfigured()) return { due: 0, sent: 0, errors: [] as string[] };
  const { rows } = await postgresService.query(
    "SELECT institution_id FROM inv_settings WHERE email_alerts AND (last_alert_on IS NULL OR last_alert_on < $1::date)", [todayBd()]);
  let sent = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      const result = await sendAlertDigest(row.institution_id, "scheduler");
      if (result.sent) sent += 1;
      // Nothing to report still counts as done for today, so the job does not retry every half hour.
      else if (result.reason === "Nothing needs attention.") await postgresService.query("UPDATE inv_settings SET last_alert_on = $2 WHERE institution_id = $1", [row.institution_id, todayBd()]);
      else errors.push(`${row.institution_id}: ${result.reason}`);
    } catch (err: any) {
      errors.push(`${row.institution_id}: ${err.message}`);
    }
  }
  return { due: rows.length, sent, errors };
};

// The advisory lock keeps two servers from sending the same digest twice.
export const startInventoryScheduler = () => {
  const tick = () =>
    postgresService.transaction(async (tx) => {
      const lock = await tx.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [JOB_LOCK]);
      if (!lock.rows[0].acquired) return;
      const result = await runDailyDigests();
      if (result.errors.length) console.warn("[Inventory Alerts]", result.errors.join("; "));
    }).catch((err) => console.error("[Inventory Alerts] failed:", err.message));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, JOB_INTERVAL_MS).unref();
  console.log("[Inventory Alerts] Daily alert emails are checked every 30 minutes.");
};
