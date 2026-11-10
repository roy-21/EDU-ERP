"use client";

import Link from "next/link";
import { useCallback } from "react";
import { noticesApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { ErrorBanner, StatGrid, SystemShell, useData } from "@/components/erp/ui";
import { liveState } from "./_components/NoticeList";

const PAGES = [
  { href: "/admin/notice/announcements", title: "Notice Board", text: "What is showing for you now.", any: true },
  { href: "/admin/notice/notices", title: "Notices", text: "Write, publish and archive notices." },
  { href: "/admin/notice/popup", title: "Pop-up Notices", text: "Shown once when the portal opens." },
  { href: "/admin/notice/email", title: "Email", text: "Send a published notice by email." },
  { href: "/admin/notice/sms", title: "SMS", text: "Not connected yet." },
  { href: "/admin/notice/push-notification", title: "Push", text: "Not connected yet." },
];

export default function NoticeHub() {
  const { can } = useMe();
  const writer = can("notice.create", "notice.update", "notice.approve", "notice.delete");
  const load = useCallback(() => (writer ? noticesApi.list() : Promise.resolve(null)), [writer]);
  const { data, error, isLoading } = useData(load);
  const rows = data || [];
  const count = (state) => rows.filter((row) => liveState(row) === state).length;

  return (
    <SystemShell title="Notice Board" subtitle="Notices for students, guardians, teachers and staff.">
      <ErrorBanner message={error} />
      {writer && (
        <StatGrid isLoading={isLoading} stats={[
          { label: "Showing now", value: count("Showing"), color: "text-green-700" },
          { label: "Scheduled", value: count("Scheduled") },
          { label: "Drafts", value: count("Draft") },
          { label: "Expired", value: count("Expired") },
          { label: "Archived", value: count("Archived") },
        ]} />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PAGES.filter((page) => page.any || writer).map((page) => (
          <Link key={page.href} href={page.href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
            <p className="font-semibold text-slate-800">{page.title}</p>
            <p className="mt-1 text-sm text-slate-500">{page.text}</p>
          </Link>
        ))}
      </div>
    </SystemShell>
  );
}
