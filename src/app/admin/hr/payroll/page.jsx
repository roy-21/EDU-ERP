"use client";

import { useCallback, useState } from "react";
import { hrApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, ViewModal, dangerButton, filterClass, formatDateTime, friendlyError, linkButton, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

const STATUS_STYLES = { DRAFT: "bg-amber-100 text-amber-700", APPROVED: "bg-blue-100 text-blue-700", PAID: "bg-green-100 text-green-700" };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function printPayslip(slip, month) {
  const win = window.open("", "_blank", "width=640,height=720");
  if (!win) return;
  const rows = [["Month", month], ["Employee", `${slip.fullName} (${slip.employeeNo})`], ["Designation", slip.designation || "—"], ["Bank account", slip.bankAccount || "—"],
    ["Basic", money(slip.basic)], ["Allowances", money(slip.allowances)], ["Deductions", `− ${money(slip.deductions)}`],
    ["Unpaid leave", `${slip.unpaidLeaveDays} days · − ${money(slip.leaveDeduction)}`], ["Net pay", money(slip.netPay)]];
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${escape(month)}</title>
    <style>body{font-family:Arial,sans-serif;padding:32px;color:#0f172a}td{padding:8px 4px;border-bottom:1px solid #e2e8f0}td:first-child{color:#64748b;width:40%}tr:last-child td{font-weight:bold}</style></head>
    <body><h1 style="font-size:20px">Payslip</h1><table>${rows.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join("")}</table>
    <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

function RunView({ runId, can, onClose, onChanged }) {
  const load = useCallback(() => hrApi.payroll(runId), [runId]);
  const { data: run, error, reload } = useData(load);
  const [actionError, setActionError] = useState("");
  const act = async (work, close = false) => {
    setActionError("");
    try {
      await work();
      onChanged();
      if (close) onClose();
      else reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };
  const actions = run && (
    <>
      {run.status === "DRAFT" && can("hr.create") && <button onClick={() => act(() => hrApi.buildPayroll(run.month))} className={secondaryButton}>Rebuild</button>}
      {run.status === "DRAFT" && can("hr.approve") && <button onClick={() => window.confirm("Approve? The payslips are then fixed and employees can see them.") && act(() => hrApi.approvePayroll(run.id))} className={primaryButton}>Approve</button>}
      {run.status === "APPROVED" && can("hr.approve") && <button onClick={() => window.confirm("Mark this payroll as paid out?") && act(() => hrApi.markPaid(run.id))} className={primaryButton}>Mark Paid</button>}
      {run.status === "DRAFT" && can("hr.delete") && <button onClick={() => window.confirm("Delete this draft?") && act(() => hrApi.removePayroll(run.id), true)} className={dangerButton}>Delete Draft</button>}
    </>
  );
  return (
    <ViewModal title={run ? `Payroll ${run.month}` : "Payroll"} onClose={onClose} wide actions={actions}>
      {(error || actionError) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error || actionError}</p>}
      {run && (
        <>
          <p className="text-sm text-slate-600">
            <span className={`mr-2 rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[run.status]}`}>{label(run.status)}</span>
            {run.employees} payslips · gross {money(run.gross)} · deductions {money(run.deductions)} · net {money(run.netPay)}
            {run.approvedAt && ` · approved by ${run.approvedBy} ${formatDateTime(run.approvedAt)}`}
          </p>
          <DataTable columns={["Employee", "Basic", "Allowances", "Deductions", "Unpaid leave", "Net pay", ""]} hasRows={run.payslips.length > 0} emptyMessage="No payslips: nobody active has a salary with a basic above zero." minWidth="min-w-[720px]">
            {run.payslips.map((slip) => (
              <tr key={slip.id} className="border-b border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{slip.fullName}<span className="block text-xs text-slate-500">{slip.employeeNo} · {slip.designation}</span></td>
                <td className="px-4 py-2">{money(slip.basic)}</td>
                <td className="px-4 py-2">{money(slip.allowances)}</td>
                <td className="px-4 py-2">{money(slip.deductions)}</td>
                <td className="px-4 py-2">{slip.unpaidLeaveDays ? `${slip.unpaidLeaveDays}d · ${money(slip.leaveDeduction)}` : "—"}</td>
                <td className="px-4 py-2 font-semibold">{money(slip.netPay)}</td>
                <td className="px-4 py-2"><button onClick={() => printPayslip(slip, run.month)} className={linkButton}>Payslip</button></td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </ViewModal>
  );
}

const loadRuns = () => hrApi.payrolls();

export default function PayrollPage() {
  const { can, isReady } = useMe();
  const { data, error, isLoading, reload } = useData(loadRuns);
  const [month, setMonth] = useState(thisMonth());
  const [openId, setOpenId] = useState(null);
  const [actionError, setActionError] = useState("");

  if (isReady && !can("hr.read")) return <NoAccess />;
  const rows = data || [];

  const build = async () => {
    setActionError("");
    try {
      const run = await hrApi.buildPayroll(month);
      reload();
      setOpenId(run.id);
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Payroll" subtitle="Build a month from current salaries and approved unpaid leave, check it, approve it, then mark it paid. Money is paid outside the system."
      crumbs={[{ href: "/admin/hr", label: "HR" }]}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {can("hr.create") && (
        <div className="flex flex-wrap items-center gap-3">
          <input aria-label="Payroll month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={filterClass} />
          <button onClick={build} disabled={!month} className={`${primaryButton} disabled:opacity-50`}>Build Payroll</button>
          <span className="text-xs text-slate-500">Building again replaces a draft. Approved months cannot change.</span>
        </div>
      )}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Month", "Payslips", "Gross", "Deductions", "Net pay", "Status", ""]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="No payrolls yet. Set salaries on the Employees page, then build a month.">
          {rows.map((run) => (
            <tr key={run.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{run.month}</td>
              <td className="px-4 py-3">{run.employees}</td>
              <td className="px-4 py-3">{money(run.gross)}</td>
              <td className="px-4 py-3">{money(run.deductions)}</td>
              <td className="px-4 py-3 font-semibold">{money(run.netPay)}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[run.status]}`}>{label(run.status)}</span></td>
              <td className="px-4 py-3"><button onClick={() => setOpenId(run.id)} className={linkButton} aria-label={`Open payroll ${run.month}`}>Open</button></td>
            </tr>
          ))}
        </DataTable>
      </section>
      {openId && <RunView runId={openId} can={can} onClose={() => setOpenId(null)} onChanged={reload} />}
    </SystemShell>
  );
}
