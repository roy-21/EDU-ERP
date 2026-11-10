"use client";

import { useCallback, useState } from "react";
import { noticesApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { label, toLocalInput } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, ViewModal, dangerButton, filterClass, formatDateTime, friendlyError, linkButton, primaryButton, useData } from "@/components/erp/ui";

export const CATEGORIES = ["GENERAL", "ACADEMIC", "EXAM", "EVENT", "HOLIDAY", "FINANCE", "URGENT"];
export const AUDIENCES = [["ALL", "Everyone"], ["STUDENTS", "Students"], ["GUARDIANS", "Guardians"], ["TEACHERS", "Teachers"], ["STAFF", "Staff"]];
const audienceName = (value) => AUDIENCES.find(([key]) => key === value)?.[1] || value;

const STATUS_STYLES = { DRAFT: "bg-slate-100 text-slate-700", PUBLISHED: "bg-green-100 text-green-700", ARCHIVED: "bg-slate-200 text-slate-500" };

// Whether a published notice is showing right now, waiting for its start, or past its end.
export const liveState = (notice) => {
  if (notice.status !== "PUBLISHED") return label(notice.status);
  const now = Date.now();
  if (notice.publishAt && Date.parse(notice.publishAt) > now) return "Scheduled";
  if (notice.expiresAt && Date.parse(notice.expiresAt) <= now) return "Expired";
  return "Showing";
};

const fields = (display) => [
  { name: "title", label: "Title *", wide: true },
  { name: "body", label: "Message *", type: "textarea" },
  { name: "category", label: "Category", type: "select", noBlank: true, options: CATEGORIES.map((c) => [c, label(c)]) },
  { name: "audience", label: "Who sees it", type: "select", noBlank: true, options: AUDIENCES },
  { name: "display", label: "Show as", type: "select", noBlank: true, disabled: Boolean(display), options: [["BOARD", "Notice board"], ["POPUP", "Pop-up when they sign in"]] },
  { name: "isPinned", label: "Pin to the top" },
  { name: "publishAt", label: "Show from (optional)", type: "datetime-local" },
  { name: "expiresAt", label: "Show until (optional)", type: "datetime-local" },
].map((field) => (field.name === "isPinned" ? { ...field, type: "checkbox" } : field));

export function NoticeView({ notice, onClose }) {
  return (
    <ViewModal title={notice.title} onClose={onClose}>
      <p className="text-xs text-slate-500">{label(notice.category)} · {audienceName(notice.audience)} · {formatDateTime(notice.publishAt || notice.publishedAt || notice.createdAt)}</p>
      <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{notice.body}</p>
    </ViewModal>
  );
}

// Writing, publishing and archiving notices. With `display`, only that kind is listed and created.
export default function NoticeManager({ title = "Notices", subtitle, display }) {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ status: "", search: "" });
  const load = useCallback(() => noticesApi.list(filters), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("notice.create", "notice.update", "notice.approve", "notice.delete")) return <NoAccess message="Only people who write notices can open this page. Everyone else reads them on the notice board." />;
  const rows = (data || []).filter((row) => !display || row.display === display);

  const act = async (work, text) => {
    setActionError("");
    try {
      await work();
      setNotice(text);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const save = async (body) => {
    if (!editing) return;
    const payload = { ...body, display: display || body.display };
    if (editing.notice) await noticesApi.update(editing.notice.id, payload);
    else await noticesApi.create({ ...payload, publish: editing.publish });
    setEditing(null);
    setNotice(editing.publish ? "Notice published." : "Notice saved.");
    reload();
  };

  return (
    <SystemShell title={title} subtitle={subtitle || "Write a notice, choose who sees it, then publish. Drafts are visible only here."}
      crumbs={[{ href: "/admin/notice", label: "Notice Board" }]}
      actions={can("notice.create") && (
        <>
          {can("notice.approve") && <button onClick={() => setEditing({ publish: true })} className={primaryButton}>New &amp; Publish</button>}
          <button onClick={() => setEditing({ publish: false })} className={can("notice.approve") ? "w-fit rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50" : primaryButton}>New Draft</button>
        </>
      )}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search notices" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search title or message" className={`${filterClass} min-w-[16rem]`} />
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="">Any status</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
        </select>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Title", "Audience", "Category", "Shown", "Status", "Updated", "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="No notices yet.">
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="px-4 py-3"><button onClick={() => setViewing(row)} className="text-left font-medium text-slate-800 hover:text-blue-700">{row.isPinned ? "📌 " : ""}{row.title}</button>
                <span className="block text-xs text-slate-500">{row.display === "POPUP" ? "Pop-up" : "Board"}{row.emailedCount ? ` · emailed to ${row.emailedCount}` : ""}</span></td>
              <td className="px-4 py-3">{audienceName(row.audience)}</td>
              <td className="px-4 py-3">{label(row.category)}</td>
              <td className="px-4 py-3 text-xs">{row.publishAt ? `from ${formatDateTime(row.publishAt)}` : "now"}{row.expiresAt ? <span className="block">until {formatDateTime(row.expiresAt)}</span> : ""}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[row.status]}`}>{liveState(row)}</span></td>
              <td className="px-4 py-3 text-xs">{formatDateTime(row.updatedAt)}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  {can("notice.update") && <button onClick={() => setEditing({ notice: row })} className={linkButton} aria-label={`Edit ${row.title}`}>Edit</button>}
                  {can("notice.approve") && row.status !== "PUBLISHED" && <button onClick={() => act(() => noticesApi.publish(row.id), "Notice published.")} className={linkButton}>Publish</button>}
                  {can("notice.approve") && row.status === "PUBLISHED" && <button onClick={() => act(() => noticesApi.archive(row.id), "Notice archived.")} className={linkButton}>Archive</button>}
                  {can("notice.delete") && <button onClick={() => window.confirm(`Delete "${row.title}"?`) && act(() => noticesApi.remove(row.id), "Notice deleted.")} className={dangerButton} aria-label={`Delete ${row.title}`}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {editing && (
        <QuickForm title={editing.notice ? "Edit Notice" : editing.publish ? "New Notice (publish now)" : "New Draft"} fields={fields(display)} onSubmit={save} onClose={() => setEditing(null)}
          submitLabel={editing.publish ? "Publish" : "Save"}
          initial={editing.notice
            ? { ...editing.notice, publishAt: toLocalInput(editing.notice.publishAt), expiresAt: toLocalInput(editing.notice.expiresAt) }
            : { category: "GENERAL", audience: "ALL", display: display || "BOARD" }} />
      )}
      {viewing && <NoticeView notice={viewing} onClose={() => setViewing(null)} />}
    </SystemShell>
  );
}
