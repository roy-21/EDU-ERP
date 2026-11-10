"use client";

import { useCallback, useState } from "react";
import { formsApi } from "@/lib/identityServices";
import { useMe } from "@/lib/useMe";
import DynamicFields, { displayValue } from "@/components/erp/DynamicForm";
import FieldDesigner, { blankField, finishFields } from "@/components/erp/FieldDesigner";
import {
  DataTable,
  ErrorBanner,
  NoAccess,
  SelectField,
  StatusBadge,
  SystemShell,
  TextField,
  ViewModal,
  dangerButton,
  formatDateTime,
  friendlyError,
  linkButton,
  primaryButton,
  secondaryButton,
  useData,
} from "@/components/erp/ui";

const PURPOSES = [
  { value: "GENERAL", label: "General form (anyone signed in can fill it)" },
  { value: "USER_PROFILE", label: "User profile (attached to a role)" },
];
const PURPOSE_LABELS = { GENERAL: "General", USER_PROFILE: "User profile", FEATURE: "Custom feature" };
const loadForms = () => formsApi.list();

function Editor({ formId, onClose, onSaved }) {
  const load = useCallback(() => (formId ? formsApi.get(formId) : Promise.resolve(null)), [formId]);
  const { data: existing, error: loadError } = useData(load);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState({});
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const current = draft || (formId
    ? existing && { title: existing.title, description: existing.description, purpose: existing.purpose, fields: existing.fields }
    : { title: "", description: "", purpose: "GENERAL", fields: [blankField()] });
  const set = (key) => (value) => setDraft({ ...current, [key]: value });
  const lockedIds = (existing?.publishedFields || []).map((field) => field.id);

  const save = async (publish) => {
    setIsSaving(true);
    setError("");
    try {
      const body = { title: current.title, description: current.description, fields: finishFields(current.fields), publish };
      const saved = formId ? await formsApi.update(formId, body) : await formsApi.create({ ...body, purpose: current.purpose });
      onSaved(saved, publish);
    } catch (err) {
      setError(friendlyError(err));
      setIsSaving(false);
    }
  };

  const previewFields = current ? finishFields(current.fields).filter((field) => field.label) : [];

  return (
    <ViewModal
      title={formId ? `Edit: ${existing?.title || ""}` : "New Form"}
      onClose={onClose}
      wide
      actions={
        current && (
          <>
            <button onClick={() => save(false)} disabled={isSaving} className={`${secondaryButton} disabled:opacity-50`}>Save Draft</button>
            <button onClick={() => save(true)} disabled={isSaving} className={`${primaryButton} disabled:opacity-50`}>Save and Publish</button>
          </>
        )
      }
    >
      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {current && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <TextField id="form-title" label="Form Title *" value={current.title} maxLength={200} onChange={set("title")} />
              <TextField id="form-description" label="Description" value={current.description} maxLength={1000} onChange={set("description")} />
              {!formId && <SelectField id="form-purpose" label="Used For" value={current.purpose} onChange={set("purpose")} options={PURPOSES} />}
            </div>
            {existing?.publishedVersion && (
              <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                Version {existing.publishedVersion} is live. Saving makes a new draft version; answers keep using version {existing.publishedVersion} until you publish.
                Field types of published fields are locked so old answers stay readable.
              </p>
            )}
            <FieldDesigner fields={current.fields} onChange={set("fields")} lockedIds={lockedIds} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Live preview</p>
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-dashed border-slate-300 p-4 sm:grid-cols-2">
              {previewFields.length === 0 ? <p className="text-sm text-slate-500">Add a field to see it here.</p> : <DynamicFields fields={previewFields} values={preview} onChange={setPreview} idPrefix="preview" />}
            </div>
            <p className="mt-2 text-xs text-slate-500">Try the answers: fields with a condition appear and disappear here exactly as they will for users. The server checks the same rules.</p>
          </div>
        </div>
      )}
    </ViewModal>
  );
}

