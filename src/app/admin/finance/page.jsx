"use client";

import Link from "next/link";
import { financeApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { label } from "@/components/erp/QuickForm";
import { ErrorBanner, NoAccess, StatGrid, SystemShell, money, useData } from "@/components/erp/ui";

const loadSummary = () => financeApi.summary();

const PAGES = [
  { href: "/admin/finance/fees", title: "Fee Heads", text: "Tuition, lab, exam and other fees." },
  { href: "/admin/finance/fee-structure", title: "Fee Structure", text: "What each program pays." },
  { href: "/admin/finance/invoices", title: "Invoices", text: "Generate, view, waive and cancel." },
  { href: "/admin/finance/payments", title: "Collect Payment", text: "Take payment at the desk." },
  { href: "/admin/finance/transactions", title: "Transactions", text: "Receipts, reversals and export." },
  { href: "/admin/hostel/fees", title: "Hostel Billing", text: "Hostel rent has its own billing." },
];

function Bars({ rows, valueKey, labelKey, format = money }) {
  const max = Math.max(1, ...rows.map((row) => row[valueKey]));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row[labelKey]} className="text-sm">
          <div className="flex justify-between text-slate-600"><span>{row[labelKey]}</span><span className="font-medium text-slate-800">{format(row[valueKey])}</span></div>
          <div className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-blue-500" style={{ width: `${(row[valueKey] / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function FinanceDashboard() {
  const { can, isReady } = useMe();
  const { data, error, isLoading } = useData(loadSummary);

  if (isReady && !can("finance.read")) return <NoAccess />;
  const rate = data && data.billed > 0 ? Math.round((data.collected / data.billed) * 100) : 0;

  return (
    <SystemShell title="Finance" subtitle="Student fees from the database: what was billed, what came in, and who owes.">
      <ErrorBanner message={error} />
      <StatGrid isLoading={isLoading} stats={[
        { label: "Billed", value: money(data?.billed) },
        { label: "Collected", value: money(data?.collected), color: "text-green-700" },
        { label: "Outstanding", value: money(data?.outstanding) },
        { label: "Overdue", value: money(data?.overdue), color: "text-red-600" },
        { label: "Collection rate", value: `${rate}%` },
      ]} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
            <p className="font-semibold text-slate-800">{page.title}</p>
            <p className="mt-1 text-sm text-slate-500">{page.text}</p>
          </Link>
        ))}
      </div>
      {data && data.invoices === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No invoices yet. Add fee heads, set the fee structure, then generate invoices for a section.</p>
      )}
      {data && data.invoices > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold text-slate-800">Collected per month (last 6)</h2>
            {data.byMonth.length ? <Bars rows={data.byMonth} valueKey="total" labelKey="month" /> : <p className="text-sm text-slate-500">No payments in the last six months.</p>}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold text-slate-800">Collected by method</h2>
            {data.byMethod.length ? <Bars rows={data.byMethod.map((row) => ({ ...row, name: `${label(row.method)} (${row.count})` }))} valueKey="total" labelKey="name" /> : <p className="text-sm text-slate-500">No payments yet.</p>}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold text-slate-800">Billed by fee head</h2>
            <Bars rows={data.byFeeHead} valueKey="billed" labelKey="name" />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold text-slate-800">Largest overdue balances ({data.overdueInvoices} overdue invoices)</h2>
            {data.defaulters.length === 0 ? <p className="text-sm text-slate-500">Nobody is overdue.</p> : (
              <table className="w-full text-left text-sm">
                <tbody>
                  {data.defaulters.map((row) => (
                    <tr key={row.studentId} className="border-b border-slate-100">
                      <td className="py-2"><Link href={`/admin/finance/invoices`} className="font-medium text-slate-800 hover:text-blue-700">{row.studentName}</Link><span className="block text-xs text-slate-500">{row.studentNo}</span></td>
                      <td className="py-2 text-xs text-slate-500">since {row.oldestDue}</td>
                      <td className="py-2 text-right font-semibold text-red-600">{money(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </SystemShell>
  );
}
