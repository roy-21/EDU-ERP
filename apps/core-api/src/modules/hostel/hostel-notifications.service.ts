import { postgresService } from "../../database/postgres";
import {
  HostelContext,
  HostelError,
  daysBetween,
  monthLabel,
  monthOf,
  newId,
  taka,
  toIso,
  toMoney,
  writeAudit,
} from "./hostel.common";
import {
  Attachment,
  adminEmail,
  isPermanentMailFailure,
  isSmtpConfigured,
  renderEmailHtml,
  sendSmtpMail,
} from "./hostel-email.service";
import { issuePaymentLink } from "./hostel-payment-links";
import { renderReceiptPdf } from "./hostel-receipt.service";
import { getLocalNow, getRentSettings } from "./hostel-rent.repository";

export const SCENARIOS = [
  "INVOICE",
  "UPCOMING",
  "FINAL_REMINDER",
  "DUE_TODAY",
  "OVERDUE",
  "OUTSTANDING",
  "PARTIAL",
  "PARTIAL_PAYMENT",
  "CONFIRMATION",
  "RECEIPT",
  "PAYMENT_FAILED",
  "ALLOCATION",
  "CHARGE_INVOICE",
  "MEAL_DUE",
  "VISITOR_TICKET",
] as const;
type Scenario = (typeof SCENARIOS)[number];

// These ask for money, so they are dropped if the invoice is paid by send time.
const REMINDERS = new Set(["INVOICE", "UPCOMING", "FINAL_REMINDER", "DUE_TODAY", "OVERDUE", "OUTSTANDING", "PARTIAL", "MEAL_DUE"]);
const WITH_RECEIPT = new Set(["CONFIRMATION", "PARTIAL_PAYMENT", "RECEIPT"]);
const WITH_PAY_LINK = new Set([...REMINDERS, "PARTIAL_PAYMENT", "PAYMENT_FAILED", "CHARGE_INVOICE"]);

const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = 15;
const CLAIM_LEASE_MINUTES = 10;
const PROVIDER_TIMEOUT_MS = 15_000;

export const DEFAULT_TEMPLATES: Record<Scenario, { subject: string; body: string }> = {
  INVOICE: {
    subject: "Hostel rent invoice for {{billingMonth}}",
    body: "Dear {{studentName}}, your hostel rent invoice for {{billingMonth}} is ready. {{amountDue}} is due on {{dueDate}}. {{paymentInstructions}}",
  },
  UPCOMING: {
    subject: "Hostel rent due on {{dueDate}}",
    body: "Dear {{studentName}}, your hostel rent for {{billingMonth}} of {{amountDue}} is due on {{dueDate}}. {{paymentInstructions}}",
  },
  FINAL_REMINDER: {
    subject: "Final reminder: hostel rent is due tomorrow",
    body: "Dear {{studentName}}, your hostel rent for {{billingMonth}} of {{amountDue}} is due tomorrow, {{dueDate}}. {{paymentInstructions}}",
  },
  DUE_TODAY: {
    subject: "Hostel rent is due today",
    body: "Dear {{studentName}}, your hostel rent for {{billingMonth}} of {{amountDue}} is due today, {{dueDate}}. {{paymentInstructions}}",
  },
  OVERDUE: {
    subject: "Hostel rent is overdue",
    body: "Dear {{studentName}}, your hostel rent for {{billingMonth}} was due on {{dueDate}} and {{amountDue}} is unpaid. Your total balance is {{totalOutstanding}}. {{paymentInstructions}}",
  },
  OUTSTANDING: {
    subject: "Hostel rent balance reminder",
    body: "Dear {{studentName}}, your outstanding hostel rent balance is {{totalOutstanding}}. The oldest unpaid month is {{billingMonth}}, due on {{dueDate}}. {{paymentInstructions}}",
  },
  PARTIAL: {
    subject: "Balance remaining on your hostel rent",
    body: "Dear {{studentName}}, {{amountDue}} of your hostel rent for {{billingMonth}} remains unpaid and is due on {{dueDate}}. {{paymentInstructions}}",
  },
  PARTIAL_PAYMENT: {
    subject: "Part payment received for your hostel rent",
    body: "Dear {{studentName}}, we received {{amountPaid}} for your hostel rent for {{billingMonth}}. Receipt: {{receiptNumber}}. {{amountDue}} remains on this invoice and is due on {{dueDate}}.",
  },
  CONFIRMATION: {
    subject: "Hostel rent payment received",
    body: "Dear {{studentName}}, we received {{amountPaid}} for your hostel rent for {{billingMonth}}. Receipt: {{receiptNumber}}. Remaining on this invoice: {{amountDue}}.",
  },
  RECEIPT: {
    subject: "Your hostel rent receipt {{receiptNumber}}",
    body: "Dear {{studentName}}, your receipt {{receiptNumber}} for {{amountPaid}} is attached.",
  },
  ALLOCATION: {
    subject: "Your hostel seat is confirmed",
    body: "Dear {{studentName}}, you have been given a hostel seat. Your details are below. Please keep this email for your records.",
  },
  CHARGE_INVOICE: {
    subject: "Invoice {{invoiceNumber}}: {{invoiceTitle}}",
    body: "Dear {{studentName}}, here is your invoice {{invoiceNumber}} for {{invoiceTitle}}. {{amountDue}} is due on {{dueDate}}.",
  },
  MEAL_DUE: {
    subject: "Your unpaid hostel meal bills",
    body: "Dear {{studentName}}, your unpaid meal bills total {{mealOutstanding}}. Please pay by {{dueDate}}.",
  },
  VISITOR_TICKET: {
    subject: "Hostel visit ticket {{ticketNumber}}",
    body: "Your hostel visit is registered. Show ticket {{ticketNumber}} at the gate on {{visitDate}}.",
  },
  PAYMENT_FAILED: {
    subject: "Your hostel rent payment did not go through",
    body: "Dear {{studentName}}, your online payment for {{billingMonth}} did not go through, and no rent was recorded. {{amountDue}} is still due on {{dueDate}}. Please try again.",
  },
};

