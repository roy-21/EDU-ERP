"use client";

import { useCallback, useEffect, useState } from "react";
import { assistantApi, fileToBase64 } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, FormModal, NoAccess, SystemShell, ViewModal, dangerButton, formatDateTime, friendlyError, inputClass, linkButton, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { CRUMBS, DOC_STATUS, Notice, Pill, SectionTabs, StatusPill, textareaClass } from "../_components/assistantUi";

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.html,.htm";
const size = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function UploadForm({ replacing, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState(replacing?.title || "");
  return (
    <FormModal title={replacing ? `Replace "${replacing.title}"` : "Upload a document"} submitLabel={replacing ? "Replace" : "Upload"} submitDisabled={!file} onClose={onClose}
      onSubmit={async () => {
        if (file.size > 7 * 1024 * 1024) throw new Error("The file is larger than 7 MB. Split it into smaller files.");
        const body = { title, fileName: file.name, contentBase64: await fileToBase64(file) };
        if (replacing) await assistantApi.replace(replacing.id, body);
        else await assistantApi.upload(body);
        onDone(replacing ? `Replacing "${title || file.name}". The old version answers until the new one is read.` : `Uploaded "${title || file.name}". It is being read now.`);
      }}>
      <div className="sm:col-span-2">
        <label htmlFor="doc-file" className="mb-1 block text-sm font-medium text-slate-700">File *</label>
        <input id="doc-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" />
        <p className="mt-1 text-xs text-slate-500">PDF, Word (.docx), text, Markdown, CSV or HTML, up to 7 MB. Old .doc files: save as .docx first. Scanned PDFs need OCR.</p>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="doc-title" className="mb-1 block text-sm font-medium text-slate-700">Title</label>
        <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Hostel rules 2026" className={inputClass} />
      </div>
    </FormModal>
  );
}

function AnswerForm({ onClose, onDone }) {
  const [form, setForm] = useState({ question: "", answer: "", explanation: "" });
  return (
    <FormModal title="Add an approved answer" submitLabel="Approve and add" submitDisabled={!form.question.trim() || !form.answer.trim()} onClose={onClose}
      onSubmit={async () => {
        await assistantApi.addKnowledge(form);
        onDone("Added. The assistant can use this answer now.");
      }}>
      <div className="sm:col-span-2">
        <label htmlFor="k-question" className="mb-1 block text-sm font-medium text-slate-700">Question *</label>
        <input id="k-question" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} maxLength={1000} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="k-answer" className="mb-1 block text-sm font-medium text-slate-700">Answer *</label>
        <textarea id="k-answer" rows={4} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} maxLength={5000} className={textareaClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="k-more" className="mb-1 block text-sm font-medium text-slate-700">More explanation</label>
        <textarea id="k-more" rows={2} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} maxLength={5000} className={textareaClass} />
      </div>
    </FormModal>
  );
}

