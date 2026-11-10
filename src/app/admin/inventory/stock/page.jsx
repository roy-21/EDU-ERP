"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, formatDateTime, friendlyError, linkButton, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { Pager, usePagination } from "@/app/admin/hostel/_components/hostelUi";
import { downloadCsv, printTable } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, KIND_LABELS, KindBadge, Notice, StockDocumentForm, qty, signed } from "../_components/inventoryUi";

const CSV_COLUMNS = [
  { label: "Date", value: (m) => m.createdAt },
  { label: "Document", value: (m) => m.docNo },
  { label: "Type", value: (m) => KIND_LABELS[m.kind] || m.kind },
  { label: "SKU", value: (m) => m.sku },
  { label: "Item", value: (m) => m.itemName },
  { label: "Store", value: (m) => m.storeCode },
  { label: "Quantity", value: (m) => m.quantity },
  { label: "Unit", value: (m) => m.unit },
  { label: "Unit cost", value: (m) => m.unitCost },
  { label: "Value", value: (m) => m.value },
  { label: "Balance after", value: (m) => m.balanceAfter },
  { label: "Batch", value: (m) => m.batchNo },
  { label: "Expiry", value: (m) => m.expiresOn },
  { label: "Party", value: (m) => m.party },
  { label: "Reference", value: (m) => m.reference },
  { label: "Note", value: (m) => m.note },
  { label: "By", value: (m) => m.createdBy },
];

// A receipt, issue slip or challan for one document, ready to print or save as PDF.
const printDocument = (doc) => {
  const first = doc.movements[0];
  if (!first) return;
  const title = `${KIND_LABELS[first.kind] || first.kind} ${doc.docNo} · ${first.storeName}${first.party ? ` · ${first.party}` : ""}${first.reference ? ` · Ref ${first.reference}` : ""}`;
  printTable(title, [
    { label: "SKU", value: (m) => m.sku },
    { label: "Item", value: (m) => m.itemName },
    { label: "Batch", value: (m) => [m.batchNo, m.expiresOn && `exp ${m.expiresOn}`].filter(Boolean).join(" ") },
    { label: "Quantity", value: (m) => `${qty(Math.abs(m.quantity))} ${m.unit}` },
    { label: "Unit cost", value: (m) => money(m.unitCost) },
    { label: "Value", value: (m) => money(Math.abs(m.value)) },
  ], doc.movements);
};