function Submissions({ form, onClose }) {
  const load = useCallback(() => Promise.all([formsApi.get(form.id), formsApi.submissions(form.id)]), [form.id]);
  const { data, error } = useData(load);
  const [detail, versions] = data ? [data[0], data[1]] : [null, []];
  const fields = detail?.publishedFields || detail?.fields || [];
  const columns = [...new Set([...fields.map((field) => field.id), ...versions.flatMap((item) => Object.keys(item.data))])].slice(0, 8);
  const labelOf = (id) => fields.find((field) => field.id === id)?.label || id;

  const exportCsv = () => {
    const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [["Submitted", "By", "Version", ...columns.map(labelOf)], ...versions.map((item) => [item.createdAt, item.submittedBy, item.version, ...columns.map((id) => displayValue(fields.find((field) => field.id === id), item.data[id]))])];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(",")).join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${form.slug}-submissions.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ViewModal title={`Answers: ${form.title}`} onClose={onClose} wide actions={versions.length > 0 && <button onClick={exportCsv} className={secondaryButton}>Export CSV</button>}>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={["Submitted", "By", "Version", ...columns.map(labelOf)]} isLoading={!data && !error} hasRows={versions.length > 0} emptyMessage="No answers yet." minWidth="min-w-[700px]">
        {versions.map((item) => (
          <tr key={item.id} className="border-b border-slate-100">
            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
            <td className="px-4 py-3 text-slate-600">{item.submittedBy}</td>
            <td className="px-4 py-3 text-slate-600">v{item.version}</td>
            {columns.map((id) => <td key={id} className="px-4 py-3 text-slate-700">{displayValue(fields.find((field) => field.id === id), item.data[id])}</td>)}
          </tr>
        ))}
      </DataTable>
    </ViewModal>
  );
}

export default function FormBuilderPage() {
  const { can, isReady } = useMe();
  const { data: forms, error, isLoading, reload } = useData(loadForms);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("system.manage_forms")) return <NoAccess />;

  const act = async (work, message) => {
    setActionError("");
    try {
      await work();
      setNotice(message);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell
      title="Form Builder"
      subtitle="Build forms with conditional questions. Every published change is a new version, and each answer keeps the version it was given on."
      actions={<button onClick={() => setModal({ type: "edit" })} className={primaryButton}>New Form</button>}
    >
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Form", "Used For", "Status", "Live Version", "Answers", "Updated", "Actions"]} isLoading={isLoading} hasRows={(forms || []).length > 0} emptyMessage="No forms yet." minWidth="min-w-[860px]">
          {(forms || []).map((form) => (
            <tr key={form.id} className="border-b border-slate-100">
              <td className="px-4 py-3"><p className="font-medium text-slate-800">{form.title}</p><p className="font-mono text-xs text-slate-500">{form.slug}</p></td>
              <td className="px-4 py-3 text-slate-600">{PURPOSE_LABELS[form.purpose]}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={{ DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" }[form.status]} />
                  {form.hasDraft && form.status === "PUBLISHED" && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Unpublished changes</span>}
                </div>
              </td>
              <td className="px-4 py-3 text-slate-600">{form.publishedVersion ? `v${form.publishedVersion} of ${form.latestVersion}` : "—"}</td>
              <td className="px-4 py-3 text-slate-600">{form.submissions}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(form.updatedAt)}</td>
              <td className="px-4 py-3">
                {form.status !== "ARCHIVED" && (
                  <div className="flex flex-wrap gap-3 whitespace-nowrap">
                    <button onClick={() => setModal({ type: "edit", id: form.id })} aria-label={`Edit ${form.title}`} className={linkButton}>Edit</button>
                    {form.hasDraft && <button onClick={() => act(() => formsApi.publish(form.id), `Published ${form.title}.`)} aria-label={`Publish ${form.title}`} className={linkButton}>Publish</button>}
                    <button onClick={() => setModal({ type: "answers", form })} aria-label={`Answers of ${form.title}`} className={linkButton}>Answers</button>
                    {form.purpose !== "FEATURE" && (
                      <button onClick={() => window.confirm(`Archive ${form.title}? It will stop taking answers.`) && act(() => formsApi.archive(form.id), `Archived ${form.title}.`)} aria-label={`Archive ${form.title}`} className={dangerButton}>Archive</button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      {modal?.type === "edit" && (
        <Editor
          formId={modal.id}
          onClose={() => setModal(null)}
          onSaved={(form, published) => {
            setModal(null);
            setNotice(published ? `Published version ${form.publishedVersion} of ${form.title}.` : `Saved a draft of ${form.title}.`);
            reload();
          }}
        />
      )}
      {modal?.type === "answers" && <Submissions form={modal.form} onClose={() => setModal(null)} />}
    </SystemShell>
  );
}