const render = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "").trim();

const loadTemplates = async (institutionId: string) => {
  const { rows } = await postgresService.query(
    "SELECT scenario, subject, body FROM hostel_notification_templates WHERE institution_id = $1",
    [institutionId]
  );
  const templates = { ...DEFAULT_TEMPLATES };
  rows.forEach((row: any) => {
    templates[row.scenario as Scenario] = { subject: row.subject, body: row.body };
  });
  return templates;
};

const INVOICE_WITH_CONTACT = `
  SELECT i.*, a.student_phone, a.student_email,
    (SELECT COALESCE(SUM(b.outstanding_amount), 0) FROM hostel_invoice_balances b
      WHERE b.allocation_id = i.allocation_id) AS total_outstanding,
    (SELECT COALESCE(SUM(b.outstanding_amount), 0) FROM hostel_invoice_balances b
      WHERE b.allocation_id = i.allocation_id AND b.billing_month < i.billing_month) AS earlier_outstanding
  FROM hostel_invoice_balances i
  JOIN hostel_allocations a ON a.id = i.allocation_id`;

const recipientFor = (channel: string, invoice: any): string => {
  if (channel === "EMAIL") return invoice.student_email;
  if (channel === "SMS") return invoice.student_phone;
  return invoice.student_id;
};

const templateValues = (invoice: any, settings: any, payment?: any): Record<string, string> => ({
  studentName: invoice.student_name,
  studentId: invoice.student_id,
  billingMonth: monthLabel(invoice.billing_month),
  amountDue: taka(toMoney(invoice.outstanding_amount)),
  totalOutstanding: taka(toMoney(invoice.total_outstanding)),
  dueDate: invoice.due_date,
  paymentInstructions: settings.paymentInstructions,
  amountPaid: payment ? taka(toMoney(payment.amount)) : "",
  receiptNumber: payment?.receipt_number || "",
  invoiceNumber: invoice.invoice_number,
  invoiceTitle: invoice.title || `hostel rent for ${monthLabel(invoice.billing_month)}`,
  mealOutstanding: invoice.meal_outstanding !== undefined ? taka(toMoney(invoice.meal_outstanding)) : "",
});

// Earlier balances are read live, so a month paid off since the invoice was issued is not shown as owed.
const emailRows = (invoice: any, payment?: any): [string, string][] => {
  const rent = toMoney(invoice.amount_due);
  const earlier = toMoney(invoice.earlier_outstanding);
  const remaining = earlier + toMoney(invoice.outstanding_amount);
  const isRent = (invoice.category || "RENT") === "RENT";
  return [
    ["Student Name", invoice.student_name],
    ["Student ID", invoice.student_id],
    ["Building", `${invoice.hostel_name}, ${invoice.building_name}`],
    ["Room Number", invoice.room_number],
    ["Seat Number", String(invoice.seat_number ?? "-")],
    ["Invoice Number", invoice.invoice_number],
    ["Billing Month", monthLabel(invoice.billing_month)],
    ...(isRent ? [] : ([["Charge", invoice.title]] as [string, string][])),
    [isRent ? "Monthly Rent" : "Amount", taka(rent)],
    ["Previous Outstanding Balance", taka(earlier)],
    ["Total Payable Amount", taka(earlier + rent)],
    ["Amount Already Paid", taka(toMoney(invoice.paid_amount))],
    ["Remaining Balance", taka(remaining)],
    ["Payment Due Date", invoice.due_date],
    ...(payment
      ? ([
          ["Payment Method", payment.method],
          ["Transaction ID", payment.transaction_reference || "-"],
          ["Receipt Number", payment.receipt_number],
        ] as [string, string][])
      : []),
  ];
};

