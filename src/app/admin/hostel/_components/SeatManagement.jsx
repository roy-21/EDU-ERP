"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AllocationForm, VacateForm } from "./AllocationForms";
import { Detail, ViewModal } from "./hostelViews";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  DataTable,
  FormModal,
  PageShell,
  Pager,
  StatGrid,
  StatusBadge,
  TextField,
  filterClass,
  formatDateTime,
  formatMonth,
  linkButton,
  money,
  useHostelData,
  usePagination,
} from "./hostelUi";

const STATUSES = ["Available", "Occupied", "Reserved"];

export function SeatForm({ seat, onClose, onSaved }) {
  const { has } = useHostelPermissions();
  const [monthlyFee, setMonthlyFee] = useState(String(seat.monthlyFee));
  const [reserved, setReserved] = useState(seat.reserved);
  const [dueDay, setDueDay] = useState(seat.dueDay ? String(seat.dueDay) : "");

  const handleSubmit = async () => {
    await hostelService.updateSeat(seat.id, {
      monthlyFee: Number(monthlyFee),
      reserved,
    });
    if (dueDay !== (seat.dueDay ? String(seat.dueDay) : "")) {
      await hostelService.setSeatDueDay(seat.id, dueDay === "" ? null : Number(dueDay));
    }
    onSaved();
  };

  return (
    <FormModal
      title={`Edit Seat ${seat.seatNumber}, Room ${seat.roomNumber}`}
      submitLabel="Save Seat"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <TextField
        id="seat-fee"
        label="Monthly Fee (৳), also the occupant's rent from the next uninvoiced month"
        type="number"
        min="0"
        step="0.01"
        value={monthlyFee}
        onChange={setMonthlyFee}
      />
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={reserved}
          disabled={seat.status === "Occupied"}
          onChange={(event) => setReserved(event.target.checked)}
        />
        Reserve this seat
      </label>
      {has("configure_rent") && (
        <TextField
          id="seat-due-day"
          label="Rent Due Day (1 to 31)"
          type="number"
          min="1"
          max="31"
          value={dueDay}
          placeholder={seat.buildingDueDay ? `Uses building: ${seat.buildingDueDay}` : "Uses global default"}
          onChange={setDueDay}
        />
      )}
    </FormModal>
  );
}

