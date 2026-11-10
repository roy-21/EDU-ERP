"use client";

import { useCallback, useState } from "react";
import { hrApi } from "@/lib/operationsApi";
import QuickForm, { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, SystemShell, friendlyError, linkButton, money, primaryButton, useData } from "@/components/erp/ui";

const STATUS_STYLES = { PENDING: "bg-amber-100 text-amber-700", APPROVED: "bg-green-100 text-green-700", REJECTED: "bg-red-100 text-red-700", CANCELLED: "bg-slate-100 text-slate-500" };

// A teacher's or staff member's own leave and payslips. Needs no HR permission, only a linked account.
export default function MyHrPage() {
  const load = useCallback(() => Promise.all([hrApi.me(), hrApi.leaveTypes()]), []);
  const { data, error, isLoading, reload } = useData(load);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [me, types] = data || [null, []];

  const withdraw = async (leave) => {
    if (!window.confirm("Withdraw this request?")) return;
    setActionError("");
    try {
      await hrApi.withdrawLeave(leave.id);
      setNotice("Request withdrawn.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="My Leave & Payslips" subtitle={me ? `${me.employee.fullName} · ${me.employee.employeeNo}` : "Your own leave balance, requests and payslips."}
      actions={me && types.length > 0 && <button onClick={() => setApplying(true)} className={primaryButton}>Apply for Leave</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {me && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {me.balances.map((balance) => (
              <div key={balance.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-500">{balance.name}{balance.isPaid ? "" : " (unpaid)"}</p>
                <p className="mt-1 text-2xl font-bold text-slate-800">{balance.remaining ?? "∞"}</p>
                <p className="text-xs text-slate-500">left · {balance.used} used{balance.pending ? ` · ${balance.pending} waiting` : ""}</p>
              </div>
            ))}
          </div>
          <section className="rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 p-4 font-semibold text-slate-800">My requests</h2>
            <DataTable columns={["Type", "From", "To", "Days", "Reason", "Status", ""]} hasRows={me.requests.length > 0} emptyMessage="No leave requests yet." minWidth="min-w-[640px]">
              {me.requests.map((leave) => (
                <tr key={leave.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">{leave.leaveType}</td>
                  <td className="px-4 py-3">{leave.fromDate}</td>
                  <td className="px-4 py-3">{leave.toDate}</td>
                  <td className="px-4 py-3">{leave.days}</td>
                  <td className="px-4 py-3 text-xs">{leave.reason}{leave.decisionNote && <span className="block text-slate-500">Note: {leave.decisionNote}</span>}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[leave.status]}`}>{label(leave.status)}</span></td>
                  <td className="px-4 py-3">{leave.status === "PENDING" && <button onClick={() => withdraw(leave)} className={linkButton}>Withdraw</button>}</td>
                </tr>
              ))}
            </DataTable>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 p-4 font-semibold text-slate-800">My payslips</h2>
            <DataTable columns={["Month", "Basic", "Allowances", "Deductions", "Unpaid leave", "Net pay", "Status"]} hasRows={me.payslips.length > 0} emptyMessage="No approved payslips yet." minWidth="min-w-[640px]">
              {me.payslips.map((slip) => (
                <tr key={slip.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium">{slip.month}</td>
                  <td className="px-4 py-3">{money(slip.basic)}</td>
                  <td className="px-4 py-3">{money(slip.allowances)}</td>
                  <td className="px-4 py-3">{money(slip.deductions)}</td>
                  <td className="px-4 py-3">{slip.unpaidLeaveDays ? `${slip.unpaidLeaveDays}d · ${money(slip.leaveDeduction)}` : "—"}</td>
                  <td className="px-4 py-3 font-semibold">{money(slip.netPay)}</td>
                  <td className="px-4 py-3">{label(slip.runStatus)}</td>
                </tr>
              ))}
            </DataTable>
          </section>
        </>
      )}
      {applying && (
        <QuickForm title="Apply for Leave" submitLabel="Send Request" onClose={() => setApplying(false)}
          fields={[
            { name: "leaveTypeId", label: "Leave type *", type: "select", options: types.map((t) => [t.id, `${t.name}${t.isPaid ? "" : " (unpaid)"}`]) },
            { name: "fromDate", label: "From *", type: "date" },
            { name: "toDate", label: "To *", type: "date" },
            { name: "reason", label: "Reason *", wide: true },
          ]}
          onSubmit={async (body) => { await hrApi.applyLeave(body); setApplying(false); setNotice("Request sent. You will see the decision here."); reload(); }} />
      )}
    </SystemShell>
  );
}
