"use client";

import { useCallback, useState } from "react";
import { libraryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, filterClass, friendlyError, linkButton, primaryButton, useData } from "@/components/erp/ui";

const FIELDS = [
  { name: "title", label: "Title *", wide: true },
  { name: "author", label: "Author" },
  { name: "isbn", label: "ISBN (10 or 13 digits)" },
  { name: "publisher", label: "Publisher" },
  { name: "edition", label: "Edition" },
  { name: "category", label: "Category" },
  { name: "shelf", label: "Shelf / location" },
  { name: "totalCopies", label: "Copies *", type: "number", min: 0 },
];

export default function BooksPage() {
  const { can, isReady } = useMe();
  const [search, setSearch] = useState("");
  const load = useCallback(() => libraryApi.books({ search }), [search]);
  const { data, error, isLoading, reload } = useData(load);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("library.read")) return <NoAccess />;
  const rows = data || [];

  const save = async (body) => {
    if (!editing) return;
    if (editing.book) await libraryApi.updateBook(editing.book.id, body);
    else await libraryApi.createBook(body);
    setEditing(null);
    setNotice("Book saved.");
    reload();
  };

  const remove = async (book) => {
    if (!window.confirm(`Delete "${book.title}"?`)) return;
    setActionError("");
    try {
      await libraryApi.removeBook(book.id);
      setNotice("Book deleted.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Books" subtitle="The catalogue. Available copies drop while books are on loan." crumbs={[{ href: "/admin/library", label: "Library" }]}
      actions={can("library.create") && <button onClick={() => setEditing({})} className={primaryButton}>Add Book</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <input aria-label="Search books" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, author or ISBN" className={`${filterClass} min-w-[18rem]`} />
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Title", "Author", "ISBN", "Category", "Shelf", "Copies", "Available", "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage={search ? "No books match." : "No books yet."}>
          {rows.map((book) => (
            <tr key={book.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{book.title}{book.edition && <span className="block text-xs text-slate-500">{book.edition}</span>}</td>
              <td className="px-4 py-3">{book.author || "—"}</td>
              <td className="px-4 py-3 font-mono text-xs">{book.isbn || "—"}</td>
              <td className="px-4 py-3">{book.category || "—"}</td>
              <td className="px-4 py-3">{book.shelf || "—"}</td>
              <td className="px-4 py-3">{book.totalCopies}</td>
              <td className={`px-4 py-3 font-medium ${book.available > 0 ? "text-green-700" : "text-red-600"}`}>{book.available}</td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  {can("library.update") && <button onClick={() => setEditing({ book })} className={linkButton} aria-label={`Edit ${book.title}`}>Edit</button>}
                  {can("library.delete") && <button onClick={() => remove(book)} className={dangerButton} aria-label={`Delete ${book.title}`}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {editing && <QuickForm title={editing.book ? "Edit Book" : "Add Book"} fields={FIELDS} initial={editing.book || { totalCopies: 1 }} onSubmit={save} onClose={() => setEditing(null)} />}
    </SystemShell>
  );
}
