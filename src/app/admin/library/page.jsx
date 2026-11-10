"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { libraryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { ErrorBanner, NoAccess, StatGrid, SystemShell, money, secondaryButton, useData } from "@/components/erp/ui";

const PAGES = [
  { href: "/admin/library/books", title: "Books", text: "The catalogue and copies." },
  { href: "/admin/library/transactions", title: "Loans", text: "Lend, renew and return." },
  { href: "/admin/library/fines", title: "Fines", text: "Late fines, paid and waived." },
];

export default function LibraryHub() {
  const { can, isReady } = useMe();
  const load = useCallback(() => Promise.all([libraryApi.summary(), libraryApi.settings()]), []);
  const { data, error, isLoading, reload } = useData(load);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  if (isReady && !can("library.read")) return <NoAccess />;
  const [summary, settings] = data || [];

  return (
    <SystemShell title="Library" subtitle="Books, loans and fines, live from the database."
      actions={can("library.update") && settings && <button onClick={() => setEditing(true)} className={secondaryButton}>Loan Rules</button>}>
      <ErrorBanner message={error} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <StatGrid isLoading={isLoading} stats={[
        { label: "Titles", value: summary?.titles ?? 0 },
        { label: "Copies", value: summary?.copies ?? 0 },
        { label: "On loan", value: summary?.onLoan ?? 0 },
        { label: "Overdue", value: summary?.overdue ?? 0, color: "text-red-600" },
        { label: "Unpaid fines", value: money(summary?.finesDue) },
      ]} />
      {settings && (
        <p className="text-sm text-slate-600">Loans last {settings.loanDays} days · fine {money(settings.finePerDay)} per late day · up to {settings.maxLoans} books per borrower · {settings.maxRenewals} renewal{settings.maxRenewals === 1 ? "" : "s"}.</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
            <p className="font-semibold text-slate-800">{page.title}</p>
            <p className="mt-1 text-sm text-slate-500">{page.text}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-slate-500">E-books, the digital repository and QR/RFID self-checkout are not built yet.</p>
      {editing && settings && (
        <QuickForm title="Loan Rules" initial={settings} onClose={() => setEditing(false)}
          fields={[
            { name: "loanDays", label: "Loan period (days)", type: "number", min: 1 },
            { name: "finePerDay", label: "Fine per late day (৳)", type: "number", step: "0.01", min: 0 },
            { name: "maxLoans", label: "Books per borrower", type: "number", min: 1 },
            { name: "maxRenewals", label: "Renewals per loan", type: "number", min: 0 },
          ]}
          onSubmit={async (body) => { await libraryApi.saveSettings(body); setEditing(false); setNotice("Loan rules saved. They apply to new loans and returns from now on."); reload(); }} />
      )}
    </SystemShell>
  );
}
