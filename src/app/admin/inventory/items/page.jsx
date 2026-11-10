"use client";

import { useCallback, useRef, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { DataTable, Detail, ErrorBanner, NoAccess, SystemShell, ViewModal, dangerButton, filterClass, formatDateTime, friendlyError, linkButton, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { Pager, usePagination } from "@/app/admin/hostel/_components/hostelUi";
import { downloadCsv, parseCsv } from "@/app/admin/hostel/_components/hostelExport";
import { Barcode, CRUMBS, ExpiryBadge, KindBadge, Notice, StockBadge, qty, signed } from "../_components/inventoryUi";

const itemFields = (stores, isNew) => [
  { name: "name", label: "Item name *", wide: true },
  { name: "sku", label: "SKU (empty = automatic)" },
  { name: "barcode", label: "Barcode (empty = SKU)" },
  { name: "category", label: "Category", hint: "e.g. Stationery, Lab Chemicals, Cleaning" },
  { name: "brand", label: "Brand" },
  { name: "unit", label: "Unit", hint: "Piece, Box, Ream, Litre, Kg" },
  { name: "reorderLevel", label: "Reorder level", type: "number", step: "any", min: 0, hint: "Alert when stock falls to this." },
  { name: "maxLevel", label: "Maximum stock (0 = no limit)", type: "number", step: "any", min: 0 },
  { name: "description", label: "Description", type: "textarea", rows: 2 },
  { name: "trackBatches", label: "Track batches and expiry dates (chemicals, medicine, food)", type: "checkbox", wide: true },
  ...(isNew ? [
    { name: "openingQuantity", label: "Opening stock", type: "number", step: "any", min: 0, optional: true },
    { name: "unitCost", label: "Opening unit cost (৳)", type: "number", step: "0.01", min: 0, optional: true },
    { name: "storeId", label: "Opening stock store", type: "select", optional: true, options: stores.filter((s) => s.isActive).map((s) => [s.id, `${s.name} (${s.code})`]) },
    { name: "batchNo", label: "Opening batch no. (batch-tracked items)", optional: true },
    { name: "expiresOn", label: "Opening batch expiry", type: "date", optional: true },
  ] : []),
];

const CSV_COLUMNS = [
  { label: "SKU", value: (item) => item.sku },
  { label: "Barcode", value: (item) => item.barcode },
  { label: "Name", value: (item) => item.name },
  { label: "Category", value: (item) => item.category },
  { label: "Brand", value: (item) => item.brand },
  { label: "Unit", value: (item) => item.unit },
  { label: "On hand", value: (item) => item.onHand },
  { label: "Average cost", value: (item) => item.avgCost },
  { label: "Stock value", value: (item) => item.stockValue },
  { label: "Reorder level", value: (item) => item.reorderLevel },
  { label: "Maximum", value: (item) => item.maxLevel },
  { label: "Stock status", value: (item) => item.stockStatus },
  { label: "Status", value: (item) => item.status },
  { label: "Track batches", value: (item) => (item.trackBatches ? "yes" : "no") },
];

// Import headers, matched loosely so a sheet exported from Excel just works.
const HEADER_KEYS = {
  sku: "sku", barcode: "barcode", name: "name", itemname: "name", category: "category", brand: "brand", unit: "unit",
  reorderlevel: "reorderLevel", reorder: "reorderLevel", maximum: "maxLevel", maxlevel: "maxLevel", description: "description",
  openingstock: "openingQuantity", openingquantity: "openingQuantity", unitcost: "unitCost", storecode: "storeCode",
  trackbatches: "trackBatches", batchno: "batchNo", batch: "batchNo", expiry: "expiresOn", expireson: "expiresOn", expirydate: "expiresOn",
};

function ItemCard({ id, onClose }) {
  const load = useCallback(() => inventoryApi.item(id), [id]);
  const { data: item, error } = useData(load);
  return (
    <ViewModal title={item ? `${item.name} · ${item.sku}` : "Item"} onClose={onClose} wide>
      <ErrorBanner message={error} />
      {!item ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail label="On hand" value={`${qty(item.onHand)} ${item.unit}`} />
            <Detail label="Average cost" value={money(item.avgCost)} />
            <Detail label="Stock value" value={money(item.stockValue)} />
            <Detail label="Reorder / max" value={`${qty(item.reorderLevel)} / ${item.maxLevel ? qty(item.maxLevel) : "—"}`} />
            <Detail label="Category" value={item.category} />
            <Detail label="Brand" value={item.brand} />
            <Detail label="Status" value={item.status === "ACTIVE" ? "Active" : "Archived"} />
            <Detail label="Last movement" value={formatDateTime(item.lastMovementAt)} />
          </div>
          {item.description && <p className="text-sm text-slate-600">{item.description}</p>}
          <div className="rounded-lg border border-slate-200 p-3"><Barcode value={item.barcode} /></div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">By store</h3>
            {item.balances.length === 0 ? <p className="text-sm text-slate-500">No stock in any store.</p> : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {item.balances.map((b) => <li key={b.storeId} className="rounded-lg bg-slate-100 px-3 py-1.5">{b.storeName}: <span className="font-semibold">{qty(b.quantity)}</span></li>)}
              </ul>
            )}
          </div>
          {item.trackBatches && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Batches</h3>
              {item.batches.length === 0 ? <p className="text-sm text-slate-500">No batch has stock.</p> : (
                <ul className="space-y-1 text-sm">
                  {item.batches.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{b.batchNo}</span><span>{b.storeCode}</span><span className="font-semibold">{qty(b.quantity)} {item.unit}</span>
                      <ExpiryBadge batch={b} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Stock card (last 25 entries)</h3>
            <DataTable columns={["When", "Document", "Store", "Type", "Qty", "Balance", "Party / note"]} hasRows={item.movements.length > 0} emptyMessage="No movements yet." minWidth="min-w-[720px]">
              {item.movements.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.docNo}</td>
                  <td className="px-4 py-2">{m.storeCode}</td>
                  <td className="px-4 py-2"><KindBadge kind={m.kind} /></td>
                  <td className={`px-4 py-2 tabular-nums ${m.quantity < 0 ? "text-red-600" : "text-green-700"}`}>{signed(m.quantity)}</td>
                  <td className="px-4 py-2 tabular-nums">{qty(m.balanceAfter)}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{[m.batchNo && `Batch ${m.batchNo}`, m.party, m.note].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </ViewModal>
  );
}

export default function ItemsPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", category: "", stock: "", status: "ACTIVE" });
  const load = useCallback(() => Promise.all([inventoryApi.items(filters), inventoryApi.stores(), inventoryApi.categories()]), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const fileInput = useRef(null);
  const [items, stores, categories] = data || [[], [], []];
  const { pageItems, pagerProps } = usePagination(items, 25);

  if (isReady && !can("inventory.read")) return <NoAccess />;

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

  const save = async (body) => {
    if (!editing) return;
    if (editing.item) await inventoryApi.updateItem(editing.item.id, body);
    else await inventoryApi.createItem({ ...body, openingQuantity: body.openingQuantity || undefined });
    setEditing(null);
    setNotice("Item saved.");
    reload();
  };

  const importFile = async (file) => {
    if (!file) return;
    setActionError("");
    try {
      const [header, ...rows] = parseCsv(await file.text());
      if (!header || rows.length === 0) throw new Error("The file has no rows under its header.");
      const keys = header.map((cell) => HEADER_KEYS[cell.toLowerCase().replace(/[^a-z]/g, "")] || null);
      if (!keys.includes("name")) throw new Error("The file needs a Name column.");
      const byCode = Object.fromEntries(stores.map((store) => [store.code.toLowerCase(), store.id]));
      const body = rows.map((cells) => {
        const row = {};
        keys.forEach((key, index) => { if (key && cells[index]?.trim()) row[key] = cells[index].trim(); });
        if (row.storeCode) row.storeId = byCode[row.storeCode.toLowerCase()];
        delete row.storeCode;
        return row;
      });
      const result = await inventoryApi.importItems(body);
      setNotice(`Imported ${result.imported} items.`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <SystemShell title="Items & Stock" subtitle="Consumable stock: what you have, where, what it is worth, and when to reorder." crumbs={CRUMBS}
      actions={<>
        {can("inventory.export") && <button onClick={() => downloadCsv(`inventory-items-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, items)} className={secondaryButton}>Export CSV</button>}
        {can("inventory.create") && <>
          <button onClick={() => fileInput.current?.click()} className={secondaryButton}>Import CSV</button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import items from a CSV file" onChange={(e) => importFile(e.target.files?.[0])} />
          <button onClick={() => setEditing({})} className={primaryButton}>Add Item</button>
        </>}
      </>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search items" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Name, SKU, barcode or brand" className={`${filterClass} min-w-[16rem]`} />
        <select aria-label="Category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={filterClass}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select aria-label="Stock level" value={filters.stock} onChange={(e) => setFilters({ ...filters, stock: e.target.value })} className={filterClass}>
          <option value="">Any stock level</option><option value="LOW">Low stock</option><option value="OUT">Out of stock</option><option value="OVER">Overstock</option><option value="OK">In stock</option>
        </select>
        <select aria-label="Item status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="ALL">All</option>
        </select>
      </div>
      <p className="text-xs text-slate-500">Import columns: Name, SKU, Barcode, Category, Brand, Unit, Reorder level, Maximum, Description, Track batches (yes/no), Opening stock, Unit cost, Store code, Batch no, Expiry. One bad row stops the whole import.</p>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Item", "Category", "On hand", "Reorder", "Avg cost", "Value", "Level", "Actions"]} isLoading={isLoading} hasRows={items.length > 0}
          emptyMessage={filters.search || filters.category || filters.stock ? "No items match." : "No items yet. Add one or import a CSV."}>
          {pageItems.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="px-4 py-3">
                <button onClick={() => setViewing(item.id)} className="text-left font-medium text-slate-800 hover:text-blue-700">{item.name}</button>
                <span className="block font-mono text-xs text-slate-500">{item.sku}{item.trackBatches && " · batches"}{item.status === "ARCHIVED" && " · archived"}</span>
              </td>
              <td className="px-4 py-3">{item.category || "—"}</td>
              <td className="px-4 py-3 font-medium tabular-nums">{qty(item.onHand)} <span className="text-xs font-normal text-slate-500">{item.unit}</span></td>
              <td className="px-4 py-3 tabular-nums">{item.reorderLevel ? qty(item.reorderLevel) : "—"}</td>
              <td className="px-4 py-3 tabular-nums">{money(item.avgCost)}</td>
              <td className="px-4 py-3 tabular-nums">{money(item.stockValue)}</td>
              <td className="px-4 py-3"><StockBadge status={item.stockStatus} /></td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => setViewing(item.id)} className={linkButton}>Card</button>
                  {can("inventory.update") && item.status === "ACTIVE" && <button onClick={() => setEditing({ item })} className={linkButton} aria-label={`Edit ${item.name}`}>Edit</button>}
                  {can("inventory.update") && item.status === "ACTIVE" && <button onClick={() => window.confirm(`Archive "${item.name}"? It will no longer take stock.`) && act(() => inventoryApi.archiveItem(item.id), "Item archived.")} className={linkButton}>Archive</button>}
                  {can("inventory.update") && item.status === "ARCHIVED" && <button onClick={() => act(() => inventoryApi.restoreItem(item.id), "Item restored.")} className={linkButton}>Restore</button>}
                  {can("inventory.delete") && <button onClick={() => window.confirm(`Delete "${item.name}"? Only items that never had stock can be deleted.`) && act(() => inventoryApi.removeItem(item.id), "Item deleted.")} className={dangerButton}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="px-4 pb-3"><Pager {...pagerProps} /></div>
      </section>
      {editing && (
        <QuickForm title={editing.item ? `Edit ${editing.item.name}` : "Add Item"} fields={itemFields(stores, !editing.item)}
          initial={editing.item || { unit: "Piece", reorderLevel: 0, maxLevel: 0, storeId: stores.find((s) => s.isActive)?.id || "" }}
          onSubmit={save} onClose={() => setEditing(null)} />
      )}
      {viewing && <ItemCard id={viewing} onClose={() => setViewing(null)} />}
    </SystemShell>
  );
}
