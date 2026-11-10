"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { DataTable, Detail, ErrorBanner, NoAccess, SystemShell, ViewModal, dangerButton, filterClass, formatDateTime, friendlyError, linkButton, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { Pager, usePagination } from "@/app/admin/hostel/_components/hostelUi";
import { downloadCsv } from "@/app/admin/hostel/_components/hostelExport";
import { ASSET_LABELS, AssetBadge, Barcode, CRUMBS, Notice } from "../_components/inventoryUi";

const CONDITIONS = [["NEW", "New"], ["GOOD", "Good"], ["FAIR", "Fair"], ["POOR", "Poor"]];

const assetFields = (stores, isNew) => [
  { name: "name", label: "Asset name *", wide: true, hint: "e.g. Dell OptiPlex 7090, Digital Microscope, Student Desk" },
  { name: "category", label: "Category", hint: "Computer, Lab Equipment, Furniture, Projector..." },
  { name: "assetTag", label: isNew ? "Asset tag (empty = automatic)" : "Asset tag *" },
  ...(isNew ? [{ name: "count", label: "How many identical assets", type: "number", min: 1, hint: "More than 1 numbers the tags: TAG-001, TAG-002..." }] : []),
  { name: "serialNo", label: "Serial number" },
  { name: "brand", label: "Brand" },
  { name: "model", label: "Model" },
  { name: "storeId", label: "Home store", type: "select", optional: true, options: stores.filter((s) => s.isActive).map((s) => [s.id, `${s.name} (${s.code})`]) },
  { name: "location", label: "Room / location" },
  { name: "supplier", label: "Supplier" },
  { name: "purchaseCost", label: "Purchase cost (৳, each)", type: "number", step: "0.01", min: 0, optional: true },
  { name: "purchasedOn", label: "Purchase date", type: "date", optional: true },
  { name: "warrantyUntil", label: "Warranty until", type: "date", optional: true },
  { name: "condition", label: "Condition", type: "select", noBlank: true, options: CONDITIONS },
  { name: "notes", label: "Notes", type: "textarea", rows: 2 },
];

// Which buttons each state offers, and what each needs.
const ACTIONS = {
  ASSIGN: { label: "Assign", from: ["AVAILABLE"], fields: [
    { name: "assignedTo", label: "Assigned to (person or room) *" }, { name: "department", label: "Department" }, { name: "location", label: "Location" }, { name: "note", label: "Note" },
  ] },
  RETURN: { label: "Return", from: ["ASSIGNED"], fields: [{ name: "condition", label: "Condition on return", type: "select", options: CONDITIONS }, { name: "location", label: "Now at" }, { name: "note", label: "Note" }] },
  MOVE: { label: "Move", from: ["AVAILABLE", "ASSIGNED"], fields: [{ name: "location", label: "New location *" }, { name: "note", label: "Note" }] },
  REPAIR: { label: "Send for repair", from: ["AVAILABLE", "ASSIGNED"], fields: [{ name: "note", label: "Problem / repair shop" }] },
  REPAIRED: { label: "Repaired", from: ["UNDER_REPAIR"], fields: [{ name: "condition", label: "Condition", type: "select", options: CONDITIONS }, { name: "note", label: "Note" }] },
  LOST: { label: "Mark lost", from: ["AVAILABLE", "ASSIGNED"], danger: true, fields: [{ name: "note", label: "What happened *" }] },
  FOUND: { label: "Found", from: ["LOST"], fields: [{ name: "location", label: "Found at" }, { name: "note", label: "Note" }] },
  DISPOSE: { label: "Dispose", from: ["AVAILABLE", "UNDER_REPAIR", "LOST"], danger: true, approve: true, fields: [{ name: "note", label: "Reason (sold, scrapped, donated) *" }] },
};

const CSV_COLUMNS = [
  { label: "Asset tag", value: (a) => a.assetTag },
  { label: "Name", value: (a) => a.name },
  { label: "Category", value: (a) => a.category },
  { label: "Brand", value: (a) => a.brand },
  { label: "Model", value: (a) => a.model },
  { label: "Serial", value: (a) => a.serialNo },
  { label: "Status", value: (a) => ASSET_LABELS[a.status] },
  { label: "Assigned to", value: (a) => a.assignedTo },
  { label: "Department", value: (a) => a.department },
  { label: "Location", value: (a) => a.location },
  { label: "Store", value: (a) => a.storeCode },
  { label: "Condition", value: (a) => a.condition },
  { label: "Purchase cost", value: (a) => a.purchaseCost },
  { label: "Purchased on", value: (a) => a.purchasedOn },
  { label: "Warranty until", value: (a) => a.warrantyUntil },
];

