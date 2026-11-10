"use client";

import { useCallback, useState } from "react";
import { structureApi, teachersApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import {
  DataTable,
  ErrorBanner,
  FormModal,
  NoAccess,
  SelectField,
  StatusBadge,
  SystemShell,
  TextField,
  filterClass,
  friendlyError,
  linkButton,
  primaryButton,
  useData,
} from "@/components/erp/ui";

const STATUS_LABEL = { ACTIVE: "Active", ON_LEAVE: "On Leave", INACTIVE: "Inactive" };
const loadDepartments = () => structureApi.list("departments");

function TeacherForm({ teacher, departments, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    employeeNo: teacher?.employeeNo || "", fullName: teacher?.fullName || "", email: teacher?.email || "", phone: teacher?.phone || "",
    departmentId: teacher?.departmentId || "", designation: teacher?.designation || "", qualification: teacher?.qualification || "",
    joinedOn: teacher?.joinedOn || "", status: teacher?.status || "ACTIVE",
  }));
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const handleSubmit = async () => {
    const body = { ...form, departmentId: form.departmentId || null, joinedOn: form.joinedOn || null };
    if (teacher) {
      delete body.employeeNo;
      await teachersApi.update(teacher.id, body);
    } else {
      delete body.status;
      await teachersApi.create(body);
    }
    onSaved();
  };
  return (
    <FormModal title={teacher ? `Edit ${teacher.fullName}` : "Add Teacher"} submitLabel="Save" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="t-no" label="Employee Number *" value={form.employeeNo} maxLength={40} onChange={set("employeeNo")} disabled={Boolean(teacher)} />
      <TextField id="t-name" label="Full Name *" value={form.fullName} maxLength={150} onChange={set("fullName")} />
      <TextField id="t-email" label="Email (sign-in goes here)" type="email" value={form.email} maxLength={255} onChange={set("email")} />
      <TextField id="t-phone" label="Phone" value={form.phone} maxLength={30} onChange={set("phone")} />
      <SelectField id="t-dept" label="Department" value={form.departmentId} onChange={set("departmentId")} options={[{ value: "", label: "None" }, ...departments.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }))]} />
      <TextField id="t-designation" label="Designation" value={form.designation} maxLength={100} onChange={set("designation")} />
      <TextField id="t-qualification" label="Qualification" value={form.qualification} maxLength={200} onChange={set("qualification")} />
      <TextField id="t-joined" label="Joined On" type="date" value={form.joinedOn} onChange={set("joinedOn")} />
      {teacher && <SelectField id="t-status" label="Status" value={form.status} onChange={set("status")} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} />}
    </FormModal>
  );
}

export default function TeacherProfilePage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", departmentId: "", status: "" });
  const load = useCallback(() => teachersApi.list(filters), [filters]);
  const { data: teachers, error, isLoading, reload } = useData(load);
  const { data: departments } = useData(loadDepartments);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("teacher.read")) return <NoAccess />;

  const account = async (teacher) => {
    setActionError("");
    setNotice("");
    try {
      const result = await teachersApi.createAccount(teacher.id);
      setNotice(result.credentials.delivered ? `Account ${result.username} created; the sign-in details were emailed.` : `Account ${result.username} created, but the email was not sent: ${result.credentials.reason}`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell
      title="Teachers"
      subtitle="Faculty records. A teacher with an account sees only their own classes for attendance and marks."
      actions={can("teacher.create") && <button onClick={() => setModal({})} className={primaryButton}>Add Teacher</button>}
    >
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search teachers" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search name, employee number or email" className={`${filterClass} min-w-[16rem] flex-1`} />
        <select aria-label="Filter by department" value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })} className={filterClass}>
          <option value="">All departments</option>
          {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
        </select>
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Employee No", "Name", "Department", "Designation", "Classes Now", "Status", "Account", "Actions"]} isLoading={isLoading && !teachers} hasRows={(teachers || []).length > 0} emptyMessage="No teachers yet." minWidth="min-w-[900px]">
          {(teachers || []).map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-xs text-slate-700">{t.employeeNo}</td>
              <td className="px-4 py-3"><p className="font-medium text-slate-800">{t.fullName}</p><p className="text-xs text-slate-500">{t.email || t.phone || ""}</p></td>
              <td className="px-4 py-3 text-slate-600">{t.departmentName || "—"}</td>
              <td className="px-4 py-3 text-slate-600">{t.designation || "—"}</td>
              <td className="px-4 py-3 text-slate-600">{t.classes}</td>
              <td className="px-4 py-3"><StatusBadge status={STATUS_LABEL[t.status]} /></td>
              <td className="px-4 py-3 text-xs text-slate-600">{t.username || "—"}</td>
              <td className="px-4 py-3">
                <div className="flex gap-3 whitespace-nowrap">
                  {can("teacher.update") && <button onClick={() => setModal({ teacher: t })} aria-label={`Edit ${t.fullName}`} className={linkButton}>Edit</button>}
                  {can("teacher.update") && !t.username && <button onClick={() => account(t)} disabled={!t.email} className={`${linkButton} disabled:opacity-40`} aria-label={`Create account for ${t.fullName}`}>Create Account</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal && <TeacherForm teacher={modal.teacher} departments={departments || []} onClose={() => setModal(null)} onSaved={() => { setModal(null); setNotice("Teacher saved."); reload(); }} />}
    </SystemShell>
  );
}
