"use client";

import Link from "next/link";
import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import {
  DataTable,
  ErrorBanner,
  Field,
  FormModal,
  PageShell,
  StatusBadge,
  TextField,
  formatDateTime,
  friendlyError,
  inputClass,
  linkButton,
  primaryButton,
  secondaryButton,
  useHostelData,
} from "./hostelUi";

const CHANNELS = [
  { value: "IN_APP", label: "In-App" },
  { value: "EMAIL", label: "Email" },
  { value: "SMS", label: "SMS" },
];

const SCENARIO_LABELS = {
  INVOICE: "Monthly Rent Invoice",
  UPCOMING: "Upcoming Rent Reminder",
  FINAL_REMINDER: "Final Reminder (1 day before)",
  PARTIAL_PAYMENT: "Partial Payment Notification",
  RECEIPT: "Payment Receipt",
  PAYMENT_FAILED: "Payment Failure Notification",
  ALLOCATION: "Seat Allocation Confirmation",
  CHARGE_INVOICE: "Invoice Copy (any charge)",
  MEAL_DUE: "Meal Due Payment Reminder",
  VISITOR_TICKET: "Visitor Ticket",
  DUE_TODAY: "Rent Due Today",
  OVERDUE: "Rent Overdue",
  PARTIAL: "Partial Payment Reminder",
  CONFIRMATION: "Payment Confirmation",
  OUTSTANDING: "Outstanding Balance Reminder",
};

const JOB_LABELS = {
  "invoice-generation": "Monthly invoice generation",
  "upcoming-reminders": "Upcoming rent emails",
  "overdue-reminders": "Overdue rent emails",
  "payment-reconciliation": "Payment reconciliation",
  "notification-delivery": "Message delivery and retry",
};

const loadJobs = () => hostelService.getJobs();

