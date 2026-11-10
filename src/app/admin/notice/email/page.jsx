"use client";

import { useCallback, useState } from "react";
import { noticesApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, formatDateTime, friendlyError, primaryButton, useData } from "@/components/erp/ui";
import { AUDIENCES, liveState } from "../_components/NoticeList";

const audienceName = (value) => AUDIENCES.find(([key]) => key === value)?.[1] || value;

// Emails a published notice to the active accounts in its audience.
export default function NoticeEmailPage() {
  const { can, isReady } = useMe();
  const load = useCallback(() => noticesApi.list({ status: "PUBLISHED" }), []);
  const { data, error, isLoading, reload } = useData(load);
  const [sending, setSending] = useState("");
  const [result, setResult] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("notice.create", "notice.update", "notice.approve")) return <NoAccess />;

  const send = async (notice) => {
    if (!window.confirm(`Email "${notice.title}" to every active ${audienceName(notice.audience).toLowerCase()} account with an email address?`)) return;
    setSending(notice.id);
    setActionError("");
    setResult("");
    try {
      const outcome = await noticesApi.email(notice.id);
      setResult(`The mail server accepted ${outcome.sent} emails${outcome.failed ? `; ${outcome.failed} failed (${outcome.failedAddresses.join(", ")})` : ""}. Accepted does not prove the email reached the inbox.`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setSending("");
    }
  };

  return (
    <SystemShell title="Email Notices" subtitle="Send a published notice to its audience by email. Recipients are user accounts in that audience that have an email address."
      crumbs={[{ href: "/admin/notice", label: "Notice Board" }]}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {result && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Notice", "Audience", "Showing", "Last emailed", ""]} isLoading={isLoading} hasRows={(data || []).length > 0} emptyMessage="No published notices. Publish one on the Notices page first.">
          {(data || []).map((notice) => (
            <tr key={notice.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{notice.title}</td>
              <td className="px-4 py-3">{audienceName(notice.audience)}</td>
              <td className="px-4 py-3">{liveState(notice)}</td>
              <td className="px-4 py-3 text-xs">{notice.emailedAt ? `${formatDateTime(notice.emailedAt)} · ${notice.emailedCount} accepted in total` : "Never"}</td>
              <td className="px-4 py-3">{can("notice.approve") && <button onClick={() => send(notice)} disabled={Boolean(sending)} className={`${primaryButton} disabled:opacity-50`}>{sending === notice.id ? "Sending..." : "Send Email"}</button>}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </SystemShell>
  );
}
