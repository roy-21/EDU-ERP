"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, StatGrid, SystemShell, dangerButton, filterClass, friendlyError, money, secondaryButton, useData } from "@/components/erp/ui";
import { downloadCsv } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, ExpiryBadge, Notice, qty } from "../_components/inventoryUi";

const STATE_LABELS = { EXPIRED: "Expired", EXPIRING: "Expiring soon", OK: "Good", NO_EXPIRY: "No expiry" };

const CSV_COLUMNS = [
  { label: "Item", value: (b) => b.itemName },
  { label: "SKU", value: (b) => b.sku },
  { label: "Batch", value: (b) => b.batchNo },
  { label: "Store", value: (b) => b.storeCode },
  { label: "Quantity", value: (b) => b.quantity },
  { label: "Unit", value: (b) => b.unit },
  { label: "Expires on", value: (b) => b.expiresOn },
  { label: "Days left", value: (b) => b.daysLeft },
  { label: "State", value: (b) => STATE_LABELS[b.state] },
  { label: "Value", value: (b) => b.value },
];

export default function BatchesPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ state: "", storeId: "" });
  const load = useCallback(() => Promise.all([inventoryApi.batches(filters), inventoryApi.stores(), inventoryApi.settings()]), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [batches, stores, settings] = data || [[], [], null];

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const expired = batches.filter((b) => b.state === "EXPIRED");
  const expiring = batches.filter((b) => b.state === "EXPIRING");

  const writeOff = async (batch) => {
    const reason = window.prompt(`Write off all ${qty(batch.quantity)} ${batch.unit} of ${batch.itemName}, batch ${batch.batchNo} in ${batch.storeName}?\nReason:`, batch.state === "EXPIRED" ? "Expired" : "");
    if (!reason) return;
    setActionError("");
    try {
      const doc = await inventoryApi.writeOff({ storeId: batch.storeId, itemId: batch.itemId, batchId: batch.id, kind: "DAMAGE", quantity: batch.quantity, reason });
      setNotice(`Written off: ${doc.docNo}.`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Batches & Expiry" subtitle="Batch-tracked stock by expiry date. Issues and transfers always take the soonest-expiring usable batch; expired stock can only be written off."
      crumbs={CRUMBS}
      actions={can("inventory.export") && <button onClick={() => downloadCsv(`batches-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, batches)} className={secondaryButton}>Export CSV</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      <StatGrid isLoading={isLoading} stats={[
        { label: "Batches with stock", value: batches.length },
        { label: "Expired", value: expired.length, color: "text-red-600" },
        { label: `Expiring in ${settings?.expiryWarningDays ?? 30} days`, value: expiring.length, color: "text-amber-600" },
        { label: "Value expired", value: money(expired.reduce((sum, b) => sum + b.value, 0)), color: "text-red-600" },
      ]} />
      <div className="flex flex-wrap gap-3">
        <select aria-label="Expiry state" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} className={filterClass}>
          <option value="">All batches with stock</option><option value="EXPIRED">Expired</option><option value="EXPIRING">Expiring soon</option>
        </select>
        <select aria-label="Store" value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value })} className={filterClass}>
          <option value="">All stores</option>
          {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">The warning window is set under Inventory → Alert Settings. Turn on batch tracking for an item in its Edit form while it has no stock.</p>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Item", "Batch", "Store", "Quantity", "Value", "Expiry", ""]} isLoading={isLoading} hasRows={batches.length > 0}
          emptyMessage={filters.state ? "No batches in this state." : "No batch-tracked stock yet."}>
          {batches.map((b) => (
            <tr key={b.id} className={`border-b border-slate-100 ${b.state === "EXPIRED" ? "bg-red-50/40" : ""}`}>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{b.itemName}</span><span className="block font-mono text-xs text-slate-500">{b.sku}</span></td>
              <td className="px-4 py-3 font-mono text-xs">{b.batchNo}</td>
              <td className="px-4 py-3">{b.storeName}</td>
              <td className="px-4 py-3 tabular-nums">{qty(b.quantity)} {b.unit}</td>
              <td className="px-4 py-3 tabular-nums">{money(b.value)}</td>
              <td className="px-4 py-3"><ExpiryBadge batch={b} /></td>
              <td className="px-4 py-3">{can("inventory.adjust_stock") && <button onClick={() => writeOff(b)} className={dangerButton}>Write off</button>}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </SystemShell>
  );
}
