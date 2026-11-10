"use client";

import { useCallback, useState } from "react";
import { libraryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, friendlyError, linkButton, money, useData } from "@/components/erp/ui";

export default function FinesPage() {
  const { can, isReady } = useMe();
  const [view, setView] = useState("FINES");
  const load = useCallback(async () => {
    if (view === "FINES") return libraryApi.loans({ state: "FINES" });
    if (view === "ACCRUING") return libraryApi.loans({ state: "OVERDUE" });
    return (await libraryApi.loans({ state: "RETURNED" })).filter((loan) => loan.fineStatus === "PAID" || loan.fineStatus === "WAIVED");
  }, [view]);
  const { data, error, isLoading, reload } = useData(load);
  const [waiving, setWaiving] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("library.read")) return <NoAccess />;
  const rows = data || [];
  const total = rows.reduce((sum, row) => sum + row.fineAmount, 0);

  const pay = async (loan) => {
    if (!window.confirm(`Mark ${money(loan.fineAmount)} from ${loan.borrowerName} as paid?`)) return;
    setActionError("");
    try {
      await libraryApi.settleFine(loan.id, "PAID");
      setNotice("Fine marked paid.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Library Fines" subtitle="Fines are fixed when a late book comes back. Overdue books show the fine so far." crumbs={[{ href: "/admin/library", label: "Library" }]}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Which fines" value={view} onChange={(e) => setView(e.target.value)} className={filterClass}>
          <option value="FINES">Unpaid fines</option><option value="ACCRUING">Still out and overdue</option><option value="SETTLED">Paid or waived</option>
        </select>
        {rows.length > 0 && <p className="text-sm text-slate-600">{rows.length} loans · {money(total)}</p>}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Borrower", "Book", "Due", "Returned", "Days late", "Fine", "Status", "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="Nothing here.">
          {rows.map((loan) => (
            <tr key={loan.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{loan.borrowerName}<span className="block text-xs text-slate-500">{loan.borrowerNo}</span></td>
              <td className="px-4 py-3">{loan.bookTitle}</td>
              <td className="px-4 py-3">{loan.dueOn}</td>
              <td className="px-4 py-3">{loan.returnedOn || "Not yet"}</td>
              <td className="px-4 py-3">{loan.lateDays}</td>
              <td className="px-4 py-3 font-medium">{money(loan.fineAmount)}</td>
              <td className="px-4 py-3">{label(loan.fineStatus)}{loan.fineNote && <span className="block text-xs text-slate-500">{loan.fineNote}</span>}</td>
              <td className="px-4 py-3">
                {loan.fineStatus === "DUE" && (
                  <div className="flex gap-3">
                    {can("library.create", "library.update") && <button onClick={() => pay(loan)} className={linkButton}>Mark Paid</button>}
                    {can("library.approve") && <button onClick={() => setWaiving(loan)} className={linkButton}>Waive</button>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {waiving && (
        <QuickForm title={`Waive ${money(waiving.fineAmount)} for ${waiving.borrowerName}`} submitLabel="Waive Fine" onClose={() => setWaiving(null)}
          fields={[{ name: "note", label: "Reason *", wide: true }]}
          onSubmit={async (body) => { await libraryApi.settleFine(waiving.id, "WAIVED", body.note); setWaiving(null); setNotice("Fine waived."); reload(); }} />
      )}
    </SystemShell>
  );
}
