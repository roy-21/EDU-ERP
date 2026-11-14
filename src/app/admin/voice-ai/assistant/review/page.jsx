"use client";

import { useCallback, useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, FormModal, NoAccess, SystemShell, filterClass, formatDateTime, inputClass, linkButton, useData } from "@/components/erp/ui";
import { CRUMBS, Notice, Pill, SectionTabs, textareaClass } from "../_components/assistantUi";

// Nothing becomes the assistant's knowledge until an admin approves it here.
const REVIEW_STATUS = { PENDING: ["Waiting", "amber"], APPROVED: ["Approved", "green"], REJECTED: ["Rejected", "red"] };
const VIA = { LINK: "answered through the private link", PANEL: "recorded in the panel" };

function ReviewForm({ review, onClose, onDone }) {
  const [form, setForm] = useState({ question: review.question, finalAnswer: review.finalAnswer || review.receivedAnswer, explanation: review.explanation || "" });
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  if (rejecting) {
    return (
      <FormModal title="Reject this answer" submitLabel="Reject" submitDisabled={!note.trim()} onClose={() => setRejecting(false)}
        onSubmit={async () => {
          await assistantApi.reject(review.id, note);
          onDone("Rejected. The assistant will not use this answer.");
        }}>
        <div className="sm:col-span-2">
          <label htmlFor="reject-note" className="mb-1 block text-sm font-medium text-slate-700">Why? *</label>
          <input id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} />
        </div>
      </FormModal>
    );
  }

  return (
    <FormModal title="Review an answer" submitLabel="Approve — the assistant learns this" submitDisabled={!form.finalAnswer.trim()} onClose={onClose}
      onSubmit={async () => {
        await assistantApi.approve(review.id, form);
        onDone("Approved. The assistant answers similar questions with this from now on, and the person who asked has their answer.");
      }}>
      <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm sm:col-span-2">
        <p><span className="font-medium">Asked by:</span> {review.askerName || "a user"} · {formatDateTime(review.askedAt)}</p>
        <p><span className="font-medium">Answered by:</span> {review.answeredBy || "—"}{review.answeredVia ? ` (${VIA[review.answeredVia] || review.answeredVia})` : ""}</p>
        <p className="whitespace-pre-line"><span className="font-medium">Their answer:</span> {review.receivedAnswer}</p>
      </div>
      {review.aiDraft && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm sm:col-span-2">
          <p className="mb-1 font-medium text-blue-900">AI suggestion (check every fact)</p>
          <p className="whitespace-pre-line text-blue-900">{review.aiDraft}</p>
          <button type="button" onClick={() => setForm({ ...form, finalAnswer: review.aiDraft })} className={`${linkButton} mt-2 text-sm`}>Use this wording</button>
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor="r-question" className="mb-1 block text-sm font-medium text-slate-700">Question (as it will be stored)</label>
        <input id="r-question" value={form.question} onChange={set("question")} maxLength={1000} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="r-answer" className="mb-1 block text-sm font-medium text-slate-700">Final answer *</label>
        <textarea id="r-answer" rows={5} value={form.finalAnswer} onChange={set("finalAnswer")} maxLength={5000} className={textareaClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="r-more" className="mb-1 block text-sm font-medium text-slate-700">More explanation</label>
        <textarea id="r-more" rows={2} value={form.explanation} onChange={set("explanation")} maxLength={5000} className={textareaClass} />
      </div>
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="button" onClick={async () => { await assistantApi.saveReview(review.id, form); onDone("Saved. Still waiting for approval."); }} className={linkButton}>Save without approving</button>
        <button type="button" onClick={() => setRejecting(true)} className="text-sm font-medium text-red-600 hover:text-red-800">Reject…</button>
      </div>
    </FormModal>
  );
}

export default function ReviewPage() {
  const { can, isReady } = useMe();
  const [status, setStatus] = useState("PENDING");
  const load = useCallback(() => assistantApi.reviews(status), [status]);
  const { data, error, isLoading, reload } = useData(load);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState("");
  const reviews = data || [];

  if (!isReady) return null;
  if (!can("voice-ai.review_knowledge")) return <NoAccess />;

  return (
    <SystemShell title="Knowledge Review" crumbs={CRUMBS} subtitle="Answers from responsible persons wait here. Edit, approve or reject — only approved answers are ever used by the assistant.">
      <SectionTabs can={can} />
      <ErrorBanner message={error} />
      <Notice text={notice} />
      <select aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)} className={filterClass}>
        <option value="PENDING">Waiting for review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="ALL">All</option>
      </select>
      <div className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Question", "Received answer", "From", "Status", "When", ""]} isLoading={isLoading} hasRows={reviews.length > 0}
          emptyMessage={status === "PENDING" ? "Nothing to review. Answers appear here when a responsible person replies." : "None."}>
          {reviews.map((review) => (
            <tr key={review.id} className="border-b border-slate-100 align-top">
              <td className="max-w-xs px-4 py-3 font-medium text-slate-800">{review.question}</td>
              <td className="max-w-sm px-4 py-3 text-slate-700">
                <span className="line-clamp-3 whitespace-pre-line">{review.status === "APPROVED" ? review.finalAnswer : review.receivedAnswer}</span>
                {review.reviewNote && <span className="mt-1 block text-xs text-slate-500">Note: {review.reviewNote}</span>}
              </td>
              <td className="px-4 py-3 text-slate-600">{review.answeredBy || "—"}<span className="block text-xs text-slate-500">{review.contactName}</span></td>
              <td className="px-4 py-3"><Pill tone={REVIEW_STATUS[review.status]?.[1]}>{REVIEW_STATUS[review.status]?.[0] || review.status}</Pill>{review.aiDraft && review.status === "PENDING" && <span className="mt-1 block text-xs text-blue-700">AI draft ready</span>}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(review.reviewedAt || review.createdAt)}<span className="block text-xs">{review.reviewedBy}</span></td>
              <td className="px-4 py-3">{review.status === "PENDING" && <button onClick={() => setOpen(review)} className={linkButton}>Review</button>}</td>
            </tr>
          ))}
        </DataTable>
      </div>
      {open && <ReviewForm review={open} onClose={() => setOpen(null)} onDone={(text) => { setOpen(null); setNotice(text); reload(); }} />}
    </SystemShell>
  );
}
