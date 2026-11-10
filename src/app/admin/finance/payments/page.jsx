"use client";

import { useCallback, useState } from "react";
import { financeApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { InvoiceView, StateBadge } from "../_components/financeViews";

// The collection desk: find a student's open invoices and take payment.
export default function CollectPaymentPage() {
  const { can, isReady } = useMe();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const load = useCallback(async () => {
    const lists = await Promise.all(["OVERDUE", "UNPAID", "PARTIAL"].map((state) => financeApi.invoices({ state, search: applied })));
    return lists.flat();
  }, [applied]);
  const { data, error, isLoading, reload } = useData(load);
  const [openId, setOpenId] = useState(null);

  if (isReady && !can("finance.read")) return <NoAccess />;
  const rows = data || [];

  return (
    <SystemShell title="Collect Payment" subtitle="Open invoices, overdue first. Record cash, bank, bKash, Nagad or cheque payments received at the desk."
      crumbs={[{ href: "/admin/finance", label: "Finance" }]}>
      <ErrorBanner message={error} />
      <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">
        This records money already received. Online payment for tuition is not connected yet; hostel rent uses its own bKash flow.
      </p>
      <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(search); }}>
        <input aria-label="Find student or invoice" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student name, ID or invoice no." className={`${filterClass} min-w-[18rem]`} />
        <button type="submit" className={secondaryButton}>Find</button>
      </form>
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Invoice", "Student", "Title", "Due date", "Outstanding", "Status", ""]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage={applied ? "No open invoices match." : "No open invoices. Everything is paid."}>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs">{row.invoiceNumber}</td>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.studentName}</span><span className="block text-xs text-slate-500">{row.studentNo}</span></td>
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{row.dueDate}</td>
              <td className="px-4 py-3 font-semibold">{money(row.outstanding)}</td>
              <td className="px-4 py-3"><StateBadge state={row.state} /></td>
              <td className="px-4 py-3">{can("finance.create") && <button onClick={() => setOpenId(row.id)} className={primaryButton} aria-label={`Collect ${row.invoiceNumber}`}>Collect</button>}</td>
            </tr>
          ))}
        </DataTable>
      </section>
      {openId && <InvoiceView invoiceId={openId} can={can} onClose={() => setOpenId(null)} onChanged={reload} />}
    </SystemShell>
  );
}
