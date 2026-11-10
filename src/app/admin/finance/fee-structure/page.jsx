"use client";

import { useState } from "react";
import { financeApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { ErrorBanner, NoAccess, SystemShell, friendlyError, money, useData } from "@/components/erp/ui";

const loadStructure = () => financeApi.structure();

// One cell: a program's amount for a fee head. Empty means the default amount.
function RateCell({ head, program, rate, canEdit, onSaved, onError }) {
  const [value, setValue] = useState(rate === undefined ? "" : String(rate));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const next = value.trim();
    if (next === (rate === undefined ? "" : String(rate))) return;
    setSaving(true);
    try {
      await financeApi.setRate(head.id, program.id, next === "" ? null : Number(next));
      onSaved(`${program.code} · ${head.name} saved.`);
    } catch (err) {
      onError(friendlyError(err));
      setValue(rate === undefined ? "" : String(rate));
    } finally {
      setSaving(false);
    }
  };
  if (!canEdit) return <span>{money(rate ?? head.defaultAmount)}{rate === undefined && <span className="text-xs text-slate-400"> (default)</span>}</span>;
  return (
    <input type="number" min="0" step="0.01" value={value} disabled={saving} placeholder={`${head.defaultAmount} (default)`}
      aria-label={`${program.code} ${head.name} amount`} onChange={(e) => setValue(e.target.value)} onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="w-32 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100" />
  );
}

export default function FeeStructurePage() {
  const { can, isReady } = useMe();
  const { data, error, isLoading, reload } = useData(loadStructure);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("finance.read")) return <NoAccess />;
  const heads = (data?.feeHeads || []).filter((head) => head.status === "ACTIVE");
  const programs = data?.programs || [];
  const rateOf = (headId, programId) => data?.rates.find((rate) => rate.feeHeadId === headId && rate.programId === programId)?.amount;

  return (
    <SystemShell title="Fee Structure" subtitle="What each program pays per fee head. Leave a cell empty to use the fee head's default amount."
      crumbs={[{ href: "/admin/finance", label: "Finance" }]}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
      {data && (heads.length === 0 || programs.length === 0) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {heads.length === 0 ? "Add active fee heads first." : "Add programs on the Academic Structure page first."}
        </p>
      )}
      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {heads.length > 0 && programs.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-4 py-3 font-semibold">Program</th>
                {heads.map((head) => <th key={head.id} className="px-4 py-3 font-semibold">{head.name}<span className="block text-xs font-normal text-slate-400">default {money(head.defaultAmount)}</span></th>)}
                <th className="px-4 py-3 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => (
                <tr key={program.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{program.code}<span className="block text-xs text-slate-500">{program.name}</span></td>
                  {heads.map((head) => (
                    <td key={head.id} className="px-4 py-3">
                      <RateCell key={`${head.id}-${program.id}-${rateOf(head.id, program.id)}`} head={head} program={program} rate={rateOf(head.id, program.id)} canEdit={can("finance.update")}
                        onSaved={(text) => { setMessage(text); setActionError(""); reload(); }} onError={setActionError} />
                    </td>
                  ))}
                  <td className="px-4 py-3 font-semibold">{money(heads.reduce((sum, head) => sum + (rateOf(head.id, program.id) ?? head.defaultAmount), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </SystemShell>
  );
}
