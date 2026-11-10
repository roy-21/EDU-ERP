"use client";

import Link from "next/link";
import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  Pager,
  StatGrid,
  StatusBadge,
  filterClass,
  formatDateTime,
  linkButton,
  useHostelAction,
  useHostelData,
  usePagination,
} from "./hostelUi";

const STATUSES = ["Pending", "Sent", "Delivered", "Failed", "Skipped"];
const CHANNELS = ["IN_APP", "EMAIL", "SMS"];

const loadNotifications = () => hostelService.getNotifications();

export default function NotificationLog() {
  const { has } = useHostelPermissions();
  const { data, error: loadError, isLoading, reload } = useHostelData(loadNotifications);
  const { error: actionError, clearError, run } = useHostelAction(reload);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [channelFilter, setChannelFilter] = useState("All");

  const rows = data || [];
  const countOf = (status) => rows.filter((row) => row.status === status).length;

  const stats = [
    { label: "Latest Messages", value: rows.length },
    { label: "Sent", value: countOf("Sent") + countOf("Delivered"), color: "text-green-600" },
    { label: "Pending", value: countOf("Pending"), color: "text-yellow-600" },
    { label: "Failed", value: countOf("Failed"), color: "text-red-600" },
    { label: "Skipped", value: countOf("Skipped"), color: "text-slate-600" },
  ];

  const query = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      [row.studentName, row.studentId, row.recipient, row.subject].join(" ").toLowerCase().includes(query) &&
      (statusFilter === "All" || row.status === statusFilter) &&
      (channelFilter === "All" || row.channel === channelFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered, 15);

  return (
    <PageShell
      title="Rent Notifications"
      subtitle="Every rent message and what happened to it. Sent means the provider accepted it."
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      <ErrorBanner message={actionError} onDismiss={clearError} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            aria-label="Search notifications"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by student, recipient, subject..."
            className={`w-full md:max-w-md ${filterClass}`}
          />
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterClass}>
            <option value="All">All Status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select aria-label="Filter by channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className={filterClass}>
            <option value="All">All Channels</option>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          columns={["When", "Student", "Type", "Channel", "To", "Message", "Status", "Action"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={rows.length === 0 ? "No notifications yet." : "No notifications match your search."}
          minWidth="min-w-[1080px]"
        >
          {pageItems.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 align-top">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
              <td className="px-4 py-3">
                {row.allocationId ? (
                  <Link href={`/admin/hostel/ledger/${row.allocationId}`} className={linkButton}>
                    {row.studentName}
                  </Link>
                ) : (
                  row.studentName
                )}
                <p className="text-xs text-slate-500">{row.studentId}</p>
              </td>
              <td className="px-4 py-3 text-slate-600">{row.scenario}</td>
              <td className="px-4 py-3 text-slate-600">{row.channel}</td>
              <td className="px-4 py-3 text-slate-600">{row.recipient || "—"}</td>
              <td className="max-w-xs px-4 py-3 text-xs text-slate-600">{row.body}</td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
                {row.lastError && <p className="mt-1 text-xs text-slate-500">{row.lastError}</p>}
              </td>
              <td className="px-4 py-3">
                {has("send_reminders") && ["Failed", "Skipped"].includes(row.status) && row.recipient && (
                  <button
                    onClick={() => run(() => hostelService.retryNotification(row.id))}
                    aria-label={`Retry message to ${row.recipient}`}
                    className={linkButton}
                  >
                    Retry
                  </button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>
    </PageShell>
  );
}
