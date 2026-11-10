"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { todayLocal } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, Field, FormModal, NoAccess, SystemShell, filterClass, friendlyError, inputClass, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { downloadCsv, printTable } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, KIND_LABELS, STOCK_LABELS, StockBadge, qty } from "../_components/inventoryUi";

// ---- Spending by purpose ----------------------------------------------------------

const GROUPS = { category: "Purpose (expense category)", month: "Month", storeName: "Store", destination: "Issued to", kind: "Type" };
const SPEND_COLUMNS = [
  { label: "Month", value: (r) => r.month }, { label: "Category", value: (r) => r.category }, { label: "Type", value: (r) => KIND_LABELS[r.kind] || r.kind },
  { label: "Store", value: (r) => r.storeName }, { label: "Issued to", value: (r) => r.destination }, { label: "Value", value: (r) => r.value },
];

function SpendingReport({ canExport }) {
  const [range, setRange] = useState({ from: `${todayLocal().slice(0, 7)}-01`, to: todayLocal() });
  const [group, setGroup] = useState("category");
  const load = useCallback(() => inventoryApi.expenses(range), [range]);
  const { data, error, isLoading } = useData(load);
  const rows = data || [];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const grouped = Object.values(rows.reduce((acc, row) => {
    const key = (group === "kind" ? KIND_LABELS[row.kind] : row[group]) || "—";
    acc[key] = acc[key] || { key, value: 0 };
    acc[key].value += row.value;
    return acc;
  }, {})).sort((a, b) => (group === "month" ? a.key.localeCompare(b.key) : b.value - a.value));

  return (
    <>
      <ErrorBanner message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={filterClass} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={filterClass} /></label>
        <select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value)} className={filterClass}>
          {Object.entries(GROUPS).map(([key, label]) => <option key={key} value={key}>By {label.toLowerCase()}</option>)}
        </select>
        {canExport && <button onClick={() => downloadCsv(`inventory-spending-${range.from}-${range.to}.csv`, SPEND_COLUMNS, rows)} className={secondaryButton}>Export CSV</button>}
        <p className="ml-auto text-sm font-semibold text-slate-800">Total {money(total)}</p>
      </div>
      <p className="text-sm text-slate-600">Stock issued, used, wasted, damaged or lost, at cost. Purchases add stock; spending is when it is used. Reversals are netted off.</p>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={[GROUPS[group], "Value", "Share"]} isLoading={isLoading} hasRows={grouped.length > 0} emptyMessage="No stock was used in this period.">
          {grouped.map((row) => (
            <tr key={row.key} className="border-b border-slate-100">
              <td className="px-4 py-2 font-medium">{row.key}</td>
              <td className="px-4 py-2 tabular-nums">{money(row.value)}</td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-32 overflow-hidden rounded bg-slate-100"><span className="block h-full bg-blue-500" style={{ width: `${total > 0 ? (row.value / total) * 100 : 0}%` }} /></span>
                  <span className="tabular-nums text-xs text-slate-600">{pct(total > 0 ? row.value / total : 0)}</span>
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
    </>
  );
}

// ---- Reorder suggestions ------------------------------------------------------------

const URGENCY = { OUT: ["Out of stock", "bg-red-100 text-red-700"], HIGH: ["Within a week", "bg-amber-100 text-amber-800"], NORMAL: ["Soon", "bg-slate-100 text-slate-600"] };
const REORDER_COLUMNS = [
  { label: "Item", value: (r) => r.name }, { label: "SKU", value: (r) => r.sku }, { label: "On hand", value: (r) => r.onHand }, { label: "Used per day", value: (r) => r.perDay },
  { label: "Days left", value: (r) => r.coverDays ?? "" }, { label: "On order", value: (r) => r.onOrder }, { label: "Suggested order", value: (r) => r.suggest },
  { label: "Last price", value: (r) => r.lastCost ?? "" }, { label: "Best price (12 months)", value: (r) => r.bestCost ?? "" }, { label: "Best supplier", value: (r) => r.bestSupplier },
  { label: "Why", value: (r) => r.reasons.join(" ") },
];

function DraftOrderForm({ lines, onClose, onDone }) {
  const load = useCallback(() => Promise.all([inventoryApi.suppliers(), inventoryApi.stores()]), []);
  const { data } = useData(load);
  const [suppliers, stores] = data || [[], []];
  const [supplierId, setSupplierId] = useState("");
  const [storeId, setStoreId] = useState("");
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const openStores = stores.filter((store) => store.isActive);
  const submit = async () => {
    onDone(await inventoryApi.createPurchaseOrder({
      supplierId: supplierId || activeSuppliers[0]?.id, storeId: storeId || openStores[0]?.id, orderedOn: todayLocal(), note: "Drafted from reorder suggestions",
      lines: lines.map((line) => ({ itemId: line.itemId, quantity: line.suggest, unitCost: line.lastCost ?? 0 })),
    }));
  };
  return (
    // Submitting before the suppliers load would send no supplier, so the button waits for them.
    <FormModal title="Draft Purchase Order" submitLabel="Create draft" onSubmit={submit} onClose={onClose} submitDisabled={!data || activeSuppliers.length === 0}>
      <p className="text-sm text-slate-600 sm:col-span-2">{lines.length} item(s) at the last price paid. The order is a draft: you can change it, and it still needs approval before it is sent.</p>
      <Field id="draft-supplier" label="Supplier *">
        <select id="draft-supplier" value={supplierId || activeSuppliers[0]?.id || ""} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
          {activeSuppliers.length === 0 && <option value="">Add a supplier under Purchases first</option>}
          {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
      </Field>
      <Field id="draft-store" label="Deliver to *">
        <select id="draft-store" value={storeId || openStores[0]?.id || ""} onChange={(e) => setStoreId(e.target.value)} className={inputClass}>
          {openStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </Field>
    </FormModal>
  );
}

function ReorderReport({ canExport, canPurchase }) {
  const [days, setDays] = useState(30);
  const load = useCallback(() => inventoryApi.reorderSuggestions(days), [days]);
  const { data, error, isLoading } = useData(load);
  const [picked, setPicked] = useState([]);
  const [drafting, setDrafting] = useState(false);
  const [notice, setNotice] = useState("");
  const rows = data?.suggestions || [];
  const chosen = rows.filter((row) => picked.includes(row.itemId));

  return (
    <>
      <ErrorBanner message={error} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Usage period" value={days} onChange={(e) => setDays(Number(e.target.value))} className={filterClass}>
          <option value={14}>Use over the last 14 days</option><option value={30}>Use over the last 30 days</option><option value={90}>Use over the last 90 days</option>
        </select>
        {canExport && <button onClick={() => downloadCsv(`reorder-suggestions-${todayLocal()}.csv`, REORDER_COLUMNS, rows)} className={secondaryButton}>Export CSV</button>}
        {canPurchase && <button disabled={chosen.length === 0} onClick={() => setDrafting(true)} className={primaryButton}>Draft purchase order ({chosen.length})</button>}
      </div>
      <p className="text-sm text-slate-600">Items at or below their reorder level, or that will run out within two weeks at the recent rate of use. Each suggestion says why. Nothing is ordered until a purchase order is approved.</p>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["", "Item", "Urgency", "On hand", "Days left", "Suggest", "Price", "Why"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="Nothing needs ordering now." minWidth="min-w-[1100px]">
          {rows.map((row) => (
            <tr key={row.itemId} className="border-b border-slate-100 align-top">
              <td className="px-4 py-3"><input type="checkbox" aria-label={`Order ${row.name}`} checked={picked.includes(row.itemId)}
                onChange={(e) => setPicked((current) => (e.target.checked ? [...current, row.itemId] : current.filter((id) => id !== row.itemId)))} /></td>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.name}</span><span className="block font-mono text-xs text-slate-500">{row.sku}</span></td>
              <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${URGENCY[row.urgency][1]}`}>{URGENCY[row.urgency][0]}</span></td>
              <td className="px-4 py-3 tabular-nums">{qty(row.onHand)} {row.unit}{row.onOrder > 0 && <span className="block text-xs text-slate-500">+{qty(row.onOrder)} on order</span>}</td>
              <td className="px-4 py-3 tabular-nums">{row.coverDays === null ? "—" : row.coverDays}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">{qty(row.suggest)} {row.unit}<span className="block text-xs font-normal text-slate-500">≈ {money(row.estimatedCost)}</span></td>
              <td className="px-4 py-3 text-xs">
                {row.lastCost !== null ? <span className="block">Last {money(row.lastCost)}{row.lastSupplier && ` · ${row.lastSupplier}`}</span> : "—"}
                {row.bestCost !== null && row.bestCost < (row.lastCost ?? Infinity) && <span className="block text-green-700">Best {money(row.bestCost)} · {row.bestSupplier}</span>}
              </td>
              <td className="max-w-sm px-4 py-3 text-xs text-slate-600">{row.reasons.join(" ")}</td>
            </tr>
          ))}
        </DataTable>
      </section>
      {drafting && (
        <DraftOrderForm lines={chosen} onClose={() => setDrafting(false)}
          onDone={(order) => { setDrafting(false); setPicked([]); setNotice(`Drafted ${order.poNo}. Open Purchases to check and approve it.`); }} />
      )}
    </>
  );
}

// ABC: the few items that hold most of the value (A, first 80%), the middle (B, next 15%), the rest (C).
const abcOf = (items) => {
  const total = items.reduce((sum, item) => sum + item.stockValue, 0);
  let running = 0;
  return [...items].sort((a, b) => b.stockValue - a.stockValue).map((item) => {
    const share = total > 0 ? item.stockValue / total : 0;
    const before = running;
    running += share;
    return { ...item, share, cumulative: running, abc: total === 0 || item.stockValue === 0 ? "C" : before < 0.8 ? "A" : before < 0.95 ? "B" : "C" };
  });
};

const pct = (value) => `${(value * 100).toFixed(1)}%`;

const REPORTS = {
  valuation: {
    title: "Stock Valuation",
    text: "Every item with quantity on hand, weighted average cost and value.",
    columns: [
      { label: "SKU", value: (r) => r.sku }, { label: "Item", value: (r) => r.name }, { label: "Category", value: (r) => r.category },
      { label: "On hand", value: (r) => r.onHand }, { label: "Unit", value: (r) => r.unit }, { label: "Avg cost", value: (r) => r.avgCost },
      { label: "Value", value: (r) => r.stockValue }, { label: "Level", value: (r) => STOCK_LABELS[r.stockStatus] },
    ],
  },
  abc: {
    title: "ABC Analysis",
    text: "A items hold ~80% of the stock value: count them often and order carefully. C items are many but cheap.",
    columns: [
      { label: "Class", value: (r) => r.abc }, { label: "SKU", value: (r) => r.sku }, { label: "Item", value: (r) => r.name },
      { label: "Value", value: (r) => r.stockValue }, { label: "Share", value: (r) => pct(r.share) }, { label: "Cumulative", value: (r) => pct(r.cumulative) },
    ],
  },
  movement: {
    title: "Fast, Slow & Dead Stock",
    text: "Issued quantity over the period. Dead stock has value on the shelf but was not issued at all.",
    columns: [
      { label: "Speed", value: (r) => r.speed }, { label: "SKU", value: (r) => r.sku }, { label: "Item", value: (r) => r.name },
      { label: "Issued", value: (r) => r.issued }, { label: "On hand", value: (r) => r.onHand }, { label: "Value", value: (r) => r.stockValue },
      { label: "Days of stock", value: (r) => (r.daysLeft === null ? "" : r.daysLeft) }, { label: "Last issued", value: (r) => r.lastIssueAt?.slice(0, 10) || "never" },
    ],
  },
  stores: {
    title: "Store-wise Stock",
    text: "What each store holds and its value.",
    columns: [
      { label: "Code", value: (r) => r.code }, { label: "Store", value: (r) => r.name }, { label: "Items held", value: (r) => r.itemCount },
      { label: "Stock value", value: (r) => r.stockValue }, { label: "Assets", value: (r) => r.assetCount }, { label: "Status", value: (r) => (r.isActive ? "Open" : "Closed") },
    ],
  },
  // These two load their own data and draw their own tables.
  spending: { title: "Spending by Purpose", own: true },
  reorder: { title: "Reorder Suggestions", own: true },
};

export default function ReportsPage() {
  const { can, isReady } = useMe();
  const [report, setReport] = useState("valuation");
  const [days, setDays] = useState(90);
  const load = useCallback(() => Promise.all([inventoryApi.items(), inventoryApi.stores(), inventoryApi.movementAnalysis(days)]), [days]);
  const { data, error, isLoading } = useData(load);
  const [actionError, setActionError] = useState("");
  const [items, stores, analysis] = data || [[], [], { items: {} }];

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const withMovement = items.map((item) => {
    const usage = analysis.items[item.id] || { issued: 0, lastIssueAt: null };
    const perDay = usage.issued / days;
    return { ...item, issued: usage.issued, lastIssueAt: usage.lastIssueAt, daysLeft: perDay > 0 ? Math.round(item.onHand / perDay) : null };
  });
  const issuedSorted = withMovement.filter((item) => item.issued > 0).sort((a, b) => b.issued - a.issued);
  const fastCut = issuedSorted[Math.max(0, Math.ceil(issuedSorted.length * 0.2) - 1)]?.issued ?? Infinity;
  const movement = withMovement
    .map((item) => ({ ...item, speed: item.issued === 0 ? (item.onHand > 0 ? "Dead" : "No stock") : item.issued >= fastCut ? "Fast" : "Slow" }))
    .sort((a, b) => b.issued - a.issued || b.stockValue - a.stockValue);

  const rows = { valuation: items, abc: abcOf(items), movement, stores }[report] || [];
  const config = REPORTS[report];
  const total = items.reduce((sum, item) => sum + item.stockValue, 0);

  const exportCsv = () => downloadCsv(`${config.title.toLowerCase().replace(/[^a-z]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`, config.columns, rows);
  const print = () => {
    setActionError("");
    try {
      printTable(`${config.title}${report === "movement" ? ` (last ${days} days)` : ""}`, config.columns, rows);
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Inventory Reports" subtitle="Live from the stock ledger. Export to CSV (opens in Excel) or print / save as PDF." crumbs={CRUMBS}
      actions={can("inventory.export") && !config.own && <>
        <button onClick={exportCsv} disabled={isLoading} className={secondaryButton}>Export CSV</button>
        <button onClick={print} disabled={isLoading} className={secondaryButton}>Print / PDF</button>
      </>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reports">
        {Object.entries(REPORTS).map(([key, value]) => (
          <button key={key} role="tab" aria-selected={report === key} onClick={() => setReport(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${report === key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {value.title}
          </button>
        ))}
        <Link href="/admin/inventory/stock" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Stock Ledger / Movement →</Link>
      </div>
      {report === "spending" && <SpendingReport canExport={can("inventory.export")} />}
      {report === "reorder" && <ReorderReport canExport={can("inventory.export")} canPurchase={can("inventory.manage_purchases")} />}
      {!config.own && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{config.text}</p>
        {report === "movement" && (
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className={filterClass}>
            <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={180}>Last 180 days</option><option value={365}>Last 365 days</option>
          </select>
        )}
        {(report === "valuation" || report === "abc") && <p className="text-sm font-semibold text-slate-800">Total stock value {money(total)}</p>}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={config.columns.map((column) => column.label)} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="Nothing to report yet.">
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              {report === "valuation" && <>
                <td className="px-4 py-2 font-mono text-xs">{row.sku}</td><td className="px-4 py-2 font-medium">{row.name}</td><td className="px-4 py-2">{row.category || "—"}</td>
                <td className="px-4 py-2 tabular-nums">{qty(row.onHand)}</td><td className="px-4 py-2">{row.unit}</td><td className="px-4 py-2 tabular-nums">{money(row.avgCost)}</td>
                <td className="px-4 py-2 tabular-nums">{money(row.stockValue)}</td><td className="px-4 py-2"><StockBadge status={row.stockStatus} /></td>
              </>}
              {report === "abc" && <>
                <td className="px-4 py-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${row.abc === "A" ? "bg-blue-100 text-blue-800" : row.abc === "B" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{row.abc}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{row.sku}</td><td className="px-4 py-2 font-medium">{row.name}</td>
                <td className="px-4 py-2 tabular-nums">{money(row.stockValue)}</td><td className="px-4 py-2 tabular-nums">{pct(row.share)}</td><td className="px-4 py-2 tabular-nums">{pct(row.cumulative)}</td>
              </>}
              {report === "movement" && <>
                <td className="px-4 py-2"><span className={`rounded-full px-3 py-1 text-xs font-medium ${row.speed === "Fast" ? "bg-green-100 text-green-700" : row.speed === "Dead" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{row.speed}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{row.sku}</td><td className="px-4 py-2 font-medium">{row.name}</td>
                <td className="px-4 py-2 tabular-nums">{qty(row.issued)} {row.unit}</td><td className="px-4 py-2 tabular-nums">{qty(row.onHand)}</td><td className="px-4 py-2 tabular-nums">{money(row.stockValue)}</td>
                <td className="px-4 py-2 tabular-nums">{row.daysLeft === null ? "—" : `${row.daysLeft} days`}</td><td className="px-4 py-2 text-xs">{row.lastIssueAt?.slice(0, 10) || "never"}</td>
              </>}
              {report === "stores" && <>
                <td className="px-4 py-2 font-mono text-xs">{row.code}</td><td className="px-4 py-2 font-medium">{row.name}</td><td className="px-4 py-2 tabular-nums">{row.itemCount}</td>
                <td className="px-4 py-2 tabular-nums">{money(row.stockValue)}</td><td className="px-4 py-2 tabular-nums">{row.assetCount}</td><td className="px-4 py-2">{row.isActive ? "Open" : "Closed"}</td>
              </>}
            </tr>
          ))}
        </DataTable>
      </section>
      </>}
    </SystemShell>
  );
}
