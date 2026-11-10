"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { structureApi, teachersApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import {
  DataTable,
  ErrorBanner,
  Field,
  FormModal,
  NoAccess,
  SystemShell,
  dangerButton,
  friendlyError,
  inputClass,
  linkButton,
  primaryButton,
  useData,
} from "@/components/erp/ui";

const yes = (value) => (value ? "Yes" : "");

// Each tab: what it lists, its columns, and the fields of its form.
const TABS = [
  {
    kind: "departments", label: "Departments", single: "Department",
    columns: [["Code", (r) => r.code], ["Name", (r) => r.name], ["Programs", (r) => r.programs], ["Teachers", (r) => r.teachers], ["Students", (r) => r.students], ["Status", (r) => r.status]],
    fields: [
      { name: "code", label: "Code *", type: "text" },
      { name: "name", label: "Name *", type: "text" },
      { name: "status", label: "Status", type: "select", options: () => [["ACTIVE", "Active"], ["INACTIVE", "Inactive"]] },
    ],
  },
  {
    kind: "programs", label: "Programs", single: "Program",
    columns: [["Code", (r) => r.code], ["Name", (r) => r.name], ["Department", (r) => r.departmentName], ["Terms", (r) => `${r.termCount} ${r.termLabel.toLowerCase()}s`], ["Students", (r) => r.students], ["Status", (r) => r.status]],
    fields: [
      { name: "code", label: "Code *", type: "text" },
      { name: "name", label: "Name *", type: "text" },
      { name: "departmentId", label: "Department *", type: "select", options: (lists) => lists.departments.map((d) => [d.id, `${d.code} · ${d.name}`]) },
      { name: "termLabel", label: "Term is called", type: "select", options: () => [["Semester", "Semester"], ["Year", "Year"], ["Class", "Class"], ["Trimester", "Trimester"]] },
      { name: "termCount", label: "Number of terms *", type: "number" },
      { name: "status", label: "Status", type: "select", options: () => [["ACTIVE", "Active"], ["INACTIVE", "Inactive"]] },
    ],
  },
  {
    kind: "sessions", label: "Sessions", single: "Session",
    columns: [["Name", (r) => r.name], ["Starts", (r) => r.startsOn], ["Ends", (r) => r.endsOn], ["Current", (r) => yes(r.isCurrent)]],
    fields: [
      { name: "name", label: "Name * (e.g. 2026-27)", type: "text" },
      { name: "startsOn", label: "Starts *", type: "date" },
      { name: "endsOn", label: "Ends *", type: "date" },
      { name: "isCurrent", label: "This is the current session", type: "checkbox" },
    ],
  },
  {
    kind: "sections", label: "Batches & Sections", single: "Section",
    columns: [["Section", (r) => `${r.programCode} ${r.termLabel} ${r.termNo} (${r.name})`], ["Session", (r) => r.sessionName], ["Students", (r) => `${r.students} / ${r.capacity}`], ["Class Teacher", (r) => r.classTeacherName || "—"]],
    fields: [
      { name: "programId", label: "Program *", type: "select", options: (lists) => lists.programs.map((p) => [p.id, `${p.code} · ${p.name}`]) },
      { name: "sessionId", label: "Session *", type: "select", options: (lists) => lists.sessions.map((s) => [s.id, s.name]) },
      { name: "termNo", label: "Term number *", type: "number" },
      { name: "name", label: "Section name * (e.g. A)", type: "text" },
      { name: "capacity", label: "Capacity", type: "number" },
      { name: "classTeacherId", label: "Class teacher", type: "select", optional: true, options: (lists) => lists.teachers.map((t) => [t.id, `${t.fullName} (${t.employeeNo})`]) },
    ],
  },
  {
    kind: "courses", label: "Courses", single: "Course",
    columns: [["Code", (r) => r.code], ["Title", (r) => r.title], ["Department", (r) => r.departmentCode], ["Credits", (r) => r.credits], ["Type", (r) => r.courseType], ["Status", (r) => r.status]],
    fields: [
      { name: "code", label: "Code *", type: "text" },
      { name: "title", label: "Title *", type: "text" },
      { name: "departmentId", label: "Department *", type: "select", options: (lists) => lists.departments.map((d) => [d.id, `${d.code} · ${d.name}`]) },
      { name: "credits", label: "Credits *", type: "number", step: "0.5" },
      { name: "courseType", label: "Type", type: "select", options: () => [["THEORY", "Theory"], ["LAB", "Lab"], ["PROJECT", "Project"]] },
      { name: "status", label: "Status", type: "select", options: () => [["ACTIVE", "Active"], ["INACTIVE", "Inactive"]] },
    ],
  },
  {
    kind: "classes", label: "Classes", single: "Class",
    columns: [["Course", (r) => `${r.courseCode} · ${r.courseTitle}`], ["Section", (r) => r.sectionLabel], ["Session", (r) => r.sessionName], ["Teacher", (r) => r.teacherName || "Not assigned"], ["Students", (r) => r.students], ["Results", (r) => (r.resultsPublishedAt ? "Published" : "")]],
    fields: [
      { name: "courseId", label: "Course *", type: "select", fixedAfterCreate: true, options: (lists) => lists.courses.filter((c) => c.status === "ACTIVE").map((c) => [c.id, `${c.code} · ${c.title}`]) },
      { name: "sectionId", label: "Section *", type: "select", fixedAfterCreate: true, options: (lists) => lists.sections.map((s) => [s.id, `${s.label}`]) },
      { name: "teacherId", label: "Teacher", type: "select", optional: true, options: (lists) => lists.teachers.filter((t) => t.status !== "INACTIVE").map((t) => [t.id, `${t.fullName} (${t.employeeNo})`]) },
    ],
  },
];

