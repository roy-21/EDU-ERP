"use client";

import { useCallback, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, friendlyError, linkButton, money, primaryButton, useData } from "@/components/erp/ui";
import { CRUMBS, Notice, STORE_KINDS, STORE_KIND_LABELS } from "../_components/inventoryUi";

const FIELDS = [
  { name: "code", label: "Code *", hint: "Short, e.g. CS, CHEM-LAB, KITCHEN" },
  { name: "name", label: "Name *" },
  { name: "kind", label: "Type", type: "select", noBlank: true, options: STORE_KINDS, hint: "A Kitchen gets the daily kitchen sheet and meal costs." },
  { name: "location", label: "Location / address", wide: true },
  { name: "manager", label: "Store manager" },
];

export default function StoresPage() {
  const { can, isReady } = useMe();
  const { data, error, isLoading, reload } = useData(inventoryApi.stores);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const stores = data || [];

  const act = useCallback(async (work, text) => {
    setActionError("");
    try {
      await work();
      setNotice(text);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  }, [reload]);

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const save = async (body) => {
    if (!editing) return;
    if (editing.store) await inventoryApi.updateStore(editing.store.id, body);
    else await inventoryApi.createStore(body);
    setEditing(null);
    setNotice("Store saved.");
    reload();
  };

  return (
    <SystemShell title="Stores" subtitle="Every place stock is kept. Each store has its own balance of every item." crumbs={CRUMBS}
      actions={can("inventory.create") && <button onClick={() => setEditing({})} className={primaryButton}>Add Store</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      <section className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Code", "Store", "Type", "Location", "Manager", "Items held", "Stock value", "Assets", "Status", "Actions"]} isLoading={isLoading} hasRows={stores.length > 0} emptyMessage="No stores yet. Add the central store first.">
          {stores.map((store) => (
            <tr key={store.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs">{store.code}</td>
              <td className="px-4 py-3 font-medium text-slate-800">{store.name}</td>
              <td className="px-4 py-3">{STORE_KIND_LABELS[store.kind] || store.kind}</td>
              <td className="px-4 py-3">{store.location || "—"}</td>
              <td className="px-4 py-3">{store.manager || "—"}</td>
              <td className="px-4 py-3 tabular-nums">{store.itemCount}</td>
              <td className="px-4 py-3 tabular-nums">{money(store.stockValue)}</td>
              <td className="px-4 py-3 tabular-nums">{store.assetCount}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${store.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{store.isActive ? "Open" : "Closed"}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  {can("inventory.update") && <button onClick={() => setEditing({ store })} className={linkButton} aria-label={`Edit ${store.name}`}>Edit</button>}
                  {can("inventory.update") && (
                    <button onClick={() => act(() => inventoryApi.updateStore(store.id, { isActive: !store.isActive }), store.isActive ? "Store closed." : "Store reopened.")} className={linkButton}>
                      {store.isActive ? "Close" : "Reopen"}
                    </button>
                  )}
                  {can("inventory.delete") && (
                    <button onClick={() => window.confirm(`Delete ${store.name}? Only stores that never held stock can be deleted.`) && act(() => inventoryApi.removeStore(store.id), "Store deleted.")} className={dangerButton}>Delete</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {editing && <QuickForm title={editing.store ? `Edit ${editing.store.name}` : "Add Store"} fields={FIELDS} initial={editing.store || { kind: "STORE" }} onSubmit={save} onClose={() => setEditing(null)} />}
    </SystemShell>
  );
}