function JobStatus() {
  const { data } = useHostelData(loadJobs);
  return (
    <ul className="mt-3 divide-y divide-slate-100 text-sm">
      {data?.map((job) => (
        <li key={job.job} className="flex flex-wrap items-center justify-between gap-2 py-2 text-slate-700">
          <span>{JOB_LABELS[job.job] || job.job}</span>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            {job.finishedAt ? formatDateTime(job.finishedAt) : "Not run yet"}
            <StatusBadge status={job.status} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmailTest() {
  const [to, setTo] = useState("");
  const [result, setResult] = useState(null);
  const [isSending, setIsSending] = useState(false);

  const send = async () => {
    setResult(null);
    setIsSending(true);
    try {
      const sent = await hostelService.sendTestEmail(to.trim());
      setResult({ ok: true, text: `The mail server accepted a message to ${sent.to}. Check that inbox to confirm it arrived.` });
    } catch (err) {
      setResult({ ok: false, text: friendlyError(err) });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <TextField id="test-email-to" label="Send a Test Email To" type="email" value={to} onChange={setTo} placeholder="Empty uses TO_EMAIL" />
      <button type="button" onClick={send} disabled={isSending} className={`${secondaryButton} mt-3 disabled:opacity-60`}>
        {isSending ? "Sending..." : "Send Test Email"}
      </button>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`mt-2 text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

const PLACEHOLDERS =
  "{{studentName}}, {{studentId}}, {{billingMonth}}, {{amountDue}}, {{totalOutstanding}}, {{dueDate}}, {{paymentInstructions}}, {{amountPaid}}, {{receiptNumber}}";

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-800">{title}</h2>
      {description && <p className="mb-4 mt-1 text-sm text-slate-500">{description}</p>}
      {children}
    </section>
  );
}

function GlobalSettingsForm({ settings, onSaved }) {
  const [form, setForm] = useState({
    defaultDueDay: String(settings.defaultDueDay),
    timezone: settings.timezone,
    reminderDaysBefore: settings.reminderDaysBefore.join(", "),
    remindOnDueDate: settings.remindOnDueDate,
    overdueFirstAfterDays: String(settings.overdueFirstAfterDays),
    overdueIntervalDays: String(settings.overdueIntervalDays),
    reminderHour: String(settings.reminderHour),
    channels: settings.channels,
    paymentInstructions: settings.paymentInstructions,
    brandName: settings.brandName,
    allowPartialOnline: settings.allowPartialOnline,
    contactInfo: settings.contactInfo || "",
    hostelRules: settings.hostelRules || "",
    mealReminderThreshold: String(settings.mealReminderThreshold ?? 500),
    mealReminderIntervalDays: String(settings.mealReminderIntervalDays ?? 3),
    mealPaymentDays: String(settings.mealPaymentDays ?? 7),
    lateFeeType: settings.lateFeeType || "NONE",
    lateFeeValue: String(settings.lateFeeValue || ""),
    lateFeeGraceDays: String(settings.lateFeeGraceDays ?? 0),
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSaving(true);

    try {
      await hostelService.updateRentSettings({
        ...form,
        defaultDueDay: Number(form.defaultDueDay),
        reminderDaysBefore: form.reminderDaysBefore
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map(Number),
        overdueFirstAfterDays: Number(form.overdueFirstAfterDays),
        overdueIntervalDays: Number(form.overdueIntervalDays),
        reminderHour: Number(form.reminderHour),
        mealReminderThreshold: Number(form.mealReminderThreshold),
        mealReminderIntervalDays: Number(form.mealReminderIntervalDays),
        mealPaymentDays: Number(form.mealPaymentDays),
        lateFeeType: form.lateFeeType,
        lateFeeValue: form.lateFeeType === "NONE" ? 0 : Number(form.lateFeeValue),
        lateFeeGraceDays: Number(form.lateFeeGraceDays || 0),
      });
      setNotice("Saved. This applies to future invoices. Issued invoices do not change.");
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <TextField
        id="global-due-day"
        label="Default Due Day (1 to 31)"
        type="number"
        min="1"
        max="31"
        value={form.defaultDueDay}
        onChange={setValue("defaultDueDay")}
      />
      <TextField id="global-timezone" label="Time Zone" value={form.timezone} onChange={setValue("timezone")} />
      <TextField
        id="reminder-hour"
        label="Send Reminders From (hour, 0 to 23)"
        type="number"
        min="0"
        max="23"
        value={form.reminderHour}
        onChange={setValue("reminderHour")}
      />
      <TextField
        id="reminder-days"
        label="Days Before Due Date (comma separated)"
        value={form.reminderDaysBefore}
        onChange={setValue("reminderDaysBefore")}
      />
      <TextField
        id="overdue-first"
        label="First Overdue Reminder (days late)"
        type="number"
        min="1"
        value={form.overdueFirstAfterDays}
        onChange={setValue("overdueFirstAfterDays")}
      />
      <TextField
        id="overdue-interval"
        label="Then Repeat Every (days)"
        type="number"
        min="1"
        value={form.overdueIntervalDays}
        onChange={setValue("overdueIntervalDays")}
      />
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={form.remindOnDueDate}
          onChange={(event) => setValue("remindOnDueDate")(event.target.checked)}
        />
        Remind on the due date
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={form.allowPartialOnline}
          onChange={(event) => setValue("allowPartialOnline")(event.target.checked)}
        />
        Allow part payments online
      </label>
      <TextField id="meal-threshold" label="Remind About Meals From (BDT owed)" type="number" min="0" value={form.mealReminderThreshold} onChange={setValue("mealReminderThreshold")} />
      <TextField id="meal-interval" label="Repeat Meal Reminders Every (days)" type="number" min="1" value={form.mealReminderIntervalDays} onChange={setValue("mealReminderIntervalDays")} />
      <TextField id="meal-payment-days" label="Meal Bills Due (days after the meal)" type="number" min="0" value={form.mealPaymentDays} onChange={setValue("mealPaymentDays")} />
      <Field id="late-fee-type" label="Late Fee on Overdue Rent">
        <select id="late-fee-type" value={form.lateFeeType} onChange={(event) => setValue("lateFeeType")(event.target.value)} className={inputClass}>
          <option value="NONE">No late fee</option>
          <option value="FLAT">Fixed amount per invoice</option>
          <option value="PERCENT">Percent of the rent invoice</option>
        </select>
      </Field>
      {form.lateFeeType !== "NONE" && (
        <>
          <TextField
            id="late-fee-value"
            label={form.lateFeeType === "FLAT" ? "Late Fee (BDT)" : "Late Fee (%)"}
            type="number"
            min="0"
            max={form.lateFeeType === "PERCENT" ? "100" : undefined}
            step="0.01"
            value={form.lateFeeValue}
            onChange={setValue("lateFeeValue")}
          />
          <TextField id="late-fee-grace" label="Grace Days After the Due Date" type="number" min="0" max="60" value={form.lateFeeGraceDays} onChange={setValue("lateFeeGraceDays")} />
          <p className="text-xs text-slate-500 sm:col-span-2">
            Charged once per rent invoice as its own fee invoice.
            {settings.lateFeeStartsOn ? ` Applies to rent due on or after ${settings.lateFeeStartsOn}.` : " Applies to rent falling due from today, never to older debts."}
          </p>
        </>
      )}
      <TextField id="contact-info" label="Hostel Contact (shown in seat confirmations)" value={form.contactInfo} maxLength={500} onChange={setValue("contactInfo")} wide />
      <Field id="hostel-rules" label="Hostel Rules (shown in seat confirmations)" wide>
        <textarea id="hostel-rules" rows={3} maxLength={5000} value={form.hostelRules} onChange={(event) => setValue("hostelRules")(event.target.value)} className={inputClass} />
      </Field>
      <TextField id="brand-name" label="Hostel or Institution Name (on emails and receipts)" value={form.brandName} maxLength={100} onChange={setValue("brandName")} />
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-slate-700">Channels</legend>
        <div className="flex flex-wrap gap-5">
          {CHANNELS.map((channel) => (
            <label key={channel.value} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.channels.includes(channel.value)}
                onChange={() =>
                  setValue("channels")(
                    form.channels.includes(channel.value)
                      ? form.channels.filter((item) => item !== channel.value)
                      : [...form.channels, channel.value]
                  )
                }
              />
              {channel.label}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        id="payment-instructions"
        label="Payment Instructions (added to messages)"
        value={form.paymentInstructions}
        maxLength={500}
        onChange={setValue("paymentInstructions")}
        placeholder="e.g. Pay at the hostel office or bKash 017XXXXXXXX."
        wide
      />
      <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-3">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
            {notice}
          </p>
        )}
        <button type="submit" disabled={isSaving} className={`${primaryButton} disabled:opacity-60`}>
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </form>
  );
}

function DueDayEditor({ label, value, fallback, onSave }) {
  const [day, setDay] = useState(value ? String(value) : "");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const save = async (next) => {
    setError("");
    setIsSaving(true);
    try {
      await onSave(next === "" ? null : Number(next));
      setDay(next);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min="1"
          max="31"
          aria-label={`Due day for ${label}`}
          value={day}
          placeholder={`Uses ${fallback}`}
          onChange={(event) => setDay(event.target.value)}
          className={`${inputClass} !w-28`}
        />
        <button type="button" disabled={isSaving} onClick={() => save(day)} className={linkButton} aria-label={`Save due day for ${label}`}>
          Save
        </button>
        {value && (
          <button type="button" disabled={isSaving} onClick={() => save("")} className={linkButton} aria-label={`Remove due day for ${label}`}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function TemplateForm({ template, onClose, onSaved }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);

  const handleSubmit = async () => {
    await hostelService.saveTemplate(template.scenario, { subject, body });
    onSaved();
  };

  return (
    <FormModal
      title={SCENARIO_LABELS[template.scenario]}
      submitLabel="Save Template"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <TextField id="template-subject" label="Subject *" value={subject} onChange={setSubject} wide />
      <Field id="template-body" label="Message *" wide>
        <textarea
          id="template-body"
          rows={5}
          maxLength={1000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-slate-500 sm:col-span-2">You can use: {PLACEHOLDERS}</p>
    </FormModal>
  );
}

const loadConfig = () => hostelService.getRentConfig();

export default function RentSettings() {
  const { data, error: loadError, isLoading, reload } = useHostelData(loadConfig);
  const [template, setTemplate] = useState(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  if (isLoading || loadError || !data) {
    return (
      <PageShell title="Rent Settings">
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {isLoading && "Loading..."}
          {!isLoading && (
            <span role="alert" className="text-red-600">
              {loadError}
            </span>
          )}
        </div>
      </PageShell>
    );
  }

  const { settings, buildings, seatOverrides, templates, providers, lastJob } = data;

  const handleRun = async () => {
    setActionError("");
    setNotice("");
    setIsRunning(true);
    try {
      const result = await hostelService.runRentCycle();
      setNotice(
        result.skipped
          ? result.skipped
          : `Done. ${result.invoicesCreated} invoice(s) created, ${result.remindersQueued} reminder(s) queued.`
      );
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setIsRunning(false);
    }
  };

  const providerRow = (name, ready) => (
    <p className="flex items-center justify-between gap-3 text-sm text-slate-700">
      {name}
      <StatusBadge status={ready ? "Active" : "Not Configured"} />
    </p>
  );

  return (
    <PageShell
      title="Rent Settings"
      subtitle="The due day comes from the seat, then the building, then the global default."
    >
      <ErrorBanner message={actionError} onDismiss={() => setActionError("")} />
      {notice && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </p>
      )}

      <Section
        title="Global Settings"
        description="The default due day for every seat without its own setting, plus the reminder schedule."
      >
        <GlobalSettingsForm settings={settings} onSaved={reload} />
      </Section>

      <Section
        title="Building Due Days"
        description="Overrides the global default for all seats in a building. Leave empty to use the global default."
      >
        <DataTable
          columns={["Hostel", "Building", "Rooms", "Seats", "Due Day"]}
          hasRows={buildings.length > 0}
          emptyMessage="No buildings yet. Buildings appear when rooms are added."
          minWidth="min-w-[640px]"
        >
          {buildings.map((building) => (
            <tr key={building.id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-slate-800">{building.hostelName}</td>
              <td className="px-4 py-3 text-slate-800">{building.name}</td>
              <td className="px-4 py-3 text-slate-600">{building.rooms}</td>
              <td className="px-4 py-3 text-slate-600">{building.seats}</td>
              <td className="px-4 py-3">
                <DueDayEditor
                  key={`${building.id}-${building.dueDay}`}
                  label={`${building.hostelName} ${building.name}`}
                  value={building.dueDay}
                  fallback={settings.defaultDueDay}
                  onSave={async (day) => {
                    await hostelService.setBuildingDueDay(building.id, day);
                    reload();
                  }}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section
        title="Seat Due Days"
        description="Seats with their own due day. Set one from Seat Management or a room's page."
      >
        <DataTable
          columns={["Seat", "Room", "Hostel / Building", "Due Day"]}
          hasRows={seatOverrides.length > 0}
          emptyMessage="No seat has its own due day."
          minWidth="min-w-[640px]"
        >
          {seatOverrides.map((seat) => (
            <tr key={seat.id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-slate-800">Seat {seat.seatNumber}</td>
              <td className="px-4 py-3">
                <Link href={`/admin/hostel/rooms/${seat.roomId}`} className={linkButton}>
                  {seat.roomNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {seat.hostelName} · {seat.building}
              </td>
              <td className="px-4 py-3">
                <DueDayEditor
                  key={`${seat.id}-${seat.dueDay}`}
                  label={`room ${seat.roomNumber} seat ${seat.seatNumber}`}
                  value={seat.dueDay}
                  fallback="building"
                  onSave={async (day) => {
                    await hostelService.setSeatDueDay(seat.id, day);
                    reload();
                  }}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Message Templates">
        <DataTable columns={["Message", "Subject", "Action"]} hasRows minWidth="min-w-[560px]">
          {templates.map((item) => (
            <tr key={item.scenario} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{SCENARIO_LABELS[item.scenario]}</td>
              <td className="px-4 py-3 text-slate-600">{item.subject}</td>
              <td className="px-4 py-3">
                <button onClick={() => setTemplate(item)} className={linkButton} aria-label={`Edit template ${SCENARIO_LABELS[item.scenario]}`}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title="Message Providers"
          description="Set in the backend environment. Without a provider, its messages are logged as Skipped."
        >
          <div className="space-y-2">
            {providerRow("In-App", providers.inApp)}
            {providerRow(providers.emailMode === "SMTP" ? "Email (Gmail SMTP)" : "Email", providers.email)}
            {providerRow("Admin Alerts (TO_EMAIL)", providers.adminEmailSet)}
            {providerRow("SMS", providers.sms)}
          </div>
          <EmailTest />
        </Section>

        <Section title="Background Jobs" description="Create invoices, send reminders, and check open bKash payments automatically.">
          {lastJob ? (
            <div className="space-y-1 text-sm text-slate-700">
              <p className="flex items-center gap-2">
                Last run: {formatDateTime(lastJob.finishedAt)} <StatusBadge status={lastJob.status} />
              </p>
              {lastJob.details?.errors?.length > 0 && (
                <p className="text-red-600">{lastJob.details.errors[0]}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Has not run yet.</p>
          )}
          <JobStatus key={lastJob?.finishedAt} />
          <button onClick={handleRun} disabled={isRunning} className={`${secondaryButton} mt-3 disabled:opacity-60`}>
            {isRunning ? "Running..." : "Run Now"}
          </button>
        </Section>
      </div>

      {template && (
        <TemplateForm
          template={template}
          onClose={() => setTemplate(null)}
          onSaved={() => {
            setTemplate(null);
            reload();
          }}
        />
      )}
    </PageShell>
  );
}
