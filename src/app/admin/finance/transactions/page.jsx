"use client";

import { useCallback, useState } from "react";
import { financeApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, filterClass, linkButton, money, secondaryButton, useData } from "@/components/erp/ui";
import { METHODS, StateBadge, printReceipt } from "../_components/financeViews";

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function TransactionsPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", method: "", status: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const load = useCallback(() => financeApi.payments(applied), [applied]);
  const { data, error, isLoading, reload } = useData(load);
  const [reversing, setReversing] = useState(null);
  const [notice, setNotice] = useState("");

  if (isReady && !can("finance.read")) return <NoAccess />;
  const rows = data || [];
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").reduce((sum, row) => sum + row.amount, 0);

  const exportCsv = () => {
    const header = ["Receipt", "Date", "Student ID", "Student", "Invoice", "Method", "Reference", "Amount", "Status", "Recorded by"];
    const lines = rows.map((r) => [r.receiptNumber, r.paidOn, r.studentNo, r.studentName, r.invoiceNumber, r.method, r.reference, r.amount, r.status, r.recordedBy].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SystemShell title="Transactions" subtitle="Every payment recorded against a fee invoice. Payments are never deleted; a mistake is reversed with a reason."
      crumbs={[{ href: "/admin/finance", label: "Finance" }]}
      actions={can("finance.export", "finance.read") && rows.length > 0 && <button onClick={exportCsv} className={secondaryButton}>Export CSV</button>}>
      <ErrorBanner message={error} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        <input aria-label="Search payments" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Student, receipt, invoice or reference" className={`${filterClass} min-w-[16rem]`} />
        <select aria-label="Method" value={filters.method} onChange={(e) => setFilters({ ...filters, method: e.target.value })} className={filterClass}>
          <option value="">All methods</option>
          {METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
        </select>
        <select aria-label="Payment status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="">Any status</option><option value="CONFIRMED">Confirmed</option><option value="REVERSED">Reversed</option>
        </select>
        <input aria-label="From date" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={filterClass} />
        <input aria-label="To date" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={filterClass} />
        <button type="submit" className={secondaryButton}>Apply</button>
      </form>
      {rows.length > 0 && <p className="text-sm text-slate-600">{rows.length} payments · confirmed total {money(confirmed)}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Receipt", "Date", "Student", "Invoice", "Method", "Amount", "Status", "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="No payments match.">
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs">{row.receiptNumber}</td>
              <td className="px-4 py-3">{row.paidOn}</td>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.studentName}</span><span className="block text-xs text-slate-500">{row.studentNo}</span></td>
              <td className="px-4 py-3 text-xs">{row.invoiceNumber}<span className="block text-slate-500">{row.invoiceTitle}</span></td>
              <td className="px-4 py-3">{label(row.method)}{row.reference && <span className="block text-xs text-slate-500">{row.reference}</span>}</td>
              <td className="px-4 py-3 font-medium">{money(row.amount)}</td>
              <td className="px-4 py-3"><StateBadge state={row.status} />{row.status === "REVERSED" && <span className="mt-1 block text-xs text-slate-500" title={row.reversalReason}>{row.reversalReason}</span>}</td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  <button onClick={() => printReceipt(row)} className={linkButton} aria-label={`Receipt ${row.receiptNumber}`}>Receipt</button>
                  {row.status === "CONFIRMED" && can("finance.approve") && <button onClick={() => setReversing(row)} className={dangerButton} aria-label={`Reverse ${row.receiptNumber}`}>Reverse</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {reversing && (
        <QuickForm title={`Reverse ${reversing.receiptNumber} (${money(reversing.amount)})`} submitLabel="Reverse Payment" onClose={() => setReversing(null)}
          fields={[{ name: "reason", label: "Reason * (kept in the audit log)", wide: true }]}
          onSubmit={async (body) => { await financeApi.reverse(reversing.id, body.reason); setReversing(null); setNotice("Payment reversed. The invoice is open again."); reload(); }} />
      )}
    </SystemShell>
  );
}
