"use client";

import { useCallback, useState } from "react";
import { structureApi, studentsApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import {
  DataTable,
  Detail,
  ErrorBanner,
  FormModal,
  NoAccess,
  SelectField,
  StatusBadge,
  SystemShell,
  TextField,
  ViewModal,
  dangerButton,
  filterClass,
  friendlyError,
  linkButton,
  primaryButton,
  secondaryButton,
  useData,
} from "@/components/erp/ui";

const STATUS_LABEL = { ACTIVE: "Active", SUSPENDED: "Suspended", GRADUATED: "Graduated", DROPPED: "Dropped" };
const loadLists = () => Promise.all([structureApi.list("programs"), structureApi.list("sections")]);

const delivery = (result, who) =>
  result.credentials?.delivered
    ? `${who} account ${result.username} created; the sign-in details were emailed.`
    : result.existing
      ? `Linked to the existing guardian account ${result.username}.`
      : `${who} account ${result.username} created, but the email was not sent: ${result.credentials?.reason || "unknown reason"}. Send a new password from the Users page.`;

function StudentForm({ student, programs, sections, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    studentNo: student?.studentNo || "",
    fullName: student?.fullName || "",
    email: student?.email || "",
    phone: student?.phone || "",
    dateOfBirth: student?.dateOfBirth || "",
    gender: student?.gender || "",
    address: student?.address || "",
    programId: student?.programId || programs.find((p) => p.status === "ACTIVE")?.id || "",
    sectionId: student?.sectionId || "",
    admissionDate: student?.admissionDate || "",
    guardianName: student?.guardian?.name || "",
    guardianPhone: student?.guardian?.phone || "",
    guardianEmail: student?.guardian?.email || "",
    guardianRelationship: student?.guardian?.relationship || "",
  }));
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value, ...(key === "programId" ? { sectionId: "" } : {}) }));
  const programSections = sections.filter((s) => s.programId === form.programId);

  const handleSubmit = async () => {
    const body = {
      fullName: form.fullName, email: form.email, phone: form.phone, dateOfBirth: form.dateOfBirth || null, gender: form.gender, address: form.address,
      programId: form.programId, sectionId: form.sectionId || null,
      guardian: { name: form.guardianName, phone: form.guardianPhone, email: form.guardianEmail, relationship: form.guardianRelationship },
    };
    if (student) await studentsApi.update(student.id, body);
    else await studentsApi.create({ ...body, studentNo: form.studentNo || undefined, admissionDate: form.admissionDate || undefined });
    onSaved();
  };

  return (
    <FormModal title={student ? `Edit ${student.fullName}` : "Admit a Student"} submitLabel={student ? "Save" : "Admit"} onSubmit={handleSubmit} onClose={onClose}>
      {!student && <TextField id="st-no" label="Student ID (blank = generated)" value={form.studentNo} maxLength={40} onChange={set("studentNo")} />}
      <TextField id="st-name" label="Full Name *" value={form.fullName} maxLength={150} onChange={set("fullName")} />
      <SelectField id="st-program" label="Program *" value={form.programId} onChange={set("programId")} options={programs.filter((p) => p.status === "ACTIVE" || p.id === form.programId).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
      <SelectField id="st-section" label="Section" value={form.sectionId} onChange={set("sectionId")} options={[{ value: "", label: "Not placed yet" }, ...programSections.map((s) => ({ value: s.id, label: `${s.termLabel} ${s.termNo} (${s.name}), ${s.sessionName} · ${s.students}/${s.capacity}` }))]} />
      <TextField id="st-email" label="Email (portal sign-in goes here)" type="email" value={form.email} maxLength={255} onChange={set("email")} />
      <TextField id="st-phone" label="Phone" value={form.phone} maxLength={30} onChange={set("phone")} />
      <TextField id="st-dob" label="Date of Birth" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} />
      <SelectField id="st-gender" label="Gender" value={form.gender} onChange={set("gender")} options={[{ value: "", label: "Not given" }, { value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]} />
      {!student && <TextField id="st-admission" label="Admission Date (blank = today)" type="date" value={form.admissionDate} onChange={set("admissionDate")} />}
      <TextField id="st-address" label="Address" value={form.address} maxLength={500} onChange={set("address")} wide />
      <p className="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-700 sm:col-span-2">Guardian</p>
      <TextField id="st-g-name" label="Guardian Name" value={form.guardianName} maxLength={150} onChange={set("guardianName")} />
      <TextField id="st-g-rel" label="Relationship" value={form.guardianRelationship} maxLength={50} onChange={set("guardianRelationship")} />
      <TextField id="st-g-phone" label="Guardian Phone" value={form.guardianPhone} maxLength={30} onChange={set("guardianPhone")} />
      <TextField id="st-g-email" label="Guardian Email" type="email" value={form.guardianEmail} maxLength={255} onChange={set("guardianEmail")} />
    </FormModal>
  );
}

