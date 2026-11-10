"use client";

import { useState } from "react";
import { financeApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, friendlyError, linkButton, money, primaryButton, useData } from "@/components/erp/ui";

const CATEGORIES = ["TUITION", "ADMISSION", "EXAM", "LAB", "LIBRARY", "TRANSPORT", "DEVELOPMENT", "FINE", "OTHER"];
const FREQUENCIES = ["ONE_TIME", "PER_TERM", "MONTHLY", "YEARLY"];
const FIELDS = [
  { name: "code", label: "Code *" },
  { name: "name", label: "Name *" },
  { name: "category", label: "Category", type: "select", noBlank: true, options: CATEGORIES.map((c) => [c, label(c)]) },
  { name: "frequency", label: "Charged", type: "select", noBlank: true, options: FREQUENCIES.map((f) => [f, label(f)]) },
  { name: "defaultAmount", label: "Default amount (৳) *", type: "number", step: "0.01", hint: "Programs can have their own amount on the Fee Structure page." },
  { name: "status", label: "Status", type: "select", noBlank: true, options: [["ACTIVE", "Active"], ["INACTIVE", "Inactive"]] },
];

const loadHeads = () => financeApi.feeHeads();

export default function FeeHeadsPage() {
  const { can, isReady } = useMe();
  const { data, error, isLoading, reload } = useData(loadHeads);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("finance.read")) return <NoAccess />;

  const remove = async (head) => {
    if (!window.confirm(`Delete fee head ${head.code}?`)) return;
    setActionError("");
    try {
      await financeApi.removeFeeHead(head.id);
      setNotice("Fee head deleted.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const save = async (body) => {
    if (!editing) return;
    if (editing.head) await financeApi.updateFeeHead(editing.head.id, body);
    else await financeApi.createFeeHead(body);
    setEditing(null);
    setNotice("Fee head saved.");
    reload();
  };

  return (
    <SystemShell title="Fee Heads" subtitle="The kinds of fees the institution charges. Invoices are built from these." crumbs={[{ href: "/admin/finance", label: "Finance" }]}
      actions={can("finance.create") && <button onClick={() => setEditing({})} className={primaryButton}>New Fee Head</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Code", "Name", "Category", "Charged", "Default", "Program rates", "Status", "Actions"]} isLoading={isLoading} hasRows={(data || []).length > 0} emptyMessage="No fee heads yet. Add Tuition, Lab fee and the rest.">
          {(data || []).map((head) => (
            <tr key={head.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs">{head.code}</td>
              <td className="px-4 py-3 font-medium text-slate-800">{head.name}</td>
              <td className="px-4 py-3">{label(head.category)}</td>
              <td className="px-4 py-3">{label(head.frequency)}</td>
              <td className="px-4 py-3">{money(head.defaultAmount)}</td>
              <td className="px-4 py-3">{head.rates}</td>
              <td className="px-4 py-3">{label(head.status)}</td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  {can("finance.update") && <button onClick={() => setEditing({ head })} className={linkButton} aria-label={`Edit ${head.code}`}>Edit</button>}
                  {can("finance.delete") && <button onClick={() => remove(head)} className={dangerButton} aria-label={`Delete ${head.code}`}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {editing && (
        <QuickForm title={editing.head ? `Edit ${editing.head.code}` : "New Fee Head"} fields={FIELDS} onSubmit={save} onClose={() => setEditing(null)}
          initial={editing.head || { category: "TUITION", frequency: "PER_TERM", status: "ACTIVE" }} />
      )}
    </SystemShell>
  );
}
