"use client";

import { useState } from "react";
import { noticesApi } from "@/lib/operationsApi";
import { label } from "@/components/erp/QuickForm";
import { ErrorBanner, SystemShell, formatDateTime, useData } from "@/components/erp/ui";
import { NoticeView } from "../_components/NoticeList";

const loadFeed = () => noticesApi.feed();

// What the signed-in person sees now: published notices for their audience, within their dates.
export default function NoticeBoardPage() {
  const { data, error, isLoading } = useData(loadFeed);
  const [viewing, setViewing] = useState(null);
  const rows = data || [];

  return (
    <SystemShell title="Notice Board" subtitle="Notices meant for you that are showing now." crumbs={[{ href: "/admin/notice", label: "Notice Board" }]}>
      <ErrorBanner message={error} />
      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {!isLoading && rows.length === 0 && !error && <p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600">No notices right now.</p>}
      <div className="space-y-3">
        {rows.map((notice) => (
          <button key={notice.id} onClick={() => setViewing(notice)} className={`block w-full rounded-xl border bg-white p-4 text-left hover:border-blue-300 ${notice.category === "URGENT" ? "border-red-300" : "border-slate-200"}`}>
            <p className="font-semibold text-slate-800">{notice.isPinned ? "📌 " : ""}{notice.title}</p>
            <p className="mt-1 text-xs text-slate-500">{label(notice.category)} · {formatDateTime(notice.publishAt || notice.publishedAt)}</p>
            <p className="mt-2 line-clamp-2 text-sm text-slate-600">{notice.body}</p>
          </button>
        ))}
      </div>
      {viewing && <NoticeView notice={viewing} onClose={() => setViewing(null)} />}
    </SystemShell>
  );
}
