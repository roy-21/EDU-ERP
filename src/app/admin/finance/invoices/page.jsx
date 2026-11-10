"use client";

import { useCallback, useState } from "react";
import { financeApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { todayLocal } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, Field, FormModal, NoAccess, SystemShell, filterClass, inputClass, linkButton, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { InvoiceView, StateBadge } from "../_components/financeViews";

const STATES = [["", "All invoices"], ["UNPAID", "Unpaid"], ["PARTIAL", "Partly paid"], ["OVERDUE", "Overdue"], ["PAID", "Paid"], ["CANCELLED", "Cancelled"]];
const plusDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// Bills a whole section or program from the fee structure.
function GenerateForm({ onClose, onDone }) {
  const load = useCallback(() => Promise.all([financeApi.feeHeads(), financeApi.targets()]), []);
  const { data, error } = useData(load);
  const [values, setValues] = useState({ title: "", dueDate: plusDays(30), target: "SECTION", sectionId: "", programId: "", feeHeadIds: [] });
  const set = (key, value) => setValues((previous) => ({ ...previous, [key]: value }));
  const [heads, targets] = data || [[], { programs: [], sections: [] }];
  const toggle = (id) => set("feeHeadIds", values.feeHeadIds.includes(id) ? values.feeHeadIds.filter((item) => item !== id) : [...values.feeHeadIds, id]);

  return (
    <FormModal title="Generate Invoices" submitLabel="Generate" onClose={onClose} onSubmit={async () => onDone(await financeApi.generate(values))}>
      {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <Field id="gen-title" label="Title * (students are billed once per title)" wide>
        <input id="gen-title" value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="Spring 2026 Term Fees" className={inputClass} />
      </Field>
      <Field id="gen-target" label="Bill">
        <select id="gen-target" value={values.target} onChange={(e) => set("target", e.target.value)} className={inputClass}>
          <option value="SECTION">A section</option>
          <option value="PROGRAM">A whole program</option>
        </select>
      </Field>
      {values.target === "SECTION" ? (
        <Field id="gen-section" label="Section *">
          <select id="gen-section" value={values.sectionId} onChange={(e) => set("sectionId", e.target.value)} className={inputClass}>
            <option value="">Choose...</option>
            {targets.sections.map((s) => <option key={s.id} value={s.id}>{s.label} — {s.students} students</option>)}
          </select>
        </Field>
      ) : (
        <Field id="gen-program" label="Program *">
          <select id="gen-program" value={values.programId} onChange={(e) => set("programId", e.target.value)} className={inputClass}>
            <option value="">Choose...</option>
            {targets.programs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </Field>
      )}
      <Field id="gen-due" label="Due date *">
        <input id="gen-due" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={inputClass} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-slate-700">Fee heads *</legend>
        {heads.filter((h) => h.status === "ACTIVE").length === 0 && <p className="text-sm text-amber-700">Add fee heads first.</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {heads.filter((h) => h.status === "ACTIVE").map((head) => (
            <label key={head.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={values.feeHeadIds.includes(head.id)} onChange={() => toggle(head.id)} />
              {head.name} <span className="text-xs text-slate-400">default {money(head.defaultAmount)}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Each student pays their program&apos;s amount from the Fee Structure, or the default.</p>
      </fieldset>
    </FormModal>
  );
}

// One invoice for one student, with hand-written lines.
function SingleForm({ onClose, onDone }) {
  const loadHeads = useCallback(() => financeApi.feeHeads(), []);
  const { data: heads } = useData(loadHeads);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState([]);
  const [student, setStudent] = useState(null);
  const [values, setValues] = useState({ title: "", dueDate: plusDays(15), issuedOn: todayLocal() });
  const [lines, setLines] = useState([{ feeHeadId: "", description: "", amount: "" }]);
  const setLine = (index, change) => setLines(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));

  const find = async () => setMatches(await financeApi.students(search));

  return (
    <FormModal title="New Invoice" submitLabel="Create Invoice" onClose={onClose}
      onSubmit={async () => {
        if (!student) throw new Error("Choose a student first.");
        onDone(await financeApi.createInvoice({ ...values, studentId: student.id, items: lines.map((line) => ({ ...line, amount: line.amount === "" ? undefined : Number(line.amount) })) }));
      }}>
      <Field id="inv-student" label="Student *" wide>
        {student ? (
          <p className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">{student.fullName} ({student.studentNo}) · {student.programCode}
            <button type="button" onClick={() => setStudent(null)} className={linkButton}>Change</button></p>
        ) : (
          <div className="flex gap-2">
            <input id="inv-student" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); find(); } }} placeholder="Name or student ID" className={inputClass} />
            <button type="button" onClick={find} className={secondaryButton}>Find</button>
          </div>
        )}
        {!student && matches.length > 0 && (
          <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 text-sm">
            {matches.map((m) => <li key={m.id}><button type="button" onClick={() => setStudent(m)} className="w-full px-3 py-2 text-left hover:bg-slate-50">{m.fullName} ({m.studentNo}) · {m.programCode} {m.status !== "ACTIVE" ? `· ${m.status}` : ""}</button></li>)}
          </ul>
        )}
      </Field>
      <Field id="inv-title" label="Title *" wide><input id="inv-title" value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} className={inputClass} /></Field>
      <Field id="inv-issued" label="Issued on"><input id="inv-issued" type="date" value={values.issuedOn} onChange={(e) => setValues({ ...values, issuedOn: e.target.value })} className={inputClass} /></Field>
      <Field id="inv-due" label="Due date *"><input id="inv-due" type="date" value={values.dueDate} onChange={(e) => setValues({ ...values, dueDate: e.target.value })} className={inputClass} /></Field>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-sm font-medium text-slate-700">Lines</p>
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
            <select aria-label={`Line ${index + 1} fee head`} value={line.feeHeadId} onChange={(e) => {
              const head = (heads || []).find((h) => h.id === e.target.value);
              setLine(index, { feeHeadId: e.target.value, amount: line.amount === "" && head ? String(head.defaultAmount) : line.amount });
            }} className={inputClass}>
              <option value="">No fee head</option>
              {(heads || []).filter((h) => h.status === "ACTIVE").map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <input aria-label={`Line ${index + 1} description`} value={line.description} onChange={(e) => setLine(index, { description: e.target.value })} placeholder="Description" className={inputClass} />
            <input aria-label={`Line ${index + 1} amount`} type="number" min="0" step="0.01" value={line.amount} onChange={(e) => setLine(index, { amount: e.target.value })} placeholder="Amount" className={inputClass} />
            <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} disabled={lines.length === 1} className="text-sm text-red-600 disabled:opacity-40">Remove</button>
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, { feeHeadId: "", description: "", amount: "" }])} className={linkButton}>+ Add line</button>
      </div>
    </FormModal>
  );
}

