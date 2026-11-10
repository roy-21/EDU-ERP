"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { downloadCsv } from "./hostelExport";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  Pager,
  StatGrid,
  StatusBadge,
  filterClass,
  formatMonth,
  friendlyError,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelData,
  usePagination,
} from "./hostelUi";

const CSV_COLUMNS = [
  { label: "Student Name", value: (row) => row.studentName },
  { label: "Student ID", value: (row) => row.studentId },
  { label: "Student Phone", value: (row) => row.studentPhone },
  { label: "Student Email", value: (row) => row.studentEmail },
  { label: "Building", value: (row) => `${row.hostelName} - ${row.buildingName}` },
  { label: "Room", value: (row) => row.roomNumber },
  { label: "Seat", value: (row) => row.seatNumber },
  { label: "Billing Month", value: (row) => row.billingMonth.slice(0, 7) },
  { label: "Monthly Rent", value: (row) => row.rentAmount },
  { label: "Total Payable", value: (row) => row.totalPayable },
  { label: "Amount Paid", value: (row) => row.paidAmount },
  { label: "Outstanding", value: (row) => row.outstandingAmount },
  { label: "Due Date", value: (row) => row.dueDate },
  { label: "Overdue Days", value: (row) => row.overdueDays },
  { label: "Payment Status", value: (row) => (row.paidAmount > 0 ? "Overdue (Partially Paid)" : "Overdue (Unpaid)") },
];

const reminderMessage = (result) => {
  if (result.alreadySentToday) {
    return "A manual reminder was already sent to this student today.";
  }
  const parts = result.channels.map((item) => {
    const name = { IN_APP: "In-app", EMAIL: "Email", SMS: "SMS" }[item.channel];
    return `${name}: ${item.status}${item.error ? ` (${item.error})` : ""}`;
  });
  return `Reminder result. ${parts.join(". ")}`;
};