// Adds one row per channel. The dedupe key means a repeat does nothing.
const queue = async (
  institutionId: string,
  invoice: any,
  scenario: Scenario,
  dedupeBase: string,
  context: {
    settings: Awaited<ReturnType<typeof getRentSettings>>;
    templates: Awaited<ReturnType<typeof loadTemplates>>;
    triggeredBy: string;
    payment?: any;
    channels?: string[];
  }
): Promise<string[]> => {
  const values = templateValues(invoice, context.settings, context.payment);
  const template = context.templates[scenario];
  const queued: string[] = [];

  for (const channel of context.channels || (context.settings.channels as string[])) {
    const recipient = recipientFor(channel, invoice);
    const result = await postgresService.query(
      `INSERT INTO hostel_notifications (id, institution_id, invoice_id, allocation_id, student_id,
         student_name, scenario, channel, recipient, subject, body, status, last_error,
         triggered_by, dedupe_key, payment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (institution_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [
        newId(),
        institutionId,
        invoice.id,
        invoice.allocation_id,
        invoice.student_id,
        invoice.student_name,
        scenario,
        channel,
        recipient,
        render(template.subject, values).slice(0, 255),
        render(template.body, values),
        recipient ? "Pending" : "Skipped",
        recipient ? "" : `No ${channel === "EMAIL" ? "email address" : "phone number"} on record.`,
        context.triggeredBy,
        `${dedupeBase}:${channel}`,
        context.payment?.id ?? null,
      ]
    );
    if (result.rows[0]) queued.push(result.rows[0].id);
  }
  return queued;
};

type Provider = { url: string; key: string; from: string };

const providerFor = (channel: string): Provider | null => {
  const prefix = channel === "EMAIL" ? "HOSTEL_EMAIL" : "HOSTEL_SMS";
  const url = process.env[`${prefix}_API_URL`];
  if (!url) return null;
  return {
    url,
    key: process.env[`${prefix}_API_KEY`] || "",
    from: process.env[`${prefix}_FROM`] || "",
  };
};

export const providerStatus = () => ({
  inApp: true,
  email: isSmtpConfigured() || Boolean(providerFor("EMAIL")),
  emailMode: isSmtpConfigured() ? "SMTP" : providerFor("EMAIL") ? "HTTP" : "",
  adminEmailSet: Boolean(adminEmail()),
  sms: Boolean(providerFor("SMS")),
});

// A 2xx answer means the provider accepted the message, so the status is Sent.
// Delivered is reserved for a provider confirmation, which needs a webhook.
const sendThroughProvider = async (provider: Provider, row: any, text: string, html: string): Promise<string> => {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}),
    },
    body: JSON.stringify({
      channel: row.channel,
      to: row.recipient,
      from: provider.from,
      subject: row.subject,
      text,
      html,
      reference: row.id,
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Provider answered HTTP ${response.status}.`);
  }
  const answer: any = await response.json().catch(() => ({}));
  return String(answer.id || answer.messageId || "");
};

class SkipMessage extends Error {}

const unpaidMeals = async (allocationId: string) => {
  const { rows } = await postgresService.query(
    `SELECT title, outstanding_amount FROM hostel_invoice_balances
     WHERE allocation_id = $1 AND category = 'MEAL' AND outstanding_amount > 0 ORDER BY due_date`,
    [allocationId]
  );
  return rows.map((item: any) => ({ title: item.title as string, outstanding: toMoney(item.outstanding_amount) }));
};

// For messages about a person rather than an invoice: an allocation or a visit.
// The rows are kept with the message, so a retry sends exactly the same content.
export const queueDirect = async (
  institutionId: string,
  message: {
    scenario: Scenario;
    allocationId: string | null;
    studentId: string;
    studentName: string;
    recipients: [string, string][];
    values: Record<string, string>;
    details: [string, string][];
    dedupeKey: string;
    triggeredBy: string;
  }
) => {
  const templates = await loadTemplates(institutionId);
  const template = templates[message.scenario];
  const queued: string[] = [];
  for (const [channel, recipient] of message.recipients) {
    const result = await postgresService.query(
      `INSERT INTO hostel_notifications (id, institution_id, allocation_id, student_id, student_name, scenario,
         channel, recipient, subject, body, status, last_error, triggered_by, dedupe_key, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (institution_id, dedupe_key) DO NOTHING RETURNING id`,
      [
        newId(),
        institutionId,
        message.allocationId,
        message.studentId,
        message.studentName,
        message.scenario,
        channel,
        recipient,
        render(template.subject, message.values).slice(0, 255),
        render(template.body, message.values),
        recipient ? "Pending" : "Skipped",
        recipient ? "" : "No email address on record.",
        message.triggeredBy,
        `${message.dedupeKey}:${channel}`,
        JSON.stringify(message.details),
      ]
    );
    if (result.rows[0]) queued.push(result.rows[0].id);
  }
  if (queued.length > 0) await deliverPending({ institutionId });
  return queued;
};

