"use client";

import { useState } from "react";
import Link from "next/link";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { ErrorBanner, NoAccess, SystemShell, friendlyError, primaryButton, useData } from "@/components/erp/ui";
import { CRUMBS, FEATURE_INFO, Notice, PROFILE_INFO } from "../_components/inventoryUi";

// The usual parts for each kind of organisation. The server keeps the same list.
const PRESETS = {
  SCHOOL: ["PURCHASING", "BATCHES", "TRANSFERS", "ASSETS", "REQUISITIONS"],
  HOSTEL: ["PURCHASING", "BATCHES", "ASSETS", "REQUISITIONS", "KITCHEN", "ROOMS"],
  OFFICE: ["PURCHASING", "TRANSFERS", "ASSETS", "REQUISITIONS"],
};

export default function InventorySetupPage() {
  const { can, isReady } = useMe();
  const { data: settings, error, isLoading } = useData(inventoryApi.settings);
  // What the user has picked; until they pick, the saved setup.
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const profile = draft?.profile ?? settings?.profile ?? "";
  const features = draft?.features ?? settings?.features ?? [];
  const setProfile = (value) => setDraft((current) => ({ profile: value, features: current?.features ?? features }));
  const setFeatures = (value) => setDraft((current) => ({ profile: current?.profile ?? profile, features: value }));

  if (isReady && !can("inventory.read")) return <NoAccess />;
  const canEdit = can("inventory.update");

  const pickProfile = (key) => {
    setProfile(key);
    if (PRESETS[key]) setFeatures(PRESETS[key]);
  };

  const toggle = (key) => {
    const next = features.includes(key) ? features.filter((item) => item !== key) : [...features, key];
    setFeatures(next);
    // Changing the parts by hand makes the setup a custom one, unless it still matches a preset.
    const same = (list) => list.length === next.length && list.every((item) => next.includes(item));
    setProfile(Object.keys(PRESETS).find((preset) => same(PRESETS[preset])) || "CUSTOM");
  };

  const save = async () => {
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      const saved = await inventoryApi.saveSetup({ profile, features });
      setProfile(saved.profile);
      setFeatures(saved.features);
      setNotice("Inventory setup saved. The dashboard now shows the parts you chose.");
    } catch (err) {
      setSaveError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SystemShell title="Inventory Setup" subtitle="Tell the system what kind of organisation this is, and which parts of inventory you use." crumbs={CRUMBS}
      actions={canEdit && <button onClick={save} disabled={saving || !profile} className={primaryButton}>{saving ? "Saving..." : "Save setup"}</button>}>
      <ErrorBanner message={error || saveError} onDismiss={saveError ? () => setSaveError("") : undefined} />
      <Notice text={notice} />
      {isLoading && !settings ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">1. What kind of organisation is this?</h2>
            <p className="mb-4 text-sm text-slate-500">Choosing one switches on its usual parts. You can change them below.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Organisation type">
              {Object.entries(PROFILE_INFO).map(([key, info]) => (
                <button key={key} type="button" role="radio" aria-checked={profile === key} disabled={!canEdit} onClick={() => pickProfile(key)}
                  className={`rounded-xl border p-4 text-left transition ${profile === key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 hover:border-blue-300"}`}>
                  <span className="block font-medium text-slate-800">{info.label}</span>
                  <span className="mt-1 block text-sm text-slate-500">{info.text}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">2. Which parts do you use?</h2>
            <p className="mb-4 text-sm text-slate-500">Items, stores and the stock ledger are always on. Switching a part off only hides it; its records are kept and come back when you switch it on again.</p>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Object.entries(FEATURE_INFO).map(([key, info]) => (
                <li key={key}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${features.includes(key) ? "border-blue-300 bg-blue-50/50" : "border-slate-200"}`}>
                    <input type="checkbox" className="mt-1" checked={features.includes(key)} disabled={!canEdit} onChange={() => toggle(key)} />
                    <span>
                      <span className="block font-medium text-slate-800">{info.label}</span>
                      <span className="block text-sm text-slate-500">{info.text}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <h2 className="mb-2 font-semibold text-slate-800">3. Then</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Add your <Link href="/admin/inventory/stores" className="text-blue-700 hover:underline">stores</Link>: the central store, labs, and a store of type Kitchen for the kitchen.</li>
              <li>Add <Link href="/admin/inventory/items" className="text-blue-700 hover:underline">items</Link> with their opening stock, or import them from CSV.</li>
              <li>Give staff the <span className="font-medium">Ask the store for items</span> permission so they can raise requisitions (Teachers and Staff have it already).</li>
            </ol>
          </section>
        </>
      )}
    </SystemShell>
  );
}
