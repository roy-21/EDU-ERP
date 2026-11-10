"use client";

import { useCallback, useState } from "react";
import { teachingApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, friendlyError, inputClass, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

const STATUSES = [
  { value: "PRESENT", short: "P", label: "Present", on: "bg-green-600 text-white" },
  { value: "ABSENT", short: "A", label: "Absent", on: "bg-red-600 text-white" },
  { value: "LATE", short: "L", label: "Late", on: "bg-amber-500 text-white" },
  { value: "EXCUSED", short: "E", label: "Excused", on: "bg-slate-600 text-white" },
];
const todayLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const loadClasses = () => teachingApi.classes("attendance");

function Sheet({ klass }) {
  const [day, setDay] = useState(todayLocal());
  const [slot, setSlot] = useState("1");
  const load = useCallback(() => teachingApi.attendanceSheet(klass.id, day, slot), [klass.id, day, slot]);
  const { data, error, reload } = useData(load);
  const [edits, setEdits] = useState({});
  const [topic, setTopic] = useState(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const key = `${day}|${slot}`;
  const marks = edits[key] || {};
  const statusOf = (student) => marks[student.studentId] ?? student.status;
  const setStatus = (studentId, status) => setEdits({ ...edits, [key]: { ...marks, [studentId]: status } });

  const save = async () => {
    setSaveError("");
    setMessage("");
    try {
      const result = await teachingApi.saveAttendance(klass.id, {
        heldOn: day, slot, topic: topic ?? data.topic,
        marks: data.students.map((student) => ({ studentId: student.studentId, status: statusOf(student) })),
      });
      setMessage(`Saved: ${result.marked - result.absent} attended, ${result.absent} absent.`);
      setEdits({ ...edits, [key]: undefined });
      setTopic(null);
      reload();
    } catch (err) {
      setSaveError(friendlyError(err));
    }
  };

  const unmarked = (data?.students || []).filter((student) => !statusOf(student)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700">Date<input type="date" value={day} max={todayLocal()} onChange={(e) => { setDay(e.target.value); setMessage(""); }} className={`${filterClass} block`} /></label>
        <label className="text-sm text-slate-700">Period<input value={slot} maxLength={30} onChange={(e) => setSlot(e.target.value || "1")} className={`${filterClass} block w-24`} /></label>
        <label className="min-w-[14rem] flex-1 text-sm text-slate-700">Topic<input value={topic ?? data?.topic ?? ""} maxLength={200} onChange={(e) => setTopic(e.target.value)} className={inputClass} /></label>
        <button onClick={() => data && setEdits({ ...edits, [key]: Object.fromEntries(data.students.map((student) => [student.studentId, "PRESENT"])) })} className={secondaryButton}>All Present</button>
        <button onClick={save} disabled={!data || unmarked > 0} className={`${primaryButton} disabled:opacity-50`}>Save Attendance</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
      {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
      {data?.takenBy && <p className="text-xs text-slate-500">Already taken by {data.takenBy}. Saving again replaces it.</p>}
      {unmarked > 0 && <p className="text-xs text-amber-700">{unmarked} student(s) still unmarked.</p>}
      <DataTable columns={["Student ID", "Name", "Status"]} isLoading={!data && !error} hasRows={(data?.students || []).length > 0} emptyMessage="No active students in this section." minWidth="min-w-[560px]">
        {(data?.students || []).map((student) => (
          <tr key={student.studentId} className="border-b border-slate-100">
            <td className="px-4 py-2 font-mono text-xs text-slate-600">{student.studentNo}</td>
            <td className="px-4 py-2 text-slate-800">{student.fullName}</td>
            <td className="px-4 py-2">
              <div role="radiogroup" aria-label={`Attendance of ${student.fullName}`} className="flex gap-1">
                {STATUSES.map((status) => (
                  <button key={status.value} role="radio" aria-checked={statusOf(student) === status.value} aria-label={`${status.label}: ${student.fullName}`} title={status.label}
                    onClick={() => setStatus(student.studentId, status.value)}
                    className={`h-8 w-8 rounded text-xs font-bold ${statusOf(student) === status.value ? status.on : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {status.short}
                  </button>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function Report({ klass }) {
  const load = useCallback(() => teachingApi.attendanceReport(klass.id), [klass.id]);
  const { data, error } = useData(load);
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-slate-600">{data ? `${data.sessions.length} class(es) taken. Late counts as attended; excused days are left out.` : "Loading..."}</p>
      <DataTable columns={["Student ID", "Name", "Attended", "Absent", "Late", "Excused", "%"]} isLoading={!data && !error} hasRows={(data?.students || []).length > 0} emptyMessage="No students." minWidth="min-w-[640px]">
        {(data?.students || []).map((row) => (
          <tr key={row.studentId} className="border-b border-slate-100">
            <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.studentNo}</td>
            <td className="px-4 py-2 text-slate-800">{row.fullName}</td>
            <td className="px-4 py-2 text-slate-600">{row.attended}</td>
            <td className="px-4 py-2 text-slate-600">{row.absent}</td>
            <td className="px-4 py-2 text-slate-600">{row.late}</td>
            <td className="px-4 py-2 text-slate-600">{row.excused}</td>
            <td className={`px-4 py-2 font-semibold ${row.percent !== null && row.percent < 75 ? "text-red-600" : "text-slate-800"}`}>{row.percent ?? "—"}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export default function AttendancePage() {
  const { can, isReady } = useMe();
  const { data: classes, error } = useData(loadClasses);
  const [classId, setClassId] = useState("");
  const [tab, setTab] = useState("take");

  if (isReady && !can("attendance.read", "attendance.create")) return <NoAccess />;
  const klass = (classes || []).find((item) => item.id === classId) || (classes || [])[0];

  return (
    <SystemShell title="Attendance" subtitle="Take attendance for a class and see each student's record. Teachers see only the classes they teach.">
      <ErrorBanner message={error} />
      {classes && classes.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No classes to show. Classes are set up in Academic Structure; a teacher needs one assigned to them.</p>}
      {klass && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select aria-label="Class" value={klass.id} onChange={(e) => setClassId(e.target.value)} className={`${filterClass} min-w-[18rem]`}>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.courseCode} · {item.sectionLabel} · {item.sessionName}{item.teacherName ? ` · ${item.teacherName}` : ""}</option>)}
            </select>
            <div role="tablist" className="flex gap-2">
              {[["take", "Take Attendance"], ["report", "Report"]].map(([value, label]) => (
                <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={tab === value ? primaryButton : secondaryButton}>{label}</button>
              ))}
            </div>
          </div>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            {tab === "take" ? <Sheet key={klass.id} klass={klass} /> : <Report key={klass.id} klass={klass} />}
          </section>
        </>
      )}
    </SystemShell>
  );
}
