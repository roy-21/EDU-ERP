"use client";

import { useCallback } from "react";
import Link from "next/link";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import AssistantChat from "@/components/assistant/AssistantChat";
import { ErrorBanner, SystemShell, useData } from "@/components/erp/ui";
import { Pill } from "./assistant/_components/assistantUi";

// The main page of module 32, AI Voice & Message Assistant. The message assistant is live;
// the voice-call sections are previews until a telephony provider is connected.

function Card({ href, icon, title, text, count, countTone = "blue" }) {
  return (
    <Link href={href} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        {count !== undefined && count !== null && <Pill tone={countTone}>{count}</Pill>}
      </div>
      <p className="mt-3 font-semibold text-slate-800 group-hover:text-blue-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
      <span className="mt-3 inline-block text-sm font-medium text-blue-600">Open →</span>
    </Link>
  );
}

const VOICE_PREVIEWS = [
  { href: "/admin/voice-ai/channels", icon: "📞", title: "Dual-Channel Call Support", text: "Phone number (SIP / Twilio / Vonage) and website voice widget." },
  { href: "/admin/voice-ai/engine", icon: "🗣️", title: "Voice Conversation Engine", text: "Speech-to-text, natural voice replies and voice settings." },
  { href: "/admin/voice-ai/objection-detect", icon: "🚨", title: "Call Complaint Detection", text: "Detect complaints in calls and raise tickets." },
  { href: "/admin/voice-ai/routing", icon: "🔀", title: "Call Routing & Callbacks", text: "Transfer a caller to a person or schedule a callback." },
];

export default function VoiceAiHomePage() {
  const { can, isReady } = useMe();
  const canKnowledge = can("voice-ai.manage_knowledge", "voice-ai.review_knowledge");
  const canReview = can("voice-ai.review_knowledge");
  const canEscalate = can("voice-ai.manage_escalations");
  const canAnalytics = can("voice-ai.view_analytics");
  const isManager = canKnowledge || canEscalate || canAnalytics;

  const load = useCallback(async () => {
    if (!canAnalytics) return null;
    const [stats, status] = await Promise.all([assistantApi.analytics(), assistantApi.status()]);
    return { stats, status };
  }, [canAnalytics]);
  const { data, error } = useData(load);
  const stats = data?.stats;
  const ai = data?.status?.ai;

  if (!isReady) return null;

  return (
    <SystemShell title="AI Voice & Message Assistant"
      subtitle="Answers questions from your own documents and live ERP records, forwards what it cannot answer to the right person, and learns only what an admin approves. It can never change a record.">
      <ErrorBanner message={error} />

      {stats && (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ["Questions asked", stats.questions.total, ""],
            ["Answered automatically", stats.questions.automaticRate === null ? "—" : `${stats.questions.automaticRate}%`, "text-green-700"],
            ["Waiting for an answer", stats.escalations.pending + stats.escalations.waiting_admin, stats.escalations.pending + stats.escalations.waiting_admin ? "text-amber-700" : ""],
            ["Waiting for review", stats.reviews.pending, stats.reviews.pending ? "text-amber-700" : ""],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-sm text-slate-500">{label}</p>
              <p className={`mt-2 text-2xl font-bold ${color || "text-slate-800"}`}>{value}</p>
            </div>
          ))}
        </section>
      )}

      {ai && (!ai.reachable || !ai.llm) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {!ai.reachable
            ? "The voice & message assistant service (voice-api) is not reachable, so PDF and Word files cannot be read and AI-written answers are off. Text files, approved answers and live ERP answers still work."
            : `The language model is off, so the assistant quotes approved answers and document sentences word for word instead of writing its own answers. ${ai.llmProblem || ""}`}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-slate-800">Message & Website Voice Assistant</h2>
          <Pill tone="green">Live</Pill>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card href="/admin/voice-ai/assistant/ask" icon="💬" title="Ask or Talk" text="Type, or talk with the microphone, in English or Bangla. Questions forwarded to you show up here too." />
          {canAnalytics && <Card href="/admin/voice-ai/assistant" icon="📊" title="Analytics" text="Every question asked, answer rates, feedback and what is connected." count={stats?.questions.total} />}
          {canKnowledge && <Card href="/admin/voice-ai/assistant/knowledge" icon="📚" title="Knowledge Base" text="Upload PDF, Word and text documents. See approved answers." count={stats ? `${stats.documents.ready} docs` : undefined} />}
          {canReview && <Card href="/admin/voice-ai/assistant/review" icon="✅" title="Knowledge Review" text="Check answers from responsible persons before the assistant learns them." count={stats?.reviews.pending} countTone={stats?.reviews.pending ? "amber" : "blue"} />}
          {canEscalate && <Card href="/admin/voice-ai/assistant/escalations" icon="📨" title="Forwarded Questions" text="Questions sent to people by SMS, email or their panel, and whether they arrived." count={stats ? stats.escalations.pending + stats.escalations.waiting_admin : undefined} countTone={stats?.escalations.waiting_admin ? "red" : "blue"} />}
          {canAnalytics && <Card href="/admin/voice-ai/assistant/calls" icon="🎧" title="Voice Calls" text="Every website voice call with what the caller said and what the assistant answered." />}
          {canEscalate && <Card href="/admin/voice-ai/assistant/setup" icon="👤" title="Responsible Persons" text="Who answers which topics, how to reach them, time zone and strictness." />}
        </div>
      </section>

      {!isManager && (
        <section className="space-y-2">
          <h2 className="font-bold text-slate-800">Ask now</h2>
          <AssistantChat compact />
        </section>
      )}

      {isManager && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-800">Phone Calls</h2>
            <Pill tone="amber">Preview</Pill>
          </div>
          <p className="text-sm text-slate-500">These pages show sample data. Calls to a phone number need a telephony provider (SIP, Twilio or similar) connected to the voice service; website voice calls above already work.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {VOICE_PREVIEWS.map((item) => <Card key={item.href} {...item} />)}
          </div>
        </section>
      )}
    </SystemShell>
  );
}
