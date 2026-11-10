"use client";

import { useCallback, useState } from "react";
import { teachingApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, friendlyError, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

const loadClasses = () => teachingApi.classes("exams");

function MarksSheet({ assessmentId, canUnlock, onChanged }) {
  const load = useCallback(() => teachingApi.marksSheet(assessmentId), [assessmentId]);
  const { data, error, reload } = useData(load);
  const [edits, setEdits] = useState({});
  const [maxMarks, setMaxMarks] = useState(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const valueOf = (student) => edits[student.studentId] ?? { marks: student.marks ?? "", isAbsent: student.isAbsent };
  const set = (student, change) => setEdits({ ...edits, [student.studentId]: { ...valueOf(student), ...change } });
  const locked = Boolean(data?.assessment.lockedAt);
  const full = maxMarks ?? data?.assessment.maxMarks;

  const run = async (work, text) => {
    setSaveError("");
    setMessage("");
    try {
      await work();
      setMessage(text);
      setEdits({});
      setMaxMarks(null);
      reload();
      onChanged();
    } catch (err) {
      setSaveError(friendlyError(err));
    }
  };

  const save = () => run(() => teachingApi.saveMarks(assessmentId, {
    maxMarks: Number(full),
    marks: Object.entries(edits).map(([studentId, value]) => ({ studentId, isAbsent: value.isAbsent, marks: value.isAbsent || value.marks === "" ? null : Number(value.marks) })),
  }), "Marks saved.");

  const missing = (data?.students || []).filter((student) => { const v = valueOf(student); return !v.isAbsent && v.marks === ""; }).length;

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
      {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
      {data && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">Full Marks<input type="number" min="1" value={full} disabled={locked} onChange={(e) => setMaxMarks(e.target.value)} className={`${filterClass} block w-28`} /></label>
          <p className="text-sm text-slate-600">{data.assessment.examName} · counts {data.assessment.weight}% · {missing} without marks</p>
          {!locked && <button onClick={save} disabled={Object.keys(edits).length === 0 && maxMarks === null} className={`${primaryButton} disabled:opacity-50`}>Save Marks</button>}
          {!locked && <button onClick={() => run(() => teachingApi.lock(assessmentId), "Marks locked.")} disabled={Object.keys(edits).length > 0} className={secondaryButton} title="Save first">Lock Marks</button>}
          {locked && <p className="text-sm font-medium text-slate-700">Locked{canUnlock ? "" : ". Ask an approver to unlock."}</p>}
          {locked && canUnlock && <button onClick={() => run(() => teachingApi.unlock(assessmentId), "Marks unlocked.")} className={secondaryButton}>Unlock</button>}
        </div>
      )}
      <DataTable columns={["Student ID", "Name", "Marks", "Absent"]} isLoading={!data && !error} hasRows={(data?.students || []).length > 0} emptyMessage="No active students." minWidth="min-w-[520px]">
        {(data?.students || []).map((student) => {
          const value = valueOf(student);
          return (
            <tr key={student.studentId} className="border-b border-slate-100">
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{student.studentNo}</td>
              <td className="px-4 py-2 text-slate-800">{student.fullName}</td>
              <td className="px-4 py-2">
                <input type="number" min="0" max={full} step="0.5" aria-label={`Marks of ${student.fullName}`} value={value.isAbsent ? "" : value.marks}
                  disabled={locked || value.isAbsent} onChange={(e) => set(student, { marks: e.target.value })}
                  className={`w-24 rounded border px-2 py-1 text-sm ${Number(value.marks) > Number(full) ? "border-red-400" : "border-slate-300"}`} />
              </td>
              <td className="px-4 py-2"><input type="checkbox" aria-label={`${student.fullName} absent`} checked={value.isAbsent} disabled={locked} onChange={(e) => set(student, { isAbsent: e.target.checked })} /></td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}

export default function MarksEntryPage() {
  const { can, isReady } = useMe();
  const { data: classes, error } = useData(loadClasses);
  const [classId, setClassId] = useState("");
  const klass = (classes || []).find((item) => item.id === classId) || (classes || [])[0];
  const loadAssessments = useCallback(() => (klass ? teachingApi.assessments(klass.id) : Promise.resolve(null)), [klass]);
  const { data: detail, reload } = useData(loadAssessments);
  const [assessmentId, setAssessmentId] = useState("");

  if (isReady && !can("examination.read", "examination.create")) return <NoAccess />;
  const assessments = detail?.assessments || [];
  const chosen = assessments.find((item) => item.id === assessmentId) || assessments[0];

  return (
    <SystemShell title="Marks Entry" subtitle="Enter each student's marks per exam, then lock them. Teachers see only their own classes." crumbs={[{ href: "/admin/examination", label: "Examinations" }]}>
      <ErrorBanner message={error} />
      {classes && classes.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No classes to show.</p>}
      {klass && (
        <select aria-label="Class" value={klass.id} onChange={(e) => { setClassId(e.target.value); setAssessmentId(""); }} className={`${filterClass} min-w-[18rem]`}>
          {classes.map((item) => <option key={item.id} value={item.id}>{item.courseCode} · {item.sectionLabel} · {item.sessionName}</option>)}
        </select>
      )}
      {detail && assessments.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">This session has no exams yet. Add them on the Examinations page.</p>}
      {assessments.length > 0 && (
        <>
          <div role="tablist" className="flex flex-wrap gap-2">
            {assessments.map((item) => (
              <button key={item.id} role="tab" aria-selected={chosen?.id === item.id} onClick={() => setAssessmentId(item.id)} className={chosen?.id === item.id ? primaryButton : secondaryButton}>
                {item.examName} ({item.weight}%){item.lockedAt ? " 🔒" : ""}
              </button>
            ))}
          </div>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <MarksSheet key={chosen.id} assessmentId={chosen.id} canUnlock={can("examination.approve")} onChanged={reload} />
          </section>
        </>
      )}
    </SystemShell>
  );
}
