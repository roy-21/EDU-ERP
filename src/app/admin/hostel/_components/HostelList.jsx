
"use client";

import { useMemo, useState } from "react";
import FeatureNotice from "./FeatureNotice";
import { useHostelBoard } from "./hostelStore";

const statusStyles = {
  Pending: "bg-yellow-100 text-yellow-700",
  Published: "bg-green-100 text-green-700",
  Draft: "bg-slate-100 text-slate-700",
  "Checked In": "bg-blue-100 text-blue-700",
  "Checked Out": "bg-slate-100 text-slate-700",
  Paid: "bg-green-100 text-green-700",
  Due: "bg-red-100 text-red-700",
  Processing: "bg-blue-100 text-blue-700",
};

const statusOptions = {
  meals: ["Draft", "Published"],
  visitors: ["Pending", "Checked In", "Checked Out"],
  fees: ["Pending", "Processing", "Paid", "Due"],
};

const money = (value) =>
  `৳${Number(value || 0).toLocaleString("en-BD")}`;

export default function HostelList({ config }) {
  const board = useHostelBoard();
  const [records, setRecords] = useState(config.records);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selected, setSelected] = useState(null);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const searchText = [
        record.id,
        record.title,
        record.category,
        record.description,
        record.studentId,
        record.student,
        record.room,
        record.hostel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = searchText.includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === "All" || record.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [records, search, statusFilter]);

  const updateStatus = (id, status) => {
    setRecords((previous) =>
      previous.map((record) =>
        record.id === id ? { ...record, status } : record
      )
    );

    setSelected((previous) =>
      previous?.id === id ? { ...previous, status } : previous
    );
  };

  const total = records.length;
  const activeCount = records.filter((item) =>
    ["Published", "Checked In", "Paid"].includes(
      item.status
    )
  ).length;
  const pendingCount = records.filter((item) =>
    ["Pending", "Draft", "Processing", "Due"].includes(
      item.status
    )
  ).length;

  const getPrimaryInfo = (record) => {
    if (config.type === "fees") {
      return money(record.amount);
    }

    if (config.type === "meals") {
      return record.servingTime || "N/A";
    }

    if (config.type === "visitors") {
      return record.student || "N/A";
    }

    return "—";
  };

  const renderDetails = (record) => {
    const excluded = [
      "id",
      "title",
      "category",
      "date",
      "status",
      "description",
    ];

    return Object.entries(record).filter(
      ([key, value]) => !excluded.includes(key) && value !== undefined
    );
  };

  if (board?.disabledBuiltIns.includes(config.type)) {
    return (
      <FeatureNotice
        title={`${config.title} is turned off`}
        message="A super admin can turn this feature back on from the control board."
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <a href="/admin" className="hover:text-blue-600">
              Admin
            </a>
            <span>/</span>
            <a href="/admin/hostel" className="hover:text-blue-600">
              Hostel Management
            </a>
            <span>/</span>
            <span className="text-slate-700">{config.title}</span>
          </div>

          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">
                {config.title}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {config.subtitle}
              </p>
            </div>

            <button
              onClick={() =>
                alert("Create form can be connected with the backend later.")
              }
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add New Record
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Total Records</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-800">
              {total}
            </h2>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Active Records</p>
            <h2 className="mt-2 text-2xl font-bold text-green-600">
              {activeCount}
            </h2>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Pending / Attention</p>
            <h2 className="mt-2 text-2xl font-bold text-orange-600">
              {pendingCount}
            </h2>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, ID, room..."
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 md:max-w-md"
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
            >
              <option value="All">All Status</option>
              {statusOptions[config.type]?.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Name / Title</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>

              <tbody>
                {filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-4 font-medium text-blue-600">
                      {record.id}
                    </td>
                    <td className="px-4 py-4 font-medium text-slate-800">
                      {record.title}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {record.category}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {getPrimaryInfo(record)}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {record.date}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          statusStyles[record.status] ||
                          "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => setSelected(record)}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan="7"
                      className="px-4 py-10 text-center text-slate-500"
                    >
                      No records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  Record Details
                </h2>
                <p className="text-sm text-slate-500">{selected.id}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Name / Title</p>
                <p className="mt-1 font-medium text-slate-800">
                  {selected.title}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Category</p>
                <p className="mt-1 font-medium text-slate-800">
                  {selected.category}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Date</p>
                <p className="mt-1 font-medium text-slate-800">
                  {selected.date}
                </p>
              </div>

              {renderDetails(selected).map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs capitalize text-slate-500">
                    {key.replace(/([A-Z])/g, " $1")}
                  </p>
                  <p className="mt-1 break-words font-medium text-slate-800">
                    {typeof value === "number" && key.toLowerCase().includes("fee")
                      ? money(value)
                      : String(value)}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-1 text-xs text-slate-500">Description</p>
              <p className="text-sm text-slate-700">
                {selected.description}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium text-slate-700">
                Update Status:
              </label>
              <select
                value={selected.status}
                onChange={(event) =>
                  updateStatus(selected.id, event.target.value)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                {statusOptions[config.type]?.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
