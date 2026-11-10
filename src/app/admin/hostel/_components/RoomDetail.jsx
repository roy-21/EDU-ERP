"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { AllocationForm, EditAllocationForm, VacateForm } from "./AllocationForms";
import { ROOM_TYPES, RoomForm } from "./RoomForms";
import { TicketForm } from "./MaintenanceManagement";
import { SeatForm } from "./SeatManagement";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  StatusBadge,
  dangerButton,
  formatDateTime,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelAction,
  useHostelData,
} from "./hostelUi";

const SEAT_BORDER = {
  Available: "border-green-200",
  Occupied: "border-blue-200",
  Reserved: "border-purple-200",
};

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 font-bold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

export default function RoomDetail({ id }) {
  const router = useRouter();
  const { has } = useHostelPermissions();
  const canManageRooms = has("manage_rooms");
  const canAllocate = has("manage_allocations");
  const load = useCallback(() => hostelService.getRoomDetail(id), [id]);
  const { data, error: loadError, isLoading, reload } = useHostelData(load);
  const { error: actionError, clearError, run } = useHostelAction(reload);
  const [form, setForm] = useState(null);

  const crumbs = [{ href: "/admin/hostel/rooms", label: "Room Management" }];

  if (isLoading || loadError || !data) {
    return (
      <PageShell title="Room Details" crumbs={crumbs}>
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {isLoading && "Loading..."}
          {!isLoading && (
            <span role="alert" className="text-red-600">
              {loadError}
            </span>
          )}
        </div>
      </PageShell>
    );
  }

  const { room, seats, allocations, tickets } = data;

  const handleSaved = () => {
    setForm(null);
    reload();
  };

  const handleDeleteRoom = () => {
    if (window.confirm(`Delete room ${room.roomNumber} and its seats? This cannot be undone.`)) {
      run(async () => {
        await hostelService.deleteRoom(room.id);
        router.push("/admin/hostel/rooms");
        return false;
      });
    }
  };

  const isUnavailable = room.status === "Maintenance" || room.status === "Closed";

  return (
    <PageShell
      title={`Room ${room.roomNumber}`}
      subtitle={`${room.hostelName} · ${room.building} · ${room.floor}`}
      crumbs={crumbs}
      actions={
        canManageRooms && (
          <>
            <button onClick={handleDeleteRoom} className={secondaryButton}>
              Delete Room
            </button>
            <button onClick={() => setForm({ type: "ticket" })} className={secondaryButton}>
              Report Issue
            </button>
            <button onClick={() => setForm({ type: "room" })} className={primaryButton}>
              Edit Room
            </button>
          </>
        )
      }
    >
      <ErrorBanner message={actionError} onDismiss={clearError} />

      <Section title="Room Information">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Status</p>
            <div className="mt-1">
              <StatusBadge status={room.status} />
            </div>
          </div>
          <Info label="Type" value={ROOM_TYPES[room.roomType]} />
          <Info label="Seats Occupied" value={`${room.occupied} / ${room.capacity}`} />
          <Info label="Open Tickets" value={room.openTickets} />
          <div className="col-span-2">
            <Info label="Facilities" value={room.facilities.join(", ") || "—"} />
          </div>
          <div className="col-span-2">
            <Info label="Notes" value={room.notes || "—"} />
          </div>
        </div>
      </Section>

      <Section title="Seats">
        {isUnavailable && (
          <p className="mb-3 rounded-lg bg-orange-50 p-3 text-sm text-orange-700">
            {room.status === "Closed" ? "This room is closed." : "This room is under maintenance."}{" "}
            New students cannot be allocated here.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {seats.map((seat) => (
            <div key={seat.id} className={`rounded-lg border p-4 ${SEAT_BORDER[seat.status]}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">Seat {seat.seatNumber}</p>
                <StatusBadge status={seat.status} />
              </div>
              <p className="mt-2 min-h-5 text-sm text-slate-700">{seat.studentName || "No student"}</p>
              <p className="text-xs text-slate-500">
                {seat.studentId || "—"} · {money(seat.monthlyFee)}/month
              </p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {seat.status === "Occupied" ? (
                  <>
                    {has("manage_allocations", "manage_students") && (
                      <button
                        onClick={() => setForm({ type: "editAllocation", seat })}
                        aria-label={`Edit allocation of seat ${seat.seatNumber}`}
                        className={linkButton}
                      >
                        Edit Allocation
                      </button>
                    )}
                    {has("view_due_rent", "manage_payments") && (
                      <Link
                        href={`/admin/hostel/ledger/${seat.allocationId}`}
                        aria-label={`Rent record of seat ${seat.seatNumber}`}
                        className={linkButton}
                      >
                        Rent
                      </Link>
                    )}
                    {canAllocate && (
                      <button
                        onClick={() => setForm({ type: "vacate", seat })}
                        aria-label={`Vacate seat ${seat.seatNumber}`}
                        className={dangerButton}
                      >
                        Vacate
                      </button>
                    )}
                  </>
                ) : (
                  !isUnavailable &&
                  canAllocate && (
                    <button
                      onClick={() => setForm({ type: "allocate", seat })}
                      aria-label={`Allocate seat ${seat.seatNumber}`}
                      className={linkButton}
                    >
                      Allocate
                    </button>
                  )
                )}
                {canManageRooms && (
                  <button
                    onClick={() => setForm({ type: "seat", seat })}
                    aria-label={`Edit seat ${seat.seatNumber}`}
                    className={linkButton}
                  >
                    Edit Seat
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Maintenance Tickets">
        <DataTable
          columns={["Ticket", "Priority", "Assigned To", "Opened", "Status", "Action"]}
          hasRows={tickets.length > 0}
          emptyMessage="No tickets for this room."
          minWidth="min-w-[700px]"
        >
          {tickets.map((ticket) => (
            <tr key={ticket.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{ticket.title}</td>
              <td className="px-4 py-3">
                <StatusBadge status={ticket.priority} />
              </td>
              <td className="px-4 py-3 text-slate-600">{ticket.assignedTo || "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(ticket.createdAt)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={ticket.status} />
              </td>
              <td className="px-4 py-3">
                {canManageRooms && (
                  <button onClick={() => setForm({ type: "ticket", ticket })} className={linkButton} aria-label={`Edit ticket ${ticket.title}`}>
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Allocation History">
        <DataTable
          columns={["Student", "Seat", "Allocated", "Vacated", "Status"]}
          hasRows={allocations.length > 0}
          emptyMessage="No students have been allocated to this room."
          minWidth="min-w-[640px]"
        >
          {allocations.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-800">{item.studentName}</p>
                <p className="text-xs text-slate-500">{item.studentId}</p>
              </td>
              <td className="px-4 py-3 text-slate-600">Seat {item.seatNumber}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.allocatedAt)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.vacatedAt)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      {form?.type === "vacate" && (
        <VacateForm
          studentName={form.seat.studentName}
          allocationId={form.seat.allocationId}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "editAllocation" && (
        <EditAllocationForm
          allocationId={form.seat.allocationId}
          hostelNames={[room.hostelName]}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
      {form?.type === "room" && (
        <RoomForm room={room} hostelNames={[room.hostelName]} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {form?.type === "seat" && (
        <SeatForm seat={form.seat} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {form?.type === "allocate" && (
        <AllocationForm fixedSeat={form.seat} seats={seats} hostelNames={[room.hostelName]} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {form?.type === "ticket" && (
        <TicketForm ticket={form.ticket} fixedRoom={room} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
    </PageShell>
  );
}
