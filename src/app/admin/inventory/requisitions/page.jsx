"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { todayLocal } from "@/components/erp/QuickForm";
import {
  DataTable, Detail, ErrorBanner, Field, FormModal, NoAccess, SystemShell, ViewModal, dangerButton, filterClass, formatDateTime, friendlyError,
  inputClass, linkButton, primaryButton, secondaryButton, useData,
} from "@/components/erp/ui";
import { Pager, usePagination } from "@/app/admin/hostel/_components/hostelUi";
import { downloadCsv } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, ExpenseCategoryInput, ItemPicker, Notice, REQ_LABELS, RequisitionBadge, qty } from "../_components/inventoryUi";

const CSV_COLUMNS = [
  { label: "Requisition", value: (r) => r.reqNo },
  { label: "Raised", value: (r) => r.createdAt },
  { label: "Requested by", value: (r) => r.requestedBy },
  { label: "For", value: (r) => r.destination },
  { label: "Purpose", value: (r) => r.purpose },
  { label: "Expense category", value: (r) => r.expenseCategory },
  { label: "Needed by", value: (r) => r.neededBy },
  { label: "Status", value: (r) => REQ_LABELS[r.status] },
  { label: "Items", value: (r) => r.lines.map((l) => `${l.name} ${l.requested}/${l.approved}/${l.issued} ${l.unit}`).join("; ") },
  { label: "Decided by", value: (r) => r.decidedBy },
  { label: "Received by", value: (r) => r.receivedBy },
];