function AssetView({ id, onClose }) {
  const load = useCallback(() => inventoryApi.asset(id), [id]);
  const { data: asset, error } = useData(load);
  return (
    <ViewModal title={asset ? `${asset.assetTag} · ${asset.name}` : "Asset"} onClose={onClose}>
      <ErrorBanner message={error} />
      {!asset ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Detail label="Status" value={ASSET_LABELS[asset.status]} />
            <Detail label="Assigned to" value={asset.assignedTo && `${asset.assignedTo}${asset.department ? ` (${asset.department})` : ""}`} />
            <Detail label="Since" value={asset.assignedOn} />
            <Detail label="Location" value={asset.location} />
            <Detail label="Home store" value={asset.storeName} />
            <Detail label="Condition" value={asset.condition} />
            <Detail label="Brand / model" value={[asset.brand, asset.model].filter(Boolean).join(" ")} />
            <Detail label="Serial" value={asset.serialNo} />
            <Detail label="Purchase cost" value={money(asset.purchaseCost)} />
            <Detail label="Purchased on" value={asset.purchasedOn} />
            <Detail label="Warranty until" value={asset.warrantyUntil} />
            <Detail label="Supplier" value={asset.supplier} />
          </div>
          {asset.notes && <p className="text-sm text-slate-600">{asset.notes}</p>}
          <div className="rounded-lg border border-slate-200 p-3"><Barcode value={asset.assetTag} /></div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">History</h3>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
              {asset.history.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="font-medium text-slate-800">{event.action.charAt(0) + event.action.slice(1).toLowerCase().replace("_", " ")}</span>
                  <span className="ml-2 text-xs text-slate-500">{formatDateTime(event.at)} · {event.by}</span>
                  {event.detail && <span className="block text-slate-600">{event.detail}</span>}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </ViewModal>
  );
}

export default function AssetsPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", status: "IN_SERVICE", category: "", storeId: "" });
  const load = useCallback(() => Promise.all([inventoryApi.assets(filters), inventoryApi.stores(), inventoryApi.categories()]), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [editing, setEditing] = useState(null);
  const [acting, setActing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [assets, stores, categories] = data || [[], [], []];
  const { pageItems, pagerProps } = usePagination(assets, 25);

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const save = async (body) => {
    if (!editing) return;
    if (editing.asset) {
      await inventoryApi.updateAsset(editing.asset.id, body);
      setNotice("Asset saved.");
    } else {
      const result = await inventoryApi.createAsset(body);
      setNotice(result.created ? `Registered ${result.created} assets.` : `Registered ${result.assetTag}.`);
    }
    setEditing(null);
    reload();
  };

  const remove = async (asset) => {
    if (!window.confirm(`Delete ${asset.assetTag}? Only a mistaken entry with no history can be deleted.`)) return;
    setActionError("");
    try {
      await inventoryApi.removeAsset(asset.id);
      setNotice("Asset deleted.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const canHandle = can("inventory.manage_assets");

  return (
    <SystemShell title="Assets" subtitle="Computers, lab equipment, furniture and other things tracked one by one: where each is, who has it, and its history." crumbs={CRUMBS}
      actions={<>
        {can("inventory.export") && <button onClick={() => downloadCsv(`assets-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, assets)} className={secondaryButton}>Export CSV</button>}
        {can("inventory.create") && <button onClick={() => setEditing({})} className={primaryButton}>Register Asset</button>}
      </>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search assets" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Tag, name, serial, holder, room" className={`${filterClass} min-w-[16rem]`} />
        <select aria-label="Asset status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="IN_SERVICE">In service</option>
          {Object.entries(ASSET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="">All</option>
        </select>
        <select aria-label="Category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={filterClass}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select aria-label="Store" value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value })} className={filterClass}>
          <option value="">All stores</option>
          {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Tag", "Asset", "Category", "Holder", "Location", "Cost", "Status", "Actions"]} isLoading={isLoading} hasRows={assets.length > 0} emptyMessage="No assets match." minWidth="min-w-[980px]">
          {pageItems.map((asset) => (
            <tr key={asset.id} className="border-b border-slate-100 align-top">
              <td className="px-4 py-3 font-mono text-xs"><button onClick={() => setViewing(asset.id)} className="text-blue-700 hover:underline">{asset.assetTag}</button></td>
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{asset.name}</span><span className="block text-xs text-slate-500">{[asset.brand, asset.model, asset.serialNo && `S/N ${asset.serialNo}`].filter(Boolean).join(" · ")}</span></td>
              <td className="px-4 py-3">{asset.category || "—"}</td>
              <td className="px-4 py-3">{asset.assignedTo || "—"}{asset.department && <span className="block text-xs text-slate-500">{asset.department}</span>}</td>
              <td className="px-4 py-3">{asset.location || "—"}{asset.storeCode && <span className="block text-xs text-slate-500">{asset.storeCode}</span>}</td>
              <td className="px-4 py-3 tabular-nums">{money(asset.purchaseCost)}</td>
              <td className="px-4 py-3"><AssetBadge status={asset.status} /></td>
              <td className="px-4 py-3">
                <div className="flex max-w-xs flex-wrap gap-x-3 gap-y-1">
                  {canHandle && Object.entries(ACTIONS).filter(([, action]) => action.from.includes(asset.status) && (!action.approve || can("inventory.approve"))).map(([key, action]) => (
                    <button key={key} onClick={() => setActing({ asset, key })} className={action.danger ? dangerButton : linkButton}>{action.label}</button>
                  ))}
                  {can("inventory.update") && asset.status !== "DISPOSED" && <button onClick={() => setEditing({ asset })} className={linkButton}>Edit</button>}
                  {can("inventory.delete") && <button onClick={() => remove(asset)} className={dangerButton}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="px-4 pb-3"><Pager {...pagerProps} /></div>
      </section>
      {editing && (
        <QuickForm title={editing.asset ? `Edit ${editing.asset.assetTag}` : "Register Asset"} fields={assetFields(stores, !editing.asset)}
          initial={editing.asset || { count: 1, condition: "GOOD" }} onSubmit={save} onClose={() => setEditing(null)} />
      )}
      {acting && (
        <QuickForm title={`${ACTIONS[acting.key].label}: ${acting.asset.assetTag}`} submitLabel={ACTIONS[acting.key].label} fields={ACTIONS[acting.key].fields}
          initial={{ condition: acting.asset.condition }} onClose={() => setActing(null)}
          onSubmit={async (body) => {
            const done = await inventoryApi.assetAction(acting.asset.id, { ...body, action: acting.key });
            setActing(null);
            setNotice(`${done.assetTag} is now ${ASSET_LABELS[done.status].toLowerCase()}.`);
            reload();
          }} />
      )}
      {viewing && <AssetView id={viewing} onClose={() => setViewing(null)} />}
    </SystemShell>
  );
}
