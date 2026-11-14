"use client";

import { useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import AssistantChat from "@/components/assistant/AssistantChat";
import VoiceCall from "@/components/assistant/VoiceCall";
import { FormModal, SystemShell, formatDateTime, linkButton, useData } from "@/components/erp/ui";
import { CRUMBS, Notice, SectionTabs, textareaClass } from "../_components/assistantUi";

// Asking, plus any questions the assistant forwarded to the signed-in person to answer.
function ForwardedToMe() {
  const { data, reload } = useData(assistantApi.assigned);
  const [answering, setAnswering] = useState(null);
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const items = data || [];
  if (items.length === 0 && !notice) return null;

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-bold text-amber-900">Questions forwarded to you ({items.length})</h2>
      <Notice text={notice} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 rounded-lg bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span><span className="font-medium text-slate-800">{item.question}</span><span className="block text-xs text-slate-500">Asked by {item.askerName || "a user"} · {formatDateTime(item.askedAt)}</span></span>
            <button onClick={() => { setAnswering(item); setAnswer(""); setError(""); }} className={linkButton}>Answer</button>
          </li>
        ))}
      </ul>
      {answering && (
        <FormModal title="Answer the question" submitLabel="Send answer" submitDisabled={!answer.trim()} onClose={() => setAnswering(null)}
          onSubmit={async () => {
            await assistantApi.answerAssigned(answering.id, answer);
            setAnswering(null);
            setNotice("Thank you. An admin reviews your answer before the assistant uses it.");
            reload();
          }}>
          <p className="text-sm text-slate-700 sm:col-span-2"><span className="font-medium">Question:</span> {answering.question}</p>
          <div className="sm:col-span-2">
            <label htmlFor="assigned-answer" className="mb-1 block text-sm font-medium text-slate-700">Your answer</label>
            <textarea id="assigned-answer" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} className={textareaClass} maxLength={5000} />
          </div>
        </FormModal>
      )}
    </section>
  );
}

export default function AskPage() {
  const { can, isReady } = useMe();
  if (!isReady) return null;
  return (
    <SystemShell title="Ask the Assistant" crumbs={CRUMBS} subtitle="Answers come from approved documents and answers, or from your own live records. Nothing you ask here can change a record.">
      <SectionTabs can={can} />
      <ForwardedToMe />
      <h2 className="font-bold text-slate-800">Talk</h2>
      <VoiceCall />
      <h2 className="font-bold text-slate-800">Type</h2>
      <AssistantChat />
      <p className="text-xs text-slate-500">If the assistant does not know, it forwards your question to the responsible person and shows you the reviewed answer here.</p>
    </SystemShell>
  );
}
