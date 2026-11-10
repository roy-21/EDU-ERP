"use client";

import { useState } from "react";
import { tenancyApi } from "@/lib/identityServices";
import { useMe } from "@/lib/useMe";
import {
  DataTable,
  ErrorBanner,
  Field,
  NoAccess,
  StatusBadge,
  SystemShell,
  formatDateTime,
  friendlyError,
  inputClass,
  money,
  primaryButton,
  useData,
} from "@/components/erp/ui";

const loadSubscription = () => tenancyApi.mySubscription();
const today = () => new Date().toISOString().slice(0, 10);

export default function SubscriptionPage() {
  const { isRole, isReady } = useMe();
  const { data, error, isLoading, reload } = useData(loadSubscription);
  const [wanted, setWanted] = useState([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [isSending, setIsSending] = useState(false);

  if (isReady && !isRole("ADMIN", "SUPER_ADMIN")) return <NoAccess message="Only an institution admin can manage the subscription." />;

  const tenant = data?.tenant;
  const active = new Set((tenant?.modules || []).filter((item) => item.status === "ACTIVE" && (!item.endsOn || item.endsOn >= today())).map((item) => item.moduleId));
  const available = (data?.catalog || []).filter((item) => !active.has(item.id));
  const pending = (data?.requests || []).find((item) => item.status === "PENDING");
  const extra = available.filter((item) => wanted.includes(item.id)).reduce((sum, item) => sum + item.monthlyPrice, 0);

  const send = async () => {
    setIsSending(true);
    setActionError("");
    try {
      await tenancyApi.requestModules(wanted, note);
      setNotice("Request sent. The platform team will review it; the modules switch on when it is approved.");
      setWanted([]);
      setNote("");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SystemShell title="Subscription" subtitle="The modules your institution pays for. Only these appear for your users." crumbs={[{ href: "/admin/settings", label: "Settings" }]}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-800">{tenant?.name || "Your institution"} · Active modules</h2>
        <DataTable columns={["Module", "Since", "Until", "Monthly", "Status"]} isLoading={isLoading} hasRows={(tenant?.modules || []).length > 0} emptyMessage="No modules." minWidth="min-w-[600px]">
          {(tenant?.modules || []).map((item) => {
            const info = data.catalog.find((module) => module.id === item.moduleId);
            const expired = item.endsOn && item.endsOn < today();
            return (
              <tr key={item.moduleId} className="border-b border-slate-100">
                <td className="px-4 py-3 text-slate-800">{info?.icon} {info?.name || item.moduleId}</td>
                <td className="px-4 py-3 text-slate-600">{item.startsOn}</td>
                <td className="px-4 py-3 text-slate-600">{item.endsOn || "Ongoing"}</td>
                <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.monthlyPrice)}</td>
                <td className="px-4 py-3"><StatusBadge status={expired ? "Expired" : item.status === "ACTIVE" ? "Active" : "Suspended"} /></td>
              </tr>
            );
          })}
        </DataTable>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-bold text-slate-800">Add modules</h2>
        {pending ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            A request for {pending.moduleIds.join(", ")} ({money(pending.monthlyTotal)} a month) is waiting for approval since {formatDateTime(pending.createdAt)}.
          </p>
        ) : available.length === 0 ? (
          <p className="text-sm text-slate-500">You already have every module.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {available.map((item) => (
                <label key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={wanted.includes(item.id)} onChange={(e) => setWanted(e.target.checked ? [...wanted, item.id] : wanted.filter((id) => id !== item.id))} />
                    {item.icon} {item.name}
                  </span>
                  <span className="tabular-nums text-slate-500">{money(item.monthlyPrice)}</span>
                </label>
              ))}
            </div>
            <Field id="request-note" label="Note to the platform team">
              <input id="request-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </Field>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-700">Adds <strong>{money(extra)}</strong> a month.</p>
              <button onClick={send} disabled={wanted.length === 0 || isSending} className={`${primaryButton} disabled:opacity-50`}>{isSending ? "Sending..." : "Request Modules"}</button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-800">Invoices</h2>
        <DataTable columns={["Invoice", "Period", "Amount", "Paid", "Balance", "Due", "Status"]} hasRows={(data?.invoices || []).length > 0} emptyMessage="No invoices yet." minWidth="min-w-[700px]">
          {(data?.invoices || []).map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.invoiceNumber}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.periodStart} to {item.periodEnd}</td>
              <td className="px-4 py-3 tabular-nums text-slate-700">{money(item.amount)}</td>
              <td className="px-4 py-3 tabular-nums text-green-700">{money(item.paid)}</td>
              <td className="px-4 py-3 tabular-nums text-orange-700">{money(item.balance)}</td>
              <td className="px-4 py-3 text-slate-600">{item.dueDate}</td>
              <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-2 text-xs text-slate-500">Pay by bank transfer or mobile banking and send the reference to the platform team; they record it here.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-800">History</h2>
        <DataTable columns={["When", "Kind", "Modules", "Monthly", "Status", "Note"]} hasRows={(data?.requests || []).length > 0} emptyMessage="No requests yet." minWidth="min-w-[700px]">
          {(data?.requests || []).map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
              <td className="px-4 py-3 text-slate-600">{item.kind === "REGISTRATION" ? "Sign-up" : "More modules"}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{item.moduleIds.join(", ")}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.monthlyTotal)}</td>
              <td className="px-4 py-3"><StatusBadge status={{ PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" }[item.status]} /></td>
              <td className="px-4 py-3 text-xs text-slate-600">{item.decisionNote}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </SystemShell>
  );
}
