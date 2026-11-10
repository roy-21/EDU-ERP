"use client";

import { useCallback, useState } from "react";
import { financeApi } from "@/lib/operationsApi";
import QuickForm, { label, todayLocal } from "@/components/erp/QuickForm";
import { Detail, ViewModal, formatDateTime, friendlyError, money, secondaryButton, primaryButton, useData } from "@/components/erp/ui";

export const METHODS = ["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "CHEQUE", "OTHER"];

const STATE_STYLES = {
  PAID: "bg-green-100 text-green-700",
  PARTIAL: "bg-blue-100 text-blue-700",
  UNPAID: "bg-slate-100 text-slate-700",
  OVERDUE: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-200 text-slate-500 line-through",
  CONFIRMED: "bg-green-100 text-green-700",
  REVERSED: "bg-red-100 text-red-700",
};

export function StateBadge({ state }) {
  return <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATE_STYLES[state] || "bg-slate-100 text-slate-700"}`}>{label(state)}</span>;
}

// Opens a print window with a receipt. Only text we put in, escaped, goes into the page.
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function printReceipt(payment) {
  const win = window.open("", "_blank", "width=640,height=720");
  if (!win) return;
  const rows = [
    ["Receipt", payment.receiptNumber], ["Date", payment.paidOn], ["Student", `${payment.studentName} (${payment.studentNo})`],
    ["Invoice", `${payment.invoiceNumber} · ${payment.invoiceTitle}`], ["Method", label(payment.method)], ["Reference", payment.reference || "—"],
    ["Amount", money(payment.amount)], ["Received by", payment.recordedBy || "—"], ["Status", label(payment.status)],
  ];
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(payment.receiptNumber)}</title>
    <style>body{font-family:Arial,sans-serif;padding:32px;color:#0f172a}h1{font-size:20px}td{padding:8px 4px;border-bottom:1px solid #e2e8f0}td:first-child{color:#64748b;width:40%}.void{color:#dc2626;font-weight:bold}</style></head>
    <body><h1>Payment Receipt</h1>${payment.status === "REVERSED" ? '<p class="void">REVERSED — this receipt is void.</p>' : ""}
    <table>${rows.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join("")}</table>
    <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

// The full invoice with its lines, adjustments and payments, and what the user may do with it.
export function InvoiceView({ invoiceId, can, onClose, onChanged }) {
  const load = useCallback(() => financeApi.invoice(invoiceId), [invoiceId]);
  const { data: invoice, error, reload } = useData(load);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState("");

  const done = (text) => {
    setForm(null);
    setMessage(text);
    reload();
    onChanged?.();
  };

  const open = invoice?.status === "ISSUED";
  const actions = invoice && (
    <>
      {open && invoice.outstanding > 0 && can("finance.create") && <button onClick={() => setForm("pay")} className={primaryButton}>Record Payment</button>}
      {open && can("finance.approve") && <button onClick={() => setForm("adjust")} className={secondaryButton}>Waiver / Fine</button>}
      {open && invoice.paidAmount === 0 && can("finance.delete") && <button onClick={() => setForm("cancel")} className={secondaryButton}>Cancel Invoice</button>}
    </>
  );

  return (
    <ViewModal title={invoice ? `${invoice.invoiceNumber} · ${invoice.title}` : "Invoice"} onClose={onClose} wide actions={actions}>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
      {invoice && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Detail label="Student" value={`${invoice.studentName} (${invoice.studentNo})`} />
            <Detail label="Program" value={invoice.programName} />
            <Detail label="Issued" value={invoice.issuedOn} />
            <Detail label="Due" value={invoice.dueDate} />
            <Detail label="Amount due" value={money(invoice.amountDue)} />
            <Detail label="Paid" value={money(invoice.paidAmount)} />
            <Detail label="Outstanding" value={money(invoice.outstanding)} />
            <div><p className="text-xs text-slate-500">Status</p><div className="mt-1"><StateBadge state={invoice.state} /></div></div>
          </div>
          {invoice.status === "CANCELLED" && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">Cancelled: {invoice.cancelReason}</p>}
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2">Item</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody>
              {invoice.items.map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="py-2">{item.description}</td><td className="py-2 text-right">{money(item.amount)}</td></tr>)}
              {invoice.adjustments.map((adj) => (
                <tr key={adj.id} className="border-b border-slate-100 text-slate-600">
                  <td className="py-2">{label(adj.kind)}: {adj.reason} <span className="text-xs text-slate-400">by {adj.createdBy}</span></td>
                  <td className={`py-2 text-right ${adj.amount < 0 ? "text-green-700" : "text-red-600"}`}>{adj.amount < 0 ? "−" : "+"}{money(Math.abs(adj.amount))}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2">Total due</td><td className="py-2 text-right">{money(invoice.amountDue)}</td></tr>
            </tbody>
          </table>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Payments</h3>
            {invoice.payments.length === 0 ? <p className="text-sm text-slate-500">No payments yet.</p> : (
              <table className="w-full text-left text-sm">
                <tbody>
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-slate-100">
                      <td className="py-2 font-mono text-xs">{payment.receiptNumber}</td>
                      <td className="py-2">{payment.paidOn}</td>
                      <td className="py-2">{label(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}</td>
                      <td className="py-2 text-right">{money(payment.amount)}</td>
                      <td className="py-2"><StateBadge state={payment.status} /></td>
                      <td className="py-2 text-right"><button onClick={() => printReceipt(payment)} className="text-sm font-medium text-blue-600 hover:text-blue-800">Receipt</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {form === "pay" && invoice && (
        <QuickForm title={`Record payment · owed ${money(invoice.outstanding)}`} submitLabel="Record Payment" onClose={() => setForm(null)}
          initial={{ amount: invoice.outstanding, method: "CASH", paidOn: todayLocal() }}
          fields={[
            { name: "amount", label: "Amount (৳) *", type: "number", step: "0.01" },
            { name: "method", label: "Method", type: "select", noBlank: true, options: METHODS.map((m) => [m, label(m)]) },
            { name: "paidOn", label: "Paid on", type: "date" },
            { name: "reference", label: "Transaction / cheque reference", hint: "Required for everything except cash." },
            { name: "notes", label: "Notes", wide: true },
          ]}
          onSubmit={async (body) => {
            const payment = await financeApi.pay({ ...body, invoiceId: invoice.id, idempotencyKey: crypto.randomUUID() });
            done(`Payment recorded. Receipt ${payment.receiptNumber}.`);
          }} />
      )}
      {form === "adjust" && invoice && (
        <QuickForm title="Waiver, discount or fine" submitLabel="Apply" onClose={() => setForm(null)} initial={{ kind: "WAIVER" }}
          fields={[
            { name: "kind", label: "Kind", type: "select", noBlank: true, options: [["WAIVER", "Waiver (lowers what is owed)"], ["DISCOUNT", "Discount (lowers what is owed)"], ["FINE", "Fine (raises what is owed)"]] },
            { name: "amount", label: "Amount (৳) *", type: "number", step: "0.01" },
            { name: "reason", label: "Reason *", wide: true },
          ]}
          onSubmit={async (body) => { await financeApi.adjust(invoice.id, body); done(`${label(body.kind)} applied.`); }} />
      )}
      {form === "cancel" && invoice && (
        <QuickForm title={`Cancel ${invoice.invoiceNumber}`} submitLabel="Cancel Invoice" onClose={() => setForm(null)}
          fields={[{ name: "reason", label: "Reason *", wide: true }]}
          onSubmit={async (body) => { await financeApi.cancel(invoice.id, body.reason); done("Invoice cancelled."); }} />
      )}
    </ViewModal>
  );
}

export { formatDateTime, friendlyError };
