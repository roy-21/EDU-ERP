"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { featuresApi } from "@/lib/identityServices";
import { useMe } from "@/lib/useMe";
import { BUILT_IN_FEATURES, clearLegacyFeatures, useLegacyFeatures } from "./hostelStore";
import { friendlyError } from "./hostelUi";

// Old browser-only field types, mapped to the server's form field types.
const TYPE_MAP = { text: "text", textarea: "textarea", number: "number", currency: "number", date: "date", select: "select", checkbox: "checkbox" };
const keyOf = (text) => (text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "f_$1") || "feature").slice(0, 50);

// Moves features made before the server kept them, with their records, then clears the browser copy.
async function importLegacy(legacy) {
  const existing = await featuresApi.list();
  let features = 0;
  let records = 0;
  for (const old of legacy.customFeatures) {
    let key = keyOf(old.slug || old.title);
    while (existing.some((item) => item.moduleId === "hostel" && item.key === key)) key = `${key}_2`;
    const fields = [
      ...(old.fields || []).map((field, index) => ({
        id: `f${index + 1}`,
        type: TYPE_MAP[field.type] || "text",
        label: field.label || `Field ${index + 1}`,
        required: field.required === true,
        options: field.type === "select" ? field.options || [] : [],
      })),
      ...(old.statuses?.length ? [{ id: "status", type: "select", label: "Status", options: old.statuses, required: false }] : []),
    ];
    const feature = await featuresApi.create({ moduleId: "hostel", key, name: old.title, description: old.description || "", icon: old.icon || "🧩", fields });
    await featuresApi.publish(feature.id);
    existing.push(feature);
    features += 1;
    for (const record of legacy.records[old.slug] || []) {
      const data = {};
      (old.fields || []).forEach((field, index) => {
        const value = record[field.id];
        if (value === undefined || value === "") return;
        data[`f${index + 1}`] = ["number", "currency"].includes(field.type) ? Number(value) : value;
      });
      if (old.statuses?.includes(record.status)) data.status = record.status;
      await featuresApi.createRecord("hostel", key, data).then(() => (records += 1)).catch(() => {});
    }
  }
  return { features, records };
}

function Card({ href, icon, title, description, tag }) {
  return (
    <Link href={href} className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="text-3xl">{icon}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${tag === "Custom" ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>{tag}</span>
      </div>
      <h3 className="mt-4 font-semibold text-slate-800 group-hover:text-blue-600">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{description || "No description added."}</p>
      <p className="mt-4 text-sm font-medium text-blue-600">Manage Section →</p>
    </Link>
  );
}

export default function HostelControlBoard() {
  const { has, isReady } = useHostelPermissions();
  const { can } = useMe();
  const legacy = useLegacyFeatures();
  const [custom, setCustom] = useState(null);
  const [message, setMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    featuresApi.available()
      .then((list) => isCurrent && setCustom(list.filter((item) => item.moduleId === "hostel")))
      .catch(() => isCurrent && setCustom([]));
    return () => { isCurrent = false; };
  }, [refresh]);

  const builtIns = BUILT_IN_FEATURES.filter((feature) => !feature.permission || has(feature.permission));
  const canBuild = can("system.manage_features");

  const runImport = async () => {
    setIsImporting(true);
    setMessage("");
    try {
      const result = await importLegacy(legacy);
      clearLegacyFeatures();
      setMessage(`Moved ${result.features} feature(s) and ${result.records} record(s) to the server.`);
      setRefresh((value) => value + 1);
    } catch (err) {
      setMessage(`Import stopped: ${friendlyError(err)} Nothing was removed from this browser.`);
    } finally {
      setIsImporting(false);
    }
  };

  if (!isReady) {
    return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading control board...</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Hostel Features</h2>
          <p className="mt-1 text-sm text-slate-500">Sections you can open with your role. Custom features are built in the Feature Builder and kept on the server.</p>
        </div>
        {canBuild && (
          <Link href="/admin/system/features?module=hostel" className="w-fit rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            + Create Feature
          </Link>
        )}
      </div>

      {canBuild && legacy?.customFeatures.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p>
            This browser still holds {legacy.customFeatures.length} feature(s) made before features were saved on the server
            ({legacy.customFeatures.map((item) => item.title).join(", ")}). Other users cannot see them until they are moved.
          </p>
          <button onClick={runImport} disabled={isImporting} className="w-fit rounded-lg bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {isImporting ? "Moving..." : "Move to Server"}
          </button>
        </div>
      )}
      {message && <p role="status" className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {builtIns.map((feature) => (
          <Card key={feature.slug} href={feature.href} icon={feature.icon} title={feature.title} description={feature.description} tag={feature.count} />
        ))}
        {(custom || []).map((feature) => (
          <Card key={feature.id} href={`/admin/features/hostel/${feature.key}`} icon={feature.icon || "🧩"} title={feature.name} description={feature.description} tag="Custom" />
        ))}
      </div>

      {builtIns.length === 0 && (custom || []).length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No hostel sections are open to your role.</div>
      )}
    </div>
  );
}
