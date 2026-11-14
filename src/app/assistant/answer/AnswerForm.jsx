"use client";

import { useCallback, useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { friendlyError, formatDateTime, useData } from "@/components/erp/ui";

// The responsible person's page. No sign-in: the private link is the permission, and it
// works once. Their answer is reviewed by an admin before the assistant uses it.
export default function AnswerForm({ token }) {
  const load = useCallback(() => assistantApi.publicView(token), [token]);
  const { data, error, isLoading } = useData(load);
  const [answer, setAnswer] = useState("");
  const [name, setName] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setIsSending(true);
    setSendError("");
    try {
      await assistantApi.publicAnswer(token, { answer, name });
      setSent(true);
    } catch (err) {
      setSendError(friendlyError(err));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm">
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {sent && (
          <div role="status" className="space-y-2">
            <h1 className="text-xl font-bold text-slate-800">Thank you</h1>
            <p className="text-sm text-slate-600">Your answer was received. An admin reviews it before the assistant uses it, and then the person who asked gets the answer.</p>
          </div>
        )}
        {data && !sent && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <p className="text-sm font-medium text-blue-700">{data.institution}</p>
              <h1 className="mt-1 text-xl font-bold text-slate-800">A question needs your answer</h1>
              <p className="mt-1 text-sm text-slate-500">The assistant could not answer this from the institution&apos;s approved knowledge{data.contactName ? `, so it was sent to you, ${data.contactName}` : ""}.</p>
            </div>
            <blockquote className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4 text-slate-800">
              {data.question}
              <span className="mt-1 block text-xs text-slate-500">Asked {formatDateTime(data.askedAt)}</span>
            </blockquote>
            <div>
              <label htmlFor="answer" className="mb-1 block text-sm font-medium text-slate-700">Your answer *</label>
              <textarea id="answer" rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={5000} required
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">Your name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder={data.contactName}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
            {sendError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sendError}</p>}
            <button type="submit" disabled={isSending || !answer.trim()} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {isSending ? "Sending…" : "Send answer"}
            </button>
            <p className="text-xs text-slate-500">This link works once. Do not forward it.</p>
          </form>
        )}
      </div>
    </main>
  );
}
