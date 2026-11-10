"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { featuresApi } from "@/lib/identityServices";
import { useMe } from "@/lib/useMe";
import DynamicFields, { displayValue, visibleValues } from "@/components/erp/DynamicForm";
import {
  DataTable,
  ErrorBanner,
  FormModal,
  SystemShell,
  dangerButton,
  filterClass,
  formatDateTime,
  friendlyError,
  linkButton,
  primaryButton,
  useData,
} from "@/components/erp/ui";

function RecordForm({ feature, fields, record, onClose, onSaved }) {
  const [values, setValues] = useState(record?.data || {});
  const handleSubmit = async () => {
    const data = visibleValues(fields, values);
    if (record) await featuresApi.updateRecord(feature.moduleId, feature.key, record.id, data);
    else await featuresApi.createRecord(feature.moduleId, feature.key, data);
    onSaved();
  };
  return (
    <FormModal title={record ? `Edit ${feature.name}` : `Add ${feature.name}`} submitLabel="Save" onSubmit={handleSubmit} onClose={onClose}>
      <DynamicFields fields={fields} values={values} onChange={setValues} idPrefix="record" />
    </FormModal>
  );
}

// One page serves every custom feature, driven by its metadata.
export default function FeatureRecordsPage() {
  const { moduleId, key } = useParams();
  const { can } = useMe();
  const [search, setSearch] = useState("");
  const load = useCallback(() => featuresApi.records(moduleId, key, search), [moduleId, key, search]);
  const { data, error, isLoading, reload } = useData(load);
  const [modal, setModal] = useState(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const feature = data?.feature;
  const fields = data?.fields || [];
  const permission = (action) => can(`${moduleId}.feature.${key}.${action}`);
  const columns = (feature?.listColumns?.length ? feature.listColumns : fields.slice(0, 5).map((field) => field.id))
    .map((id) => fields.find((field) => field.id === id))
    .filter(Boolean);

  const remove = async (record) => {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    setActionError("");
    try {
      await featuresApi.deleteRecord(moduleId, key, record.id);
      setNotice("Record deleted.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell
      title={feature ? `${feature.icon || ""} ${feature.name}`.trim() : "Feature"}
      subtitle={feature?.description || `${feature?.moduleName || moduleId}: custom feature`}
      crumbs={moduleId === "hostel" ? [{ href: "/admin/hostel", label: "Hostel Management" }] : []}
      actions={permission("create") && feature && <button onClick={() => setModal({})} className={primaryButton}>Add Record</button>}
    >
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <input aria-label="Search records" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search records" className={`${filterClass} w-full max-w-md`} />
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable
          columns={[...columns.map((field) => field.label), "Updated", "Actions"]}
          isLoading={isLoading && !data}
          hasRows={(data?.records || []).length > 0}
          emptyMessage="No records yet."
          minWidth="min-w-[700px]"
        >
          {(data?.records || []).map((record) => (
            <tr key={record.id} className="border-b border-slate-100">
              {columns.map((field) => <td key={field.id} className="px-4 py-3 text-slate-700">{displayValue(field, record.data[field.id])}</td>)}
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(record.updatedAt)}<p className="text-xs">{record.updatedBy}</p></td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  {permission("update") && <button onClick={() => setModal({ record })} className={linkButton}>Edit</button>}
                  {permission("delete") && <button onClick={() => remove(record)} className={dangerButton}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal && feature && (
        <RecordForm
          feature={feature}
          fields={fields}
          record={modal.record}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setNotice("Record saved.");
            reload();
          }}
        />
      )}
    </SystemShell>
  );
}
