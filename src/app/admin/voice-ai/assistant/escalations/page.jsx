"use client";

import { useCallback, useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, FormModal, NoAccess, SystemShell, filterClass, formatDateTime, inputClass, linkButton, dangerButton, useData } from "@/components/erp/ui";
import { CHANNEL_STATUS, CRUMBS, ESC_STATUS, Notice, SectionTabs, StatusPill, textareaClass } from "../_components/assistantUi";

// Questions the assistant could not answer, who they went to, and whether they arrived.
function AnswerForm({ escalation, onClose, onDone }) {
  const [answer, setAnswer] = useState("");
  const [answeredBy, setAnsweredBy] = useState(escalation.contactName || "");
  return (
    <FormModal title="Record an answer" submitLabel="Save for review" submitDisabled={!answer.trim()} onClose={onClose}
      onSubmit={async () => {
        await assistantApi.answerEscalation(escalation.id, { answer, answeredBy });
        onDone("Saved. It is waiting in Review — approve it there before the assistant uses it.");
      }}>
      <p className="text-sm text-slate-700 sm:col-span-2"><span className="font-medium">Question:</span> {escalation.question}</p>
      <div className="sm:col-span-2">
        <label htmlFor="e-answer" className="mb-1 block text-sm font-medium text-slate-700">Answer *</label>
        <textarea id="e-answer" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={5000} className={textareaClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="e-by" className="mb-1 block text-sm font-medium text-slate-700">Answered by</label>
        <input id="e-by" value={answeredBy} onChange={(e) => setAnsweredBy(e.target.value)} maxLength={150} placeholder="e.g. Mr. Karim, by phone" className={inputClass} />
      </div>
    </FormModal>
  );
}

function ResendForm({ escalation, contacts, onClose, onDone }) {
  const [contactId, setContactId] = useState(escalation.contactId || contacts[0]?.id || "");
  return (
    <FormModal title="Send to a responsible person" submitLabel="Send" submitDisabled={!contactId} onClose={onClose}
      onSubmit={async () => {
        await assistantApi.resend(escalation.id, contactId);
        onDone("Sent again with a new private link.");
      }}>
      <p className="text-sm text-slate-700 sm:col-span-2"><span className="font-medium">Question:</span> {escalation.question}</p>
      <div className="sm:col-span-2">
        <label htmlFor="e-contact" className="mb-1 block text-sm font-medium text-slate-700">Person</label>
        <select id="e-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
          {contacts.length === 0 && <option value="">Add a responsible person first</option>}
          {contacts.filter((contact) => contact.isActive).map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.title ? ` — ${contact.title}` : ""} ({contact.channels.join(", ")})</option>)}
        </select>
      </div>
    </FormModal>
  );
}

function CloseForm({ escalation, onClose, onDone }) {
  const [note, setNote] = useState("");
  return (
    <FormModal title="Close without an answer" submitLabel="Close" submitDisabled={!note.trim()} onClose={onClose}
      onSubmit={async () => {
        await assistantApi.closeEscalation(escalation.id, note);
        onDone("Closed.");
      }}>
      <div className="sm:col-span-2">
        <label htmlFor="e-note" className="mb-1 block text-sm font-medium text-slate-700">Reason *</label>
        <input id="e-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} />
      </div>
    </FormModal>
  );
}

export default function EscalationsPage() {
  const { can, isReady } = useMe();
  const [status, setStatus] = useState("");
  const load = useCallback(() => Promise.all([assistantApi.escalations(status), assistantApi.contacts()]), [status]);
  const { data, error, isLoading, reload } = useData(load);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");
  const [items, contacts] = data || [[], []];

  if (!isReady) return null;
  if (!can("voice-ai.manage_escalations")) return <NoAccess />;
  const done = (text) => {
    setForm(null);
    setNotice(text);
    reload();
  };
  const open = (escalation) => !["ANSWERED", "CLOSED"].includes(escalation.status);

  return (
    <SystemShell title="Forwarded Questions" crumbs={CRUMBS} subtitle="Questions the assistant could not answer. Each goes to the responsible person by SMS, email or call; their answer waits for review.">
      <SectionTabs can={can} />
      <ErrorBanner message={error} />
      <Notice text={notice} />
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={filterClass}>
        <option value="">All</option><option value="WAITING_ADMIN">Needs admin</option><option value="SENT">Waiting for answer</option>
        <option value="FAILED">Delivery failed</option><option value="ANSWERED">Answered</option><option value="CLOSED">Closed</option>
      </select>
      <div className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Question", "Sent to", "Status", "SMS", "Email", "Call", "Answer", ""]} isLoading={isLoading} hasRows={items.length > 0}
          emptyMessage="No forwarded questions.">
          {items.map((item) => (
            <tr key={item.id} className="border-b border-slate-100 align-top">
              <td className="max-w-xs px-4 py-3"><span className="font-medium text-slate-800">{item.question}</span><span className="block text-xs text-slate-500">{item.askerName || "A user"} · {formatDateTime(item.askedAt)}</span></td>
              <td className="px-4 py-3 text-slate-700">{item.contactName || <span className="text-slate-400">Nobody</span>}<span className="block text-xs text-slate-500">{item.contactTitle}</span></td>
              <td className="px-4 py-3">
                <StatusPill map={ESC_STATUS} value={item.status} />
                {item.lastError && open(item) && <span className="mt-1 block max-w-[14rem] text-xs text-red-700">{item.lastError}</span>}
                {item.nextAttemptAt && open(item) && <span className="block text-xs text-slate-500">Retry {formatDateTime(item.nextAttemptAt)}</span>}
              </td>
              <td className="px-4 py-3"><StatusPill map={CHANNEL_STATUS} value={item.smsStatus} /></td>
              <td className="px-4 py-3"><StatusPill map={CHANNEL_STATUS} value={item.emailStatus} /></td>
              <td className="px-4 py-3"><StatusPill map={CHANNEL_STATUS} value={item.callStatus} /></td>
              <td className="max-w-xs px-4 py-3 text-slate-700">
                {item.answer ? <><span className="line-clamp-3 whitespace-pre-line">{item.answer}</span><span className="block text-xs text-slate-500">{item.answeredBy} · {formatDateTime(item.answeredAt)}</span></> : item.closedNote || "—"}
                {item.reviewStatus && <span className="block text-xs text-blue-700">Review: {item.reviewStatus.toLowerCase()}</span>}
              </td>
              <td className="px-4 py-3">
                {open(item) && (
                  <div className="flex flex-col gap-1.5">
                    <button onClick={() => setForm({ kind: "answer", item })} className={linkButton}>Record answer</button>
                    <button onClick={() => setForm({ kind: "resend", item })} className={linkButton}>{item.contactId ? "Send again" : "Send to someone"}</button>
                    <button onClick={() => setForm({ kind: "close", item })} className={dangerButton}>Close</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
      {form?.kind === "answer" && <AnswerForm escalation={form.item} onClose={() => setForm(null)} onDone={done} />}
      {form?.kind === "resend" && <ResendForm escalation={form.item} contacts={contacts} onClose={() => setForm(null)} onDone={done} />}
      {form?.kind === "close" && <CloseForm escalation={form.item} onClose={() => setForm(null)} onDone={done} />}
    </SystemShell>
  );
}
