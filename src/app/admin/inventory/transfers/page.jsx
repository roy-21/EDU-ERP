"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, filterClass, formatDateTime, friendlyError, linkButton, primaryButton, useData } from "@/components/erp/ui";
import { CRUMBS, Notice, StockDocumentForm, TRANSFER_LABELS, TransferBadge, qty } from "../_components/inventoryUi";

export default function TransfersPage() {
  const { me, can, isReady } = useMe();
  const [status, setStatus] = useState("OPEN");
  const load = useCallback(() => Promise.all([inventoryApi.transfers({ status }), inventoryApi.items(), inventoryApi.stores()]), [status]);
  const { data, error, isLoading, reload } = useData(load);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [transfers, items, stores] = data || [[], [], []];

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const canMove = can("inventory.transfer_stock", "inventory.approve");
  const canApprove = can("inventory.approve");

  const act = async (work, text) => {
    setActionError("");
    try {
      const transfer = await work();
      if (!transfer) return;
      setNotice(`${transfer.transferNo}: ${text}`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const ask = (question, required) => {
    const answer = window.prompt(question);
    if (answer === null) return null;
    if (required && !answer.trim()) {
      setActionError("A reason is required.");
      return null;
    }
    return answer;
  };

  return (
    <SystemShell title="Store Transfers" subtitle="Requested, approved (stock leaves the source), then received (stock arrives). Nothing moves until it is approved." crumbs={CRUMBS}
      actions={canMove && <button disabled={stores.filter((s) => s.isActive).length < 2} onClick={() => setRequesting(true)} className={primaryButton}>Request Transfer</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      {!isLoading && stores.filter((s) => s.isActive).length < 2 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Transfers need at least two open stores.</p>}
      <select aria-label="Transfer status" value={status} onChange={(e) => setStatus(e.target.value)} className={filterClass}>
        <option value="OPEN">Open (pending or in transit)</option>
        {Object.entries(TRANSFER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        <option value="">All</option>
      </select>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Transfer", "From → To", "Items", "Status", "Requested", "Decision", "Actions"]} isLoading={isLoading} hasRows={transfers.length > 0} emptyMessage="No transfers here." minWidth="min-w-[960px]">
          {transfers.map((t) => (
            <tr key={t.id} className="border-b border-slate-100 align-top">
              <td className="px-4 py-3 font-mono text-xs">{t.transferNo}{t.note && <span className="mt-1 block font-sans text-slate-500">{t.note}</span>}</td>
              <td className="px-4 py-3">{t.fromStore} <span className="text-slate-400">→</span> {t.toStore}</td>
              <td className="px-4 py-3">
                <ul className="space-y-0.5 text-xs">
                  {t.lines.map((line) => <li key={line.itemId}><span className="font-medium">{qty(line.quantity)} {line.unit}</span> {line.name}</li>)}
                </ul>
              </td>
              <td className="px-4 py-3"><TransferBadge status={t.status} /></td>
              <td className="px-4 py-3 text-xs">{formatDateTime(t.createdAt)}<span className="block text-slate-500">{t.requestedBy}</span></td>
              <td className="px-4 py-3 text-xs">
                {t.approvedBy ? <>{t.approvedBy}<span className="block text-slate-500">{formatDateTime(t.approvedAt)}</span></> : "—"}
                {t.decisionNote && <span className="block text-slate-500">{t.decisionNote}</span>}
                {t.receivedBy && <span className="block text-green-700">Received by {t.receivedBy}</span>}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  {t.status === "PENDING" && canApprove && (
                    <button onClick={() => window.confirm(`Approve ${t.transferNo}? The stock leaves ${t.fromStore} now.`) && act(() => inventoryApi.approveTransfer(t.id), "approved and sent.")} className={linkButton}>Approve</button>
                  )}
                  {t.status === "PENDING" && canApprove && (
                    <button onClick={() => { const note = ask(`Reject ${t.transferNo}? Reason:`, true); if (note !== null) act(() => inventoryApi.rejectTransfer(t.id, note), "rejected."); }} className={dangerButton}>Reject</button>
                  )}
                  {t.status === "PENDING" && (canApprove || (canMove && t.requestedBy === me?.email)) && (
                    <button onClick={() => { const note = ask(`Cancel ${t.transferNo}? Reason (optional):`, false); if (note !== null) act(() => inventoryApi.cancelTransfer(t.id, note), "cancelled."); }} className={dangerButton}>Cancel</button>
                  )}
                  {t.status === "IN_TRANSIT" && canMove && (
                    <button onClick={() => window.confirm(`Confirm everything on ${t.transferNo} arrived at ${t.toStore}?`) && act(() => inventoryApi.receiveTransfer(t.id), "received.")} className={linkButton}>Receive</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {requesting && (
        <StockDocumentForm mode="transfer" items={items} stores={stores} onClose={() => setRequesting(false)}
          onSubmit={async (body) => {
            const transfer = await inventoryApi.requestTransfer(body);
            setRequesting(false);
            setNotice(`${transfer.transferNo} requested. It waits for approval.`);
            reload();
          }} />
      )}
    </SystemShell>
  );
}
