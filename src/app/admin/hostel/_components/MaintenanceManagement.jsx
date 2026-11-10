"use client";

import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { downloadCsv } from "./hostelExport";
import {
  DataTable,
  ErrorBanner,
  Field,
  FormModal,
  PageShell,
  Pager,
  SelectField,
  StatGrid,
  StatusBadge,
  TextField,
  dangerButton,
  filterClass,
  formatDateTime,
  inputClass,
  linkButton,
  primaryButton,
  secondaryButton,
  useHostelAction,
  useHostelData,
  usePagination,
} from "./hostelUi";

const CATEGORIES = ["Electric", "Plumbing", "Furniture", "Cleaning", "Internet", "Other"];
const PRIORITIES = ["Low", "Medium", "High"];
const STATUSES = ["Open", "In Progress", "Resolved"];

export const TICKET_CSV_COLUMNS = [
  { label: "Title", value: (ticket) => ticket.title },
  { label: "Room", value: (ticket) => ticket.roomLabel },
  { label: "Category", value: (ticket) => ticket.category },
  { label: "Priority", value: (ticket) => ticket.priority },
  { label: "Status", value: (ticket) => ticket.status },
  { label: "Assigned To", value: (ticket) => ticket.assignedTo },
  { label: "Reported By", value: (ticket) => ticket.reportedBy },
  { label: "Blocks Room", value: (ticket) => (ticket.blocksRoom ? "Yes" : "No") },
  { label: "Opened", value: (ticket) => formatDateTime(ticket.createdAt) },
  { label: "Resolved", value: (ticket) => formatDateTime(ticket.resolvedAt) },
  { label: "Description", value: (ticket) => ticket.description },
];

export function TicketForm({ ticket, rooms, fixedRoom, onClose, onSaved }) {
  const [form, setForm] = useState({
    roomId: fixedRoom?.id || "",
    title: ticket?.title || "",
    description: ticket?.description || "",
    category: ticket?.category || "Other",
    priority: ticket?.priority || "Medium",
    status: ticket?.status || "Open",
    blocksRoom: ticket?.blocksRoom || false,
    assignedTo: ticket?.assignedTo || "",
  });

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async () => {
    if (ticket) {
      await hostelService.updateTicket(ticket.id, form);
    } else {
      await hostelService.createTicket(form);
    }
    onSaved();
  };

  const roomOptions = [
    { value: "", label: "Select a room..." },
    ...(rooms || []).map((room) => ({
      value: room.id,
      label: `${room.hostelName} · ${room.building} · Room ${room.roomNumber}`,
    })),
  ];

  return (
    <FormModal
      title={ticket ? "Edit Ticket" : `New Ticket${fixedRoom ? ` for Room ${fixedRoom.roomNumber}` : ""}`}
      submitLabel="Save Ticket"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {!ticket && !fixedRoom && (
        <SelectField
          id="ticket-room"
          label="Room *"
          value={form.roomId}
          onChange={setValue("roomId")}
          options={roomOptions}
          wide
        />
      )}
      {ticket && (
        <p className="text-sm text-slate-600 sm:col-span-2">{ticket.roomLabel}</p>
      )}
      <TextField
        id="ticket-title"
        label="Title *"
        value={form.title}
        onChange={setValue("title")}
        placeholder="e.g. Ceiling fan not working"
        wide
      />
      <SelectField id="ticket-category" label="Category" value={form.category} onChange={setValue("category")} options={CATEGORIES} />
      <SelectField id="ticket-priority" label="Priority" value={form.priority} onChange={setValue("priority")} options={PRIORITIES} />
      <SelectField id="ticket-status" label="Status" value={form.status} onChange={setValue("status")} options={STATUSES} />
      <TextField id="ticket-assigned" label="Assigned To" value={form.assignedTo} onChange={setValue("assignedTo")} />
      <Field id="ticket-description" label="Description" wide>
        <textarea
          id="ticket-description"
          rows={3}
          maxLength={500}
          value={form.description}
          onChange={(event) => setValue("description")(event.target.value)}
          className={inputClass}
        />
      </Field>
      <label className="flex items-start gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.blocksRoom}
          onChange={(event) => setValue("blocksRoom")(event.target.checked)}
        />
        Keep the room in maintenance until this ticket is resolved (no new students can be allocated)
      </label>
    </FormModal>
  );
}

