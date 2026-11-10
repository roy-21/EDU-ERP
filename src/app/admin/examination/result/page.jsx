"use client";

import { useCallback, useState } from "react";
import { teachingApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, NoAccess, SystemShell, filterClass, formatDateTime, friendlyError, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

const loadClasses = () => teachingApi.classes("exams");

export default function ResultsPage() {
  const { can, isReady } = useMe();
  const { data: classes, error } = useData(loadClasses);
  const [classId, setClassId] = useState("");
  const klass = (classes || []).find((item) => item.id === classId) || (classes || [])[0];
  const load = useCallback(() => (klass ? teachingApi.results(klass.id) : Promise.resolve(null)), [klass]);
  const { data, error: loadError, reload } = useData(load);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("examination.read", "examination.create")) return <NoAccess />;

  const act = async (work, text) => {
    setActionError("");
    setMessage("");
    try {
      await work();
      setMessage(text);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };
  const results = data?.results || [];
  const complete = results.filter((row) => row.complete);
  const passed = complete.filter((row) => row.passed).length;
  const published = data?.class.resultsPublishedAt;
  const exams = results[0]?.parts.map((part) => part.exam) || [];

  return (
    <SystemShell title="Results" subtitle="Each student's weighted total and grade from the institution's grading scale. Students see results only after they are published." crumbs={[{ href: "/admin/examination", label: "Examinations" }]}>
      <ErrorBanner message={error || loadError || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
      {classes && classes.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No classes to show.</p>}
      {klass && (
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Class" value={klass.id} onChange={(e) => { setClassId(e.target.value); setMessage(""); }} className={`${filterClass} min-w-[18rem]`}>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.courseCode} · {item.sectionLabel} · {item.sessionName}</option>)}
          </select>
          {data && can("examination.approve") && (published
            ? <button onClick={() => window.confirm("Withdraw these results? Students stop seeing them.") && act(() => teachingApi.withdraw(klass.id), "Results withdrawn.")} className={secondaryButton}>Withdraw Results</button>
            : <button onClick={() => act(() => teachingApi.publish(klass.id), "Results published. Students can see them now.")} disabled={data.totalWeight !== 100 || !data.allLocked} className={`${primaryButton} disabled:opacity-50`}>Publish Results</button>)}
        </div>
      )}
      {data && (
        <p className="text-sm text-slate-600">
          {published ? `Published ${formatDateTime(published)}. ` : ""}
          Exams carry {data.totalWeight}%{data.totalWeight !== 100 ? " (must be 100% to publish)" : ""}. {data.allLocked ? "All marks locked." : "Some marks are not locked yet."} {complete.length} of {results.length} complete, {passed} passed.
        </p>
      )}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Student ID", "Name", ...exams, "Total %", "Grade", "Point", "Result"]} isLoading={klass && !data && !loadError} hasRows={results.length > 0} emptyMessage="No students." minWidth="min-w-[760px]">
          {results.map((row) => (
            <tr key={row.studentId} className="border-b border-slate-100">
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.studentNo}</td>
              <td className="px-4 py-2 text-slate-800">{row.fullName}</td>
              {row.parts.map((part) => <td key={part.exam} className="px-4 py-2 text-slate-600">{part.isAbsent ? "Absent" : part.marks === null ? "—" : `${part.marks}/${part.maxMarks}`}</td>)}
              <td className="px-4 py-2 font-medium text-slate-800">{row.percent}</td>
              <td className="px-4 py-2 font-semibold text-slate-800">{row.letter ?? "—"}</td>
              <td className="px-4 py-2 text-slate-600">{row.gradePoint === null ? "—" : row.gradePoint.toFixed(2)}</td>
              <td className={`px-4 py-2 font-medium ${row.passed === false ? "text-red-600" : "text-green-700"}`}>{row.complete ? (row.passed ? "Pass" : "Fail") : "Incomplete"}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </SystemShell>
  );
}
