"use client";

import Link from "next/link";
import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  AllocationForm,
  AssignSeatForm,
  EditAllocationForm,
  RejectForm,
  VacateForm,
} from "./AllocationForms";
import { downloadCsv } from "./hostelExport";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  Pager,
  StatGrid,
  StatusBadge,
  dangerButton,
  filterClass,
  formatDateTime,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelAction,
  useHostelData,
  usePagination,
} from "./hostelUi";

const STATUSES = ["Pending", "Allocated", "Rejected", "Vacated"];

export const ALLOCATION_CSV_COLUMNS = [
  { label: "Student ID", value: (item) => item.studentId },
  { label: "Student Name", value: (item) => item.studentName },
  { label: "Department", value: (item) => item.department },
  { label: "Guardian Phone", value: (item) => item.guardianPhone },
  { label: "Preferred Hostel", value: (item) => item.preferredHostel },
  { label: "Status", value: (item) => item.status },
  { label: "Room", value: (item) => item.roomLabel },
  { label: "Seat", value: (item) => item.seatNumber },
  { label: "Allocated At", value: (item) => formatDateTime(item.allocatedAt) },
  { label: "Vacated At", value: (item) => formatDateTime(item.vacatedAt) },
  { label: "Reject Reason", value: (item) => item.rejectReason },
];

const loadPage = async () => {
  const [allocations, seats] = await Promise.all([
    hostelService.getAllocations(),
    hostelService.getSeats(),
  ]);
  return { allocations, seats };
};

export default function AllocationManagement() {
  const { has } = useHostelPermissions();
  const canManage = has("manage_allocations");
  const { data, error: loadError, isLoading, reload } = useHostelData(loadPage);
  const { error: actionError, clearError, run } = useHostelAction(reload);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [form, setForm] = useState(null);

  const allocations = data?.allocations || [];
  const seats = data?.seats || [];
  const hostelNames = [...new Set(seats.map((seat) => seat.hostelName))].sort();

  const countOf = (status) => allocations.filter((item) => item.status === status).length;
  const stats = [
    { label: "Total Records", value: allocations.length },
    { label: "Pending", value: countOf("Pending"), color: "text-yellow-600" },
    { label: "Allocated", value: countOf("Allocated"), color: "text-green-600" },
    { label: "Rejected", value: countOf("Rejected"), color: "text-red-600" },
    { label: "Vacated", value: countOf("Vacated"), color: "text-slate-600" },
  ];

  const query = search.trim().toLowerCase();
  const filtered = allocations.filter(
    (item) =>
      [item.studentId, item.studentName, item.department, item.roomLabel]
        .join(" ")
        .toLowerCase()
        .includes(query) &&
      (statusFilter === "All" || item.status === statusFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered);

  const handleSaved = () => {
    setForm(null);
    reload();
  };

  const handleDelete = (item) => {
    if (window.confirm(`Delete the application of ${item.studentName}? This cannot be undone.`)) {
      run(() => hostelService.deleteAllocation(item.id));
    }
  };

  return (
    <PageShell
      title="Student Allocation"
      subtitle="Review applications, assign seats, transfer students and record check-outs."
      actions={
        <>
          <button
            onClick={() => downloadCsv("hostel-allocations.csv", ALLOCATION_CSV_COLUMNS, filtered)}
            disabled={filtered.length === 0}
            className={`${secondaryButton} disabled:opacity-50`}
          >
            Export CSV
          </button>
          {canManage && (
            <button onClick={() => setForm({ type: "new" })} className={primaryButton}>
              + New Application
            </button>
          )}
        </>
      }
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      <ErrorBanner message={actionError} onDismiss={clearError} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            aria-label="Search allocations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by student, ID, department, room..."
            className={`w-full md:max-w-md ${filterClass}`}
          />
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          columns={["Student", "Department", "Room / Seat", "Rent", "Applied", "Status", "Action"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={allocations.length === 0 ? "No applications yet." : "No records match your search."}
          minWidth="min-w-[960px]"
        >
          {pageItems.map((item) => (
            <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-4">
                <p className="font-medium text-slate-800">{item.studentName}</p>
                <p className="text-xs text-slate-500">{item.studentId}</p>
              </td>
              <td className="px-4 py-4 text-slate-600">{item.department || "—"}</td>
              <td className="px-4 py-4 text-slate-600">
                {item.seatNumber ? (
                  <>
                    <p>Seat {item.seatNumber}</p>
                    <p className="text-xs text-slate-500">{item.roomLabel}</p>
                  </>
                ) : (
                  "—"
                )}
                {item.rejectReason && (
                  <p className="text-xs text-red-600">Reason: {item.rejectReason}</p>
                )}
              </td>
              <td className="px-4 py-4 tabular-nums text-slate-600">
                {item.monthlyRent ? money(item.monthlyRent) : "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                {formatDateTime(item.createdAt)}
              </td>
              <td className="px-4 py-4">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {["Allocated", "Vacated"].includes(item.status) && has("view_due_rent", "manage_payments") && (
                    <Link href={`/admin/hostel/ledger/${item.id}`} className={linkButton} aria-label={`Rent record of ${item.studentName}`}>
                      Rent
                    </Link>
                  )}
                  {item.status === "Pending" && (
                    <button onClick={() => setForm({ type: "assign", item })} className={linkButton} aria-label={`Assign seat to ${item.studentName}`}>
                      Assign Seat
                    </button>
                  )}
                  {item.status === "Allocated" && (
                    <>
                      <button onClick={() => setForm({ type: "assign", item })} className={linkButton} aria-label={`Transfer ${item.studentName}`}>
                        Transfer
                      </button>
                      <button onClick={() => setForm({ type: "vacate", item })} className={dangerButton} aria-label={`Vacate ${item.studentName}`}>
                        Vacate
                      </button>
                    </>
                  )}
                  {(item.status === "Pending" || item.status === "Allocated") && (
                    <button onClick={() => setForm({ type: "edit", item })} className={linkButton} aria-label={`Edit ${item.studentName}`}>
                      Edit
                    </button>
                  )}
                  {item.status === "Pending" && (
                    <button onClick={() => setForm({ type: "reject", item })} className={dangerButton} aria-label={`Reject ${item.studentName}`}>
                      Reject
                    </button>
                  )}
                  {(item.status === "Pending" || item.status === "Rejected") && (
                    <button onClick={() => handleDelete(item)} className={dangerButton} aria-label={`Delete ${item.studentName}`}>
                      Delete
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>

      {form?.type === "edit" && (
        <EditAllocationForm
          allocationId={form.item.id}
          hostelNames={hostelNames}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "vacate" && (
        <VacateForm
          studentName={form.item.studentName}
          allocationId={form.item.id}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "new" && (
        <AllocationForm
          seats={seats}
          hostelNames={hostelNames}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "assign" && (
        <AssignSeatForm
          allocation={form.item}
          seats={seats}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "reject" && (
        <RejectForm allocation={form.item} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
    </PageShell>
  );
}
