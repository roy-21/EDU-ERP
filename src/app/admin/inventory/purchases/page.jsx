"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { todayLocal } from "@/components/erp/QuickForm";
import {
  DataTable, Detail, ErrorBanner, Field, FormModal, NoAccess, SystemShell, ViewModal, dangerButton, filterClass, formatDateTime,
  friendlyError, inputClass, linkButton, money, primaryButton, secondaryButton, useData,
} from "@/components/erp/ui";
import { printTable } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, ItemPicker, Notice, PO_LABELS, PoBadge, qty } from "../_components/inventoryUi";

const printOrder = (order) => {
  printTable(
    `Purchase Order ${order.poNo} · ${order.supplierName} · deliver to ${order.storeName} · ordered ${order.orderedOn}${order.expectedOn ? ` · expected ${order.expectedOn}` : ""} · total ${money(order.total)}`,
    [
      { label: "SKU", value: (l) => l.sku },
      { label: "Item", value: (l) => l.name },
      { label: "Quantity", value: (l) => `${qty(l.quantity)} ${l.unit}` },
      { label: "Unit price", value: (l) => money(l.unitCost) },
      { label: "Amount", value: (l) => money(l.value) },
      { label: "Received", value: (l) => qty(l.received) },
    ],
    order.lines
  );
};

function OrderForm({ order, items, stores, suppliers, onClose, onDone }) {
  const [head, setHead] = useState({
    supplierId: order?.supplierId || suppliers.find((s) => s.isActive)?.id || "",
    storeId: order?.storeId || stores.find((s) => s.isActive)?.id || "",
    orderedOn: order?.orderedOn || todayLocal(),
    expectedOn: order?.expectedOn || "",
    note: order?.note || "",
  });
  const [lines, setLines] = useState(() => (order?.lines || []).map((line) => ({
    item: items.find((item) => item.id === line.itemId) || { id: line.itemId, name: line.name, sku: line.sku, unit: line.unit, onHand: 0 },
    quantity: String(line.quantity), unitCost: String(line.unitCost),
  })));
  const setLine = (index, patch) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0);

  const submit = async () => {
    if (lines.length === 0) throw new Error("Add at least one item.");
    const body = { ...head, expectedOn: head.expectedOn || null, lines: lines.map((line) => ({ itemId: line.item.id, quantity: Number(line.quantity), unitCost: Number(line.unitCost || 0) })) };
    onDone(order ? await inventoryApi.updatePurchaseOrder(order.id, body) : await inventoryApi.createPurchaseOrder(body));
  };

  return (
    <FormModal title={order ? `Edit ${order.poNo}` : "New Purchase Order"} submitLabel={order ? "Save draft" : "Save as draft"} onSubmit={submit} onClose={onClose}>
      <Field id="po-supplier" label="Supplier *">
        <select id="po-supplier" value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })} className={inputClass}>
          <option value="">Choose...</option>
          {suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field id="po-store" label="Deliver to store *">
        <select id="po-store" value={head.storeId} onChange={(e) => setHead({ ...head, storeId: e.target.value })} className={inputClass}>
          {stores.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
        </select>
      </Field>
      <Field id="po-date" label="Order date">
        <input id="po-date" type="date" value={head.orderedOn} onChange={(e) => setHead({ ...head, orderedOn: e.target.value })} className={inputClass} />
      </Field>
      <Field id="po-expected" label="Expected delivery">
        <input id="po-expected" type="date" value={head.expectedOn} onChange={(e) => setHead({ ...head, expectedOn: e.target.value })} className={inputClass} />
      </Field>
      <Field id="po-note" label="Note / terms" wide>
        <input id="po-note" value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} className={inputClass} />
      </Field>
      <ItemPicker id="po-item" items={items.filter((item) => item.status === "ACTIVE")} exclude={lines.map((line) => line.item.id)}
        onPick={(item) => setLines((current) => [...current, { item, quantity: "", unitCost: String(item.avgCost || "") }])} />
      <div className="sm:col-span-2 overflow-x-auto">
        {lines.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No items yet.</p> : (
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2">Quantity</th><th className="py-2">Unit price (৳)</th><th className="py-2">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.item.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2">{line.item.name}<span className="block text-xs text-slate-500">{qty(line.item.onHand)} {line.item.unit} on hand</span></td>
                  <td className="py-2 pr-2"><input aria-label={`Quantity of ${line.item.name}`} type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} className={`${inputClass} w-28`} /></td>
                  <td className="py-2 pr-2"><input aria-label={`Unit price of ${line.item.name}`} type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => setLine(index, { unitCost: e.target.value })} className={`${inputClass} w-32`} /></td>
                  <td className="py-2 pr-2 tabular-nums">{money(Number(line.quantity || 0) * Number(line.unitCost || 0))}</td>
                  <td className="py-2"><button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-sm font-medium text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lines.length > 0 && <p className="mt-2 text-right text-sm font-semibold text-slate-700">Total {money(total)}</p>}
      </div>
    </FormModal>
  );
}

