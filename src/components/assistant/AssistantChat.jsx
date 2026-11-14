"use client";

import { useCallback, useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { friendlyError, formatDateTime, useData } from "@/components/erp/ui";

// Asking the institution's assistant. Used in the admin panel and in the student/guardian
// portal. Each person only ever sees their own questions.

const STATUS = {
  ANSWERED: { label: "Answered", tone: "bg-green-100 text-green-800" },
  ANSWERED_LATER: { label: "Answered by staff", tone: "bg-green-100 text-green-800" },
  ESCALATED: { label: "Forwarded", tone: "bg-amber-100 text-amber-800" },
  NO_DATA: { label: "No data", tone: "bg-slate-100 text-slate-700" },
  REFUSED: { label: "Not allowed", tone: "bg-red-100 text-red-800" },
};

const SOURCE = { DOCUMENT: "From a document", KNOWLEDGE: "From an approved answer", ERP: "From your live records", HUMAN: "Reviewed staff answer" };

const EXAMPLES = ["How many meals have I had today?", "What is today's meal menu?", "What is my attendance percentage?", "How much payment is pending?"];

export function AnswerStatus({ status }) {
  const item = STATUS[status] || { label: status, tone: "bg-slate-100 text-slate-700" };
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${item.tone}`}>{item.label}</span>;
}

function Answer({ item, onRate }) {
  const canRate = ["ANSWERED", "ANSWERED_LATER", "NO_DATA"].includes(item.status);
  return (
    <div className="space-y-2">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white">{item.question}</div>
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <AnswerStatus status={item.status} />
          {SOURCE[item.answerSource] && <span className="text-xs text-slate-500">{SOURCE[item.answerSource]}</span>}
          <span className="text-xs text-slate-400">{formatDateTime(item.answeredAt || item.createdAt)}</span>
        </div>
        <p className="whitespace-pre-line leading-relaxed">{item.answer}</p>
        {item.sources?.filter((source) => source.kind === "DOCUMENT").length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Source: {item.sources.filter((source) => source.kind === "DOCUMENT").map((source) => source.title).join(", ")}</p>
        )}
        {canRate && (
          <div className="mt-2 flex items-center gap-3 text-xs">
            {item.feedback ? (
              <span className="text-slate-500">Thanks — you said this was {item.feedback === "HELPFUL" ? "helpful" : "not helpful"}.</span>
            ) : (
              <>
                <span className="text-slate-500">Was this right?</span>
                <button onClick={() => onRate(item, "HELPFUL")} className="font-medium text-green-700 hover:text-green-900">Yes</button>
                <button onClick={() => onRate(item, "NOT_HELPFUL")} className="font-medium text-red-600 hover:text-red-800">No</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AssistantChat({ compact = false }) {
  const { data, error, isLoading, reload } = useData(assistantApi.myQuestions);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const history = [...(data || [])].reverse();

  const submit = useCallback(async (event) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text || isAsking) return;
    setIsAsking(true);
    setAskError("");
    try {
      await assistantApi.ask(text);
      setQuestion("");
      reload();
    } catch (err) {
      setAskError(friendlyError(err));
    } finally {
      setIsAsking(false);
    }
  }, [question, isAsking, reload]);

  const rate = useCallback(async (item, value) => {
    try {
      await assistantApi.feedback(item.id, value);
      reload();
    } catch (err) {
      setAskError(friendlyError(err));
    }
  }, [reload]);

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-slate-50">
      <div className={`space-y-4 overflow-y-auto p-4 ${compact ? "max-h-96" : "max-h-[60vh] min-h-64"}`} aria-live="polite">
        {isLoading && <p className="text-sm text-slate-500">Loading your questions…</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!isLoading && !error && history.length === 0 && (
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-800">Ask anything about the institution, or about your own records.</p>
            <p className="mt-1">Answers come only from documents and answers the institution has approved, or from your own live records. If the assistant does not know, it forwards your question to the right person.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => setQuestion(example)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-blue-400">{example}</button>
              ))}
            </div>
          </div>
        )}
        {history.map((item) => <Answer key={item.id} item={item} onRate={rate} />)}
        {isAsking && <p className="text-sm text-slate-500">Finding an answer…</p>}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 bg-white p-3">
        <label htmlFor="assistant-question" className="sr-only">Your question</label>
        <input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000}
          placeholder="Type your question in English or Bangla…" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
        <button type="submit" disabled={isAsking || !question.trim()} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {isAsking ? "Asking…" : "Ask"}
        </button>
      </form>
      {askError && <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{askError}</p>}
    </section>
  );
}