export default function InvoicesPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", state: "" });
  const [applied, setApplied] = useState(filters);
  const load = useCallback(() => financeApi.invoices(applied), [applied]);
  const { data, error, isLoading, reload } = useData(load);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");

  if (isReady && !can("finance.read")) return <NoAccess />;
  const rows = data || [];
  const totals = rows.filter((row) => row.status === "ISSUED").reduce((sum, row) => ({ due: sum.due + row.amountDue, paid: sum.paid + row.paidAmount, out: sum.out + row.outstanding }), { due: 0, paid: 0, out: 0 });

  return (
    <SystemShell title="Invoices" subtitle="Tuition and other fee invoices. Balances come from recorded payments, waivers and fines." crumbs={[{ href: "/admin/finance", label: "Finance" }]}
      actions={can("finance.create") && (
        <>
          <button onClick={() => setModal({ kind: "generate" })} className={primaryButton}>Generate Invoices</button>
          <button onClick={() => setModal({ kind: "single" })} className={secondaryButton}>Single Invoice</button>
        </>
      )}>
      <ErrorBanner message={error} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        <input aria-label="Search invoices" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Student, ID, invoice no. or title" className={`${filterClass} min-w-[16rem]`} />
        <select aria-label="Status" value={filters.state} onChange={(e) => { const next = { ...filters, state: e.target.value }; setFilters(next); setApplied(next); }} className={filterClass}>
          {STATES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <button type="submit" className={secondaryButton}>Search</button>
      </form>
      {rows.length > 0 && <p className="text-sm text-slate-600">{rows.length} invoices shown · due {money(totals.due)} · paid {money(totals.paid)} · outstanding {money(totals.out)}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Invoice", "Student", "Title", "Due date", "Amount", "Paid", "Outstanding", "Status", ""]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="No invoices match.">
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs">{row.invoiceNumber}</td>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.studentName}</span><span className="block text-xs text-slate-500">{row.studentNo}</span></td>
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{row.dueDate}</td>
              <td className="px-4 py-3">{money(row.amountDue)}</td>
              <td className="px-4 py-3">{money(row.paidAmount)}</td>
              <td className="px-4 py-3 font-medium">{money(row.outstanding)}</td>
              <td className="px-4 py-3"><StateBadge state={row.state} /></td>
              <td className="px-4 py-3"><button onClick={() => setModal({ kind: "view", id: row.id })} className={linkButton} aria-label={`Open ${row.invoiceNumber}`}>Open</button></td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal?.kind === "generate" && (
        <GenerateForm onClose={() => setModal(null)} onDone={(result) => {
          setModal(null);
          setNotice(`${result.created} invoices created (${money(result.total)}).${result.skipped ? ` ${result.skipped} students skipped: already billed under this title or nothing to pay.` : ""}`);
          reload();
        }} />
      )}
      {modal?.kind === "single" && <SingleForm onClose={() => setModal(null)} onDone={(invoice) => { setNotice(`Invoice ${invoice.invoiceNumber} created.`); setModal({ kind: "view", id: invoice.id }); reload(); }} />}
      {modal?.kind === "view" && <InvoiceView invoiceId={modal.id} can={can} onClose={() => setModal(null)} onChanged={reload} />}
    </SystemShell>
  );
}
