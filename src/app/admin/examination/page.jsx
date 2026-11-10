"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { structureApi, teachingApi } from "@/lib/academicsApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, FormModal, NoAccess, SystemShell, TextField, dangerButton, filterClass, friendlyError, linkButton, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

const loadSessions = () => structureApi.list("sessions");

function ExamForm({ exam, sessionId, remaining, onClose, onSaved }) {
  const [form, setForm] = useState({ name: exam?.name || "", weight: String(exam?.weight ?? remaining), defaultMaxMarks: String(exam?.defaultMaxMarks ?? 100), startsOn: exam?.startsOn || "", endsOn: exam?.endsOn || "" });
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const handleSubmit = async () => {
    const body = { name: form.name, weight: Number(form.weight), startsOn: form.startsOn || null, endsOn: form.endsOn || null };
    if (exam) await teachingApi.updateExam(exam.id, body);
    else await teachingApi.createExam({ ...body, sessionId, defaultMaxMarks: Number(form.defaultMaxMarks) });
    onSaved();
  };
  return (
    <FormModal title={exam ? `Edit ${exam.name}` : "New Exam"} submitLabel="Save" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="exam-name" label="Name * (e.g. Midterm)" value={form.name} maxLength={100} onChange={set("name")} />
      <TextField id="exam-weight" label={`Weight % * (${remaining}% left in this session)`} type="number" min="0" max="100" step="0.5" value={form.weight} onChange={set("weight")} />
      {!exam && <TextField id="exam-max" label="Full Marks (each class can change it)" type="number" min="1" value={form.defaultMaxMarks} onChange={set("defaultMaxMarks")} />}
      <TextField id="exam-start" label="Starts" type="date" value={form.startsOn} onChange={set("startsOn")} />
      <TextField id="exam-end" label="Ends" type="date" value={form.endsOn} onChange={set("endsOn")} />
      <p className="text-xs text-slate-500 sm:col-span-2">Every class in the session gets this exam. A student&apos;s course result is the weighted total of all exams, which must come to 100% before results can be published.</p>
    </FormModal>
  );
}

export default function ExaminationPage() {
  const { can, isReady } = useMe();
  const { data: sessions } = useData(loadSessions);
  const [sessionId, setSessionId] = useState("");
  const current = sessionId || sessions?.find((s) => s.isCurrent)?.id || sessions?.[0]?.id || "";
  const load = useCallback(() => (current ? teachingApi.exams(current) : Promise.resolve([])), [current]);
  const { data: exams, error, isLoading, reload } = useData(load);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("examination.read")) return <NoAccess />;
  const total = (exams || []).reduce((sum, exam) => sum + exam.weight, 0);
  const canManage = can("examination.approve");

  const remove = async (exam) => {
    if (!window.confirm(`Delete ${exam.name}?`)) return;
    setActionError("");
    try {
      await teachingApi.deleteExam(exam.id);
      setNotice(`${exam.name} deleted.`);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell
      title="Examinations"
      subtitle="Exams of a session and their weights. Marks are entered per class; results are worked out from the grading scale."
      actions={
        <>
          <Link href="/admin/examination/marks-entry" className={secondaryButton}>Marks Entry</Link>
          <Link href="/admin/examination/result" className={secondaryButton}>Results</Link>
          {canManage && <button onClick={() => setModal({})} disabled={!current || total >= 100} className={`${primaryButton} disabled:opacity-50`}>New Exam</button>}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Session" value={current} onChange={(e) => setSessionId(e.target.value)} className={filterClass}>
          {(sessions || []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? " (current)" : ""}</option>)}
        </select>
        <p className={`text-sm ${total === 100 ? "text-green-700" : "text-amber-700"}`}>Weights: {total}% of 100%{total === 100 ? "" : ". Results publish only at 100%."}</p>
      </div>
      {sessions && sessions.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Create a session in Academic Structure first.</p>}
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Exam", "Weight", "Full Marks", "Dates", "Classes", "Marks Locked", "Actions"]} isLoading={isLoading} hasRows={(exams || []).length > 0} emptyMessage="No exams in this session." minWidth="min-w-[760px]">
          {(exams || []).map((exam) => (
            <tr key={exam.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{exam.name}</td>
              <td className="px-4 py-3 text-slate-600">{exam.weight}%</td>
              <td className="px-4 py-3 text-slate-600">{exam.defaultMaxMarks}</td>
              <td className="px-4 py-3 text-slate-600">{exam.startsOn ? `${exam.startsOn} to ${exam.endsOn || "?"}` : "—"}</td>
              <td className="px-4 py-3 text-slate-600">{exam.classes}</td>
              <td className="px-4 py-3 text-slate-600">{exam.locked} of {exam.classes}</td>
              <td className="px-4 py-3">
                {canManage && (
                  <div className="flex gap-3">
                    <button onClick={() => setModal({ exam })} aria-label={`Edit ${exam.name}`} className={linkButton}>Edit</button>
                    <button onClick={() => remove(exam)} aria-label={`Delete ${exam.name}`} className={dangerButton}>Delete</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal && (
        <ExamForm exam={modal.exam} sessionId={current} remaining={100 - total + (modal.exam?.weight || 0)} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setNotice("Exam saved."); reload(); }} />
      )}
    </SystemShell>
  );
}
