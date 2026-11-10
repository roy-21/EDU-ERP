"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { filterClass, linkButton, money, useHostelData } from "./hostelUi";

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const TILES = [
  ["Active Students", (data) => data.activeStudents],
  ["Rent Expected", (data) => money(data.expected)],
  ["Rent Collected", (data) => money(data.collected), "text-green-700"],
  ["Outstanding", (data) => money(data.outstanding), "text-orange-600"],
  ["Overdue", (data) => money(data.overdue), "text-red-600"],
  ["Fully Paid Students", (data) => data.paidStudents, "text-green-700"],
  ["Partly Paid Students", (data) => data.partialStudents, "text-blue-700"],
  ["Unpaid Students", (data) => data.unpaidStudents, "text-orange-600"],
  ["Overdue Students", (data) => data.overdueStudents, "text-red-600"],
  ["Online Payments Successful", (data) => data.onlineSuccessful, "text-green-700"],
  ["Online Payments Failed", (data) => data.onlineFailed, "text-red-600"],
  ["Online Payments To Review", (data) => data.onlineReview, "text-amber-700"],
];

function Dashboard() {
  const [filters, setFilters] = useState({ month: currentMonth(), buildingId: "", method: "", status: "" });
  const key = JSON.stringify(filters);
  const load = useCallback(() => hostelService.getRentDashboard(JSON.parse(key)), [key]);
  const { data, error } = useHostelData(load);

  const setFilter = (name) => (event) =>
    setFilters((previous) => ({ ...previous, [name]: event.target.value }));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-800">Rent Overview</h2>
          <p className="mt-1 text-sm text-slate-500">From invoices and confirmed payments. Clear the month to see all months.</p>
        </div>
        <Link href="/admin/hostel/due-rent" className={linkButton}>Due Rent</Link>
      </div>

      <div className="mb-4 flex flex-col flex-wrap gap-3 md:flex-row">
        <input type="month" aria-label="Billing month" value={filters.month} onChange={setFilter("month")} className={filterClass} />
        <select aria-label="Building" value={filters.buildingId} onChange={setFilter("buildingId")} className={filterClass}>
          <option value="">All Buildings</option>
          {data?.filterOptions.buildings.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <select aria-label="Payment method" value={filters.method} onChange={setFilter("method")} className={filterClass}>
          <option value="">All Payment Methods</option>
          {data?.filterOptions.methods.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select aria-label="Payment status" value={filters.status} onChange={setFilter("status")} className={filterClass}>
          <option value="">All Payment Status</option>
          {["Paid", "Partially Paid", "Unpaid", "Overdue"].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {TILES.map(([label, read, color]) => (
          <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${color || "text-slate-800"}`}>{data ? read(data) : "—"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function RentDashboard() {
  const { has } = useHostelPermissions();
  return has("view_due_rent") ? <Dashboard /> : null;
}