export default function DueRentManagement() {
  const { has } = useHostelPermissions();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    buildingId: "",
    room: "",
    month: "",
    dueOn: "",
    paymentState: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const deferredSearch = useDeferredValue(search);

  const params = { ...filters, q: deferredSearch.trim() };
  const paramKey = JSON.stringify(params);

  const load = useCallback(
    () => hostelService.getDueRent(JSON.parse(paramKey)),
    [paramKey]
  );
  const { data, error: loadError, isLoading, reload } = useHostelData(load);

  const rows = data?.rows || [];
  const count = data?.count;
  const options = data?.filterOptions;
  const [view, setView] = useState("invoice");
  const students = Object.values(
    rows.reduce((groups, row) => {
      const group = groups[row.allocationId] || {
        allocationId: row.allocationId,
        studentName: row.studentName,
        studentId: row.studentId,
        roomNumber: row.roomNumber,
        seatNumber: row.seatNumber,
        invoices: 0,
        cents: 0,
        oldestDue: row.dueDate,
        overdueDays: 0,
      };
      group.invoices += 1;
      group.cents += Math.round(row.outstandingAmount * 100);
      if (row.dueDate < group.oldestDue) group.oldestDue = row.dueDate;
      group.overdueDays = Math.max(group.overdueDays, row.overdueDays);
      groups[row.allocationId] = group;
      return groups;
    }, {})
  );
  const { pageItems, pagerProps } = usePagination(rows);

  const setFilter = (key) => (event) =>
    setFilters((previous) => ({ ...previous, [key]: event.target.value }));

  const stats = [
    { label: "Students With Due Rent", value: count?.students ?? 0, color: "text-red-600" },
    { label: "Overdue Invoices", value: count?.invoices ?? 0, color: "text-orange-600" },
    { label: "Total Overdue", value: money(count?.totalOutstanding), color: "text-red-600" },
    { label: "Showing", value: rows.length },
  ];

  const handleExport = async () => {
    setError("");
    try {
      const exported = await hostelService.exportDueRent(params);
      downloadCsv("hostel-due-rent.csv", CSV_COLUMNS, exported);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const handleRemind = async (row) => {
    setError("");
    setNotice("");
    try {
      const result = await hostelService.sendReminder(row.allocationId);
      setNotice(`${row.studentName}: ${reminderMessage(result)}`);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <PageShell
      title={`Due Rent (${count?.students ?? 0})`}
      subtitle="Students whose due date has passed with money still owed."
      actions={
        has("export_reports") && (
          <button
            onClick={handleExport}
            disabled={rows.length === 0}
            className={`${secondaryButton} disabled:opacity-50`}
          >
            Export CSV
          </button>
        )
      }
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      <ErrorBanner message={error} onDismiss={() => setError("")} />
      {notice && (
        <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          {notice}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col flex-wrap gap-3 md:flex-row">
          <input
            type="text"
            aria-label="Search due rent"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by student name or ID..."
            className={`w-full md:max-w-xs ${filterClass}`}
          />
          <select aria-label="Filter by building" value={filters.buildingId} onChange={setFilter("buildingId")} className={filterClass}>
            <option value="">All Buildings</option>
            {options?.buildings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select aria-label="Filter by room" value={filters.room} onChange={setFilter("room")} className={filterClass}>
            <option value="">All Rooms</option>
            {options?.rooms.map((room) => (
              <option key={room} value={room}>
                Room {room}
              </option>
            ))}
          </select>
          <select aria-label="Filter by month" value={filters.month} onChange={setFilter("month")} className={filterClass}>
            <option value="">All Months</option>
            {options?.months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Filter by due date"
            value={filters.dueOn}
            onChange={setFilter("dueOn")}
            className={filterClass}
          />
          <select aria-label="Filter by payment status" value={filters.paymentState} onChange={setFilter("paymentState")} className={filterClass}>
            <option value="">All Payment Status</option>
            <option value="Unpaid">Overdue, nothing paid</option>
            <option value="Partially Paid">Overdue, partly paid</option>
          </select>
        </div>

        <div role="group" aria-label="View" className="mb-4 flex gap-2">
          {[["invoice", "By Invoice"], ["student", "By Student"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={view === value ? primaryButton : secondaryButton}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "student" && (
          <DataTable
            columns={["Student", "Room / Seat", "Overdue Invoices", "Outstanding", "Oldest Due Date", "Action"]}
            isLoading={isLoading && !data}
            loadError={loadError}
            onRetry={reload}
            hasRows={students.length > 0}
            emptyMessage={count?.invoices === 0 ? "No overdue rent. Everyone is up to date." : "No records match your filters."}
            minWidth="min-w-[760px]"
          >
            {students.map((row) => (
              <tr key={row.allocationId} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-4">
                  <p className="font-medium text-slate-800">{row.studentName}</p>
                  <p className="text-xs text-slate-500">{row.studentId}</p>
                </td>
                <td className="px-4 py-4 text-slate-600">Room {row.roomNumber || "—"} · Seat {row.seatNumber ?? "—"}</td>
                <td className="px-4 py-4 text-slate-600">{row.invoices}</td>
                <td className="px-4 py-4 font-medium tabular-nums text-red-700">{money(row.cents / 100)}</td>
                <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                  {row.oldestDue}
                  <p className="text-xs text-red-600">{row.overdueDays} day(s) late</p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex gap-3 whitespace-nowrap">
                    <Link href={`/admin/hostel/ledger/${row.allocationId}`} className={linkButton}>
                      Invoices &amp; Payments
                    </Link>
                    {has("send_reminders") && (
                      <button onClick={() => handleRemind(row)} aria-label={`Send reminder to ${row.studentName}`} className={linkButton}>
                        Remind
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        {view === "invoice" && (
        <>
        <DataTable
          columns={["Student", "Contact", "Room / Seat", "Month", "Rent", "Total Payable", "Paid", "Outstanding", "Due Date", "Status", "Action"]}
          isLoading={isLoading && !data}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={count?.invoices === 0 ? "No overdue rent. Everyone is up to date." : "No records match your filters."}
          minWidth="min-w-[1180px]"
        >
          {pageItems.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-4">
                <p className="font-medium text-slate-800">{row.studentName}</p>
                <p className="text-xs text-slate-500">{row.studentId}</p>
              </td>
              <td className="px-4 py-4 text-slate-600">
                <p>{row.studentPhone || "—"}</p>
                <p className="text-xs text-slate-500">{row.studentEmail || "—"}</p>
              </td>
              <td className="px-4 py-4 text-slate-600">
                <p>
                  Room {row.roomNumber || "—"} · Seat {row.seatNumber ?? "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {row.hostelName} · {row.buildingName}
                </p>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatMonth(row.billingMonth)}</td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(row.rentAmount)}</td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(row.totalPayable)}</td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(row.paidAmount)}</td>
              <td className="px-4 py-4 font-medium tabular-nums text-red-700">{money(row.outstandingAmount)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                {row.dueDate}
                <p className="text-xs text-red-600">{row.overdueDays} day(s) late</p>
              </td>
              <td className="px-4 py-4">
                <StatusBadge status="Overdue" />
                {row.paidAmount > 0 && <p className="mt-1 text-xs text-slate-500">Partly paid</p>}
              </td>
              <td className="px-4 py-4">
                <div className="flex gap-3 whitespace-nowrap">
                  <Link href={`/admin/hostel/ledger/${row.allocationId}`} className={linkButton}>
                    Invoice &amp; Payments
                  </Link>
                  {has("send_reminders") && (
                    <button
                      onClick={() => handleRemind(row)}
                      aria-label={`Send reminder to ${row.studentName}`}
                      className={linkButton}
                    >
                      Remind
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
        </>
        )}
      </div>
    </PageShell>
  );
}
