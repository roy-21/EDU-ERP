"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, StatGrid, SystemShell, ViewModal, formatDateTime, friendlyError, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { KindBadge, LinkCard, qty, signed } from "./_components/inventoryUi";

const ALERT_STYLES = {
  danger: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

const monthLabel = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

// Stock in against stock out by value, month by month.
function MonthlyChart({ months }) {
  const peak = Math.max(1, ...months.flatMap((month) => [month.inValue, month.outValue]));
  return (
    <div>
      <div className="flex h-48 items-end gap-3" role="img" aria-label="Stock in and stock out by value for the last six months">
        {months.map((month) => (
          <div key={month.month} className="flex h-full flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-1">
              <div title={`Stock in ${money(month.inValue)}`} className="w-1/3 max-w-6 rounded-t bg-emerald-500" style={{ height: `${(month.inValue / peak) * 100}%` }} />
              <div title={`Stock out ${money(month.outValue)}`} className="w-1/3 max-w-6 rounded-t bg-blue-500" style={{ height: `${(month.outValue / peak) * 100}%` }} />
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">{monthLabel(month.month)}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Stock in</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> Issued</span>
      </div>
    </div>
  );
}

// Who gets the daily alert email, how early expiry is warned about, and what was sent.
function AlertSettings({ canEdit, onClose, onSaved }) {
  const load = useCallback(() => Promise.all([inventoryApi.settings(), inventoryApi.emailLog()]), []);
  const { data, error, reload } = useData(load);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [settings, log = []] = data || [];

  const sendNow = async () => {
    setSending(true);
    setMessage("");
    try {
      const result = await inventoryApi.emailAlertsNow();
      setMessage(result.sent ? `Sent ${result.alerts} alert(s) to ${result.recipients.join(", ")}.` : `Not sent: ${result.reason}`);
      reload();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setSending(false);
    }
  };

  if (editing && settings) {
    return (
      <QuickForm title="Alert Settings" initial={settings} onClose={() => setEditing(false)}
        fields={[
          { name: "emailAlerts", label: "Send a daily alert email (from 08:00, only when something needs attention)", type: "checkbox", wide: true },
          { name: "alertEmails", label: "Send to (comma separated)", wide: true, hint: "e.g. store@school.edu, accounts@school.edu" },
          { name: "expiryWarningDays", label: "Warn this many days before a batch expires", type: "number", min: 1 },
        ]}
        onSubmit={async (body) => { await inventoryApi.saveSettings(body); setEditing(false); reload(); onSaved(); }} />
    );
  }

  return (
    <ViewModal title="Alert Settings" onClose={onClose}
      actions={canEdit && settings && <>
        <button onClick={sendNow} disabled={sending || !settings.alertEmails} className={secondaryButton}>{sending ? "Sending..." : "Send alert email now"}</button>
        <button onClick={() => setEditing(true)} className={primaryButton}>Edit</button>
      </>}>
      <ErrorBanner message={error} />
      {!settings ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          {!settings.smtpConfigured && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The server has no mail account (EMAIL_USER and EMAIL_PASS in the backend .env), so emails cannot be sent yet. In-app alerts still work.</p>}
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Daily email</dt><dd className="font-medium">{settings.emailAlerts ? "On" : "Off"}</dd></div>
            <div><dt className="text-xs text-slate-500">Recipients</dt><dd className="break-words font-medium">{settings.alertEmails || "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Expiry warning</dt><dd className="font-medium">{settings.expiryWarningDays} days</dd></div>
          </dl>
          {message && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{message}</p>}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Recent alert emails</h3>
            {log.length === 0 ? <p className="text-sm text-slate-500">None sent yet.</p> : (
              <ul className="space-y-1 text-sm">
                {log.map((row, index) => (
                  <li key={index}><span className={row.status === "SENT" ? "text-green-700" : "text-red-600"}>{row.status === "SENT" ? "Sent" : "Failed"}</span> · {formatDateTime(row.at)} · {row.recipient}{row.error && ` · ${row.error}`}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </ViewModal>
  );
}

// Someone who can only ask the store for items sees their requisitions, not the stock.
function RequesterHome() {
  return (
    <SystemShell title="Inventory" subtitle="Ask the store for the items you need.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <LinkCard href="/admin/inventory/requisitions" title="My Requisitions" text="Raise a requisition and follow it until the items arrive." icon="📝" />
      </div>
    </SystemShell>
  );
}

export default function InventoryDashboard() {
  const { can, isReady } = useMe();
  const canRead = can("inventory.read");
  const load = useCallback(() => (canRead ? Promise.all([inventoryApi.summary(), inventoryApi.alerts(), inventoryApi.settings()]) : Promise.resolve(null)), [canRead]);
  const { data, error, isLoading, reload } = useData(load);
  const [showSettings, setShowSettings] = useState(false);

  if (isReady && !canRead) return can("inventory.request_items") ? <RequesterHome /> : <NoAccess />;
  const [summary, alerts = [], settings] = data || [];
  // Until the settings load, show everything rather than flash a short menu.
  const on = (feature) => !settings || settings.features.includes(feature);

  const sections = [
    { href: "/admin/inventory/items", title: "Items & Stock", text: "Stock items, levels, reorder points and value.", icon: "📦", count: summary?.items },
    { href: "/admin/inventory/stock", title: "Stock Ledger", text: "Receive, issue, use, take back, count and write off.", icon: "🧾" },
    on("REQUISITIONS") && { href: "/admin/inventory/requisitions", title: "Requisitions", text: "Requests from departments and rooms: approve, then issue.", icon: "📝", count: summary ? summary.requisitionsWaiting + summary.requisitionsToIssue : undefined },
    on("KITCHEN") && { href: "/admin/inventory/kitchen", title: "Kitchen & Consumption", text: "Daily use and wastage, meals served, cost per meal.", icon: "🍲" },
    on("ROOMS") && { href: "/admin/inventory/rooms", title: "Room Inventory", text: "What each hostel room holds: fans, lights, beds...", icon: "🛏️", count: summary?.roomAssets },
    on("PURCHASING") && { href: "/admin/inventory/purchases", title: "Purchases", text: "Suppliers, purchase orders and goods received.", icon: "🛒", count: summary ? summary.openPurchaseOrders + summary.draftPurchaseOrders : undefined },
    on("BATCHES") && { href: "/admin/inventory/batches", title: "Batches & Expiry", text: "Expiry dates, soonest first; write off expired stock.", icon: "⏳", count: summary ? summary.expiredBatches + summary.expiringBatches : undefined },
    on("TRANSFERS") && { href: "/admin/inventory/transfers", title: "Transfers", text: "Move stock between stores, with approval.", icon: "🔁", count: summary ? summary.pendingTransfers + summary.inTransit : undefined },
    on("ASSETS") && { href: "/admin/inventory/assets", title: "Assets", text: "Equipment and furniture: where each is and who has it.", icon: "💻", count: summary?.assets.total },
    { href: "/admin/inventory/stores", title: "Stores", text: "Central store, kitchens, labs and other locations.", icon: "🏬", count: summary?.stores },
    { href: "/admin/inventory/barcode", title: "Barcodes & Scan", text: "Print labels and look things up with a scanner.", icon: "🏷️" },
    { href: "/admin/inventory/reports", title: "Reports", text: "Valuation, spending by purpose, reorder suggestions.", icon: "📊" },
    { href: "/admin/inventory/setup", title: "Setup", text: "Organisation type and the parts of inventory in use.", icon: "⚙️" },
  ].filter(Boolean);

  const stats = [
    { label: "Stock items", value: summary?.items ?? 0 },
    { label: "Stock value", value: money(summary?.stockValue), color: "text-blue-700" },
    { label: "Low stock", value: summary?.lowStock ?? 0, color: "text-amber-600" },
    { label: "Out of stock", value: summary?.outOfStock ?? 0, color: "text-red-600" },
    { label: "Today in / out", value: `${qty(summary?.todayIn)} / ${qty(summary?.todayOut)}` },
    on("REQUISITIONS") && { label: "Requisitions to approve / issue", value: summary ? `${summary.requisitionsWaiting} / ${summary.requisitionsToIssue}` : "—", color: "text-amber-600" },
    on("KITCHEN") && { label: "Used this month", value: money(summary?.monthConsumed) },
    on("KITCHEN") && { label: "Wasted this month", value: money(summary?.monthWasted), color: "text-red-600" },
    on("ROOMS") && { label: "Assets in rooms", value: summary?.roomAssets ?? 0 },
    on("ASSETS") && { label: "Assets in service", value: summary?.assets.total ?? 0 },
    on("ASSETS") && { label: "Asset value", value: money(summary?.assets.value) },
    on("ASSETS") && { label: "Under repair", value: summary?.assets.underRepair ?? 0, color: "text-amber-600" },
    on("TRANSFERS") && { label: "Transfers open", value: summary ? `${summary.pendingTransfers} pending · ${summary.inTransit} sent` : "—" },
    on("BATCHES") && { label: "Expired / expiring batches", value: summary ? `${summary.expiredBatches} / ${summary.expiringBatches}` : "—", color: "text-red-600" },
    on("PURCHASING") && { label: "Purchase orders open / draft", value: summary ? `${summary.openPurchaseOrders} / ${summary.draftPurchaseOrders}` : "—" },
    { label: "Overstock", value: summary?.overStock ?? 0, color: "text-purple-700" },
  ].filter(Boolean);

  return (
    <SystemShell title="Inventory" subtitle="Stock, stores and assets, live from the database."
      actions={<>
        <button onClick={() => setShowSettings(true)} className={secondaryButton}>Alert Settings</button>
        <button onClick={reload} className={secondaryButton}>Refresh</button>
      </>}>
      <ErrorBanner message={error} />
      {settings && !settings.isSetUp && can("inventory.update") && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <span><span className="font-semibold">Set up inventory for your organisation.</span> A hostel gets kitchen and room inventory, an office gets requisitions and assets, and so on.</span>
          <Link href="/admin/inventory/setup" className={primaryButton}>Open Setup</Link>
        </div>
      )}
      <StatGrid isLoading={isLoading} stats={stats} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="font-semibold text-slate-800">Stock in and out, last 6 months</h2>
          <p className="mb-4 text-sm text-slate-500">By value at cost.</p>
          {summary ? <MonthlyChart months={summary.monthly} /> : <p className="py-16 text-center text-sm text-slate-500">{isLoading ? "Loading..." : "—"}</p>}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Needs attention</h2>
          <p className="mb-3 text-sm text-slate-500">{alerts.length} alert{alerts.length === 1 ? "" : "s"}</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {alerts.length === 0 && !isLoading && <li className="text-sm text-slate-500">Nothing needs attention.</li>}
            {alerts.slice(0, 30).map((alert, index) => (
              <li key={`${alert.type}-${index}`}>
                <Link href={alert.link} className={`block rounded-lg border p-3 text-sm hover:opacity-90 ${ALERT_STYLES[alert.level]}`}>
                  <span className="font-medium">{alert.title}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{alert.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => <LinkCard key={section.href} {...section} />)}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <h2 className="p-5 pb-2 font-semibold text-slate-800">Recent stock activity</h2>
          <DataTable columns={["When", "Document", "Item", "Store", "Type", "Qty"]} isLoading={isLoading} hasRows={(summary?.recent || []).length > 0} emptyMessage="No stock has moved yet." minWidth="min-w-[640px]">
            {(summary?.recent || []).map((m) => (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(m.createdAt)}</td>
                <td className="px-4 py-3 font-mono text-xs">{m.docNo}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{m.itemName}</td>
                <td className="px-4 py-3">{m.storeCode}</td>
                <td className="px-4 py-3"><KindBadge kind={m.kind} /></td>
                <td className={`px-4 py-3 font-medium tabular-nums ${m.quantity < 0 ? "text-red-600" : "text-green-700"}`}>{signed(m.quantity)} {m.unit}</td>
              </tr>
            ))}
          </DataTable>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Most used, last 90 days</h2>
          <ol className="mt-3 space-y-3">
            {(summary?.topIssued || []).length === 0 && <li className="text-sm text-slate-500">Nothing issued yet.</li>}
            {(summary?.topIssued || []).map((item, index) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span><span className="mr-2 text-slate-400">{index + 1}.</span><span className="font-medium text-slate-800">{item.name}</span></span>
                <span className="tabular-nums text-slate-600">{qty(item.quantity)} {item.unit}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {showSettings && <AlertSettings canEdit={can("inventory.update")} onClose={() => setShowSettings(false)} onSaved={reload} />}
    </SystemShell>
  );
}