export default function KnowledgePage() {
  const { can, isReady } = useMe();
  const canManage = can("voice-ai.manage_knowledge");
  const canReview = can("voice-ai.review_knowledge");
  const documents = useData(assistantApi.documents);
  const loadKnowledge = useCallback(() => assistantApi.knowledge("ALL"), []);
  const knowledge = useData(loadKnowledge);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const docs = documents.data || [];
  const busy = docs.some((doc) => doc.status === "QUEUED" || doc.status === "PROCESSING");
  const reloadDocuments = documents.reload;

  // While a document is being read, its status is refreshed every few seconds.
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(reloadDocuments, 3000);
    return () => clearInterval(timer);
  }, [busy, reloadDocuments]);

  const act = async (work, text) => {
    setActionError("");
    try {
      await work();
      setNotice(text);
      documents.reload();
      knowledge.reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  if (!isReady) return null;
  if (!canManage && !canReview) return <NoAccess />;

  const done = (text) => {
    setForm(null);
    setNotice(text);
    documents.reload();
    knowledge.reload();
  };

  return (
    <SystemShell title="Knowledge Base" crumbs={CRUMBS} subtitle="The only things the assistant answers from: your documents and the answers an admin approved."
      actions={<>
        {canReview && <button onClick={() => setForm({ kind: "answer" })} className={secondaryButton}>Add Answer</button>}
        {canManage && <button onClick={() => setForm({ kind: "upload" })} className={primaryButton}>Upload Document</button>}
      </>}>
      <SectionTabs can={can} />
      <ErrorBanner message={documents.error || knowledge.error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />

      <section className="space-y-2">
        <h2 className="font-bold text-slate-800">Documents</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-1">
          <DataTable columns={["Document", "Size", "Status", "Passages", "Uploaded", "Actions"]} isLoading={documents.isLoading} hasRows={docs.length > 0}
            emptyMessage="No documents yet. Upload rules, prospectus, fee charts, FAQs — anything people ask about.">
            {docs.map((doc) => (
              <tr key={doc.id} className="border-b border-slate-100 align-top">
                <td className="px-4 py-3"><span className="font-medium text-slate-800">{doc.title}</span><span className="block text-xs text-slate-500">{doc.fileName}</span></td>
                <td className="px-4 py-3 text-slate-600">{size(doc.sizeBytes)}</td>
                <td className="px-4 py-3">
                  <StatusPill map={DOC_STATUS} value={doc.status} />
                  {doc.error && <span className={`mt-1 block max-w-xs text-xs ${doc.status === "FAILED" ? "text-red-700" : "text-amber-700"}`}>{doc.error}</span>}
                  {doc.status === "QUEUED" && doc.attempts > 0 && <span className="block text-xs text-slate-500">Next try {formatDateTime(doc.nextAttemptAt)}</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {doc.status === "READY" ? <>{doc.chunkCount}<span className="block text-xs text-slate-500">{doc.embeddedChunks ? `${doc.embeddedChunks} with embeddings` : "word search"}</span></> : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDateTime(doc.createdAt)}<span className="block text-xs text-slate-500">{doc.uploadedBy}</span></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-3">
                    {doc.status === "READY" && <button onClick={() => assistantApi.preview(doc.id).then((chunks) => setPreview({ doc, chunks })).catch((err) => setActionError(friendlyError(err)))} className={linkButton}>What was read</button>}
                    {canManage && doc.status === "FAILED" && <button onClick={() => act(() => assistantApi.retryDocument(doc.id), "Trying again.")} className={linkButton}>Try again</button>}
                    {canManage && <button onClick={() => setForm({ kind: "upload", replacing: doc })} className={linkButton}>Replace</button>}
                    {canManage && <button onClick={() => window.confirm(`Remove "${doc.title}"? The assistant stops using it at once.`) && act(() => assistantApi.removeDocument(doc.id), "Document removed.")} className={dangerButton}>Remove</button>}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold text-slate-800">Approved answers</h2>
        <p className="text-sm text-slate-500">Answers from responsible persons that an admin approved, and answers admins added. Retire one that is no longer right.</p>
        <div className="rounded-xl border border-slate-200 bg-white p-1">
          <DataTable columns={["Question", "Answer", "Approved", "Status", ""]} isLoading={knowledge.isLoading} hasRows={(knowledge.data || []).length > 0}
            emptyMessage="No approved answers yet. They appear here after you approve them in Review.">
            {(knowledge.data || []).map((item) => (
              <tr key={item.id} className="border-b border-slate-100 align-top">
                <td className="max-w-xs px-4 py-3 font-medium text-slate-800">{item.question}</td>
                <td className="max-w-md px-4 py-3 text-slate-700"><span className="whitespace-pre-line">{item.answer}</span>{item.explanation && <span className="mt-1 block text-xs text-slate-500">{item.explanation}</span>}</td>
                <td className="px-4 py-3 text-slate-600">{formatDateTime(item.approvedAt)}<span className="block text-xs text-slate-500">{item.approvedBy}</span></td>
                <td className="px-4 py-3">{item.status === "ACTIVE" ? <Pill tone="green">In use</Pill> : <Pill>Retired</Pill>}</td>
                <td className="px-4 py-3">
                  {canReview && item.status === "ACTIVE" && (
                    <button onClick={() => window.confirm("Retire this answer? The assistant stops using it.") && act(() => assistantApi.retireKnowledge(item.id), "Answer retired.")} className={dangerButton}>Retire</button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      {form?.kind === "upload" && <UploadForm replacing={form.replacing} onClose={() => setForm(null)} onDone={done} />}
      {form?.kind === "answer" && <AnswerForm onClose={() => setForm(null)} onDone={done} />}
      {preview && (
        <ViewModal title={`What was read from "${preview.doc.title}"`} onClose={() => setPreview(null)}>
          <p className="text-sm text-slate-500">The first {preview.chunks.length} of {preview.doc.chunkCount} passages.</p>
          {preview.chunks.map((chunk) => (
            <pre key={chunk.position} className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{chunk.content}</pre>
          ))}
        </ViewModal>
      )}
    </SystemShell>
  );
}
