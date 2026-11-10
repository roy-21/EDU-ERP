"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { todayLocal } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, Field, FormModal, NoAccess, StatGrid, SystemShell, ViewModal, filterClass, inputClass, linkButton, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { downloadCsv } from "@/app/admin/hostel/_components/hostelExport";
import { AssetBadge, CRUMBS, Notice, qty } from "../_components/inventoryUi";

const CSV_COLUMNS = [
  { label: "Room", value: (r) => r.roomNumber },
  { label: "Hostel", value: (r) => r.hostelName },
  { label: "Building", value: (r) => r.building },
  { label: "Floor", value: (r) => r.floor },
  { label: "Assets", value: (r) => r.assets.map((a) => `${a.count} × ${a.name}`).join("; ") },
  { label: "Asset count", value: (r) => r.assetCount },
  { label: "Asset value", value: (r) => r.assetValue },
  { label: "Needs attention", value: (r) => r.needsAttention },
];

// Units of a stock item sent to rooms (or other places) and registered as assets, one per unit.
function FromStockForm({ rooms, items, stores, onClose, onDone }) {
  const open = stores.filter((store) => store.isActive);
  const [head, setHead] = useState({ itemId: "", storeId: open[0]?.id || "", assetTag: "", warrantyUntil: "", note: "" });
  const [rows, setRows] = useState([{ key: 1, roomId: "", location: "", quantity: "1" }]);
  const set = (patch) => setHead((current) => ({ ...current, ...patch }));
  const setRow = (index, patch) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const item = items.find((entry) => entry.id === head.itemId);
  const total = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);

  const submit = async () => {
    onDone(await inventoryApi.assetsFromStock({
      ...head, assetTag: head.assetTag || undefined, warrantyUntil: head.warrantyUntil || null,
      allocations: rows.map((row) => ({ roomId: row.roomId || undefined, location: row.roomId ? "" : row.location, quantity: Number(row.quantity) })),
    }));
  };

  return (
    <FormModal title="Send Stock to Rooms" submitLabel={`Register ${total || ""} asset${total === 1 ? "" : "s"}`} onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-slate-600 sm:col-span-2">Bought 20 fans? Send 2 to Room 101 and 3 to Room 102: the 5 leave the store and become assets with their own tags, held by each room. The rest stay in stock.</p>
      <Field id="fs-item" label="Item *" wide>
        <select id="fs-item" value={head.itemId} onChange={(e) => set({ itemId: e.target.value })} className={inputClass}>
          <option value="">Choose...</option>
          {items.filter((entry) => entry.status === "ACTIVE" && entry.onHand > 0).map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name} · {entry.sku} ({qty(entry.onHand)} {entry.unit} in stock)</option>
          ))}
        </select>
      </Field>
      <Field id="fs-store" label="From store *">
        <select id="fs-store" value={head.storeId} onChange={(e) => set({ storeId: e.target.value })} className={inputClass}>
          {open.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}
        </select>
      </Field>
      <Field id="fs-tag" label="Asset tag prefix">
        <input id="fs-tag" value={head.assetTag} onChange={(e) => set({ assetTag: e.target.value })} placeholder={item ? `${item.sku} → ${item.sku}-001` : "The item's SKU"} className={inputClass} />
      </Field>
      <Field id="fs-warranty" label="Warranty until">
        <input id="fs-warranty" type="date" min={todayLocal()} value={head.warrantyUntil} onChange={(e) => set({ warrantyUntil: e.target.value })} className={inputClass} />
      </Field>
      <Field id="fs-note" label="Note">
        <input id="fs-note" value={head.note} onChange={(e) => set({ note: e.target.value })} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Room</th><th className="py-2">or other place</th><th className="py-2">Units</th><th /></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className="border-b border-slate-100">
                <td className="py-2 pr-2">
                  <select aria-label={`Room for line ${index + 1}`} value={row.roomId} onChange={(e) => setRow(index, { roomId: e.target.value })} className={inputClass}>
                    <option value="">—</option>
                    {rooms.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-2"><input aria-label={`Place for line ${index + 1}`} disabled={Boolean(row.roomId)} value={row.location} onChange={(e) => setRow(index, { location: e.target.value })} placeholder="e.g. Common room" className={inputClass} /></td>
                <td className="py-2 pr-2"><input aria-label={`Units for line ${index + 1}`} type="number" min="1" step="1" value={row.quantity} onChange={(e) => setRow(index, { quantity: e.target.value })} className={`${inputClass} w-24`} /></td>
                <td className="py-2">{rows.length > 1 && <button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="text-sm font-medium text-red-600 hover:text-red-800">Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => setRows((current) => [...current, { key: Date.now(), roomId: "", location: "", quantity: "1" }])} className={`mt-2 text-sm ${linkButton}`}>+ Another room</button>
        {item && <p className="mt-2 text-xs text-slate-500">{qty(item.onHand)} {item.unit} in all stores · each asset is booked at the average cost of {money(item.avgCost)}.</p>}
      </div>
    </FormModal>
  );
}

