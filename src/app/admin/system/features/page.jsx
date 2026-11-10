"use client";

import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { featuresApi, formsApi, identityService } from "@/lib/identityServices";
import { refreshMe, useMe } from "@/lib/useMe";
import FieldDesigner, { blankField, finishFields } from "@/components/erp/FieldDesigner";
import {
  DataTable,
  ErrorBanner,
  Field,
  NoAccess,
  SelectField,
  StatusBadge,
  SystemShell,
  TextField,
  ViewModal,
  dangerButton,
  friendlyError,
  inputClass,
  linkButton,
  primaryButton,
  secondaryButton,
  useData,
} from "@/components/erp/ui";

const ICONS = ["🧩", "🛠️", "📋", "🚪", "🌙", "🧹", "🩺", "📦", "⚠️", "🔑", "🧺", "📣"];
const loadFeatures = () => featuresApi.list();
const loadModules = () => identityService.permissionTree();

function FeatureEditor({ feature, modules, defaultModule, onClose, onSaved }) {
  const loadForm = useCallback(() => (feature ? formsApi.get(feature.formId) : Promise.resolve(null)), [feature]);
  const { data: form } = useData(loadForm);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const current = draft || (feature
    ? form && { moduleId: feature.moduleId, key: feature.key, name: feature.name, description: feature.description, icon: feature.icon || ICONS[0], fields: form.fields, listColumns: feature.listColumns }
    : { moduleId: defaultModule || "hostel", key: "", name: "", description: "", icon: ICONS[0], fields: [blankField()], listColumns: [] });
  const set = (key) => (value) => setDraft({ ...current, [key]: value });
  const finished = current ? finishFields(current.fields) : [];

  const save = async (publish) => {
    setIsSaving(true);
    setError("");
    try {
      const listColumns = current.listColumns.filter((id) => finished.some((field) => field.id === id));
      const body = { name: current.name, description: current.description, icon: current.icon, fields: finished, listColumns: listColumns.length ? listColumns : undefined };
      let saved = feature ? await featuresApi.update(feature.id, body) : await featuresApi.create({ ...body, moduleId: current.moduleId, key: current.key });
      if (publish) saved = await featuresApi.publish(saved.id);
      onSaved(saved, publish);
    } catch (err) {
      setError(friendlyError(err));
      setIsSaving(false);
    }
  };

  return (
    <ViewModal
      title={feature ? `Edit Feature: ${feature.name}` : "New Feature"}
      onClose={onClose}
      wide
      actions={current && (
        <>
          <button onClick={() => save(false)} disabled={isSaving} className={`${secondaryButton} disabled:opacity-50`}>Save Draft</button>
          <button onClick={() => save(true)} disabled={isSaving} className={`${primaryButton} disabled:opacity-50`}>Save and Publish</button>
        </>
      )}
    >
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!current && <p className="text-sm text-slate-500">Loading...</p>}
      {current && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField id="feature-name" label="Feature Name *" value={current.name} maxLength={150} onChange={set("name")} />
            {feature ? (
              <TextField id="feature-key" label="Key (fixed)" value={`${current.moduleId}.${current.key}`} onChange={() => {}} disabled />
            ) : (
              <>
                <SelectField id="feature-module" label="Module *" value={current.moduleId} onChange={set("moduleId")} options={modules.filter((item) => item.entitled).map((item) => ({ value: item.id, label: item.name }))} />
                <TextField id="feature-key" label="Key * (used in links and permissions)" value={current.key} maxLength={60} onChange={(value) => set("key")(value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="e.g. laundry_log" />
              </>
            )}
            <TextField id="feature-description" label="Description" value={current.description} maxLength={1000} onChange={set("description")} />
            <Field id="feature-icon" label="Icon">
              <select id="feature-icon" value={current.icon} onChange={(e) => set("icon")(e.target.value)} className={inputClass}>
                {ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Record Fields</p>
            <FieldDesigner fields={current.fields} onChange={set("fields")} lockedIds={(form?.publishedFields || []).map((field) => field.id)} />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-700">Columns in the list</legend>
            <div className="flex flex-wrap gap-4">
              {finished.filter((field) => field.label).map((field) => (
                <label key={field.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={current.listColumns.includes(field.id)}
                    onChange={(e) => set("listColumns")(e.target.checked ? [...current.listColumns, field.id] : current.listColumns.filter((id) => id !== field.id))}
                  />
                  {field.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">None ticked shows the first five fields.</p>
          </fieldset>
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            Publishing creates four permissions (view, add, edit, delete) under the module. Give them to roles on the Roles page; admins have them automatically.
          </p>
        </div>
      )}
    </ViewModal>
  );
}

function FeatureBuilder() {
  const { can, isReady } = useMe();
  const params = useSearchParams();
  const { data: features, error, isLoading, reload } = useData(loadFeatures);
  const { data: modules } = useData(loadModules);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const moduleFilter = params.get("module") || "";

  if (isReady && !can("system.manage_features")) return <NoAccess />;

  const act = async (work, message) => {
    setActionError("");
    try {
      await work();
      setNotice(message);
      reload();
      refreshMe(true);
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const shown = (features || []).filter((item) => !moduleFilter || item.moduleId === moduleFilter);

  return (
    <SystemShell
      title="Feature Builder"
      subtitle="Add a feature to any module without code: its form, its list and its own permissions. Records are stored on the server."
      actions={<button onClick={() => setModal({})} disabled={!modules} className={`${primaryButton} disabled:opacity-50`}>New Feature</button>}
    >
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Feature", "Module", "Status", "Form", "Records", "Actions"]} isLoading={isLoading} hasRows={shown.length > 0} emptyMessage="No custom features yet." minWidth="min-w-[820px]">
          {shown.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.icon} {item.name}</p><p className="font-mono text-xs text-slate-500">{item.moduleId}.{item.key}</p></td>
              <td className="px-4 py-3 text-slate-600">{item.moduleName}</td>
              <td className="px-4 py-3"><StatusBadge status={{ DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" }[item.status]} /></td>
              <td className="px-4 py-3 text-slate-600">{item.formVersion ? `v${item.formVersion}` : "Draft"}</td>
              <td className="px-4 py-3 text-slate-600">{item.records}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3 whitespace-nowrap">
                  {item.status === "PUBLISHED" && <Link href={`/admin/features/${item.moduleId}/${item.key}`} className={linkButton}>Open</Link>}
                  {item.status !== "ARCHIVED" && <button onClick={() => setModal({ feature: item })} aria-label={`Edit ${item.name}`} className={linkButton}>Edit</button>}
                  {item.status === "DRAFT" && <button onClick={() => act(() => featuresApi.publish(item.id), `Published ${item.name}.`)} aria-label={`Publish ${item.name}`} className={linkButton}>Publish</button>}
                  {item.status !== "ARCHIVED" && (
                    <button onClick={() => window.confirm(`Archive ${item.name}? Its records are kept but it closes.`) && act(() => featuresApi.archive(item.id), `Archived ${item.name}.`)} aria-label={`Archive ${item.name}`} className={dangerButton}>Archive</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal && modules && (
        <FeatureEditor
          feature={modal.feature}
          modules={modules}
          defaultModule={moduleFilter}
          onClose={() => setModal(null)}
          onSaved={(feature, published) => {
            setModal(null);
            setNotice(published ? `Published ${feature.name}. Its permissions are on the Roles page.` : `Saved ${feature.name} as a draft.`);
            reload();
            refreshMe(true);
          }}
        />
      )}
    </SystemShell>
  );
}

export default function FeatureBuilderPage() {
  return (
    <Suspense fallback={null}>
      <FeatureBuilder />
    </Suspense>
  );
}