function StudentDetail({ id, canEdit, onClose, onEdit, onChanged }) {
  const load = useCallback(() => studentsApi.get(id), [id]);
  const { data, error, reload } = useData(load);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const act = async (work, describe) => {
    setActionError("");
    setMessage("");
    try {
      const result = await work();
      setMessage(describe(result));
      reload();
      onChanged();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };
  const s = data?.student;

  return (
    <ViewModal title={s ? `${s.fullName} (${s.studentNo})` : "Student"} onClose={onClose} wide actions={s && canEdit && <button onClick={() => onEdit(s)} className={secondaryButton}>Edit</button>}>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Detail label="Program" value={`${s.programCode} · ${s.programName}`} />
            <Detail label="Section" value={s.sectionLabel || "Not placed"} />
            <div><p className="text-xs text-slate-500">Status</p><div className="mt-1"><StatusBadge status={STATUS_LABEL[s.status]} /></div>{s.statusReason && <p className="text-xs text-slate-500">{s.statusReason}</p>}</div>
            <Detail label="Admitted" value={s.admissionDate} />
            <Detail label="Email" value={s.email || "—"} />
            <Detail label="Phone" value={s.phone || "—"} />
            <Detail label="Date of Birth" value={s.dateOfBirth || "—"} />
            <Detail label="Hostel" value={s.hostelStatus || "No hostel record"} />
            <Detail label="Guardian" value={s.guardian.name ? `${s.guardian.name}${s.guardian.relationship ? ` (${s.guardian.relationship})` : ""}` : "—"} />
            <Detail label="Guardian Contact" value={[s.guardian.phone, s.guardian.email].filter(Boolean).join(" · ") || "—"} />
            <Detail label="Portal Account" value={s.username || "None"} />
            <Detail label="Guardian Accounts" value={data.guardians.map((g) => g.username).join(", ") || "None"} />
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {!s.username && <button onClick={() => act(() => studentsApi.createAccount(s.id), (r) => delivery(r, "Student"))} disabled={!s.email} className={`${secondaryButton} disabled:opacity-50`} title={s.email ? "" : "Add an email first"}>Create Portal Account</button>}
              {s.guardian.email && <button onClick={() => act(() => studentsApi.createGuardianAccount(s.id), (r) => delivery(r, "Guardian"))} className={secondaryButton}>Give Guardian Portal Access</button>}
              {s.status === "ACTIVE" ? (
                ["SUSPENDED", "GRADUATED", "DROPPED"].map((status) => (
                  <button key={status} onClick={() => { const reason = window.prompt(`Reason for marking ${s.fullName} as ${STATUS_LABEL[status].toLowerCase()}:`); if (reason) act(() => studentsApi.setStatus(s.id, status, reason), () => `${s.fullName} is now ${STATUS_LABEL[status].toLowerCase()}.`); }} className={status === "GRADUATED" ? secondaryButton : `${dangerButton} rounded-lg border border-red-200 px-3 py-2 text-sm`}>
                    Mark {STATUS_LABEL[status]}
                  </button>
                ))
              ) : (
                <button onClick={() => act(() => studentsApi.setStatus(s.id, "ACTIVE", ""), () => `${s.fullName} is active again.`)} className={secondaryButton}>Make Active</button>
              )}
            </div>
          )}

          <section>
            <h3 className="mb-2 font-semibold text-slate-800">Attendance {data.attendance.overallPercent !== null ? `· ${data.attendance.overallPercent}% overall` : ""}</h3>
            <DataTable columns={["Course", "Attended", "Absent", "%"]} hasRows={data.attendance.classes.length > 0} emptyMessage="No attendance taken yet." minWidth="min-w-[420px]">
              {data.attendance.classes.map((row) => (
                <tr key={row.classId} className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700">{row.courseCode} · {row.courseTitle}</td>
                  <td className="px-4 py-2 text-slate-600">{row.attended}</td>
                  <td className="px-4 py-2 text-slate-600">{row.absent}</td>
                  <td className={`px-4 py-2 font-medium ${row.percent !== null && row.percent < 75 ? "text-red-600" : "text-slate-800"}`}>{row.percent ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-slate-800">Published Results {data.transcript.cgpa !== null ? `· CGPA ${data.transcript.cgpa.toFixed(2)} of ${data.transcript.scale}` : ""}</h3>
            {data.transcript.terms.length === 0 && <p className="text-sm text-slate-500">No published results yet.</p>}
            {data.transcript.terms.map((term) => (
              <div key={`${term.session}-${term.term}`} className="mb-3">
                <p className="text-sm font-medium text-slate-700">{term.session} · {term.term} · GPA {term.gpa?.toFixed(2)} ({term.credits} credits)</p>
                <DataTable columns={["Course", "Credits", "%", "Grade", "Point"]} hasRows={term.courses.length > 0} minWidth="min-w-[420px]">
                  {term.courses.map((course) => (
                    <tr key={course.courseCode} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-700">{course.courseCode} · {course.courseTitle}</td>
                      <td className="px-4 py-2 text-slate-600">{course.credits}</td>
                      <td className="px-4 py-2 text-slate-600">{course.percent}</td>
                      <td className={`px-4 py-2 font-medium ${course.passed ? "text-slate-800" : "text-red-600"}`}>{course.letter}</td>
                      <td className="px-4 py-2 text-slate-600">{course.gradePoint.toFixed(2)}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            ))}
          </section>
        </>
      )}
    </ViewModal>
  );
}

export default function StudentInformationPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", programId: "", sectionId: "", status: "ACTIVE" });
  const load = useCallback(() => studentsApi.list(filters), [filters]);
  const { data: students, error, isLoading, reload } = useData(load);
  const { data: lists } = useData(loadLists);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState([]);
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("student.read")) return <NoAccess />;
  const [programs, sections] = lists || [[], []];
  const canEdit = can("student.update");
  const chosen = (students || []).filter((s) => selected.includes(s.id));
  const sameProgram = chosen.length > 0 && chosen.every((s) => s.programId === chosen[0].programId);

  const move = async () => {
    setActionError("");
    try {
      const result = await studentsApi.move(selected, target);
      setNotice(`Moved ${result.moved} student(s).`);
      setSelected([]);
      setTarget("");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell
      title="Students"
      subtitle="Every student's record: program, section, guardian, portal access, attendance and published results. The student ID is the same in hostel and the portal."
      actions={can("student.create") && <button onClick={() => setModal({ type: "form" })} disabled={!lists || programs.length === 0} className={`${primaryButton} disabled:opacity-50`}>Admit Student</button>}
    >
      {lists && programs.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Add a department and program in Academic Structure first.</p>}
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search students" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search name, ID, email or phone" className={`${filterClass} min-w-[16rem] flex-1`} />
        <select aria-label="Filter by program" value={filters.programId} onChange={(e) => setFilters({ ...filters, programId: e.target.value, sectionId: "" })} className={filterClass}>
          <option value="">All programs</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
        <select aria-label="Filter by section" value={filters.sectionId} onChange={(e) => setFilters({ ...filters, sectionId: e.target.value })} className={filterClass}>
          <option value="">All sections</option>
          {sections.filter((s) => !filters.programId || s.programId === filters.programId).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {canEdit && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <span>{selected.length} selected.</span>
          {sameProgram ? (
            <>
              <select aria-label="Move to section" value={target} onChange={(e) => setTarget(e.target.value)} className={filterClass}>
                <option value="">Move to section...</option>
                {sections.filter((s) => s.programId === chosen[0].programId).map((s) => <option key={s.id} value={s.id}>{s.label} · {s.students}/{s.capacity}</option>)}
              </select>
              <button onClick={move} disabled={!target} className={`${primaryButton} disabled:opacity-50`}>Move</button>
            </>
          ) : (
            <span className="text-amber-700">Pick students of one program to move them together.</span>
          )}
          <button onClick={() => setSelected([])} className={linkButton}>Clear</button>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Select", "Student ID", "Name", "Program / Section", "Status", "Portal", "Hostel", "Open"]} isLoading={isLoading && !students} hasRows={(students || []).length > 0} emptyMessage="No students match." minWidth="min-w-[920px]">
          {(students || []).map((s) => (
            <tr key={s.id} className="border-b border-slate-100">
              <td className="px-4 py-3">{canEdit && <input type="checkbox" aria-label={`Select ${s.fullName}`} checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id))} />}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-700">{s.studentNo}</td>
              <td className="px-4 py-3"><p className="font-medium text-slate-800">{s.fullName}</p><p className="text-xs text-slate-500">{s.email || s.phone || ""}</p></td>
              <td className="px-4 py-3 text-slate-600"><p>{s.programCode}</p><p className="text-xs">{s.sectionLabel || "Not placed"}</p></td>
              <td className="px-4 py-3"><StatusBadge status={STATUS_LABEL[s.status]} /></td>
              <td className="px-4 py-3 text-xs text-slate-600">{s.username || "—"}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{s.hostelStatus || "—"}</td>
              <td className="px-4 py-3"><button onClick={() => setModal({ type: "view", id: s.id })} aria-label={`Open ${s.fullName}`} className={linkButton}>Open</button></td>
            </tr>
          ))}
        </DataTable>
      </section>

      {modal?.type === "form" && (
        <StudentForm student={modal.student} programs={programs} sections={sections} onClose={() => setModal(modal.student ? { type: "view", id: modal.student.id } : null)}
          onSaved={() => { setNotice(modal.student ? "Student saved." : "Student admitted."); setModal(modal.student ? { type: "view", id: modal.student.id } : null); reload(); }} />
      )}
      {modal?.type === "view" && (
        <StudentDetail id={modal.id} canEdit={canEdit} onClose={() => setModal(null)} onEdit={(student) => setModal({ type: "form", student })} onChanged={reload} />
      )}
    </SystemShell>
  );
}