// The seat's fee and the student's contract rent, changed through one service.
export function SeatRentForm({ seat, onClose, onSaved }) {
  const load = useCallback(() => hostelService.getSeatRent(seat.id), [seat.id]);
  const { data, error } = useHostelData(load);
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState("");

  const contract = data?.contract;
  const handleSubmit = async () => {
    if (amount === "" || !(Number(amount) >= 0)) throw new Error("Enter the new monthly rent.");
    await hostelService.setSeatRent(seat.id, { monthlyFee: Number(amount), effectiveMonth: month || undefined });
    onSaved();
  };

  return (
    <FormModal title={`Rent: Seat ${seat.seatNumber}, Room ${seat.roomNumber}`} submitLabel="Change Rent" onSubmit={handleSubmit} onClose={onClose}>
      {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500 sm:col-span-2">Loading...</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4 sm:col-span-2">
            <Detail label="Seat Fee (default for the next student)" value={money(data.seatFee)} />
            <Detail label="Student" value={contract ? `${contract.studentName} (${contract.studentId})` : "Vacant"} />
            {contract && <Detail label="Rent This Month" value={money(contract.currentRent)} />}
            {contract && (
              <Detail
                label="Next Change"
                value={contract.nextRent ? `${money(contract.nextRent.rent)} from ${formatMonth(contract.nextRent.effectiveMonth)}` : "None scheduled"}
              />
            )}
          </div>
          <TextField id="seat-rent-amount" label="New Monthly Rent (৳) *" type="number" min="0" step="0.01" value={amount} onChange={setAmount} placeholder={String(data.seatFee)} />
          {contract && (
            <TextField
              id="seat-rent-month"
              label={`Effective From (earliest ${formatMonth(contract.earliestChangeMonth)})`}
              type="month"
              min={contract.earliestChangeMonth.slice(0, 7)}
              value={month}
              onChange={setMonth}
            />
          )}
          <p className="text-xs text-slate-500 sm:col-span-2">
            {contract
              ? "The student's rent and the seat fee change together. Months already invoiced are not changed."
              : "This becomes the default rent for the next student on this seat."}
          </p>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-semibold text-slate-700">Rent History</p>
            <DataTable columns={["When", "From", "To", "Effective", "Changed In", "By"]} hasRows={data.history.length > 0} emptyMessage="No changes yet." minWidth="min-w-[560px]">
              {data.history.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatDateTime(item.createdAt)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{item.oldAmount === null ? "—" : money(item.oldAmount)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-800">{money(item.newAmount)}</td>
                  <td className="px-3 py-2 text-slate-600">{item.effectiveMonth ? formatMonth(item.effectiveMonth) : "Next student"}</td>
                  <td className="px-3 py-2 text-slate-600">{{ SEAT: "Seat", ALLOCATION: "Allocation", ALLOCATED: "New allocation" }[item.source]}</td>
                  <td className="px-3 py-2 text-slate-600">{item.changedBy}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </FormModal>
  );
}

function SeatDetails({ seat, onClose }) {
  const { has } = useHostelPermissions();
  return (
    <ViewModal title={`Seat ${seat.seatNumber}, Room ${seat.roomNumber}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <Detail label="Hostel / Building" value={`${seat.hostelName} · ${seat.building}`} />
        <Detail label="Floor" value={seat.floor} />
        <div>
          <p className="text-xs text-slate-500">Status</p>
          <div className="mt-1 flex gap-2">
            <StatusBadge status={seat.status} />
            {seat.roomBlocked && <StatusBadge status={seat.roomClosed ? "Closed" : "Maintenance"} />}
          </div>
        </div>
        <Detail label="Seat Fee" value={money(seat.monthlyFee)} />
        <Detail label="Student" value={seat.studentName ? `${seat.studentName} (${seat.studentId})` : "Vacant"} />
        <Detail label="Student's Rent" value={seat.allocationRent === null || seat.allocationRent === undefined ? "—" : money(seat.allocationRent)} />
        <Detail label="Due Day" value={seat.dueDay ? String(seat.dueDay) : seat.buildingDueDay ? `Building: ${seat.buildingDueDay}` : "Global default"} />
      </div>
      <div className="flex gap-4 text-sm">
        <Link href={`/admin/hostel/rooms/${seat.roomId}`} className={linkButton}>Open room</Link>
        {seat.allocationId && has("view_due_rent", "manage_payments") && (
          <Link href={`/admin/hostel/ledger/${seat.allocationId}`} className={linkButton}>Open student record</Link>
        )}
      </div>
    </ViewModal>
  );
}

export default function SeatManagement() {
  const { data, error: loadError, isLoading, reload } = useHostelData(hostelService.getSeats);
  const [search, setSearch] = useState("");
  const [hostelFilter, setHostelFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [editing, setEditing] = useState(null);
  const [action, setAction] = useState(null);
  const { has } = useHostelPermissions();

  const seats = data || [];
  const hostelNames = [...new Set(seats.map((seat) => seat.hostelName))].sort();
  const countOf = (status) => seats.filter((seat) => seat.status === status).length;

  const stats = [
    { label: "Total Seats", value: seats.length },
    { label: "Available", value: countOf("Available"), color: "text-green-600" },
    { label: "Occupied", value: countOf("Occupied"), color: "text-blue-600" },
    { label: "Reserved", value: countOf("Reserved"), color: "text-purple-600" },
    {
      label: "In Closed / Maintenance",
      value: seats.filter((seat) => seat.roomBlocked).length,
      color: "text-orange-600",
    },
  ];

  const query = search.trim().toLowerCase();
  const filtered = seats.filter(
    (seat) =>
      [seat.roomNumber, seat.hostelName, seat.building, seat.studentName, seat.studentId]
        .join(" ")
        .toLowerCase()
        .includes(query) &&
      (hostelFilter === "All" || seat.hostelName === hostelFilter) &&
      (statusFilter === "All" || seat.status === statusFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered);

  return (
    <PageShell
      title="Seat Management"
      subtitle="Allocate, change rent or free a seat here. A seat's fee and its student's rent always match."
    >
      <StatGrid stats={stats} isLoading={isLoading} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            aria-label="Search seats"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by room, hostel, student..."
            className={`w-full md:max-w-md ${filterClass}`}
          />
          <select
            aria-label="Filter by hostel"
            value={hostelFilter}
            onChange={(event) => setHostelFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Hostels</option>
            {hostelNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
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
          columns={["Seat", "Room", "Hostel / Building", "Student", "Monthly Fee", "Status", "Action"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={seats.length === 0 ? "No seats yet. Add a room first." : "No seats match your search."}
        >
          {pageItems.map((seat) => (
            <tr key={seat.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-4 font-medium text-slate-800">Seat {seat.seatNumber}</td>
              <td className="px-4 py-4">
                <Link href={`/admin/hostel/rooms/${seat.roomId}`} className={linkButton}>
                  {seat.roomNumber}
                </Link>
              </td>
              <td className="px-4 py-4 text-slate-600">
                {seat.hostelName} · {seat.building}
              </td>
              <td className="px-4 py-4 text-slate-600">
                {seat.studentName ? (
                  <>
                    <p>{seat.studentName}</p>
                    <p className="text-xs text-slate-500">{seat.studentId}</p>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(seat.monthlyFee)}</td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={seat.status} />
                  {seat.roomBlocked && (
                    <StatusBadge status={seat.roomClosed ? "Closed" : "Maintenance"} />
                  )}
                </div>
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap gap-3 whitespace-nowrap">
                  <button onClick={() => setAction({ type: "view", seat })} aria-label={`View seat ${seat.seatNumber} in room ${seat.roomNumber}`} className={linkButton}>
                    View
                  </button>
                  {has("manage_rooms") && (
                    <button onClick={() => setEditing(seat)} aria-label={`Edit seat ${seat.seatNumber} in room ${seat.roomNumber}`} className={linkButton}>
                      Edit
                    </button>
                  )}
                  {has("manage_rooms", "manage_allocations") && (
                    <button onClick={() => setAction({ type: "rent", seat })} aria-label={`Rent for seat ${seat.seatNumber} in room ${seat.roomNumber}`} className={linkButton}>
                      Rent
                    </button>
                  )}
                  {has("manage_allocations") && seat.status !== "Occupied" && !seat.roomBlocked && (
                    <button onClick={() => setAction({ type: "allocate", seat })} aria-label={`Allocate seat ${seat.seatNumber} in room ${seat.roomNumber}`} className={linkButton}>
                      Allocate
                    </button>
                  )}
                  {has("manage_allocations") && seat.allocationId && (
                    <button onClick={() => setAction({ type: "vacate", seat })} aria-label={`Vacate seat ${seat.seatNumber} in room ${seat.roomNumber}`} className="font-medium text-red-600 hover:text-red-800">
                      Vacate
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>

      {action?.type === "view" && <SeatDetails seat={action.seat} onClose={() => setAction(null)} />}
      {action?.type === "rent" && (
        <SeatRentForm seat={action.seat} onClose={() => setAction(null)} onSaved={() => { setAction(null); reload(); }} />
      )}
      {action?.type === "allocate" && (
        <AllocationForm
          fixedSeat={action.seat}
          seats={seats}
          hostelNames={hostelNames}
          onClose={() => setAction(null)}
          onSaved={() => { setAction(null); reload(); }}
        />
      )}
      {action?.type === "vacate" && (
        <VacateForm
          studentName={action.seat.studentName}
          allocationId={action.seat.allocationId}
          onClose={() => setAction(null)}
          onSaved={() => { setAction(null); reload(); }}
        />
      )}
      {editing && (
        <SeatForm
          seat={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </PageShell>
  );
}
