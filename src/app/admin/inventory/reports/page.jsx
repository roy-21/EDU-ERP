"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, friendlyError, money, secondaryButton, useData } from "@/components/erp/ui";
import { downloadCsv, printTable } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, STOCK_LABELS, StockBadge, qty } from "../_components/inventoryUi";

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

  const rows = { valuation: items, abc: abcOf(items), movement, stores }[report];
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
      actions={can("inventory.export") && <>
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
    </SystemShell>
  );
}
