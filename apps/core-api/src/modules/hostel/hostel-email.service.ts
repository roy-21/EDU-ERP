import nodemailer, { Transporter } from "nodemailer";

const SEND_TIMEOUT_MS = 20_000;

const smtpSettings = () => {
  const user = process.env.EMAIL_USER || "";
  const pass = process.env.EMAIL_PASS || "";
  if (!user || !pass) return null;

  const port = Number(process.env.EMAIL_SMTP_PORT) || 465;
  return {
    host: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
    port,
    secure: process.env.EMAIL_SMTP_SECURE ? process.env.EMAIL_SMTP_SECURE === "true" : port === 465,
    user,
    pass,
  };
};

export const isSmtpConfigured = (): boolean => smtpSettings() !== null;
export const adminEmail = (): string => process.env.TO_EMAIL || "";

let cached: { key: string; transporter: Transporter } | null = null;

const transporter = (): Transporter => {
  const settings = smtpSettings();
  if (!settings) throw new Error("Email is not configured.");

  const key = JSON.stringify(settings);
  if (cached?.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: { user: settings.user, pass: settings.pass },
        connectionTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      }),
    };
  }
  return cached.transporter;
};

export type Attachment = { filename: string; content: Buffer; contentType: string };

// Accepted means the mail server took it. It does not prove it reached the inbox.
export const sendSmtpMail = async (message: {
  brand: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Attachment[];
}): Promise<string> => {
  const settings = smtpSettings();
  if (!settings) throw new Error("Email is not configured.");

  const info = await transporter().sendMail({
    from: { name: message.brand, address: settings.user },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
  });
  if ((info.rejected?.length ?? 0) > 0) {
    const error: any = new Error("The mail server rejected this address.");
    error.responseCode = 550;
    throw error;
  }
  return info.messageId;
};

// A bad address will not fix itself, but a login or network problem might.
export const isPermanentMailFailure = (err: any): boolean =>
  err?.code === "EENVELOPE" ||
  (Number(err?.responseCode) >= 550 && Number(err?.responseCode) < 560);

export const validateEmailConfig = async (): Promise<void> => {
  if (!isSmtpConfigured()) {
    console.warn("[Hostel Email] EMAIL_USER and EMAIL_PASS are not set. Student emails will be logged as Skipped.");
    return;
  }
  try {
    await transporter().verify();
    console.log("[Hostel Email] SMTP login succeeded.");
  } catch (err: any) {
    console.error(`[Hostel Email] SMTP check failed: ${err.message}`);
  }
  if (!adminEmail()) console.warn("[Hostel Email] TO_EMAIL is not set. Admin alerts will not be sent.");
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Tables and inline styles, because many mail apps ignore style sheets.
export const renderEmailHtml = (content: {
  brand: string;
  title: string;
  body: string;
  rows: [string, string][];
  actionUrl?: string;
  actionLabel?: string;
}): string => {
  const rows = content.rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:8px 0;color:#64748b;font-size:14px;border-bottom:1px solid #f1f5f9;">${escapeHtml(label)}</td>
        <td align="right" style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${escapeHtml(value)}</td>
      </tr>`
    )
    .join("");
  const action = content.actionUrl
    ? `<p style="margin:24px 0;text-align:center;"><a href="${escapeHtml(content.actionUrl)}" style="display:inline-block;background:#e2136e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:8px;">${escapeHtml(content.actionLabel || "Pay Now")}</a></p>
       <p style="margin:0;color:#64748b;font-size:12px;">This link is only for you. Do not forward it.</p>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
        <tr><td style="background:#0f172a;color:#ffffff;padding:18px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700;">${escapeHtml(content.brand)}</td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 12px;color:#0f172a;font-size:20px;">${escapeHtml(content.title)}</h1>
          <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.5;white-space:pre-line;">${escapeHtml(content.body)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          ${action}
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
};
