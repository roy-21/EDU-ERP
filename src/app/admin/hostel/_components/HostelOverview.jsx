"use client";

import Link from "next/link";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { formatDateTime, useHostelData } from "./hostelUi";

const STATS = [
  {
    title: "Total Rooms",
    value: (summary) => summary.rooms,
    description: "Across all hostel buildings",
    color: "text-blue-600",
  },
  {
    title: "Total Seats",
    value: (summary) => summary.seats,
    description: "Hostel capacity",
    color: "text-indigo-600",
  },
  {
    title: "Occupied Seats",
    value: (summary) => summary.occupied,
    description: "Currently assigned",
    color: "text-green-600",
  },
  {
    title: "Pending Applications",
    value: (summary) => summary.pendingApplications,
    description: "Waiting for allocation",
    color: "text-orange-600",
  },
];

export function HostelStats() {
  const { data: summary, error } = useHostelData(hostelService.getSummary);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">{stat.title}</p>
            <p className={`mt-2 text-3xl font-bold ${stat.color}`}>
              {summary ? stat.value(summary) : "—"}
            </p>
            <p className="mt-2 text-xs text-slate-400">{stat.description}</p>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const loadRecent = () => hostelService.getAudit(5);

function RecentActivityList() {
  const { data, error, isLoading } = useHostelData(loadRecent);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-800">Recent Activities</h2>
          <p className="mt-1 text-sm text-slate-500">Latest hostel management changes.</p>
        </div>
        <Link href="/admin/hostel/audit" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          View all
        </Link>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {data?.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}

      <div className="divide-y divide-slate-100">
        {data?.map((row) => (
          <div key={row.id} className="flex flex-col justify-between gap-1 py-3 sm:flex-row sm:items-center sm:gap-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{row.summary}</p>
              <p className="mt-1 text-xs text-slate-500">
                {row.actorEmail || "System"} · {formatDateTime(row.createdAt)}
              </p>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {row.action}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RecentActivity() {
  const { has } = useHostelPermissions();
  return has("manage_rooms", "manage_allocations", "configure_rent", "manage_payments") ? (
    <RecentActivityList />
  ) : null;
}