// Reads the balance again at send time, so a message never quotes an old amount.
// The link is added here and not saved, so the log never holds a working token.
const prepareMessage = async (row: any) => {
  const settings = await getRentSettings(row.institution_id);
  if (!row.invoice_id) {
    const rows: [string, string][] = Array.isArray(row.details) ? row.details : [];
    return {
      brand: settings.brandName,
      subject: row.subject,
      text: [row.body, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n"),
      html: renderEmailHtml({ brand: settings.brandName, title: row.subject, body: row.body, rows }),
      attachments: [] as Attachment[],
    };
  }

  const [invoiceResult, paymentResult, templates] = await Promise.all([
    postgresService.query(`${INVOICE_WITH_CONTACT} WHERE i.id = $1`, [row.invoice_id]),
    row.payment_id
      ? postgresService.query("SELECT * FROM hostel_payments WHERE id = $1", [row.payment_id])
      : Promise.resolve({ rows: [] as any[] }),
    loadTemplates(row.institution_id),
  ]);
  const invoice = invoiceResult.rows[0];
  const payment = paymentResult.rows[0];
  // A meal reminder is about all unpaid meals, not one invoice.
  const mealLines: { title: string; outstanding: number }[] =
    row.scenario === "MEAL_DUE" ? await unpaidMeals(invoice.allocation_id) : [];
  if (row.scenario === "MEAL_DUE") {
    invoice.meal_outstanding = mealLines.reduce((sum, line) => sum + Math.round(line.outstanding * 100), 0) / 100;
  }
  const hasBalance =
    row.scenario === "MEAL_DUE" ? invoice.meal_outstanding > 0 : toMoney(invoice.outstanding_amount) > 0;

  if (REMINDERS.has(row.scenario) && !hasBalance) {
    throw new SkipMessage("Already paid, so this reminder was not sent.");
  }

  const template = templates[row.scenario as Scenario] || { subject: row.subject, body: row.body };
  const values = templateValues(invoice, settings, payment);
  const subject = render(template.subject, values).slice(0, 255);
  const body = render(template.body, values);
  await postgresService.query("UPDATE hostel_notifications SET subject = $2, body = $3 WHERE id = $1", [row.id, subject, body]);

  if (row.channel === "IN_APP") {
    return { brand: settings.brandName, subject, text: body, html: "", attachments: [] as Attachment[] };
  }

  const payUrl =
    WITH_PAY_LINK.has(row.scenario) && hasBalance
      ? await issuePaymentLink(row.institution_id, row.invoice_id)
      : "";

  const attachments: Attachment[] = [];
  if (row.channel === "EMAIL" && payment && WITH_RECEIPT.has(row.scenario)) {
    const receipt = await renderReceiptPdf(row.institution_id, payment.id);
    attachments.push({ filename: receipt.fileName, content: receipt.content, contentType: "application/pdf" });
  }

  return {
    brand: settings.brandName,
    subject,
    text: payUrl ? `${body}\n\nPay online: ${payUrl}` : body,
    html: renderEmailHtml({
      brand: settings.brandName,
      title: subject,
      body,
      rows:
        row.scenario === "MEAL_DUE"
          ? [
              ["Student Name", invoice.student_name],
              ["Student ID", invoice.student_id],
              ...mealLines.map((line) => [line.title, taka(line.outstanding)] as [string, string]),
              ["Total Meal Outstanding", taka(invoice.meal_outstanding)],
              ["Payment Due Date", invoice.due_date],
            ]
          : emailRows(invoice, payment),
      actionUrl: payUrl,
      actionLabel: "View and Pay",
    }),
    attachments,
  };
};

const sendRow = async (row: any): Promise<string> => {
  const message = await prepareMessage(row);
  if (row.channel === "IN_APP") return "";

  if (row.channel === "EMAIL" && isSmtpConfigured()) {
    return sendSmtpMail({ ...message, to: row.recipient });
  }
  const provider = providerFor(row.channel);
  if (!provider) {
    throw new SkipMessage(`${row.channel === "EMAIL" ? "Email" : "SMS"} provider is not configured.`);
  }
  return sendThroughProvider(provider, row, message.text, message.html);
};

// A row is leased while it is sent, so two workers can never send it twice.
export const deliverPending = async (options: { institutionId?: string; limit?: number } = {}) => {
  const { rows } = await postgresService.query(
    `UPDATE hostel_notifications SET attempts = attempts + 1,
       next_attempt_at = NOW() + ($1 || ' minutes')::interval
     WHERE id IN (
       SELECT id FROM hostel_notifications
       WHERE status = 'Pending' AND next_attempt_at <= NOW()
         ${options.institutionId ? "AND institution_id = $3" : ""}
       ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
    options.institutionId
      ? [String(CLAIM_LEASE_MINUTES), options.limit ?? 200, options.institutionId]
      : [String(CLAIM_LEASE_MINUTES), options.limit ?? 200]
  );

  const counts = { sent: 0, failed: 0, retrying: 0, skipped: 0 };

  for (const row of rows) {
    try {
      const messageId = await sendRow(row);
      await postgresService.query(
        `UPDATE hostel_notifications SET status = 'Sent', sent_at = NOW(), last_error = '',
           provider_message_id = $2 WHERE id = $1`,
        [row.id, messageId]
      );
      counts.sent += 1;
    } catch (err: any) {
      if (err instanceof SkipMessage) {
        await postgresService.query(
          "UPDATE hostel_notifications SET status = 'Skipped', last_error = $2 WHERE id = $1",
          [row.id, err.message]
        );
        counts.skipped += 1;
        continue;
      }

      const isFinal = row.attempts >= MAX_ATTEMPTS || isPermanentMailFailure(err);
      await postgresService.query(
        `UPDATE hostel_notifications SET status = $2, last_error = $3,
           next_attempt_at = NOW() + ($4 || ' minutes')::interval
         WHERE id = $1`,
        [
          row.id,
          isFinal ? "Failed" : "Pending",
          String(err.message).slice(0, 500),
          String(RETRY_MINUTES * row.attempts),
        ]
      );
      counts[isFinal ? "failed" : "retrying"] += 1;
    }
  }

  return counts;
};

// Tells a student about this month's invoice once, however often the job runs.
export const queueNewInvoices = async (institutionId: string) => {
  const local = await getLocalNow(institutionId);
  const templates = await loadTemplates(institutionId);
  const { rows } = await postgresService.query(
    `${INVOICE_WITH_CONTACT}
     WHERE i.institution_id = $1 AND i.billing_month = $2 AND i.outstanding_amount > 0 AND i.category = 'RENT'`,
    [institutionId, monthOf(local.today)]
  );

  let queued = 0;
  for (const invoice of rows) {
    queued += (
      await queue(institutionId, invoice, "INVOICE", `${invoice.id}:INVOICE`, {
        settings: local.settings,
        templates,
        triggeredBy: "system",
      })
    ).length;
  }
  return { queued };
};

// Picks the reminders due today. Overdue reminders go per student, for their
// oldest overdue invoice, so several overdue months do not mean several messages.
export const queueDueReminders = async (
  institutionId: string,
  options: { today?: string; ignoreHour?: boolean; scope?: "upcoming" | "overdue" } = {}
) => {
  const local = await getLocalNow(institutionId);
  const { settings } = local;
  if (!options.ignoreHour && local.hour < settings.reminderHour) {
    return { queued: 0, waitingForHour: true };
  }

  const today = options.today || local.today;
  const templates = await loadTemplates(institutionId);
  const context = { settings, templates, triggeredBy: "system" };
  const includeUpcoming = options.scope !== "overdue";
  const includeOverdue = options.scope !== "upcoming";
  let queued = 0;

  const { rows } = await postgresService.query(
    `${INVOICE_WITH_CONTACT}
     WHERE i.institution_id = $1 AND i.outstanding_amount > 0 AND i.category = 'RENT'
     ORDER BY i.due_date`,
    [institutionId]
  );

  const oldestOverdue = new Map<string, any>();

  for (const invoice of rows) {
    const daysToDue = daysBetween(today, invoice.due_date);

    if (daysToDue < 0) {
      if (!oldestOverdue.has(invoice.allocation_id)) {
        oldestOverdue.set(invoice.allocation_id, invoice);
      }
      continue;
    }
    if (!includeUpcoming) continue;

    let scenario: Scenario | null = null;
    if (daysToDue === 0 && settings.remindOnDueDate) scenario = "DUE_TODAY";
    if (daysToDue > 0 && settings.reminderDaysBefore.includes(daysToDue)) {
      if (toMoney(invoice.paid_amount) > 0) scenario = "PARTIAL";
      else scenario = daysToDue === 1 ? "FINAL_REMINDER" : "UPCOMING";
    }
    if (scenario) {
      const key = `${invoice.id}:${scenario}:${today}`;
      queued += (await queue(institutionId, invoice, scenario, key, context)).length;
    }
  }

  if (!includeOverdue) return { queued, waitingForHour: false };

  for (const invoice of oldestOverdue.values()) {
    const overdueDays = daysBetween(invoice.due_date, today);
    if (overdueDays < settings.overdueFirstAfterDays) continue;

    // Uses the last reminder rather than exact days, so a missed run still sends.
    const last = await postgresService.query(
      `SELECT TO_CHAR(MAX(created_at) AT TIME ZONE $3, 'YYYY-MM-DD') AS day
       FROM hostel_notifications
       WHERE allocation_id = $1 AND institution_id = $2
         AND scenario IN ('OVERDUE', 'OUTSTANDING') AND triggered_by = 'system'`,
      [invoice.allocation_id, institutionId, settings.timezone]
    );
    const lastDay: string | null = last.rows[0].day;
    if (lastDay && daysBetween(lastDay, today) < settings.overdueIntervalDays) continue;

    const scenario: Scenario = lastDay ? "OUTSTANDING" : "OVERDUE";
    const key = `${invoice.allocation_id}:${scenario}:${today}`;
    queued += (await queue(institutionId, invoice, scenario, key, context)).length;
  }

  return { queued, waitingForHour: false };
};

const loadInvoice = async (invoiceId: string) => {
  const { rows } = await postgresService.query(`${INVOICE_WITH_CONTACT} WHERE i.id = $1`, [invoiceId]);
  return rows[0];
};

// Messages a student once the meals they owe for reach the configured amount.
export const queueMealReminders = async (
  institutionId: string,
  options: { allocationIds?: string[]; triggeredBy?: string; today?: string } = {}
) => {
  const local = await getLocalNow(institutionId);
  const today = options.today || local.today;
  const manual = Boolean(options.allocationIds);
  const values: unknown[] = [institutionId];
  if (manual) values.push(options.allocationIds);

  const { rows } = await postgresService.query(
    `SELECT allocation_id, SUM(outstanding_amount) AS total, MIN(id) FILTER (WHERE true) AS any_invoice
     FROM hostel_invoice_balances
     WHERE institution_id = $1 AND category = 'MEAL' AND outstanding_amount > 0
       ${manual ? "AND allocation_id = ANY($2)" : ""}
     GROUP BY allocation_id`,
    values
  );

  const templates = await loadTemplates(institutionId);
  const results: { allocationId: string; total: number; queued: number; reason?: string }[] = [];

  for (const row of rows) {
    const total = toMoney(row.total);
    if (!manual && total < toMoney(local.settings.mealReminderThreshold)) continue;

    if (!manual) {
      const last = await postgresService.query(
        `SELECT TO_CHAR(MAX(created_at) AT TIME ZONE $3, 'YYYY-MM-DD') AS day FROM hostel_notifications
         WHERE allocation_id = $1 AND institution_id = $2 AND scenario = 'MEAL_DUE' AND triggered_by = 'system'`,
        [row.allocation_id, institutionId, local.settings.timezone]
      );
      if (last.rows[0].day && daysBetween(last.rows[0].day, today) < local.settings.mealReminderIntervalDays) {
        continue;
      }
    }

    const oldest = await postgresService.query(
      `${INVOICE_WITH_CONTACT} WHERE i.allocation_id = $1 AND i.category = 'MEAL' AND i.outstanding_amount > 0
       ORDER BY i.due_date LIMIT 1`,
      [row.allocation_id]
    );
    const queued = await queue(
      institutionId,
      oldest.rows[0],
      "MEAL_DUE",
      `${manual ? "meal-manual" : "meal"}:${row.allocation_id}:${today}`,
      { settings: local.settings, templates, triggeredBy: options.triggeredBy || "system", channels: ["EMAIL", "IN_APP"] }
    );
    results.push({ allocationId: row.allocation_id, total, queued: queued.length, reason: queued.length ? undefined : "Already sent today." });
  }

  if (results.some((item) => item.queued > 0)) await deliverPending({ institutionId });
  return results;
};

export const hostelNotificationService = {
  // Sends any invoice by email, with a link to pay what is left. Once a day per invoice.
  async emailInvoice(ctx: HostelContext, invoiceId: string) {
    const local = await getLocalNow(ctx.institutionId);
    const invoice = await loadInvoice(invoiceId);
    if (!invoice || invoice.institution_id !== ctx.institutionId) throw new HostelError(404, "Invoice not found.");
    const key = `invoice-copy:${invoiceId}:${local.today}`;
    await queue(ctx.institutionId, invoice, "CHARGE_INVOICE", key, {
      settings: local.settings,
      templates: await loadTemplates(ctx.institutionId),
      triggeredBy: ctx.actorEmail,
      channels: ["EMAIL"],
    });
    await deliverPending({ institutionId: ctx.institutionId });
    const log = await postgresService.query(
      "SELECT status, recipient, last_error FROM hostel_notifications WHERE institution_id = $1 AND dedupe_key = $2",
      [ctx.institutionId, `${key}:EMAIL`]
    );
    return { status: log.rows[0].status, recipient: log.rows[0].recipient, error: log.rows[0].last_error };
  },

  // Full payment gets a confirmation. Part payment says what is still owed.
  async sendPaymentConfirmation(institutionId: string, payment: any) {
    const [settings, templates, invoice, paymentRow] = await Promise.all([
      getRentSettings(institutionId),
      loadTemplates(institutionId),
      loadInvoice(payment.invoiceId),
      postgresService.query("SELECT * FROM hostel_payments WHERE id = $1", [payment.id]),
    ]);

    const queued = await queue(
      institutionId,
      invoice,
      toMoney(invoice.outstanding_amount) > 0 ? "PARTIAL_PAYMENT" : "CONFIRMATION",
      `payment:${payment.id}`,
      { settings, templates, triggeredBy: "system", payment: paymentRow.rows[0] }
    );
    if (queued.length > 0) await deliverPending({ institutionId });
  },

  async sendPaymentFailure(institutionId: string, transactionId: string, invoiceId: string) {
    const [settings, templates, invoice] = await Promise.all([
      getRentSettings(institutionId),
      loadTemplates(institutionId),
      loadInvoice(invoiceId),
    ]);
    const queued = await queue(institutionId, invoice, "PAYMENT_FAILED", `gateway:${transactionId}`, {
      settings,
      templates,
      triggeredBy: "system",
      channels: ["EMAIL"],
    });
    if (queued.length > 0) await deliverPending({ institutionId });
  },

  // Sends a new link to the address on file, at most once a day per invoice.
  async sendNewPaymentLink(institutionId: string, invoiceId: string) {
    const local = await getLocalNow(institutionId);
    const invoice = await loadInvoice(invoiceId);
    const queued = await queue(institutionId, invoice, "UPCOMING", `renew:${invoiceId}:${local.today}`, {
      settings: local.settings,
      templates: await loadTemplates(institutionId),
      triggeredBy: "student link request",
      channels: ["EMAIL"],
    });
    if (queued.length > 0) await deliverPending({ institutionId });
  },

  async emailReceipt(ctx: HostelContext, paymentId: string) {
    const local = await getLocalNow(ctx.institutionId);
    const { rows } = await postgresService.query(
      "SELECT * FROM hostel_payments WHERE institution_id = $1 AND id = $2",
      [ctx.institutionId, paymentId]
    );
    if (!rows[0]) throw new HostelError(404, "Payment not found.");

    const invoice = await loadInvoice(rows[0].invoice_id);
    await queue(ctx.institutionId, invoice, "RECEIPT", `receipt:${paymentId}:${local.today}`, {
      settings: local.settings,
      templates: await loadTemplates(ctx.institutionId),
      triggeredBy: ctx.actorEmail,
      payment: rows[0],
      channels: ["EMAIL"],
    });
    await deliverPending({ institutionId: ctx.institutionId });

    const log = await postgresService.query(
      "SELECT status, recipient, last_error FROM hostel_notifications WHERE institution_id = $1 AND dedupe_key = $2",
      [ctx.institutionId, `receipt:${paymentId}:${local.today}:EMAIL`]
    );
    return { status: log.rows[0].status, recipient: log.rows[0].recipient, error: log.rows[0].last_error };
  },

  // Goes only to the admin address, for things a person has to look at.
  async alertAdmin(institutionId: string, key: string, subject: string, body: string) {
    const recipient = adminEmail();
    await postgresService.query(
      `INSERT INTO hostel_notifications (id, institution_id, scenario, channel, recipient, subject, body,
         status, last_error, dedupe_key)
       VALUES ($1, $2, 'ADMIN_ALERT', 'EMAIL', $3, $4, $5, $6, $7, $8)
       ON CONFLICT (institution_id, dedupe_key) DO NOTHING`,
      [
        newId(),
        institutionId,
        recipient,
        subject.slice(0, 255),
        body,
        recipient ? "Pending" : "Skipped",
        recipient ? "" : "TO_EMAIL is not set.",
        `admin:${key}`,
      ]
    );
    if (recipient) await deliverPending({ institutionId });
  },

  // Reports the mail server's real answer, for checking the setup.
  async sendTestEmail(ctx: HostelContext, requestedTo: string) {
    const to = requestedTo || adminEmail();
    if (!isSmtpConfigured()) throw new HostelError(503, "Set EMAIL_USER and EMAIL_PASS in the backend environment first.");
    if (!to) throw new HostelError(400, "Enter an address, or set TO_EMAIL in the backend environment.");

    const settings = await getRentSettings(ctx.institutionId);
    const subject = "Hostel email test";
    const body = "This test message confirms that the hostel system can send email.";
    try {
      const messageId = await sendSmtpMail({
        brand: settings.brandName,
        to,
        subject,
        text: body,
        html: renderEmailHtml({ brand: settings.brandName, title: subject, body, rows: [] }),
      });
      await postgresService.transaction((tx) =>
        writeAudit(tx, ctx, "Tested", "Email", "", `Sent a test email to ${to}.`)
      );
      return { to, messageId };
    } catch (err: any) {
      throw new HostelError(502, `The mail server did not accept the message: ${err.message}`);
    }
  },

  // A manual reminder for the student's oldest unpaid invoice, once a day.
  async sendManualReminder(ctx: HostelContext, allocationId: string) {
    const local = await getLocalNow(ctx.institutionId);
    const { rows } = await postgresService.query(
      `${INVOICE_WITH_CONTACT}
       WHERE i.institution_id = $1 AND i.allocation_id = $2 AND i.outstanding_amount > 0 AND i.category = 'RENT'
       ORDER BY i.due_date LIMIT 1`,
      [ctx.institutionId, allocationId]
    );
    const invoice = rows[0];
    if (!invoice) throw new HostelError(409, "This student has no outstanding rent.");

    const scenario: Scenario =
      local.today > invoice.due_date ? "OUTSTANDING" : toMoney(invoice.paid_amount) > 0 ? "PARTIAL" : "UPCOMING";

    const queued = await queue(
      ctx.institutionId,
      invoice,
      scenario,
      `manual:${allocationId}:${local.today}`,
      {
        settings: local.settings,
        templates: await loadTemplates(ctx.institutionId),
        triggeredBy: ctx.actorEmail,
      }
    );

    if (queued.length > 0) {
      await deliverPending({ institutionId: ctx.institutionId });
      await postgresService.transaction((tx) =>
        writeAudit(tx, ctx, "Reminder", "Notification", allocationId, `Sent a rent reminder to ${invoice.student_name} (${invoice.student_id}).`)
      );
    }

    const log = await postgresService.query(
      `SELECT channel, status, recipient, last_error FROM hostel_notifications
       WHERE institution_id = $1 AND dedupe_key LIKE $2 ORDER BY channel`,
      [ctx.institutionId, `manual:${allocationId}:${local.today}:%`]
    );

    return {
      alreadySentToday: queued.length === 0,
      channels: log.rows.map((row: any) => ({
        channel: row.channel,
        status: row.status,
        recipient: row.recipient,
        error: row.last_error,
      })),
    };
  },

  async list(institutionId: string, options: { allocationId?: string; limit?: number } = {}) {
    const values: unknown[] = [institutionId, options.limit ?? 500];
    if (options.allocationId) values.push(options.allocationId);

    const { rows } = await postgresService.query(
      `SELECT * FROM hostel_notifications WHERE institution_id = $1
       ${options.allocationId ? "AND allocation_id = $3" : ""}
       ORDER BY created_at DESC LIMIT $2`,
      values
    );
    return rows.map((row: any) => ({
      id: row.id,
      allocationId: row.allocation_id,
      invoiceId: row.invoice_id,
      studentId: row.student_id,
      studentName: row.student_name,
      scenario: row.scenario,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      triggeredBy: row.triggered_by,
      sentAt: toIso(row.sent_at),
      createdAt: toIso(row.created_at),
    }));
  },

  async retry(ctx: HostelContext, id: string) {
    const { rows } = await postgresService.query(
      `UPDATE hostel_notifications SET status = 'Pending', attempts = 0, next_attempt_at = NOW(), last_error = ''
       WHERE institution_id = $1 AND id = $2 AND status IN ('Failed', 'Skipped') AND recipient <> ''
       RETURNING id`,
      [ctx.institutionId, id]
    );
    if (!rows[0]) {
      throw new HostelError(409, "Only a failed or skipped message with a recipient can be retried.");
    }
    await deliverPending({ institutionId: ctx.institutionId });

    const { rows: updated } = await postgresService.query(
      "SELECT status, last_error FROM hostel_notifications WHERE id = $1",
      [id]
    );
    return { id, status: updated[0].status, error: updated[0].last_error };
  },

  async listTemplates(institutionId: string) {
    const templates = await loadTemplates(institutionId);
    return SCENARIOS.map((scenario) => ({ scenario, ...templates[scenario] }));
  },

  async saveTemplate(ctx: HostelContext, scenario: Scenario, subject: string, body: string) {
    await postgresService.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO hostel_notification_templates (institution_id, scenario, subject, body)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (institution_id, scenario)
         DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = NOW()`,
        [ctx.institutionId, scenario, subject, body]
      );
      await writeAudit(tx, ctx, "Updated", "Rent Config", scenario, `Updated the ${scenario} notification template.`);
    });
    return { scenario, subject, body };
  },
};
