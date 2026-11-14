"use client";

import { useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, ViewModal, formatDateTime, friendlyError, linkButton, useData } from "@/components/erp/ui";
import { CRUMBS, Pill, SectionTabs } from "../_components/assistantUi";

// Website voice calls with their transcripts. The voice service saves each turn as it
// happens; recordings themselves are not kept.
const seconds = (ms) => `${Math.round((ms || 0) / 100) / 10}s`;

export default function VoiceCallsPage() {
  const { can, isReady } = useMe();
  const { data, error, isLoading } = useData(assistantApi.calls);
  const [open, setOpen] = useState(null);
  const [openError, setOpenError] = useState("");
  const calls = data || [];

  if (!isReady) return null;
  if (!can("voice-ai.view_analytics")) return <NoAccess />;

  const show = async (call) => {
    setOpenError("");
    try {
      setOpen(await assistantApi.callTranscript(call.id));
    } catch (err) {
      setOpenError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Voice Calls" crumbs={CRUMBS} subtitle="Every website voice call: what the caller said and what the assistant answered. Audio recordings are not kept.">
      <SectionTabs can={can} />
      <ErrorBanner message={error || openError} />
      <div className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Caller", "Started", "Turns", "Language", "Status", ""]} isLoading={isLoading} hasRows={calls.length > 0}
          emptyMessage="No voice calls yet. Calls appear here when someone talks to the assistant from Ask or the portal.">
          {calls.map((call) => (
            <tr key={call.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{call.userName || call.userId}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(call.startedAt)}</td>
              <td className="px-4 py-3">{call.turns}</td>
              <td className="px-4 py-3">{call.language === "bn" ? "বাংলা" : call.language === "en" ? "English" : "—"}</td>
              <td className="px-4 py-3">{call.status === "ACTIVE" ? <Pill tone="green">Active</Pill> : <Pill>Ended</Pill>}</td>
              <td className="px-4 py-3"><button onClick={() => show(call)} className={linkButton}>Transcript</button></td>
            </tr>
          ))}
        </DataTable>
      </div>
      {open && (
        <ViewModal title={`Call with ${open.userName || "caller"} — ${formatDateTime(open.startedAt)}`} onClose={() => setOpen(null)}>
          {open.transcript.length === 0 && <p className="text-sm text-slate-500">Nothing was said in this call.</p>}
          <div className="space-y-2">
            {open.transcript.map((turn) => (
              <div key={turn.id} className={`rounded-lg p-3 text-sm ${turn.speaker === "CALLER" ? "bg-blue-50 text-slate-800" : "bg-slate-50 text-slate-700"}`}>
                <p className="mb-1 text-xs font-medium text-slate-500">
                  {turn.speaker === "CALLER" ? "Caller" : "Assistant"} · {formatDateTime(turn.createdAt)} · audio {seconds(turn.audioMs)} · processed in {seconds(turn.processingMs)}
                </p>
                <p className="whitespace-pre-line">{turn.text}</p>
              </div>
            ))}
          </div>
        </ViewModal>
      )}
    </SystemShell>
  );
}
