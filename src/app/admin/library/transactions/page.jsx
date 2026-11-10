"use client";

import { useCallback, useState } from "react";
import { libraryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, Field, FormModal, NoAccess, SystemShell, filterClass, friendlyError, inputClass, linkButton, money, primaryButton, useData } from "@/components/erp/ui";

const STATE_STYLES = { ON_LOAN: "bg-blue-100 text-blue-700", OVERDUE: "bg-red-100 text-red-700", RETURNED: "bg-slate-100 text-slate-600" };

function IssueForm({ onClose, onDone }) {
  const [search, setSearch] = useState("");
  const [books, setBooks] = useState([]);
  const [book, setBook] = useState(null);
  const [values, setValues] = useState({ borrowerType: "STUDENT", borrower: "", dueOn: "" });

  return (
    <FormModal title="Lend a Book" submitLabel="Lend" onClose={onClose}
      onSubmit={async () => {
        if (!book) throw new Error("Choose a book first.");
        onDone(await libraryApi.issue({ ...values, bookId: book.id, dueOn: values.dueOn || undefined }));
      }}>
      <Field id="issue-book" label="Book *" wide>
        {book ? (
          <p className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">{book.title} · {book.available} available
            <button type="button" onClick={() => setBook(null)} className={linkButton}>Change</button></p>
        ) : (
          <>
            <input id="issue-book" value={search} placeholder="Type a title, author or ISBN" className={inputClass}
              onChange={async (e) => { setSearch(e.target.value); setBooks(e.target.value.trim().length > 1 ? await libraryApi.books({ search: e.target.value }) : []); }} />
            {books.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 text-sm">
                {books.map((item) => (
                  <li key={item.id}><button type="button" disabled={item.available < 1} onClick={() => setBook(item)} className="w-full px-3 py-2 text-left hover:bg-slate-50 disabled:text-slate-400">
                    {item.title} {item.author && `· ${item.author}`} — {item.available > 0 ? `${item.available} available` : "none available"}</button></li>
                ))}
              </ul>
            )}
          </>
        )}
      </Field>
      <Field id="issue-type" label="Borrower is a">
        <select id="issue-type" value={values.borrowerType} onChange={(e) => setValues({ ...values, borrowerType: e.target.value })} className={inputClass}>
          <option value="STUDENT">Student</option><option value="TEACHER">Teacher</option>
        </select>
      </Field>
      <Field id="issue-who" label={values.borrowerType === "STUDENT" ? "Student ID *" : "Employee number *"}>
        <input id="issue-who" value={values.borrower} onChange={(e) => setValues({ ...values, borrower: e.target.value })} className={inputClass} />
      </Field>
      <Field id="issue-due" label="Due date (empty = standard loan period)">
        <input id="issue-due" type="date" value={values.dueOn} onChange={(e) => setValues({ ...values, dueOn: e.target.value })} className={inputClass} />
      </Field>
    </FormModal>
  );
}

export default function LoansPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ state: "OPEN", search: "" });
  const load = useCallback(() => libraryApi.loans(filters), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [issuing, setIssuing] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("library.read")) return <NoAccess />;
  const rows = data || [];
  const desk = can("library.create", "library.update");

  const act = async (work, text) => {
    setActionError("");
    try {
      const loan = await work();
      setNotice(typeof text === "function" ? text(loan) : text);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Loans" subtitle="Lend, renew and take back books. A late return fixes the fine at the current day rate."
      crumbs={[{ href: "/admin/library", label: "Library" }]}
      actions={desk && <button onClick={() => setIssuing(true)} className={primaryButton}>Lend a Book</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <select aria-label="Loan status" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} className={filterClass}>
          <option value="OPEN">On loan</option><option value="OVERDUE">Overdue</option><option value="RETURNED">Returned</option><option value="">All</option>
        </select>
        <input aria-label="Search loans" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Borrower, ID or title" className={`${filterClass} min-w-[16rem]`} />
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Book", "Borrower", "Issued", "Due", "Returned", "Status", "Fine", "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="No loans match.">
          {rows.map((loan) => (
            <tr key={loan.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{loan.bookTitle}</td>
              <td className="px-4 py-3">{loan.borrowerName}<span className="block text-xs text-slate-500">{label(loan.borrowerType)} · {loan.borrowerNo}</span></td>
              <td className="px-4 py-3">{loan.issuedOn}</td>
              <td className="px-4 py-3">{loan.dueOn}{loan.renewals > 0 && <span className="block text-xs text-slate-500">renewed {loan.renewals}×</span>}</td>
              <td className="px-4 py-3">{loan.returnedOn || "—"}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${STATE_STYLES[loan.state]}`}>{loan.state === "OVERDUE" ? `Overdue ${loan.lateDays}d` : label(loan.state)}</span></td>
              <td className="px-4 py-3">{loan.fineAmount > 0 ? `${money(loan.fineAmount)} · ${label(loan.fineStatus)}` : "—"}</td>
              <td className="px-4 py-3">
                {desk && !loan.returnedOn && (
                  <div className="flex gap-3">
                    <button onClick={() => act(() => libraryApi.giveBack(loan.id), (l) => (l.fineAmount > 0 ? `Returned. Fine due: ${money(l.fineAmount)}.` : "Returned."))} className={linkButton} aria-label={`Return ${loan.bookTitle} from ${loan.borrowerNo}`}>Return</button>
                    {loan.state !== "OVERDUE" && <button onClick={() => act(() => libraryApi.renew(loan.id), (l) => `Renewed until ${l.dueOn}.`)} className={linkButton}>Renew</button>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {issuing && <IssueForm onClose={() => setIssuing(false)} onDone={(loan) => { setIssuing(false); setNotice(`Lent to ${loan.borrowerName}, due ${loan.dueOn}.`); reload(); }} />}
    </SystemShell>
  );
}