const loadPage = async () => {
  const [tickets, rooms] = await Promise.all([
    hostelService.getTickets(),
    hostelService.getRooms(),
  ]);
  return { tickets, rooms };
};

export default function MaintenanceManagement() {
  const { has } = useHostelPermissions();
  const canManage = has("manage_rooms");
  const { data, error: loadError, isLoading, reload } = useHostelData(loadPage);
  const { error: actionError, clearError, run } = useHostelAction(reload);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [form, setForm] = useState(null);

  const tickets = data?.tickets || [];
  const countOf = (status) => tickets.filter((ticket) => ticket.status === status).length;

  const stats = [
    { label: "Total Tickets", value: tickets.length },
    { label: "Open", value: countOf("Open"), color: "text-red-600" },
    { label: "In Progress", value: countOf("In Progress"), color: "text-blue-600" },
    { label: "Resolved", value: countOf("Resolved"), color: "text-green-600" },
    {
      label: "High Priority Open",
      value: tickets.filter((ticket) => ticket.priority === "High" && ticket.status !== "Resolved").length,
      color: "text-orange-600",
    },
  ];

  const query = search.trim().toLowerCase();
  const filtered = tickets.filter(
    (ticket) =>
      [ticket.title, ticket.roomLabel, ticket.category, ticket.assignedTo]
        .join(" ")
        .toLowerCase()
        .includes(query) &&
      (statusFilter === "All" || ticket.status === statusFilter) &&
      (priorityFilter === "All" || ticket.priority === priorityFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered);

  const handleDelete = (ticket) => {
    if (window.confirm(`Delete the ticket "${ticket.title}"? This cannot be undone.`)) {
      run(() => hostelService.deleteTicket(ticket.id));
    }
  };

  return (
    <PageShell
      title="Maintenance Tickets"
      subtitle="Track room complaints and repairs. A ticket can close its room until it is resolved."
      actions={
        <>
          <button
            onClick={() => downloadCsv("hostel-maintenance.csv", TICKET_CSV_COLUMNS, filtered)}
            disabled={filtered.length === 0}
            className={`${secondaryButton} disabled:opacity-50`}
          >
            Export CSV
          </button>
          {canManage && (
            <button onClick={() => setForm({ ticket: null })} className={primaryButton}>
              + New Ticket
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
            aria-label="Search tickets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, room, category, staff..."
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
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Priorities</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          columns={["Ticket", "Room", "Priority", "Assigned To", "Opened", "Status", "Action"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={tickets.length === 0 ? "No tickets yet." : "No tickets match your search."}
          minWidth="min-w-[900px]"
        >
          {pageItems.map((ticket) => (
            <tr key={ticket.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-4">
                <p className="font-medium text-slate-800">{ticket.title}</p>
                <p className="text-xs text-slate-500">
                  {ticket.category}
                  {ticket.blocksRoom && ticket.status !== "Resolved" ? " · Room in maintenance" : ""}
                </p>
              </td>
              <td className="px-4 py-4 text-slate-600">{ticket.roomLabel}</td>
              <td className="px-4 py-4">
                <StatusBadge status={ticket.priority} />
              </td>
              <td className="px-4 py-4 text-slate-600">{ticket.assignedTo || "—"}</td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                {formatDateTime(ticket.createdAt)}
              </td>
              <td className="px-4 py-4">
                <StatusBadge status={ticket.status} />
              </td>
              <td className="px-4 py-4">
                {canManage && (
                  <div className="flex gap-3">
                    <button onClick={() => setForm({ ticket })} className={linkButton} aria-label={`Edit ticket ${ticket.title}`}>
                      Edit
                    </button>
                    <button onClick={() => handleDelete(ticket)} className={dangerButton} aria-label={`Delete ticket ${ticket.title}`}>
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>

      {form && (
        <TicketForm
          ticket={form.ticket}
          rooms={data?.rooms}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
        />
      )}
    </PageShell>
  );
}