// A goods received note against an order: what came, at what price, in which batch.
function ReceiveForm({ order, onClose, onDone }) {
  const [head, setHead] = useState({ reference: "", note: "" });
  const [lines, setLines] = useState(() => order.lines.filter((line) => line.remaining > 0).map((line, index) => ({
    key: `${line.itemId}-${index}`, line, quantity: String(line.remaining), unitCost: String(line.unitCost), batchNo: "", expiresOn: "",
  })));
  const setLine = (index, patch) => setLines((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const submit = async () => {
    const chosen = lines.filter((row) => Number(row.quantity) > 0);
    if (chosen.length === 0) throw new Error("Enter a quantity for at least one item.");
    onDone(await inventoryApi.receivePurchaseOrder(order.id, {
      ...head,
      lines: chosen.map((row) => ({
        itemId: row.line.itemId, quantity: Number(row.quantity), unitCost: Number(row.unitCost),
        ...(row.line.trackBatches ? { batchNo: row.batchNo, expiresOn: row.expiresOn || undefined } : {}),
      })),
    }));
  };

  return (
    <FormModal title={`Receive goods · ${order.poNo}`} submitLabel="Post GRN" onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-slate-600 sm:col-span-2">From <span className="font-medium">{order.supplierName}</span> into <span className="font-medium">{order.storeName}</span>. Set 0 for what did not come; the rest stays due.</p>
      <Field id="grn-ref" label="Supplier invoice / challan no.">
        <input id="grn-ref" value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} className={inputClass} />
      </Field>
      <Field id="grn-note" label="Note">
        <input id="grn-note" value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} className={inputClass} />
      </Field>
      <div className="sm:col-span-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2">Due</th><th className="py-2">Received now</th><th className="py-2">Unit price</th><th /></tr></thead>
          <tbody>
            {lines.map((row, index) => (
              <tr key={row.key} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-2">{row.line.name}<span className="block font-mono text-xs text-slate-500">{row.line.sku}</span>
                  {row.line.trackBatches && (
                    <span className="mt-1 flex flex-wrap gap-2">
                      <input aria-label={`Batch number of ${row.line.name}`} placeholder="Batch no. *" value={row.batchNo} onChange={(e) => setLine(index, { batchNo: e.target.value })} className={`${inputClass} w-32`} />
                      <input aria-label={`Expiry date of ${row.line.name}`} type="date" title="Expiry date" value={row.expiresOn} onChange={(e) => setLine(index, { expiresOn: e.target.value })} className={`${inputClass} w-40`} />
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2 tabular-nums">{qty(row.line.remaining)} {row.line.unit}</td>
                <td className="py-2 pr-2"><input aria-label={`Received quantity of ${row.line.name}`} type="number" min="0" step="any" value={row.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} className={`${inputClass} w-28`} /></td>
                <td className="py-2 pr-2"><input aria-label={`Unit price of ${row.line.name}`} type="number" min="0" step="0.01" value={row.unitCost} onChange={(e) => setLine(index, { unitCost: e.target.value })} className={`${inputClass} w-28`} /></td>
                <td className="py-2">
                  {row.line.trackBatches && (
                    <button type="button" className={linkButton} onClick={() => setLines((current) => [...current.slice(0, index + 1), { ...row, key: `${row.key}-${Date.now()}`, quantity: "0", batchNo: "", expiresOn: "" }, ...current.slice(index + 1)])}>
                      + batch
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FormModal>
  );
}

function OrderView({ id, onClose }) {
  const load = useCallback(() => inventoryApi.purchaseOrder(id), [id]);
  const { data: order, error } = useData(load);
  return (
    <ViewModal title={order ? `${order.poNo} · ${order.supplierName}` : "Purchase order"} onClose={onClose} wide
      actions={order && <button onClick={() => printOrder(order)} className={secondaryButton}>Print / PDF</button>}>
      <ErrorBanner message={error} />
      {!order ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail label="Status" value={PO_LABELS[order.status]} />
            <Detail label="Deliver to" value={order.storeName} />
            <Detail label="Ordered / expected" value={`${order.orderedOn} → ${order.expectedOn || "—"}`} />
            <Detail label="Total" value={money(order.total)} />
            <Detail label="Drafted by" value={order.createdBy} />
            <Detail label="Approved by" value={order.approvedBy && `${order.approvedBy}, ${formatDateTime(order.approvedAt)}`} />
            <Detail label="Supplier contact" value={[order.supplierPhone, order.supplierEmail].filter(Boolean).join(" · ")} />
            <Detail label="Closed" value={order.closedBy && `${order.closedBy}: ${order.closeNote}`} />
          </div>
          {order.note && <p className="text-sm text-slate-600">{order.note}</p>}
          <DataTable columns={["Item", "Ordered", "Received", "Due", "Price", "Amount"]} hasRows minWidth="min-w-[600px]">
            {order.lines.map((line) => (
              <tr key={line.itemId} className="border-b border-slate-100">
                <td className="px-4 py-2">{line.name}<span className="block font-mono text-xs text-slate-500">{line.sku}</span></td>
                <td className="px-4 py-2 tabular-nums">{qty(line.quantity)} {line.unit}</td>
                <td className="px-4 py-2 tabular-nums text-green-700">{qty(line.received)}</td>
                <td className="px-4 py-2 tabular-nums">{qty(line.remaining)}</td>
                <td className="px-4 py-2 tabular-nums">{money(line.unitCost)}</td>
                <td className="px-4 py-2 tabular-nums">{money(line.value)}</td>
              </tr>
            ))}
          </DataTable>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Goods received</h3>
            {order.receipts.length === 0 ? <p className="text-sm text-slate-500">Nothing received yet.</p> : (
              <ul className="space-y-1 text-sm">
                {order.receipts.map((r) => <li key={r.docNo}><span className="font-mono text-xs">{r.docNo}</span> · {formatDateTime(r.at)} · {r.lines} line(s) · {money(r.value)}{r.reference && ` · Ref ${r.reference}`} · {r.by}</li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </ViewModal>
  );
}

const SUPPLIER_FIELDS = (isEdit) => [
  { name: "name", label: "Supplier name *", wide: true },
  { name: "contactPerson", label: "Contact person" },
  { name: "phone", label: "Phone" },
  { name: "email", label: "Email" },
  { name: "address", label: "Address", wide: true },
  ...(isEdit ? [{ name: "isActive", label: "Active (can receive new orders)", type: "checkbox" }] : []),
];

export default function PurchasesPage() {
  const { can, isReady } = useMe();
  const [tab, setTab] = useState("orders");
  const [filters, setFilters] = useState({ status: "OPEN", search: "" });
  const load = useCallback(() => Promise.all([inventoryApi.purchaseOrders(filters), inventoryApi.suppliers(), inventoryApi.items(), inventoryApi.stores()]), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [orders, suppliers, items, stores] = data || [[], [], [], []];

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const act = async (work, text) => {
    setActionError("");
    try {
      const result = await work();
      if (result === null) return;
      setNotice(typeof text === "function" ? text(result) : text);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const done = (text) => (result) => {
    setForm(null);
    setNotice(typeof text === "function" ? text(result) : text);
    reload();
  };

  const canPurchase = can("inventory.manage_purchases");
  const canApprove = can("inventory.approve");
  const canReceive = can("inventory.manage_stock");

  return (
    <SystemShell title="Purchases" subtitle="Purchase orders and suppliers. Stock arrives through goods received notes (GRN) against an approved order; partial deliveries are fine." crumbs={CRUMBS}
      actions={canPurchase && (tab === "orders"
        ? <button onClick={() => setForm({ type: "order" })} disabled={suppliers.length === 0} className={primaryButton}>New Purchase Order</button>
        : <button onClick={() => setForm({ type: "supplier" })} className={primaryButton}>Add Supplier</button>)}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      <div className="flex flex-wrap gap-2" role="tablist">
        {[["orders", "Purchase Orders"], ["suppliers", `Suppliers (${suppliers.length})`]].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>

      {tab === "orders" && (
        <>
          {!isLoading && suppliers.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Add a supplier first (Suppliers tab).</p>}
          <div className="flex flex-wrap gap-3">
            <select aria-label="Order status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
              <option value="OPEN">Open (draft, approved, partly received)</option>
              {Object.entries(PO_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="">All</option>
            </select>
            <input aria-label="Search orders" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="PO number or supplier" className={`${filterClass} min-w-[14rem]`} />
          </div>
          <section className="rounded-xl border border-slate-200 bg-white p-1">
            <DataTable columns={["Order", "Supplier", "Deliver to", "Expected", "Total", "Received", "Status", "Actions"]} isLoading={isLoading} hasRows={orders.length > 0} emptyMessage="No purchase orders here." minWidth="min-w-[1000px]">
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-3"><button onClick={() => setForm({ type: "view", id: o.id })} className="font-mono text-xs text-blue-700 hover:underline">{o.poNo}</button><span className="block text-xs text-slate-500">{o.orderedOn} · {o.lines.length} item(s)</span></td>
                  <td className="px-4 py-3 font-medium text-slate-800">{o.supplierName}</td>
                  <td className="px-4 py-3">{o.storeCode}</td>
                  <td className="px-4 py-3">{o.expectedOn || "—"}{o.isLate && <span className="block text-xs font-medium text-red-600">Late</span>}</td>
                  <td className="px-4 py-3 tabular-nums">{money(o.total)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-24 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-green-500" style={{ width: `${Math.min(100, o.receivedShare * 100)}%` }} /></div>
                    <span className="text-xs text-slate-500">{Math.round(o.receivedShare * 100)}%</span>
                  </td>
                  <td className="px-4 py-3"><PoBadge status={o.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-xs flex-wrap gap-x-3 gap-y-1">
                      {o.status === "DRAFT" && canPurchase && <button onClick={() => setForm({ type: "order", order: o })} className={linkButton}>Edit</button>}
                      {o.status === "DRAFT" && canApprove && <button onClick={() => window.confirm(`Approve ${o.poNo} for ${money(o.total)}?`) && act(() => inventoryApi.approvePurchaseOrder(o.id), `${o.poNo} approved. Send it to the supplier.`)} className={linkButton}>Approve</button>}
                      {["APPROVED", "PARTIAL"].includes(o.status) && canReceive && <button onClick={() => setForm({ type: "receive", order: o })} className={linkButton}>Receive (GRN)</button>}
                      {o.status === "PARTIAL" && canApprove && <button onClick={() => { const note = window.prompt(`Close ${o.poNo} short? The rest will not be delivered. Reason:`); if (note) act(() => inventoryApi.closePurchaseOrder(o.id, note), `${o.poNo} closed.`); }} className={linkButton}>Close short</button>}
                      {["DRAFT", "APPROVED"].includes(o.status) && canApprove && <button onClick={() => { const note = window.prompt(`Cancel ${o.poNo}? Reason (optional):`); if (note !== null) act(() => inventoryApi.cancelPurchaseOrder(o.id, note), `${o.poNo} cancelled.`); }} className={dangerButton}>Cancel</button>}
                      {o.status === "DRAFT" && canPurchase && <button onClick={() => window.confirm(`Delete draft ${o.poNo}?`) && act(() => inventoryApi.removePurchaseOrder(o.id), "Draft deleted.")} className={dangerButton}>Delete</button>}
                      <button onClick={() => printOrder(o)} className={linkButton}>Print</button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          </section>
        </>
      )}

      {tab === "suppliers" && (
        <section className="rounded-xl border border-slate-200 bg-white p-1">
          <DataTable columns={["Supplier", "Contact", "Phone / email", "Open orders", "Ordered (all time)", "Status", "Actions"]} isLoading={isLoading} hasRows={suppliers.length > 0} emptyMessage="No suppliers yet.">
            {suppliers.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-800">{s.name}{s.address && <span className="block text-xs font-normal text-slate-500">{s.address}</span>}</td>
                <td className="px-4 py-3">{s.contactPerson || "—"}</td>
                <td className="px-4 py-3 text-xs">{[s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-4 py-3 tabular-nums">{s.openOrders}</td>
                <td className="px-4 py-3 tabular-nums">{money(s.totalOrdered)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${s.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{s.isActive ? "Active" : "Inactive"}</span></td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    {canPurchase && <button onClick={() => setForm({ type: "supplier", supplier: s })} className={linkButton}>Edit</button>}
                    {can("inventory.delete") && <button onClick={() => window.confirm(`Delete ${s.name}?`) && act(() => inventoryApi.removeSupplier(s.id), "Supplier deleted.")} className={dangerButton}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}

      {form?.type === "order" && <OrderForm order={form.order} items={items} stores={stores} suppliers={suppliers} onClose={() => setForm(null)} onDone={done((o) => `${o.poNo} saved as a draft.`)} />}
      {form?.type === "receive" && <ReceiveForm order={form.order} onClose={() => setForm(null)} onDone={done((r) => `${r.grn.docNo} posted. ${r.order.poNo} is now ${PO_LABELS[r.order.status].toLowerCase()}.`)} />}
      {form?.type === "view" && <OrderView id={form.id} onClose={() => setForm(null)} />}
      {form?.type === "supplier" && (
        <QuickForm title={form.supplier ? `Edit ${form.supplier.name}` : "Add Supplier"} fields={SUPPLIER_FIELDS(Boolean(form.supplier))} initial={form.supplier || {}}
          onClose={() => setForm(null)}
          onSubmit={async (body) => done("Supplier saved.")(form.supplier ? await inventoryApi.updateSupplier(form.supplier.id, body) : await inventoryApi.createSupplier(body))} />
      )}
    </SystemShell>
  );
}
