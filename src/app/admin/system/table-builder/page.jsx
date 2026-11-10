"use client";
import { useState, useEffect } from "react";
import ColumnRow from "./components/ColumnRow";
import { systemService } from "@/lib/erpServices";

// নতুন কলাম যোগ করার জন্য ডিফল্ট টেমপ্লেট
const createNewColumn = () => ({
  id: `col_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  name: "",
  label: "",
  type: "String",
  isPrimaryKey: false,
  isForeignKey: false,
  fkTable: "",
  fkColumn: "",
  relation: "none",
  validation: { required: false },
  isSearchable: false,
  isSortable: false,
  isFilterable: false,
  isVisible: true,
});

export default function TableBuilderPage() {
  const [tableName, setTableName] = useState("");
  const [tableSlug, setTableSlug] = useState("");
  const [isExportable, setIsExportable] = useState(true);
  const [columns, setColumns] = useState([
    {
      id: "col_id",
      name: "id",
      label: "Record ID",
      type: "UUID",
      isPrimaryKey: true,
      isForeignKey: false,
      fkTable: "",
      fkColumn: "",
      relation: "none",
      validation: { required: true },
      isSearchable: true,
      isSortable: true,
      isFilterable: false,
      isVisible: true,
    },
    createNewColumn()
  ]);

  const [loading, setLoading] = useState(false);
  const [savedTables, setSavedTables] = useState([]);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [notification, setNotification] = useState(null);
  const [activeTab, setActiveTab] = useState("builder"); // 'builder' or 'preview'

  // Fetch saved dynamic tables on mount
  useEffect(() => {
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const res = await systemService.getTables();
      const list = Array.isArray(res) ? res : res?.data || [];
      setSavedTables(list);
    } catch (err) {
      console.error("Failed to fetch tables", err);
    }
  };

  // টেবিলের নাম থেকে অটোমেটিক স্লাগ জেনারেট করা
  const handleTableNameChange = (e) => {
    const val = e.target.value;
    setTableName(val);
    setTableSlug(val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  };

  const handleAddColumn = () => {
    setColumns([...columns, createNewColumn()]);
  };

  const handleRemoveColumn = (indexToRemove) => {
    setColumns(columns.filter((_, index) => index !== indexToRemove));
  };

  const handleUpdateColumn = (indexToUpdate, newColumnData) => {
    setColumns(columns.map((col, index) => (index === indexToUpdate ? newColumnData : col)));
  };

  // ব্যাকএন্ডে মেটাডাটা পাঠানোর লজিক
  const handleSaveSchema = async () => {
    const isValid = columns.length > 0 && columns.every(col => col.name.trim() !== "");
    if (!tableName.trim() || !isValid) {
      setNotification({
        type: "error",
        message: "Table Name and all column DB names are mandatory!"
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        tableName,
        slug: tableSlug,
        isExportable,
        columns: columns.map(col => {
          const { id, ...cleanCol } = col;
          return cleanCol;
        })
      };

      await systemService.saveTableSchema(payload);
      setNotification({
        type: "success",
        message: `Table design "${tableName}" saved for your institution. To enter records with a form and list, build it in the Feature Builder.`
      });
      fetchTables();
    } catch (err) {
      setNotification({
        type: "error",
        message: `Not saved: ${err.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTableIntoBuilder = (table) => {
    setTableName(table.tableName);
    setTableSlug(table.slug);
    setIsExportable(table.isExportable ?? true);
    if (Array.isArray(table.columns) && table.columns.length > 0) {
      setColumns(table.columns.map((col, idx) => ({
        ...col,
        id: `loaded_${idx}_${Date.now()}`
      })));
    }
    setShowSavedModal(false);
    setNotification({
      type: "info",
      message: `Table schema "${table.tableName}" loaded into builder.`
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto h-[calc(100vh-4rem)] overflow-y-auto">
      
      {/* Toast Notification */}
      {notification && (
        <div className={`mb-6 p-4 rounded-xl flex items-center justify-between text-sm shadow-sm transition-all animate-fadeIn ${
          notification.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
          notification.type === "info" ? "bg-blue-50 text-blue-800 border border-blue-200" :
          "bg-rose-50 text-rose-800 border border-rose-200"
        }`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{notification.type === "success" ? "Success:" : notification.type === "info" ? "Notice:" : "Error:"}</span>
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-indigo-100 text-indigo-700 rounded-lg text-lg font-bold">🗄️</span>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Dynamic Table Builder</h1>
              <p className="text-sm text-slate-500 mt-0.5">Design a table&apos;s columns, keys and links. Designs are saved per institution; records are kept through the Feature Builder.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSavedModal(true)}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            Registered Tables ({savedTables.length})
          </button>

          <button
            onClick={handleSaveSchema}
            disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-md flex items-center gap-2 transition-all"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
            )}
            Save Table Design
          </button>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab("builder")}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === "builder"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Schema Definition
        </button>
        <button
          onClick={() => setActiveTab("preview")}
          className={`pb-3 px-1 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "preview"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>Preview</span>
          <span className="px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-md font-mono">{columns.length} Cols</span>
        </button>
      </div>

      {activeTab === "builder" ? (
        <>
          {/* Table Meta Data Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Table Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={tableName}
                  onChange={handleTableNameChange}
                  placeholder="e.g. Student Profiles or Research Papers"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  System Slug / REST Route
                </label>
                <div className="flex items-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="text-xs text-slate-400 font-mono">/api/v1/</span>
                  <input
                    type="text"
                    value={tableSlug}
                    readOnly
                    className="w-full bg-transparent text-slate-700 font-mono text-xs outline-none ml-1 font-semibold"
                    placeholder="auto_generated_slug"
                  />
                </div>
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isExportable}
                    onChange={(e) => setIsExportable(e.target.checked)}
                    className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-800 block">Exportable Table</span>
                    <span className="text-xs text-slate-400">Allow instant CSV, Excel & PDF exports for this schema</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Columns Builder Area */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-800">Database Columns & Type Relations</h2>
              <p className="text-xs text-slate-500">Configure fields, primary/foreign keys, and data constraints</p>
            </div>
            <button
              onClick={handleAddColumn}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors border border-slate-200"
            >
              <span className="text-base leading-none font-bold text-indigo-600">+</span> Add Column
            </button>
          </div>

          {/* Rendering Columns */}
          <div className="space-y-3">
            {columns.map((col, index) => (
              <ColumnRow
                key={col.id}
                index={index}
                column={col}
                onUpdate={handleUpdateColumn}
                onRemove={handleRemoveColumn}
              />
            ))}
          </div>

          {columns.length === 0 && (
            <div className="text-center py-16 bg-white border-2 border-dashed border-slate-200 rounded-xl">
              <p className="text-slate-400 text-sm">No columns defined yet. Click "Add Column" above to start building.</p>
            </div>
          )}
        </>
      ) : (
        /* Live CRUD Table Simulation Preview */
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-800">{tableName || "Untitled Table"} — Preview</h3>
              <p className="text-xs text-slate-500">How the columns will look, with sample values only</p>
            </div>
            {isExportable && (
              <div className="flex gap-2">
                <span className="px-2.5 py-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-medium">Export: CSV</span>
                <span className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-md font-medium">Export: PDF</span>
              </div>
            )}
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-b border-slate-200">
                <tr>
                  {columns.map((c, i) => (
                    <th key={i} className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span>{c.label || c.name || `Col_${i+1}`}</span>
                        <span className="text-[10px] text-slate-400 font-mono lowercase">({c.type})</span>
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr className="hover:bg-slate-50/50">
                  {columns.map((c, i) => (
                    <td key={i} className="px-4 py-3 font-mono">
                      {c.isPrimaryKey ? "uuid-87f2e1a" : c.type === "Integer" || c.type === "Float" ? "100" : c.type === "Boolean" ? "true" : c.type === "Date" ? "2026-11-04" : "Sample " + (c.name || "val")}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <span className="text-indigo-600 hover:underline font-medium cursor-pointer mr-2">Edit</span>
                    <span className="text-rose-600 hover:underline font-medium cursor-pointer">Delete</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Saved Tables Library Drawer / Modal */}
      {showSavedModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col border border-slate-200">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Dynamic Tables Repository</h3>
                <p className="text-xs text-slate-500">Registered schemas in Core ERP Backend</p>
              </div>
              <button onClick={() => setShowSavedModal(false)} className="text-slate-400 hover:text-slate-700 text-lg font-bold">✕</button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {savedTables.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">
                  No custom tables registered yet. Create and save one above!
                </div>
              ) : (
                savedTables.map((tbl, idx) => (
                  <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 transition-all flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 text-sm">{tbl.tableName}</span>
                        <span className="text-[11px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">
                          slug: {tbl.slug}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 font-mono">
                        Columns: {Array.isArray(tbl.columns) ? tbl.columns.map(c => c.name || c.label).join(", ") : "None"}
                      </p>
                    </div>
                    <button
                      onClick={() => loadTableIntoBuilder(tbl)}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition"
                    >
                      Load into Builder
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl text-right">
              <button
                onClick={() => setShowSavedModal(false)}
                className="px-4 py-2 bg-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
