"use client";

import Link from "next/link";
import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { downloadCsv } from "./hostelExport";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { BulkRoomForm, ROOM_TYPES, RoomForm } from "./RoomForms";
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
  friendlyError,
  inputClass,
  linkButton,
  primaryButton,
  secondaryButton,
  useHostelAction,
  useHostelData,
  usePagination,
} from "./hostelUi";

const STATUSES = ["Available", "Occupied", "Maintenance", "Closed"];

const CSV_COLUMNS = [
  { label: "Hostel", value: (room) => room.hostelName },
  { label: "Building", value: (room) => room.building },
  { label: "Floor", value: (room) => room.floor },
  { label: "Room Number", value: (room) => room.roomNumber },
  { label: "Room Type", value: (room) => ROOM_TYPES[room.roomType] },
  { label: "Capacity", value: (room) => room.capacity },
  { label: "Occupied", value: (room) => room.occupied },
  { label: "Reserved", value: (room) => room.reserved },
  { label: "Free", value: (room) => room.capacity - room.occupied - room.reserved },
  { label: "Facilities", value: (room) => room.facilities.join("; ") },
  { label: "Status", value: (room) => room.status },
  { label: "Notes", value: (room) => room.notes },
];

function RoomDetailsModal({ room: initialRoom, canManage, onClose, onStatusChanged }) {
  const [room, setRoom] = useState(initialRoom);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const handleStatusChange = async (event) => {
    setIsSaving(true);
    setError("");

    try {
      setRoom(await hostelService.setRoomStatus(room.id, event.target.value));
      onStatusChanged();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const isFull = room.occupied >= room.capacity;
  const details = [
    ["Hostel", room.hostelName],
    ["Building", room.building],
    ["Floor", room.floor],
    ["Room Type", ROOM_TYPES[room.roomType]],
    ["Capacity", `${room.capacity} seat(s)`],
    ["Occupied", room.occupied],
    ["Reserved", room.reserved],
    ["Free", room.capacity - room.occupied - room.reserved],
    ["Open Tickets", room.openTickets],
    ["Last Updated", formatDateTime(room.updatedAt)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-details-title"
        className="my-4 w-full max-w-2xl rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-5">
          <h2 id="room-details-title" className="text-lg font-bold text-slate-800">
            Room {room.roomNumber}
          </h2>
          <StatusBadge status={room.status} />
        </div>

        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-1 break-words text-sm font-medium text-slate-800">{value}</dd>
              </div>
            ))}
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-slate-500">Facilities</dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">
                {room.facilities.join(", ") || "—"}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-slate-500">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-800">
                {room.notes || "—"}
              </dd>
            </div>
          </dl>

          {canManage && (
            <div className="border-t border-slate-100 pt-4">
              <label htmlFor="room-status" className="mb-1 block text-sm font-medium text-slate-700">
                Change Status
              </label>
              <select
                id="room-status"
                value={["Maintenance", "Closed"].includes(room.status) ? room.status : "Open"}
                disabled={isSaving}
                onChange={handleStatusChange}
                className={`${inputClass} sm:max-w-sm`}
              >
                <option value="Open" disabled={room.blockingTickets > 0}>
                  {isFull ? "Occupied (all seats taken)" : "Available"}
                </option>
                <option value="Maintenance">Maintenance</option>
                <option value="Closed">Closed</option>
              </select>

              <p className="mt-2 text-xs text-slate-500">
                New students cannot be allocated to a room in Maintenance or Closed. Students
                already there stay allocated. A closed room stays closed until you reopen it.
              </p>
              {room.blockingTickets > 0 && (
                <p className="mt-2 text-xs text-orange-700">
                  {room.blockingTickets} open ticket(s) stop this room from being Available.
                  Resolve them from Maintenance Tickets first.
                </p>
              )}
              {error && (
                <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 p-5">
          {canManage && (
            <Link
              href={`/admin/hostel/rooms/${room.id}`}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Seats & History
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoomManagement() {
  const { has } = useHostelPermissions();
  const canManage = has("manage_rooms");
  const { data, error: loadError, isLoading, reload } = useHostelData(hostelService.getRooms);
  const { error: actionError, clearError, run } = useHostelAction(reload);
  const [search, setSearch] = useState("");
  const [hostelFilter, setHostelFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [form, setForm] = useState(null);
  const [viewing, setViewing] = useState(null);

  const rooms = data || [];
  const hostelNames = [...new Set(rooms.map((room) => room.hostelName))].sort();
  const totalSeats = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const occupiedSeats = rooms.reduce((sum, room) => sum + room.occupied, 0);
  const reservedSeats = rooms.reduce((sum, room) => sum + room.reserved, 0);

  const stats = [
    { label: "Total Rooms", value: rooms.length },
    { label: "Total Seats", value: totalSeats, color: "text-indigo-600" },
    { label: "Occupied Seats", value: occupiedSeats, color: "text-blue-600" },
    { label: "Free Seats", value: totalSeats - occupiedSeats - reservedSeats, color: "text-green-600" },
    {
      label: "Maintenance / Closed",
      value: `${rooms.filter((room) => room.status === "Maintenance").length} / ${
        rooms.filter((room) => room.status === "Closed").length
      }`,
      color: "text-orange-600",
    },
  ];

  const query = search.trim().toLowerCase();
  const filteredRooms = rooms.filter(
    (room) =>
      [room.roomNumber, room.hostelName, room.building, room.floor, ...room.facilities]
        .join(" ")
        .toLowerCase()
        .includes(query) &&
      (hostelFilter === "All" || room.hostelName === hostelFilter) &&
      (statusFilter === "All" || room.status === statusFilter)
  );
  const { pageItems, pagerProps } = usePagination(filteredRooms);

  const handleDelete = (room) => {
    if (window.confirm(`Delete room ${room.roomNumber} and its seats? This cannot be undone.`)) {
      run(() => hostelService.deleteRoom(room.id));
    }
  };

  const handleSaved = () => {
    setForm(null);
    reload();
  };

  const columns = [
    "Room",
    "Hostel",
    "Building / Floor",
    "Type",
    "Seats Occupied",
    "Facilities",
    "Status",
    "Action",
  ];

  return (
    <PageShell
      title="Room Management"
      subtitle="Manage hostel buildings, floors and rooms. Seats are created from each room's capacity."
      actions={
        <>
          {has("export_reports") && (
            <button
              onClick={() => downloadCsv("hostel-rooms.csv", CSV_COLUMNS, filteredRooms)}
              disabled={filteredRooms.length === 0}
              className={`${secondaryButton} disabled:opacity-50`}
            >
              Export CSV
            </button>
          )}
          {canManage && (
            <>
              <button onClick={() => setForm({ type: "bulk" })} className={secondaryButton}>
                Bulk Add
              </button>
              <button onClick={() => setForm({ type: "room", room: null })} className={primaryButton}>
                + Add New Room
              </button>
            </>
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
            aria-label="Search rooms"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by room, hostel, building, facility..."
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
          columns={columns}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={rooms.length === 0 ? "No rooms yet." : "No rooms match your search."}
          minWidth="min-w-[1020px]"
        >
          {pageItems.map((room) => (
            <tr key={room.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-4 font-medium text-slate-800">
                {canManage ? (
                  <Link href={`/admin/hostel/rooms/${room.id}`} className="text-blue-600 hover:text-blue-800">
                    {room.roomNumber}
                  </Link>
                ) : (
                  room.roomNumber
                )}
              </td>
              <td className="px-4 py-4 text-slate-600">{room.hostelName}</td>
              <td className="px-4 py-4 text-slate-600">
                {room.building} · {room.floor}
              </td>
              <td className="px-4 py-4 text-slate-600">{ROOM_TYPES[room.roomType]}</td>
              <td className="px-4 py-4 text-slate-600">
                <span className="tabular-nums">
                  {room.occupied} / {room.capacity}
                </span>
                <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${(room.occupied / room.capacity) * 100}%` }}
                  />
                </div>
              </td>
              <td className="max-w-[200px] px-4 py-4 text-slate-600">
                {room.facilities.join(", ") || "—"}
              </td>
              <td className="px-4 py-4">
                <StatusBadge status={room.status} />
              </td>
              <td className="px-4 py-4">
                <div className="flex gap-3 whitespace-nowrap">
                  <button
                    onClick={() => setViewing(room)}
                    aria-label={`View details of room ${room.roomNumber}`}
                    className={linkButton}
                  >
                    View Details
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => setForm({ type: "room", room })}
                        aria-label={`Edit room ${room.roomNumber}`}
                        className={linkButton}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(room)}
                        aria-label={`Delete room ${room.roomNumber}`}
                        className={dangerButton}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>

      {viewing && (
        <RoomDetailsModal
          room={viewing}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onStatusChanged={reload}
        />
      )}
      {form?.type === "room" && (
        <RoomForm
          room={form.room}
          hostelNames={hostelNames}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "bulk" && (
        <BulkRoomForm
          hostelNames={hostelNames}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
    </PageShell>
  );
}
