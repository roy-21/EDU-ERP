"use client";

import { useCallback, useState } from "react";
import { hrApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, filterClass, friendlyError, linkButton, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

const STATUS_STYLES = { PENDING: "bg-amber-100 text-amber-700", APPROVED: "bg-green-100 text-green-700", REJECTED: "bg-red-100 text-red-700", CANCELLED: "bg-slate-100 text-slate-500" };

export default function LeavePage() {
  const { can, isReady } = useMe();
  const [status, setStatus] = useState("PENDING");
  const load = useCallback(() => Promise.all([hrApi.leave({ status }), hrApi.leaveTypes()]), [status]);
  const { data, error, isLoading, reload } = useData(load);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("hr.read")) return <NoAccess />;
  const [requests, types] = data || [[], []];

  const act = async (work, text) => {
    setActionError("");
    try {
      await work();
      setNotice(text);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const openRecord = async () => setModal({ kind: "record", employees: await hrApi.employees({ status: "ACTIVE" }) });

  return (
    <SystemShell title="Leave" subtitle="Employees apply from their own account (My HR). Approvers decide here. Days are calendar days, both ends included."
      crumbs={[{ href: "/admin/hr", label: "HR" }]}
      actions={(
        <>
          {can("hr.create") && <button onClick={openRecord} disabled={types.length === 0} className={`${primaryButton} disabled:opacity-50`}>Record Leave</button>}
          {can("hr.update") && <button onClick={() => setModal({ kind: "types" })} className={secondaryButton}>Leave Types</button>}
        </>
      )}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      {data && types.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Add leave types (Casual, Sick, Unpaid…) before anyone can apply.</p>}
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={filterClass}>
        <option value="PENDING">Waiting for a decision</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option><option value="">All</option>
      </select>
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Employee", "Type", "From", "To", "Days", "Reason", "Status", "Actions"]} isLoading={isLoading} hasRows={requests.length > 0} emptyMessage="No leave requests here.">
          {requests.map((leave) => (
            <tr key={leave.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{leave.fullName}<span className="block text-xs text-slate-500">{leave.employeeNo} · {label(leave.personType)}</span></td>
              <td className="px-4 py-3">{leave.leaveType}{!leave.isPaid && <span className="block text-xs text-amber-700">unpaid</span>}</td>
              <td className="px-4 py-3">{leave.fromDate}</td>
              <td className="px-4 py-3">{leave.toDate}</td>
              <td className="px-4 py-3">{leave.days}</td>
              <td className="max-w-xs px-4 py-3 text-xs">{leave.reason}{leave.decisionNote && <span className="block text-slate-500">Note: {leave.decisionNote}</span>}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[leave.status]}`}>{label(leave.status)}</span>{leave.decidedBy && <span className="mt-1 block text-xs text-slate-500">{leave.decidedBy}</span>}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  {leave.status === "PENDING" && can("hr.approve") && <button onClick={() => act(() => hrApi.decide(leave.id, "APPROVED"), "Leave approved.")} className={linkButton}>Approve</button>}
                  {leave.status === "PENDING" && can("hr.approve") && <button onClick={() => setModal({ kind: "reject", leave })} className={dangerButton}>Reject</button>}
                  {(leave.status === "PENDING" || leave.status === "APPROVED") && can("hr.update") && <button onClick={() => window.confirm("Cancel this leave?") && act(() => hrApi.cancelLeave(leave.id), "Leave cancelled.")} className={linkButton}>Cancel</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal?.kind === "reject" && (
        <QuickForm title={`Reject leave of ${modal.leave.fullName}`} submitLabel="Reject" onClose={() => setModal(null)} fields={[{ name: "note", label: "Reason *", wide: true }]}
          onSubmit={async (body) => { await hrApi.decide(modal.leave.id, "REJECTED", body.note); setModal(null); setNotice("Leave rejected."); reload(); }} />
      )}
      {modal?.kind === "record" && (
        <QuickForm title="Record leave for an employee" submitLabel="Save Request" onClose={() => setModal(null)}
          fields={[
            { name: "person", label: "Employee *", type: "select", wide: true, options: modal.employees.map((e) => [`${e.personType}:${e.id}`, `${e.fullName} (${e.employeeNo}) · ${label(e.personType)}`]) },
            { name: "leaveTypeId", label: "Leave type *", type: "select", options: types.map((t) => [t.id, `${t.name}${t.isPaid ? "" : " (unpaid)"}`]) },
            { name: "fromDate", label: "From *", type: "date" },
            { name: "toDate", label: "To *", type: "date" },
            { name: "reason", label: "Reason *", wide: true },
          ]}
          onSubmit={async ({ person, ...body }) => {
            const [personType, personId] = (person || ":").split(":");
            await hrApi.recordLeave({ ...body, personType, personId });
            setModal(null);
            setStatus("PENDING");
            setNotice("Leave recorded. It still needs a decision.");
            reload();
          }} />
      )}
      {modal?.kind === "types" && <LeaveTypes types={types} onClose={() => setModal(null)} onChanged={reload} />}
    </SystemShell>
  );
}

function LeaveTypes({ types, onClose, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  if (editing) {
    return (
      <QuickForm title={editing.type ? `Edit ${editing.type.name}` : "New Leave Type"} initial={editing.type || { isPaid: true, daysPerYear: 10 }} onClose={() => setEditing(null)}
        fields={[
          { name: "name", label: "Name *" },
          { name: "daysPerYear", label: "Days per year (0 = no limit)", type: "number", min: 0 },
          { name: "isPaid", label: "Paid leave (unpaid days are deducted from basic pay)", type: "checkbox", wide: true },
        ]}
        onSubmit={async (body) => {
          if (editing.type) await hrApi.updateLeaveType(editing.type.id, body);
          else await hrApi.createLeaveType(body);
          setEditing(null);
          onChanged();
        }} />
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Leave types" onClick={(e) => e.stopPropagation()} className="my-4 w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-800">Leave Types</h2><button onClick={onClose} aria-label="Close" className="text-xl text-slate-400">×</button></div>
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {types.map((type) => (
            <li key={type.id} className="flex items-center justify-between py-2">
              <span>{type.name} · {type.daysPerYear || "no limit"} days · {type.isPaid ? "paid" : "unpaid"}</span>
              <span className="flex gap-3">
                <button onClick={() => setEditing({ type })} className={linkButton}>Edit</button>
                <button onClick={async () => { setError(""); try { await hrApi.removeLeaveType(type.id); onChanged(); } catch (err) { setError(friendlyError(err)); } }} className={dangerButton}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
        <button onClick={() => setEditing({})} className={`${primaryButton} mt-4`}>New Leave Type</button>
      </div>
    </div>
  );
}