// Raising a requisition: where it is for, why, and the items.
function NewRequisition({ catalog, onClose, onSaved }) {
  const [head, setHead] = useState({ destination: "", purpose: "", neededBy: "", expenseCategory: "" });
  const [lines, setLines] = useState([]);
  const set = (patch) => setHead((current) => ({ ...current, ...patch }));

  const submit = async () => {
    if (lines.length === 0) throw new Error("Add at least one item.");
    onSaved(await inventoryApi.createRequisition({
      ...head, neededBy: head.neededBy || null,
      lines: lines.map((line) => ({ itemId: line.item.id, quantity: Number(line.quantity) })),
    }));
  };

  return (
    <FormModal title="New Requisition" submitLabel="Submit for approval" onSubmit={submit} onClose={onClose}>
      <Field id="req-dest" label="Needed for (department, room or place) *">
        <input id="req-dest" value={head.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="e.g. CSE Department, Room 204, Kitchen" className={inputClass} />
      </Field>
      <Field id="req-needed" label="Needed by">
        <input id="req-needed" type="date" min={todayLocal()} value={head.neededBy} onChange={(e) => set({ neededBy: e.target.value })} className={inputClass} />
      </Field>
      <Field id="req-purpose" label="Purpose *" wide>
        <input id="req-purpose" value={head.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="e.g. Mid-term exam papers" className={inputClass} />
      </Field>
      <Field id="req-category" label="Expense category">
        <ExpenseCategoryInput id="req-category" value={head.expenseCategory} onChange={(value) => set({ expenseCategory: value })} />
      </Field>
      <ItemPicker id="req-item" items={catalog} exclude={lines.map((line) => line.item.id)}
        onPick={(item) => setLines((current) => [...current, { item, quantity: "" }])} />
      <div className="sm:col-span-2">
        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No items yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2">In stores</th><th className="py-2">Quantity</th><th /></tr></thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.item.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2">{line.item.name}<span className="block font-mono text-xs text-slate-500">{line.item.sku}</span></td>
                  <td className="py-2 pr-2 text-slate-600">{qty(line.item.onHand)} {line.item.unit}</td>
                  <td className="py-2 pr-2">
                    <input aria-label={`Quantity of ${line.item.name}`} type="number" min="0" step="any" value={line.quantity} className={`${inputClass} w-28`}
                      onChange={(e) => setLines((current) => current.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))} />
                  </td>
                  <td className="py-2"><button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-sm font-medium text-red-600 hover:text-red-800">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </FormModal>
  );
}

// Approving: the approver can cut each line down, or to zero.
function ApproveForm({ requisition, onClose, onDone }) {
  const [approved, setApproved] = useState(() => Object.fromEntries(requisition.lines.map((line) => [line.itemId, String(line.requested)])));
  const [note, setNote] = useState("");
  const submit = async () => {
    onDone(await inventoryApi.approveRequisition(requisition.id, {
      note, lines: requisition.lines.map((line) => ({ itemId: line.itemId, approved: Number(approved[line.itemId] || 0) })),
    }), "approved");
  };
  return (
    <FormModal title={`Approve ${requisition.reqNo}`} submitLabel="Approve" onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-slate-600 sm:col-span-2">For <span className="font-medium">{requisition.destination}</span>: {requisition.purpose}. Lower a quantity to approve part of it, or 0 to leave it out.</p>
      <div className="sm:col-span-2">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2">Asked</th><th className="py-2">In stores</th><th className="py-2">Approve</th></tr></thead>
          <tbody>
            {requisition.lines.map((line) => (
              <tr key={line.itemId} className="border-b border-slate-100">
                <td className="py-2 pr-2">{line.name}</td>
                <td className="py-2 pr-2 tabular-nums">{qty(line.requested)} {line.unit}</td>
                <td className={`py-2 pr-2 tabular-nums ${line.onHand < line.requested ? "text-amber-700" : "text-slate-600"}`}>{qty(line.onHand)}</td>
                <td className="py-2"><input aria-label={`Approve quantity of ${line.name}`} type="number" min="0" max={line.requested} step="any" value={approved[line.itemId]}
                  onChange={(e) => setApproved({ ...approved, [line.itemId]: e.target.value })} className={`${inputClass} w-28`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field id="approve-note" label="Note" wide>
        <input id="approve-note" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </Field>
    </FormModal>
  );
}

// Issuing: from which store, and how much of what is still to issue.
function IssueForm({ requisition, stores, onClose, onDone }) {
  const open = stores.filter((store) => store.isActive);
  const [storeId, setStoreId] = useState(requisition.storeId || open[0]?.id || "");
  const [amounts, setAmounts] = useState(() => Object.fromEntries(requisition.lines.map((line) => [line.itemId, String(line.toIssue)])));
  const [note, setNote] = useState("");
  const submit = async () => {
    const result = await inventoryApi.issueRequisition(requisition.id, {
      storeId, note, lines: requisition.lines.filter((line) => line.toIssue > 0).map((line) => ({ itemId: line.itemId, quantity: Number(amounts[line.itemId] || 0) })),
    });
    onDone(result.requisition, `issued with ${result.document.docNo}`);
  };
  return (
    <FormModal title={`Issue ${requisition.reqNo}`} submitLabel="Issue" onSubmit={submit} onClose={onClose}>
      <Field id="issue-store" label="Issue from store *">
        <select id="issue-store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputClass}>
          {open.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}
        </select>
      </Field>
      <Field id="issue-note" label="Note">
        <input id="issue-note" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2">Approved</th><th className="py-2">Issued</th><th className="py-2">Issue now</th></tr></thead>
          <tbody>
            {requisition.lines.filter((line) => line.approved > 0).map((line) => (
              <tr key={line.itemId} className="border-b border-slate-100">
                <td className="py-2 pr-2">{line.name}</td>
                <td className="py-2 pr-2 tabular-nums">{qty(line.approved)} {line.unit}</td>
                <td className="py-2 pr-2 tabular-nums">{qty(line.issued)}</td>
                <td className="py-2">{line.toIssue > 0 ? (
                  <input aria-label={`Issue quantity of ${line.name}`} type="number" min="0" max={line.toIssue} step="any" value={amounts[line.itemId]}
                    onChange={(e) => setAmounts({ ...amounts, [line.itemId]: e.target.value })} className={`${inputClass} w-28`} />
                ) : <span className="text-xs text-green-700">Done</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Issue less now and the rest later. Batch-tracked items go first-expiry-first-out.</p>
      </div>
    </FormModal>
  );
}

function RequisitionView({ id, onClose }) {
  const load = useCallback(() => inventoryApi.requisition(id), [id]);
  const { data: req, error } = useData(load);
  return (
    <ViewModal title={req ? `${req.reqNo} · ${req.destination}` : "Requisition"} onClose={onClose}>
      <ErrorBanner message={error} />
      {!req ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Detail label="Status" value={REQ_LABELS[req.status]} />
            <Detail label="Requested by" value={req.requestedBy} />
            <Detail label="Raised" value={formatDateTime(req.createdAt)} />
            <Detail label="Purpose" value={req.purpose} />
            <Detail label="Expense category" value={req.expenseCategory} />
            <Detail label="Needed by" value={req.neededBy} />
            <Detail label="Decided by" value={req.decidedBy && `${req.decidedBy} · ${formatDateTime(req.decidedAt)}`} />
            <Detail label="Decision note" value={req.decisionNote} />
            <Detail label="Issued from" value={req.storeName} />
            <Detail label="Received by" value={req.receivedBy && `${req.receivedBy} · ${formatDateTime(req.receivedAt)}`} />
            <Detail label="Receipt note" value={req.receiveNote} />
            <Detail label="Issue documents" value={req.issueDocs.join(", ")} />
          </div>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2">Asked</th><th className="py-2">Approved</th><th className="py-2">Issued</th></tr></thead>
            <tbody>
              {req.lines.map((line) => (
                <tr key={line.itemId} className="border-b border-slate-100">
                  <td className="py-2">{line.name}<span className="ml-2 font-mono text-xs text-slate-500">{line.sku}</span></td>
                  <td className="py-2 tabular-nums">{qty(line.requested)} {line.unit}</td>
                  <td className="py-2 tabular-nums">{["SUBMITTED", "REJECTED", "CANCELLED"].includes(req.status) && line.approved === 0 ? "—" : qty(line.approved)}</td>
                  <td className="py-2 tabular-nums">{qty(line.issued)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ViewModal>
  );
}

export default function RequisitionsPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ status: "OPEN", search: "", mine: "" });
  const seesAll = can("inventory.read");
  const load = useCallback(() => Promise.all([
    inventoryApi.requisitions(filters),
    inventoryApi.requisitionCatalog(),
    seesAll ? inventoryApi.stores() : Promise.resolve([]),
  ]), [filters, seesAll]);
  const { data, error, isLoading, reload } = useData(load);
  const [form, setForm] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [requisitions, catalog, stores] = data || [[], [], []];
  const { pageItems, pagerProps } = usePagination(requisitions, 25);

  if (isReady && !can("inventory.read", "inventory.request_items")) return <NoAccess />;

  const done = (req, what) => {
    setForm(null);
    setNotice(`${req.reqNo} ${what}.`);
    reload();
  };

  const act = async (work, what) => {
    setActionError("");
    try {
      done(await work(), what);
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const ask = (message, required) => {
    const value = window.prompt(message);
    if (value === null || (required && !value.trim())) return null;
    return value;
  };

  return (
    <SystemShell title="Requisitions" crumbs={CRUMBS}
      subtitle={seesAll ? "Requests for stock from departments, rooms and staff: approve, issue and track them." : "Ask the store for items and follow your requests."}
      actions={<>
        {seesAll && can("inventory.export") && <button onClick={() => downloadCsv(`requisitions-${todayLocal()}.csv`, CSV_COLUMNS, requisitions)} className={secondaryButton}>Export CSV</button>}
        {can("inventory.request_items") && <button onClick={() => setForm({ type: "new" })} className={primaryButton}>New Requisition</button>}
      </>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Search requisitions" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Number, place, purpose, person" className={`${filterClass} min-w-[15rem]`} />
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="OPEN">Open</option>
          {Object.entries(REQ_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="">All</option>
        </select>
        {seesAll && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={filters.mine === "1"} onChange={(e) => setFilters({ ...filters, mine: e.target.checked ? "1" : "" })} /> Only mine
          </label>
        )}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Requisition", "For", "Items", "Requested by", "Status", "Actions"]} isLoading={isLoading} hasRows={requisitions.length > 0}
          emptyMessage={filters.status === "OPEN" ? "No open requisitions." : "No requisitions match."} minWidth="min-w-[960px]">
          {pageItems.map((req) => {
            const nothingIssued = req.lines.every((line) => line.issued === 0);
            return (
              <tr key={req.id} className="border-b border-slate-100 align-top">
                <td className="px-4 py-3"><button onClick={() => setViewing(req.id)} className="font-mono text-xs text-blue-700 hover:underline">{req.reqNo}</button>
                  <span className="block text-xs text-slate-500">{formatDateTime(req.createdAt)}</span>
                  {req.neededBy && <span className="block text-xs text-amber-700">Needed by {req.neededBy}</span>}</td>
                <td className="px-4 py-3"><span className="font-medium text-slate-800">{req.destination}</span><span className="block text-xs text-slate-500">{req.purpose}</span></td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {req.lines.map((line) => (
                    <span key={line.itemId} className="block">{line.name}: {qty(line.requested)}{line.approved > 0 && line.approved !== line.requested ? ` → ${qty(line.approved)}` : ""} {line.unit}{line.issued > 0 ? ` (issued ${qty(line.issued)})` : ""}</span>
                  ))}
                </td>
                <td className="px-4 py-3 text-xs">{req.requestedBy}{req.isMine && <span className="block text-blue-700">You</span>}</td>
                <td className="px-4 py-3"><RequisitionBadge status={req.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex max-w-xs flex-wrap gap-x-3 gap-y-1">
                    {req.status === "SUBMITTED" && can("inventory.approve") && <>
                      <button onClick={() => setForm({ type: "approve", req })} className={linkButton}>Approve</button>
                      <button onClick={() => { const note = ask(`Reject ${req.reqNo}? Reason:`, true); if (note) act(() => inventoryApi.rejectRequisition(req.id, note), "rejected"); }} className={dangerButton}>Reject</button>
                    </>}
                    {["APPROVED", "PARTIAL"].includes(req.status) && can("inventory.manage_stock") && <button onClick={() => setForm({ type: "issue", req })} className={linkButton}>Issue</button>}
                    {["ISSUED", "PARTIAL"].includes(req.status) && (req.isMine || can("inventory.manage_stock")) && (
                      <button onClick={() => { const note = ask(`Confirm that ${req.destination} received the items of ${req.reqNo}? Anything not issued yet will no longer be expected. Note (optional):`); if (note !== null) act(() => inventoryApi.confirmRequisition(req.id, note), "confirmed as received"); }} className={linkButton}>Confirm received</button>
                    )}
                    {req.status === "PARTIAL" && can("inventory.approve") && (
                      <button onClick={() => { const note = ask(`Close ${req.reqNo} short? The rest will not be issued. Reason:`, true); if (note) act(() => inventoryApi.closeRequisition(req.id, note), "closed"); }} className={linkButton}>Close short</button>
                    )}
                    {["SUBMITTED", "APPROVED"].includes(req.status) && nothingIssued && (req.isMine || can("inventory.approve")) && (
                      <button onClick={() => { const note = ask(`Cancel ${req.reqNo}? Reason (optional):`); if (note !== null) act(() => inventoryApi.cancelRequisition(req.id, note), "cancelled"); }} className={dangerButton}>Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
        <div className="px-4 pb-3"><Pager {...pagerProps} /></div>
      </section>
      {form?.type === "new" && <NewRequisition catalog={catalog} onClose={() => setForm(null)} onSaved={(req) => done(req, "submitted for approval")} />}
      {form?.type === "approve" && <ApproveForm requisition={form.req} onClose={() => setForm(null)} onDone={done} />}
      {form?.type === "issue" && <IssueForm requisition={form.req} stores={stores} onClose={() => setForm(null)} onDone={done} />}
      {viewing && <RequisitionView id={viewing} onClose={() => setViewing(null)} />}
    </SystemShell>
  );
}