const loadLists = async () => {
  const kinds = ["departments", "programs", "sessions", "sections", "courses", "classes"];
  const [lists, teachers] = await Promise.all([Promise.all(kinds.map((kind) => structureApi.list(kind))), teachersApi.list().catch(() => [])]);
  return { ...Object.fromEntries(kinds.map((kind, i) => [kind, lists[i]])), teachers };
};

function RecordForm({ tab, record, lists, onClose, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(tab.fields.map((field) => [field.name, record?.[field.name] ?? (field.type === "checkbox" ? false : "")])));
  const set = (name, value) => setValues((previous) => ({ ...previous, [name]: value }));
  const handleSubmit = async () => {
    const body = {};
    for (const field of tab.fields) {
      if (record && field.fixedAfterCreate) continue;
      const value = values[field.name];
      body[field.name] = field.type === "number" ? (value === "" ? undefined : Number(value)) : field.optional && value === "" ? null : value;
    }
    if (record) await structureApi.update(tab.kind, record.id, body);
    else await structureApi.create(tab.kind, body);
    onSaved();
  };
  return (
    <FormModal title={record ? `Edit ${tab.single}` : `New ${tab.single}`} submitLabel="Save" onSubmit={handleSubmit} onClose={onClose}>
      {tab.fields.map((field) => {
        const id = `${tab.kind}-${field.name}`;
        const disabled = Boolean(record && field.fixedAfterCreate);
        if (field.type === "checkbox") {
          return (
            <label key={field.name} className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
              <input id={id} type="checkbox" checked={Boolean(values[field.name])} onChange={(e) => set(field.name, e.target.checked)} />
              {field.label}
            </label>
          );
        }
        return (
          <Field key={field.name} id={id} label={field.label}>
            {field.type === "select" ? (
              <select id={id} value={values[field.name] ?? ""} disabled={disabled} onChange={(e) => set(field.name, e.target.value)} className={inputClass}>
                <option value="">{field.optional ? "None" : "Choose..."}</option>
                {field.options(lists).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : (
              <input id={id} type={field.type} step={field.step} value={values[field.name] ?? ""} onChange={(e) => set(field.name, e.target.value)} className={inputClass} />
            )}
          </Field>
        );
      })}
    </FormModal>
  );
}

function AcademicStructure() {
  const { can, isReady } = useMe();
  const params = useSearchParams();
  const [tabKind, setTabKind] = useState(TABS.some((tab) => tab.kind === params.get("tab")) ? params.get("tab") : "departments");
  const load = useCallback(() => loadLists(), []);
  const { data: lists, error, isLoading, reload } = useData(load);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("institution.read", "classroom.read", "student.read", "teacher.read")) return <NoAccess />;

  const tab = TABS.find((item) => item.kind === tabKind);
  const area = tab.kind === "classes" ? "classroom" : "institution";
  const rows = lists?.[tab.kind] || [];

  const remove = async (record) => {
    if (!window.confirm(`Delete this ${tab.single.toLowerCase()}?`)) return;
    setActionError("");
    try {
      await structureApi.remove(tab.kind, record.id);
      setNotice(`${tab.single} deleted.`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell
      title="Academic Structure"
      subtitle="Departments, programs, sessions, sections, courses and the classes that teach them. Students, attendance and results all build on this."
      actions={can(`${area}.create`) && <button onClick={() => setModal({})} disabled={!lists} className={`${primaryButton} disabled:opacity-50`}>New {tab.single}</button>}
    >
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((item) => (
          <button key={item.kind} role="tab" aria-selected={item.kind === tabKind} onClick={() => { setTabKind(item.kind); setNotice(""); }}
            className={`px-4 py-2 text-sm font-medium ${item.kind === tabKind ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"}`}>
            {item.label}{lists ? ` (${lists[item.kind].length})` : ""}
          </button>
        ))}
      </div>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={[...tab.columns.map(([label]) => label), "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage={`No ${tab.label.toLowerCase()} yet.`} minWidth="min-w-[760px]">
          {rows.map((record) => (
            <tr key={record.id} className="border-b border-slate-100">
              {tab.columns.map(([label, render]) => <td key={label} className="px-4 py-3 text-slate-700">{render(record)}</td>)}
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  {can(`${area}.update`) && <button onClick={() => setModal({ record })} aria-label={`Edit ${tab.single} ${record.code || record.name || record.courseCode}`} className={linkButton}>Edit</button>}
                  {can(`${area}.delete`) && <button onClick={() => remove(record)} aria-label={`Delete ${tab.single} ${record.code || record.name || record.courseCode}`} className={dangerButton}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal && lists && (
        <RecordForm
          tab={tab}
          record={modal.record}
          lists={lists}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setNotice(`${tab.single} saved.`); reload(); }}
        />
      )}
    </SystemShell>
  );
}

export default function AcademicStructurePage() {
  return (
    <Suspense fallback={null}>
      <AcademicStructure />
    </Suspense>
  );
}
