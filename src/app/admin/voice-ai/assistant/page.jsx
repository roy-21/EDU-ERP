"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import AssistantChat, { AnswerStatus } from "@/components/assistant/AssistantChat";
import { DataTable, ErrorBanner, StatGrid, SystemShell, filterClass, formatDateTime, useData } from "@/components/erp/ui";
import { CRUMBS, Pill, SectionTabs } from "./_components/assistantUi";

function ProviderStatus({ status }) {
  if (!status) return null;
  const { ai, delivery } = status;
  const items = [
    ["Voice & Message service", ai.reachable, ai.reachable ? "Connected (voice-api)" : "Not reachable — PDF/Word reading and AI answers are off"],
    ["Language model", ai.llm, ai.llm ? `${ai.provider === "ollama" ? "Own model on your server" : "Claude"} (${ai.model})` : `Off — answers are quoted from approved text only. ${ai.llmProblem || ""}`],
    ["Meaning search", ai.embeddings, ai.embeddings ? `${ai.embeddingProvider === "ollama" ? "Own model" : "Voyage"} (${ai.embeddingModel})` : "Off — search uses words only"],
    ["SMS", delivery.sms, delivery.sms ? "Set up" : "Not set up"],
    ["Email", delivery.email, delivery.email ? `Set up (${delivery.emailMode})` : "Not set up"],
    ["Call forwarding", delivery.call, delivery.call ? "Set up" : "Needs a telephony provider"],
  ];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-bold text-slate-800">What is connected</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, isOn, text]) => (
          <li key={label} className="flex items-start gap-2 text-sm">
            <Pill tone={isOn ? "green" : "amber"}>{isOn ? "On" : "Off"}</Pill>
            <span><span className="font-medium text-slate-800">{label}:</span> <span className="text-slate-600">{text}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND = { KNOWLEDGE: "Knowledge", LIVE_DATA: "Live data", ACTION: "Change request" };

export default function AssistantOverviewPage() {
  const { can, isReady } = useMe();
  const canAnalytics = can("voice-ai.view_analytics");
  const [filters, setFilters] = useState({ status: "", kind: "", search: "" });
  const loadOverview = useCallback(() => (canAnalytics ? Promise.all([assistantApi.analytics(), assistantApi.status()]) : Promise.resolve(null)), [canAnalytics]);
  const loadQuestions = useCallback(() => (canAnalytics ? assistantApi.questions(filters) : Promise.resolve([])), [canAnalytics, filters]);
  const overview = useData(loadOverview);
  const questions = useData(loadQuestions);

  if (!isReady) return null;
  // People who only ask get the chat here.
  if (!canAnalytics) {
    return (
      <SystemShell title="Ask the Assistant" crumbs={CRUMBS} subtitle="Ask about the institution or your own records.">
        <SectionTabs can={can} />
        <AssistantChat />
      </SystemShell>
    );
  }
  const [stats, status] = overview.data || [];
  const q = stats?.questions;
  const cards = stats ? [
    { label: "Questions asked", value: q.total },
    { label: "Answered automatically", value: `${q.answeredFromKnowledge + q.answeredFromErp}${q.automaticRate !== null ? ` (${q.automaticRate}%)` : ""}`, color: "text-green-700" },
    { label: "From live ERP data", value: q.answeredFromErp },
    { label: "Unresolved", value: q.unresolved, color: q.unresolved ? "text-amber-700" : undefined },
    { label: "Forwarded to people", value: stats.escalations.total },
    { label: "Waiting for review", value: stats.reviews.pending, color: stats.reviews.pending ? "text-amber-700" : undefined },
    { label: "Approved answers", value: stats.knowledge.active },
    { label: "Answer accuracy (feedback)", value: stats.feedback.accuracy === null ? "No ratings yet" : `${stats.feedback.accuracy}%` },
    { label: "Change requests refused", value: q.refused },
    { label: "Documents ready", value: `${stats.documents.ready} / ${stats.documents.total}` },
  ] : [];

  return (
    <SystemShell title="Assistant Analytics" crumbs={CRUMBS} subtitle="Answers from your approved documents and live ERP records. Unknown questions go to a person, and nothing is learnt without an admin's approval.">
      <SectionTabs can={can} />
      <ErrorBanner message={overview.error} />
      <ProviderStatus status={status} />
      <StatGrid stats={cards} isLoading={overview.isLoading} />

      {stats && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-bold text-slate-800">Forwarded questions</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Waiting for an answer</dt><dd className="font-medium">{stats.escalations.pending}</dd>
              <dt className="text-slate-500">Needs an admin</dt><dd className="font-medium">{stats.escalations.waiting_admin}</dd>
              <dt className="text-slate-500">Answered</dt><dd className="font-medium">{stats.escalations.answered}</dd>
              <dt className="text-slate-500">SMS sent</dt><dd className="font-medium">{stats.escalations.sms_sent}</dd>
              <dt className="text-slate-500">Emails sent</dt><dd className="font-medium">{stats.escalations.email_sent}</dd>
              <dt className="text-slate-500">Delivery failures</dt><dd className="font-medium">{stats.escalations.delivery_failed}</dd>
            </dl>
            <Link href="/admin/voice-ai/assistant/escalations" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-800">Open forwarded questions →</Link>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-bold text-slate-800">Most used knowledge</h2>
            {stats.topSources.length === 0 ? <p className="text-sm text-slate-500">No answers from documents or approved answers yet.</p> : (
              <ul className="space-y-1 text-sm">
                {stats.topSources.map((source) => (
                  <li key={`${source.kind}-${source.id}`} className="flex justify-between gap-3"><span className="truncate">{source.title}</span><span className="text-slate-500">{source.uses} answers</span></li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">{stats.documents.chunks} searchable passages from documents{stats.documents.embedded ? `, ${stats.documents.embedded} with embeddings` : ""}.</p>
          </section>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-bold text-slate-800">All questions</h2>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Search questions" placeholder="Search questions" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className={filterClass} />
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
            <option value="">Any result</option><option value="ANSWERED">Answered</option><option value="ESCALATED">Forwarded</option>
            <option value="ANSWERED_LATER">Answered by staff</option><option value="NO_DATA">No data</option><option value="REFUSED">Refused</option>
          </select>
          <select aria-label="Kind" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })} className={filterClass}>
            <option value="">Any kind</option><option value="KNOWLEDGE">Knowledge</option><option value="LIVE_DATA">Live data</option><option value="ACTION">Change request</option>
          </select>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-1">
          <DataTable columns={["Question", "Asked by", "Kind", "Result", "Answer", "Feedback", "When"]} isLoading={questions.isLoading} hasRows={(questions.data || []).length > 0}
            loadError={questions.error} onRetry={questions.reload} emptyMessage="No questions yet.">
            {(questions.data || []).map((item) => (
              <tr key={item.id} className="border-b border-slate-100 align-top">
                <td className="max-w-xs px-4 py-3 font-medium text-slate-800">{item.question}</td>
                <td className="px-4 py-3 text-slate-600">{item.askerName}<span className="block text-xs text-slate-400">{item.askerRole}</span></td>
                <td className="px-4 py-3">{KIND[item.kind] || item.kind}</td>
                <td className="px-4 py-3"><AnswerStatus status={item.status} /></td>
                <td className="max-w-sm px-4 py-3 text-slate-600"><span className="line-clamp-3 whitespace-pre-line">{item.answer}</span></td>
                <td className="px-4 py-3">{item.feedback === "HELPFUL" ? "👍" : item.feedback === "NOT_HELPFUL" ? "👎" : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>
    </SystemShell>
  );
}
