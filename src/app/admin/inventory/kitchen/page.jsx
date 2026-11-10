"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { todayLocal } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, StatGrid, SystemShell, filterClass, friendlyError, inputClass, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { downloadCsv, printTable } from "@/app/admin/hostel/_components/hostelExport";
import { CRUMBS, Notice, StockDocumentForm, qty } from "../_components/inventoryUi";

const SHEET_COLUMNS = [
  { label: "Item", value: (r) => r.name },
  { label: "Unit", value: (r) => r.unit },
  { label: "Opening", value: (r) => r.opening },
  { label: "Received", value: (r) => r.received },
  { label: "Used", value: (r) => r.consumed },
  { label: "Wasted", value: (r) => r.wasted },
  { label: "Other (+/-)", value: (r) => r.other },
  { label: "Closing", value: (r) => r.closing },
  { label: "Cost used", value: (r) => r.consumedValue },
  { label: "Cost wasted", value: (r) => r.wastedValue },
];

// The item summary of a month or range: what there was, bought, used, wasted and left.
const STOCK_COLUMNS = [
  { label: "Item", value: (r) => r.name },
  { label: "SKU", value: (r) => r.sku },
  { label: "Unit", value: (r) => r.unit },
  { label: "At the start", value: (r) => r.opening },
  { label: "Bought", value: (r) => r.purchased },
  { label: "Bought (taka)", value: (r) => r.purchasedValue },
  { label: "Avg price", value: (r) => r.avgPurchasePrice ?? "" },
  { label: "Other in", value: (r) => Math.round((r.received - r.purchased) * 1000) / 1000 },
  { label: "Used", value: (r) => r.consumed },
  { label: "Used (taka)", value: (r) => r.consumedValue },
  { label: "Wasted", value: (r) => r.wasted },
  { label: "Wasted (taka)", value: (r) => r.wastedValue },
  { label: "Issued / adjusted", value: (r) => r.other },
  { label: "Left", value: (r) => r.closing },
  { label: "Left (taka)", value: (r) => r.closingValue },
];

const MONTH_COLUMNS = [
  { label: "Date", value: (r) => r.date },
  { label: "Received", value: (r) => r.received },
  { label: "Used", value: (r) => r.consumed },
  { label: "Wasted", value: (r) => r.wasted },
  { label: "Meals served", value: (r) => r.mealsServed },
  { label: "Cost per meal", value: (r) => r.costPerMeal ?? "" },
];

// Meals served by hand count; empty uses the hostel meal bookings of the day.
function MealRow({ meal, canEdit, onSave }) {
  const [served, setServed] = useState(meal.source === "COUNT" ? String(meal.served) : "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(meal.meal, served);
    } finally {
      setSaving(false);
    }
  };
  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3 font-medium text-slate-800">{meal.meal}</td>
      <td className="px-4 py-3 tabular-nums">{money(meal.cost)}</td>
      <td className="px-4 py-3">
        {canEdit ? (
          <span className="flex items-center gap-2">
            <input aria-label={`Meals served at ${meal.meal}`} type="number" min="0" step="1" value={served} placeholder={meal.source === "BOOKINGS" ? `${meal.served} booked` : "Count"}
              onChange={(e) => setServed(e.target.value)} className={`${inputClass} w-28`} />
            <button onClick={save} disabled={saving} className={secondaryButton}>{saving ? "..." : "Save"}</button>
          </span>
        ) : <span className="tabular-nums">{meal.served ?? "—"}</span>}
        {meal.source && <span className="mt-1 block text-xs text-slate-500">{meal.source === "COUNT" ? "Counted by hand" : "From hostel meal bookings"}</span>}
      </td>
      <td className="px-4 py-3 font-medium tabular-nums">{meal.costPerMeal !== null ? money(meal.costPerMeal) : "—"}</td>
    </tr>
  );
}

const MEAL_ORDER = ["Breakfast", "Lunch", "Dinner", "Snacks", "Special Meal"];