export default function StockPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", storeId: "", kind: "", from: "", to: "" });
  const load = useCallback(() => Promise.all([inventoryApi.movements(filters), inventoryApi.items(), inventoryApi.stores()]), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [movements, items, stores] = data || [[], [], []];
  const { pageItems, pagerProps } = usePagination(movements, 50);

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const openStores = stores.filter((store) => store.isActive);
  const storeOptions = openStores.map((store) => [store.id, `${store.name} (${store.code})`]);
  const itemOptions = items.filter((item) => item.status === "ACTIVE").map((item) => [item.id, `${item.name} · ${item.sku} (${qty(item.onHand)} ${item.unit})`]);

  const posted = (doc, text) => {
    setForm(null);
    setNotice(`${text} ${doc.docNo}.`);
    reload();
  };

  const reverse = async (movement) => {
    const reason = window.prompt(`Reverse ${movement.docNo} (${KIND_LABELS[movement.kind]} ${signed(movement.quantity)} ${movement.unit} of ${movement.itemName})?\nThe original entry stays in the ledger. Reason:`);
    if (!reason) return;
    setActionError("");
    try {
      const doc = await inventoryApi.reverse(movement.id, reason);
      setNotice(`Reversed with ${doc.docNo}.`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const print = async (docNo) => {
    setActionError("");
    try {
      printDocument(await inventoryApi.document(docNo));
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const noStores = !isLoading && openStores.length === 0;

  return (
    <SystemShell title="Stock Ledger" subtitle="Every stock movement, in order. Entries are never edited: a mistake is reversed with a new entry." crumbs={CRUMBS}
      actions={<>
        {can("inventory.manage_stock") && <>
          <button disabled={noStores} onClick={() => setForm("receive")} className={primaryButton}>Stock In</button>
          <button disabled={noStores} onClick={() => setForm("issue")} className={secondaryButton}>Issue</button>
          <button disabled={noStores} onClick={() => setForm("return")} className={secondaryButton}>Take Back</button>
        </>}
        {can("inventory.adjust_stock") && <>
          <button disabled={noStores} onClick={() => setForm("count")} className={secondaryButton}>Stock Count</button>
          <button disabled={noStores} onClick={() => setForm("writeOff")} className={secondaryButton}>Write Off</button>
        </>}
        {can("inventory.export") && <button onClick={() => downloadCsv(`stock-ledger-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, movements)} className={secondaryButton}>Export CSV</button>}
      </>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      {noStores && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Add a store first (Inventory → Stores). Stock is always kept in a store.</p>}
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search the ledger" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Item, SKU, document, party" className={`${filterClass} min-w-[15rem]`} />
        <select aria-label="Store" value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value })} className={filterClass}>
          <option value="">All stores</option>
          {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
        <select aria-label="Movement type" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })} className={filterClass}>
          <option value="">All types</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={filterClass} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={filterClass} /></label>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["When", "Document", "Item", "Store", "Type", "Qty", "Value", "Balance", "Party / note", ""]} isLoading={isLoading} hasRows={movements.length > 0} emptyMessage="No stock movements match." minWidth="min-w-[1050px]">
          {pageItems.map((m) => (
            <tr key={m.id} className={`border-b border-slate-100 ${m.isReversed ? "text-slate-400" : ""}`}>
              <td className="px-4 py-3 text-xs">{formatDateTime(m.createdAt)}<span className="block text-slate-400">{m.createdBy}</span></td>
              <td className="px-4 py-3"><button onClick={() => print(m.docNo)} className="font-mono text-xs text-blue-700 hover:underline" title="Print this document">{m.docNo}</button></td>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{m.itemName}</span><span className="block font-mono text-xs text-slate-500">{m.sku}</span></td>
              <td className="px-4 py-3">{m.storeCode}</td>
              <td className="px-4 py-3"><KindBadge kind={m.kind} />{m.isReversed && <span className="mt-1 block text-xs">reversed</span>}</td>
              <td className={`px-4 py-3 font-medium tabular-nums ${m.quantity < 0 ? "text-red-600" : "text-green-700"}`}>{signed(m.quantity)} <span className="text-xs font-normal">{m.unit}</span></td>
              <td className="px-4 py-3 tabular-nums">{money(Math.abs(m.value))}</td>
              <td className="px-4 py-3 tabular-nums">{qty(m.balanceAfter)}</td>
              <td className="max-w-xs px-4 py-3 text-xs text-slate-600">{[m.batchNo && `Batch ${m.batchNo}`, m.party, m.reference && `Ref ${m.reference}`, m.note].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-4 py-3">
                {can("inventory.approve") && !m.isReversed && !["REVERSAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(m.kind) && (
                  <button onClick={() => reverse(m)} className={linkButton}>Reverse</button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="px-4 pb-3"><Pager {...pagerProps} /></div>
      </section>

      {form === "receive" && <StockDocumentForm mode="receive" items={items} stores={stores} onClose={() => setForm(null)} onSubmit={async (body) => posted(await inventoryApi.receive(body), "Received:")} />}
      {form === "issue" && <StockDocumentForm mode="issue" items={items} stores={stores} onClose={() => setForm(null)} onSubmit={async (body) => posted(await inventoryApi.issue(body), "Issued:")} />}
      {form === "return" && <StockDocumentForm mode="return" items={items} stores={stores} onClose={() => setForm(null)} onSubmit={async (body) => posted(await inventoryApi.takeBack(body), "Taken back:")} />}
      {form === "count" && (
        <QuickForm title="Stock Count" submitLabel="Save count" onClose={() => setForm(null)}
          initial={{ storeId: openStores[0]?.id || "" }}
          fields={[
            { name: "storeId", label: "Store *", type: "select", options: storeOptions },
            { name: "itemId", label: "Item *", type: "select", options: itemOptions, wide: true },
            { name: "countedQuantity", label: "Counted quantity *", type: "number", step: "any", min: 0, hint: "What is physically on the shelf. The difference is posted." },
            { name: "batchNo", label: "Batch no. (batch-tracked items only)", optional: true, hint: "Batch-tracked items are counted one batch at a time." },
            { name: "expiresOn", label: "Batch expiry (for a new batch)", type: "date", optional: true },
            { name: "reason", label: "Reason *", hint: "e.g. Monthly count, audit" },
          ]}
          onSubmit={async (body) => posted(await inventoryApi.count(body), "Count saved:")} />
      )}
      {form === "writeOff" && (
        <QuickForm title="Write Off Stock" submitLabel="Write off" onClose={() => setForm(null)}
          initial={{ storeId: openStores[0]?.id || "", kind: "DAMAGE" }}
          fields={[
            { name: "storeId", label: "Store *", type: "select", options: storeOptions },
            { name: "kind", label: "Type *", type: "select", noBlank: true, options: [["DAMAGE", "Damaged / expired"], ["LOSS", "Lost / stolen"]] },
            { name: "itemId", label: "Item *", type: "select", options: itemOptions, wide: true },
            { name: "quantity", label: "Quantity *", type: "number", step: "any", min: 0, hint: "Batch-tracked items: soonest expiry first. To write off one batch, use Batches & Expiry." },
            { name: "reason", label: "Reason *" },
          ]}
          onSubmit={async (body) => posted(await inventoryApi.writeOff(body), "Written off:")} />
      )}
    </SystemShell>
  );
}