function RoomAssets({ room, onClose }) {
  const load = useCallback(() => inventoryApi.assets({ roomId: room.id, status: "IN_SERVICE" }), [room.id]);
  const { data, error } = useData(load);
  return (
    <ViewModal title={room.label} onClose={onClose}>
      <ErrorBanner message={error} />
      {!data ? <p className="text-sm text-slate-500">Loading...</p> : data.length === 0 ? <p className="text-sm text-slate-500">Nothing is recorded in this room.</p> : (
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="py-2">Tag</th><th className="py-2">Asset</th><th className="py-2">Condition</th><th className="py-2">Status</th><th className="py-2">Cost</th></tr></thead>
          <tbody>
            {data.map((asset) => (
              <tr key={asset.id} className="border-b border-slate-100">
                <td className="py-2 font-mono text-xs">{asset.assetTag}</td>
                <td className="py-2">{asset.name}{asset.warrantyUntil && <span className="block text-xs text-slate-500">Warranty to {asset.warrantyUntil}</span>}</td>
                <td className="py-2">{asset.condition}</td>
                <td className="py-2"><AssetBadge status={asset.status} /></td>
                <td className="py-2 tabular-nums">{money(asset.purchaseCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-slate-500">To move an asset to another room, repair or replace it, use <Link href="/admin/inventory/assets" className="text-blue-700 hover:underline">Assets</Link>; each change is kept in its history.</p>
    </ViewModal>
  );
}

export default function RoomInventoryPage() {
  const { can, isReady } = useMe();
  const load = useCallback(() => Promise.all([inventoryApi.rooms(), inventoryApi.items(), inventoryApi.stores()]), []);
  const { data, error, isLoading, reload } = useData(load);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [notice, setNotice] = useState("");
  const [rooms, items, stores] = data || [[], [], []];

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const term = search.trim().toLowerCase();
  const shown = term ? rooms.filter((room) => [room.label, room.floor, ...room.assets.map((asset) => asset.name)].some((value) => String(value).toLowerCase().includes(term))) : rooms;
  const canSend = can("inventory.manage_stock") && can("inventory.manage_assets");

  return (
    <SystemShell title="Room Inventory" crumbs={CRUMBS} subtitle="What every hostel room holds: fans, lights, beds, tables. Each item is an asset with its own tag and history."
      actions={<>
        {can("inventory.export") && <button onClick={() => downloadCsv(`room-inventory-${todayLocal()}.csv`, CSV_COLUMNS, shown)} className={secondaryButton}>Export CSV</button>}
        {canSend && <button disabled={rooms.length === 0} onClick={() => setForm(true)} className={primaryButton}>Send Stock to Rooms</button>}
      </>}>
      <ErrorBanner message={error} />
      <Notice text={notice} />
      {!isLoading && rooms.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No rooms yet. Rooms come from the hostel: add them under <Link href="/admin/hostel/rooms" className="font-medium underline">Hostel → Rooms</Link>.</p>
      )}
      <StatGrid isLoading={isLoading} stats={[
        { label: "Rooms", value: rooms.length },
        { label: "Assets in rooms", value: rooms.reduce((sum, room) => sum + room.assetCount, 0) },
        { label: "Value in rooms", value: money(rooms.reduce((sum, room) => sum + room.assetValue, 0)), color: "text-blue-700" },
        { label: "Rooms with nothing recorded", value: rooms.filter((room) => room.assetCount === 0).length },
        { label: "Needs repair / poor", value: rooms.reduce((sum, room) => sum + room.needsAttention, 0), color: "text-amber-600" },
      ]} />
      <input aria-label="Search rooms" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Room, building or asset (e.g. fan)" className={`${filterClass} min-w-[16rem]`} />
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Room", "Floor", "Holds", "Assets", "Value", ""]} isLoading={isLoading} hasRows={shown.length > 0} emptyMessage="No rooms match." minWidth="min-w-[820px]">
          {shown.map((room) => (
            <tr key={room.id} className="border-b border-slate-100 align-top">
              <td className="px-4 py-3"><span className="font-medium text-slate-800">Room {room.roomNumber}</span><span className="block text-xs text-slate-500">{room.hostelName}, {room.building}</span>
                {room.underMaintenance && <span className="mt-1 block text-xs text-amber-700">Under maintenance</span>}</td>
              <td className="px-4 py-3">{room.floor}</td>
              <td className="px-4 py-3">
                {room.assets.length === 0 ? <span className="text-slate-400">Nothing recorded</span> : (
                  <span className="flex flex-wrap gap-1.5">
                    {room.assets.map((asset) => (
                      <span key={asset.name} className={`rounded-full px-2.5 py-0.5 text-xs ${asset.attention ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}
                        title={asset.attention ? `${asset.attention} under repair or in poor condition` : undefined}>{asset.count} × {asset.name}</span>
                    ))}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 tabular-nums">{room.assetCount}</td>
              <td className="px-4 py-3 tabular-nums">{money(room.assetValue)}</td>
              <td className="px-4 py-3"><button onClick={() => setViewing(room)} className={linkButton}>View</button></td>
            </tr>
          ))}
        </DataTable>
      </section>
      {form && (
        <FromStockForm rooms={rooms} items={items} stores={stores} onClose={() => setForm(false)}
          onDone={(result) => { setForm(false); setNotice(`Registered ${result.created} asset${result.created === 1 ? "" : "s"} (${result.docNo}).`); reload(); }} />
      )}
      {viewing && <RoomAssets room={viewing} onClose={() => setViewing(null)} />}
    </SystemShell>
  );
}