export default function KitchenPage() {
  const { can, isReady } = useMe();
  const [view, setView] = useState("day");
  const [storeId, setStoreId] = useState("");
  const [day, setDay] = useState(todayLocal());
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [range, setRange] = useState({ from: `${todayLocal().slice(0, 7)}-01`, to: todayLocal() });
  const [itemSearch, setItemSearch] = useState("");
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const loadBase = useCallback(() => Promise.all([inventoryApi.stores(), inventoryApi.items()]), []);
  const base = useData(loadBase);
  const [stores, items] = base.data || [[], []];
  const firstKitchen = stores.find((store) => store.isActive && store.kind === "KITCHEN") || stores.find((store) => store.isActive);
  const current = storeId || firstKitchen?.id || "";

  const loadSheet = useCallback(() => {
    if (!current) return Promise.resolve(null);
    if (view === "day") return inventoryApi.kitchenDay(current, day);
    return inventoryApi.kitchenMonth(current, view === "month" ? { month } : { from: range.from, to: range.to });
  }, [current, view, day, month, range.from, range.to]);
  const sheet = useData(loadSheet);

  if (isReady && !can("inventory.read")) return <NoAccess />;
  const open = stores.filter((store) => store.isActive);
  // Kitchens first; any store can record use.
  const choices = [...open.filter((store) => store.kind === "KITCHEN"), ...open.filter((store) => store.kind !== "KITCHEN")];
  const canRecord = can("inventory.manage_kitchen", "inventory.manage_stock");
  const data = sheet.data;
  // Right after switching views the other view's data is still shown until the new one loads,
  // so each view checks for its own shape (both have items).
  const isDay = view === "day" && Boolean(data?.meals);
  const isMonth = (view === "month" || view === "range") && Boolean(data?.days);
  const periodLabel = isMonth ? (data.month ? new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : `${data.from} to ${data.to}`) : "";
  const term = itemSearch.trim().toLowerCase();
  const stockRows = isMonth ? data.items.filter((row) => !term || row.name.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term) || row.category.toLowerCase().includes(term)) : [];

  const posted = (doc, text) => {
    setForm(null);
    setNotice(`${text} ${doc.docNo}.`);
    sheet.reload();
    base.reload();
  };

  const saveMeal = async (meal, served) => {
    setActionError("");
    try {
      await inventoryApi.setMealCount({ storeId: current, date: day, meal, served: served === "" ? null : Number(served) });
      setNotice(`${meal} count saved.`);
      sheet.reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const storeName = choices.find((store) => store.id === current)?.name || "";
  const noKitchen = !base.isLoading && open.length > 0 && !open.some((store) => store.kind === "KITCHEN");

  return (
    <SystemShell title="Kitchen & Consumption" crumbs={CRUMBS}
      subtitle="Daily use and wastage of food and supplies. Closing = Opening + Received − Used − Wasted, straight from the stock ledger."
      actions={<>
        {can("inventory.manage_stock") && <button disabled={!current} onClick={() => setForm("receive")} className={secondaryButton}>Stock In</button>}
        {canRecord && <button disabled={!current} onClick={() => setForm("waste")} className={secondaryButton}>Record Wastage</button>}
        {canRecord && <button disabled={!current} onClick={() => setForm("consume")} className={primaryButton}>Record Use</button>}
      </>}>
      <ErrorBanner message={base.error || sheet.error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      {!base.isLoading && open.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Add a store of type Kitchen first (Inventory → Stores).</p>}
      {noKitchen && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Tip: set the kitchen store&apos;s type to Kitchen (Inventory → Stores). Its use then counts as a food cost.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Store" value={current} onChange={(e) => setStoreId(e.target.value)} className={filterClass}>
          {choices.map((store) => <option key={store.id} value={store.id}>{store.name}{store.kind === "KITCHEN" ? " (kitchen)" : ""}</option>)}
        </select>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm" role="tablist">
          {[["day", "Day sheet"], ["month", "Month"], ["range", "Date range"]].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}
              className={`rounded-md px-3 py-1.5 ${view === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{label}</button>
          ))}
        </div>
        {view === "day" && <input aria-label="Date" type="date" max={todayLocal()} value={day} onChange={(e) => setDay(e.target.value || todayLocal())} className={filterClass} />}
        {view === "month" && <input aria-label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value || todayLocal().slice(0, 7))} className={filterClass} />}
        {view === "range" && <>
          <label className="flex items-center gap-2 text-sm text-slate-600">From <input aria-label="From date" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className={filterClass} /></label>
          <label className="flex items-center gap-2 text-sm text-slate-600">To <input aria-label="To date" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className={filterClass} /></label>
        </>}
        {isDay && can("inventory.export") && <>
          <button onClick={() => downloadCsv(`kitchen-${data.store.code}-${data.date}.csv`, SHEET_COLUMNS, data.items)} className={secondaryButton}>Export CSV</button>
          <button onClick={() => printTable(`${data.store.name} · day sheet ${data.date}`, SHEET_COLUMNS, data.items)} className={secondaryButton}>Print</button>
        </>}
        {isMonth && can("inventory.export") && <>
          <button onClick={() => downloadCsv(`stock-${data.store.code}-${data.month || `${data.from}-${data.to}`}.csv`, STOCK_COLUMNS, stockRows)} className={secondaryButton}>Export item summary</button>
          <button onClick={() => printTable(`${data.store.name} · stock ${periodLabel}`, STOCK_COLUMNS, stockRows)} className={secondaryButton}>Print</button>
          <button onClick={() => downloadCsv(`kitchen-days-${data.store.code}-${data.month || `${data.from}-${data.to}`}.csv`, MONTH_COLUMNS, data.days)} className={secondaryButton}>Export days</button>
        </>}
      </div>

      {isDay && <>
        <StatGrid stats={[
          { label: "Received today", value: money(data.totals.receivedValue), color: "text-green-700" },
          { label: "Used today", value: money(data.totals.consumedValue), color: "text-blue-700" },
          { label: "Wasted today", value: money(data.totals.wastedValue), color: "text-red-600" },
          { label: "Meals served", value: data.totals.mealsServed },
          { label: "Cost per meal", value: data.totals.costPerMeal !== null ? money(data.totals.costPerMeal) : "—" },
        ]} />
        <section className="rounded-xl border border-slate-200 bg-white p-1">
          <h2 className="px-4 pt-4 font-semibold text-slate-800">{storeName} · {data.date}</h2>
          <DataTable columns={["Item", "Opening", "Received", "Used", "Wasted", "Other", "Closing", "Cost used"]} isLoading={sheet.isLoading} hasRows={data.items.length > 0}
            emptyMessage="Nothing in this store on this day." minWidth="min-w-[860px]">
            {data.items.map((row) => (
              <tr key={row.itemId} className="border-b border-slate-100">
                <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.name}</span><span className="ml-2 text-xs text-slate-500">{row.unit}</span></td>
                <td className="px-4 py-3 tabular-nums">{qty(row.opening)}</td>
                <td className="px-4 py-3 tabular-nums text-green-700">{row.received ? `+${qty(row.received)}` : "—"}</td>
                <td className="px-4 py-3 tabular-nums text-blue-700">{row.consumed ? qty(row.consumed) : "—"}</td>
                <td className="px-4 py-3 tabular-nums text-red-600">{row.wasted ? qty(row.wasted) : "—"}</td>
                <td className="px-4 py-3 tabular-nums" title="Issues, transfers and count adjustments">{row.other ? qty(row.other) : "—"}</td>
                <td className="px-4 py-3 font-semibold tabular-nums">{qty(row.closing)}</td>
                <td className="px-4 py-3 tabular-nums">{money(row.consumedValue)}</td>
              </tr>
            ))}
          </DataTable>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-1">
          <h2 className="px-4 pt-4 font-semibold text-slate-800">Meals and cost per meal</h2>
          <p className="px-4 text-sm text-slate-500">Cost is the food used for that meal. Type how many were served, or leave it empty to use the hostel meal bookings.</p>
          <DataTable columns={["Meal", "Food cost", "Served", "Cost per meal"]} hasRows minWidth="min-w-[600px]">
            {MEAL_ORDER.map((name) => data.meals.find((meal) => meal.meal === name) || { meal: name, cost: 0, served: null, source: null, costPerMeal: null }).map((meal) => (
              <MealRow key={`${meal.meal}-${data.date}-${meal.source}-${meal.served}`} meal={meal} canEdit={canRecord} onSave={saveMeal} />
            ))}
          </DataTable>
          {data.unassignedCost > 0 && <p className="px-4 pb-3 text-xs text-slate-500">{money(data.unassignedCost)} of use was not recorded against a meal.</p>}
        </section>
      </>}

      {isMonth && <>
        <StatGrid stats={[
          { label: "Stock at the start", value: money(data.totals.opening) },
          { label: "Bought", value: money(data.totals.purchased), color: "text-green-700" },
          { label: "Used (cooked)", value: money(data.totals.consumed), color: "text-blue-700" },
          { label: "Wasted", value: money(data.totals.wasted), color: "text-red-600" },
          { label: "Stock left now", value: money(data.totals.closing), color: "text-slate-900" },
          { label: "Meals served", value: data.totals.mealsServed },
          { label: "Cost per meal", value: data.totals.costPerMeal !== null ? money(data.totals.costPerMeal) : "—" },
          { label: "Cost per day", value: data.totals.costPerDay !== null ? money(data.totals.costPerDay) : "—" },
        ]} />

        <section className="rounded-xl border border-slate-200 bg-white p-1">
          <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
            <div>
              <h2 className="font-semibold text-slate-800">Item stock · {storeName} · {periodLabel}</h2>
              <p className="text-sm text-slate-500">At the start + Bought − Used − Wasted = Left. Every number comes from the stock ledger.</p>
            </div>
            <input aria-label="Search items" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Rice, dal, oil..." className={`${filterClass} min-w-[12rem]`} />
          </div>
          <DataTable columns={["Item", "At the start", "Bought", "Avg price", "Used", "Wasted", "Left", "Lasts"]} isLoading={sheet.isLoading} hasRows={stockRows.length > 0}
            emptyMessage={term ? "No item matches." : "Nothing in this store in this period."} minWidth="min-w-[1000px]">
            {stockRows.map((row) => {
              const otherIn = Math.round((row.received - row.purchased) * 1000) / 1000;
              return (
                <tr key={row.itemId} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-3"><span className="font-medium text-slate-800">{row.name}</span><span className="block text-xs text-slate-500">{[row.sku, row.category].filter(Boolean).join(" · ")}</span></td>
                  <td className="px-4 py-3 tabular-nums">{qty(row.opening)} {row.unit}</td>
                  <td className="px-4 py-3 tabular-nums text-green-700">
                    {row.purchased ? <><span className="font-medium">{qty(row.purchased)} {row.unit}</span><span className="block text-xs">{money(row.purchasedValue)}</span></> : "—"}
                    {otherIn !== 0 && <span className="block text-xs text-slate-500" title="Opening stock, returns and transfers in">{otherIn > 0 ? "+" : ""}{qty(otherIn)} other in</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.avgPurchasePrice !== null ? `${money(row.avgPurchasePrice)}/${row.unit}` : "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-blue-700">{row.consumed ? <>{qty(row.consumed)} {row.unit}<span className="block text-xs">{money(row.consumedValue)}</span></> : "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-red-600">{row.wasted ? <>{qty(row.wasted)} {row.unit}<span className="block text-xs">{money(row.wastedValue)}</span></> : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className="font-semibold text-slate-900">{qty(row.closing)} {row.unit}</span><span className="block text-xs text-slate-500">{money(row.closingValue)}</span>
                    {row.other !== 0 && <span className="block text-xs text-slate-500" title="Issued, transferred out or count adjustments">{row.other > 0 ? "+" : ""}{qty(row.other)} issued / adjusted</span>}
                  </td>
                  <td className={`px-4 py-3 tabular-nums ${row.daysLeft !== null && row.daysLeft < 7 ? "font-medium text-red-600" : ""}`}>
                    {row.closing <= 0 ? <span className="text-red-600">Finished</span> : row.daysLeft === null ? "—" : `~${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"}`}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-1 xl:col-span-2">
            <h2 className="px-4 pt-4 font-semibold text-slate-800">Day by day</h2>
            <DataTable columns={["Date", "Received", "Used", "Wasted", "Meals", "Cost per meal"]} isLoading={sheet.isLoading} hasRows minWidth="min-w-[600px]">
              {data.days.filter((row) => row.received || row.consumed || row.wasted || row.mealsServed).map((row) => (
                <tr key={row.date} className="border-b border-slate-100">
                  <td className="px-4 py-2"><button onClick={() => { setDay(row.date); setView("day"); }} className="text-blue-700 hover:underline">{row.date}</button></td>
                  <td className="px-4 py-2 tabular-nums">{money(row.received)}</td>
                  <td className="px-4 py-2 tabular-nums">{money(row.consumed)}</td>
                  <td className="px-4 py-2 tabular-nums text-red-600">{row.wasted ? money(row.wasted) : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{row.mealsServed || "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{row.costPerMeal !== null ? money(row.costPerMeal) : "—"}</td>
                </tr>
              ))}
            </DataTable>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">Biggest food costs</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {!data.items.some((row) => row.consumedValue > 0) && <li className="text-slate-500">Nothing used in this period.</li>}
              {[...data.items].filter((row) => row.consumedValue > 0).sort((a, b) => b.consumedValue - a.consumedValue).slice(0, 12).map((row) => (
                <li key={row.itemId} className="flex justify-between gap-3">
                  <span><span className="font-medium text-slate-800">{row.name}</span> <span className="text-xs text-slate-500">{qty(row.consumed)} {row.unit}{row.wasted ? `, ${qty(row.wasted)} wasted` : ""}</span></span>
                  <span className="tabular-nums">{money(row.consumedValue)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </>}

      {form === "consume" && <StockDocumentForm mode="consume" items={items} stores={stores} defaultStoreId={current} onClose={() => setForm(null)} onSubmit={async (body) => posted(await inventoryApi.consume(body), "Use recorded:")} />}
      {form === "waste" && <StockDocumentForm mode="waste" items={items} stores={stores} defaultStoreId={current} onClose={() => setForm(null)} onSubmit={async (body) => posted(await inventoryApi.waste(body), "Wastage recorded:")} />}
      {form === "receive" && <StockDocumentForm mode="receive" items={items} stores={stores} defaultStoreId={current} onClose={() => setForm(null)} onSubmit={async (body) => posted(await inventoryApi.receive(body), "Received:")} />}
    </SystemShell>
  );
}
