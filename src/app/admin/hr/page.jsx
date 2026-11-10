"use client";

import Link from "next/link";
import { useCallback } from "react";
import { hrApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { ErrorBanner, StatGrid, SystemShell, money, useData } from "@/components/erp/ui";

const PAGES = [
  { href: "/admin/hr/employees", title: "Employees", text: "Teachers and staff, with salaries." },
  { href: "/admin/hr/leave", title: "Leave", text: "Requests, decisions and leave types." },
  { href: "/admin/hr/payroll", title: "Payroll", text: "Build, approve and pay each month." },
];

export default function HrHub() {
  const { can } = useMe();
  const office = can("hr.read");
  const load = useCallback(() => (office ? Promise.all([hrApi.employees(), hrApi.leave({ status: "PENDING" }), hrApi.payrolls()]) : Promise.resolve(null)), [office]);
  const { data, error, isLoading } = useData(load);
  const [employees, pending, runs] = data || [[], [], []];
  const active = employees.filter((e) => e.status !== "INACTIVE");

  return (
    <SystemShell title="HR & Payroll" subtitle="People, leave and salaries from the database.">
      <ErrorBanner message={error} />
      {office && (
        <StatGrid isLoading={isLoading} stats={[
          { label: "Active employees", value: active.length },
          { label: "Without salary", value: active.filter((e) => !e.salary).length, color: "text-amber-700" },
          { label: "Leave waiting", value: pending.length },
          { label: "Monthly net pay", value: money(active.reduce((sum, e) => sum + (e.salary?.net || 0), 0)) },
          { label: "Last payroll", value: runs[0] ? `${runs[0].month} · ${runs[0].status.toLowerCase()}` : "None" },
        ]} />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {office && PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
            <p className="font-semibold text-slate-800">{page.title}</p>
            <p className="mt-1 text-sm text-slate-500">{page.text}</p>
          </Link>
        ))}
        <Link href="/admin/hr/me" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
          <p className="font-semibold text-slate-800">My Leave &amp; Payslips</p>
          <p className="mt-1 text-sm text-slate-500">Apply for leave and see your payslips.</p>
        </Link>
      </div>
      {office && <p className="text-xs text-slate-500">Staff attendance, performance reviews, promotions and recruitment are not built yet.</p>}
    </SystemShell>
  );
}
