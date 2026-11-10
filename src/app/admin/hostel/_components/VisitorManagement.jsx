"use client";

import { useCallback, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
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
  friendlyError,
  inputClass,
  linkButton,
  primaryButton,
  secondaryButton,
  useHostelData,
  usePagination,
} from "./hostelUi";
import { Detail, DocumentPreview, ViewModal, fileToBase64 } from "./hostelViews";

const todayText = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const MAX_BYTES = 5 * 1024 * 1024;
const DOC_LABELS = { PHOTO: "Visitor Photograph (JPG/PNG)", NID: "NID Card (JPG/PNG/PDF)", OTHER: "Other Document (JPG/PNG/PDF)" };

function NewVisitor({ onClose, onSaved }) {
  const { data: allocations } = useHostelData(hostelService.getAllocations);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    allocationId: "",
    visitorName: "",
    visitorPhone: "",
    visitorEmail: "",
    visitorNid: "",
    relationship: "",
    purpose: "",
    visitDate: todayText(),
    expectedArrival: "",
    expectedDeparture: "",
    sendTicketTo: "none",
  });
  const [files, setFiles] = useState({});
  const setValue = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));

  const members = (allocations || []).filter((item) => item.status === "Allocated");
  const query = search.trim().toLowerCase();
  const matches = members
    .filter((item) => `${item.studentName} ${item.studentId} ${item.studentPhone} ${item.roomLabel} seat ${item.seatNumber}`.toLowerCase().includes(query))
    .slice(0, 50);
  const host = members.find((item) => item.id === form.allocationId);

  const handleSubmit = async () => {
    if (!form.allocationId) throw new Error("Choose the student being visited.");
    const documents = {};
    for (const [type, file] of Object.entries(files)) {
      if (!file) continue;
      if (file.size > MAX_BYTES) throw new Error(`${DOC_LABELS[type]} must be 5 MB or smaller.`);
      documents[type] = { fileName: file.name, contentBase64: await fileToBase64(file) };
    }
    const visit = await hostelService.createVisitor({ ...form, documents });
    onSaved(visit);
  };

  return (
    <FormModal title="New Visitor" submitLabel="Register and Create Ticket" onSubmit={handleSubmit} onClose={onClose}>
      <p className="text-sm font-semibold text-slate-700 sm:col-span-2">1. Student being visited</p>
      <TextField id="host-search" label="Search Student" value={search} onChange={setSearch} placeholder="Name, ID, phone, room or seat" wide />
      <Field id="host-select" label="Student *" wide>
        <select id="host-select" value={form.allocationId} onChange={(event) => setValue("allocationId")(event.target.value)} className={inputClass} size={Math.min(6, Math.max(2, matches.length + 1))}>
          <option value="">Select a student...</option>
          {matches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.studentName} ({item.studentId}) · {item.roomLabel}, seat {item.seatNumber}
            </option>
          ))}
        </select>
      </Field>
      {host && (
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 sm:col-span-2">
          <Detail label="Student" value={`${host.studentName} (${host.studentId})`} />
          <Detail label="Room / Seat" value={`${host.roomLabel}, seat ${host.seatNumber}`} />
          <Detail label="Phone" value={host.studentPhone} />
          <Detail label="Guardian" value={host.guardianName} />
        </div>
      )}

      <p className="text-sm font-semibold text-slate-700 sm:col-span-2">2. Visitor</p>
      <TextField id="visitor-name" label="Visitor Full Name *" value={form.visitorName} maxLength={100} onChange={setValue("visitorName")} />
      <TextField id="visitor-phone" label="Phone *" value={form.visitorPhone} maxLength={20} onChange={setValue("visitorPhone")} />
      <TextField id="visitor-email" label="Email" type="email" value={form.visitorEmail} onChange={setValue("visitorEmail")} />
      <TextField id="visitor-nid" label="NID Number" value={form.visitorNid} maxLength={17} onChange={setValue("visitorNid")} />
      <TextField id="visitor-relationship" label="Relationship *" value={form.relationship} maxLength={100} onChange={setValue("relationship")} />
      <TextField id="visitor-purpose" label="Visit Purpose" value={form.purpose} maxLength={500} onChange={setValue("purpose")} />
      {Object.entries(DOC_LABELS).map(([type, label]) => (
        <Field key={type} id={`visitor-file-${type}`} label={label}>
          <input
            id={`visitor-file-${type}`}
            type="file"
            accept={type === "PHOTO" ? ".jpg,.jpeg,.png" : ".jpg,.jpeg,.png,.pdf"}
            onChange={(event) => setFiles((previous) => ({ ...previous, [type]: event.target.files?.[0] }))}
            className="text-sm"
          />
        </Field>
      ))}

      <p className="text-sm font-semibold text-slate-700 sm:col-span-2">3. Visit schedule</p>
      <TextField id="visit-date" label="Visit Date *" type="date" min={todayText()} value={form.visitDate} onChange={setValue("visitDate")} />
      <TextField id="visit-arrival" label="Expected Arrival *" type="time" value={form.expectedArrival} onChange={setValue("expectedArrival")} />
      <TextField id="visit-departure" label="Expected Departure *" type="time" value={form.expectedDeparture} onChange={setValue("expectedDeparture")} />
      <SelectField
        id="visit-send"
        label="Email the Ticket To"
        value={form.sendTicketTo}
        onChange={setValue("sendTicketTo")}
        options={[
          { value: "none", label: "Nobody" },
          { value: "visitor", label: "Visitor" },
          { value: "host", label: "Student" },
          { value: "both", label: "Visitor and student" },
        ]}
      />
    </FormModal>
  );
}

function VisitorCard({ visitId, onClose, onChanged }) {
  const { has } = useHostelPermissions();
  const load = useCallback(() => hostelService.getVisitor(visitId), [visitId]);
  const { data: visit, error, reload } = useHostelData(load);
  const [preview, setPreview] = useState(null);
  const [actionError, setActionError] = useState("");
  const loadPreview = useCallback(() => hostelService.getVisitorDocument(preview), [preview]);

  const act = async (work) => {
    setActionError("");
    try {
      await work();
      reload();
      onChanged();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };
  const withReason = (status) => {
    const reason = window.prompt(`Reason for ${status.toLowerCase()}`);
    if (reason) act(() => hostelService.setVisitorStatus(visitId, status, reason));
  };

  const canEnter = visit && ["Pending", "Approved"].includes(visit.status);
  return (
    <ViewModal
      title={visit ? `Ticket ${visit.ticketNumber}` : "Visit"}
      onClose={onClose}
      wide
      actions={
        visit && has("manage_visitors") && (
          <>
            {visit.status === "Pending" && <button onClick={() => act(() => hostelService.setVisitorStatus(visitId, "Approved", ""))} className={secondaryButton}>Approve</button>}
            {canEnter && <button onClick={() => withReason("Rejected")} className={secondaryButton}>Reject</button>}
            {canEnter && <button onClick={() => withReason("Cancelled")} className={secondaryButton}>Cancel Visit</button>}
            {canEnter && <button onClick={() => act(() => hostelService.checkInVisitor(visitId))} className={primaryButton}>Confirm Entry</button>}
            {visit.status === "Checked In" && <button onClick={() => act(() => hostelService.checkOutVisitor(visitId))} className={primaryButton}>Confirm Departure</button>}
          </>
        )
      }
    >
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {visit && (
        <>
          <div className="flex flex-col gap-4 md:flex-row">
            {visit.photoId && (
              <button onClick={() => setPreview(visit.photoId)} className="shrink-0 text-left" aria-label="Show visitor photograph">
                <VisitorPhoto documentId={visit.photoId} />
              </button>
            )}
            <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-3">
              <Detail label="Visitor" value={visit.visitorName} />
              <Detail label="Phone" value={visit.visitorPhone} />
              <Detail label="Email" value={visit.visitorEmail} />
              <Detail label="NID" value={visit.visitorNid} />
              <Detail label="Relationship" value={visit.relationship} />
              <Detail label="Purpose" value={visit.purpose} />
              <Detail label="Visiting" value={`${visit.hostName} (${visit.hostStudentId})`} />
              <Detail label="Room / Seat" value={visit.hostLocation} />
              <div>
                <p className="text-xs text-slate-500">Status</p>
                <div className="mt-1"><StatusBadge status={visit.status} /></div>
              </div>
              <Detail label="Visit Date" value={visit.visitDate} />
              <Detail label="Expected" value={`${visit.expectedArrival} to ${visit.expectedDeparture}`} />
              <Detail label="Checked In" value={visit.checkedInAt ? `${formatDateTime(visit.checkedInAt)} by ${visit.checkedInBy}` : ""} />
              <Detail label="Checked Out" value={visit.checkedOutAt ? `${formatDateTime(visit.checkedOutAt)} by ${visit.checkedOutBy}` : ""} />
              {visit.statusReason && <Detail label="Reason" value={visit.statusReason} />}
            </div>
          </div>
          {visit.documents.length > 0 && (
            <div className="flex flex-wrap gap-4 text-sm">
              {visit.documents.map((item) => (
                <button key={item.id} onClick={() => setPreview(item.id)} aria-label={`Preview ${item.documentType}`} className={linkButton}>
                  {item.documentType}: {item.fileName}
                </button>
              ))}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">History</p>
            <ul className="space-y-1 text-sm text-slate-600">
              {visit.history.map((item, index) => (
                <li key={index}>{formatDateTime(item.createdAt)} · {item.action} · {item.actorEmail}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      {preview && <DocumentPreview load={loadPreview} onClose={() => setPreview(null)} />}
    </ViewModal>
  );
}

// The photo is fetched through the logged-in API, like every document.
function VisitorPhoto({ documentId }) {
  const load = useCallback(() => hostelService.getVisitorDocument(documentId), [documentId]);
  const { data } = useHostelData(load);
  if (!data) return <div className="h-32 w-28 rounded-lg bg-slate-100" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`data:${data.mimeType};base64,${data.contentBase64}`} alt="Visitor" className="h-32 w-28 rounded-lg border border-slate-200 object-cover" />;
}

function TicketLookup({ onOpen }) {
  const [ticket, setTicket] = useState("");
  const [error, setError] = useState("");
  const find = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const visit = await hostelService.findVisitorTicket(ticket.trim());
      onOpen(visit.id);
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  return (
    <form onSubmit={find} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-end">
      <div className="flex-1">
        <label htmlFor="ticket-search" className="mb-1 block text-sm font-medium text-slate-700">Gate: Find a Ticket</label>
        <input id="ticket-search" value={ticket} onChange={(event) => setTicket(event.target.value)} placeholder="VT-XXXXXXXX" className={`${inputClass} uppercase`} />
      </div>
      <button type="submit" disabled={!ticket.trim()} className={`${primaryButton} disabled:opacity-50`}>Find Ticket</button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default function VisitorManagement() {
  const { has } = useHostelPermissions();
  const { data, error: loadError, isLoading, reload } = useHostelData(hostelService.getVisitors);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [created, setCreated] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("");

  const visits = data || [];
  const query = search.trim().toLowerCase();
  const filtered = visits.filter(
    (item) =>
      `${item.ticketNumber} ${item.visitorName} ${item.hostName} ${item.hostStudentId} ${item.visitorPhone}`.toLowerCase().includes(query) &&
      (statusFilter === "All" || item.status === statusFilter) &&
      (!dateFilter || item.visitDate === dateFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered);
  const today = todayText();

  const stats = [
    { label: "Visits Today", value: visits.filter((item) => item.visitDate === today).length },
    { label: "Inside Now", value: visits.filter((item) => item.status === "Checked In").length, color: "text-green-600" },
    { label: "Expected", value: visits.filter((item) => ["Pending", "Approved"].includes(item.status)).length, color: "text-blue-600" },
    { label: "Total", value: visits.length },
  ];

  return (
    <PageShell
      title="Visitor Management"
      subtitle="Register a visit to get a ticket. At the gate, find the ticket, check the photo and confirm entry and exit."
      actions={has("manage_visitors") && <button onClick={() => setCreating(true)} className={primaryButton}>New Record</button>}
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      {created && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 p-4 text-green-800">
          <span>Ticket created: <strong className="text-lg tracking-wider">{created.ticketNumber}</strong> for {created.visitorName}, {created.visitDate}.</span>
          <button onClick={() => setOpenId(created.id)} className={linkButton}>Open ticket</button>
        </div>
      )}
      <TicketLookup onOpen={setOpenId} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <ErrorBanner message={loadError} />
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <input aria-label="Search visitors" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticket, visitor, student..." className={`w-full md:max-w-md ${filterClass}`} />
          <input type="date" aria-label="Filter by visit date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className={filterClass} />
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterClass}>
            <option value="All">All Status</option>
            {["Pending", "Approved", "Checked In", "Checked Out", "Rejected", "Cancelled", "Expired"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <DataTable
          columns={["Ticket", "Visitor", "Visiting", "Room / Seat", "Visit Date", "Expected", "Checked In", "Checked Out", "Status", "Action"]}
          isLoading={isLoading && !data}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={visits.length === 0 ? "No visitors yet." : "No visits match your search."}
          minWidth="min-w-[1180px]"
        >
          {pageItems.map((item) => (
            <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-800">{item.ticketNumber}</td>
              <td className="px-4 py-3">
                <p className="font-medium text-slate-800">{item.visitorName}</p>
                <p className="text-xs text-slate-500">{item.visitorPhone}{item.hasPhoto ? " · photo" : ""}</p>
              </td>
              <td className="px-4 py-3"><p className="text-slate-800">{item.hostName}</p><p className="text-xs text-slate-500">{item.hostStudentId}</p></td>
              <td className="px-4 py-3 text-slate-600">{item.hostLocation}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.visitDate}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.expectedArrival}–{item.expectedDeparture}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.checkedInAt ? formatDateTime(item.checkedInAt) : "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.checkedOutAt ? formatDateTime(item.checkedOutAt) : "—"}</td>
              <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
              <td className="px-4 py-3">
                <div className="flex gap-3 whitespace-nowrap">
                  <button onClick={() => setOpenId(item.id)} aria-label={`View ticket ${item.ticketNumber}`} className={linkButton}>View</button>
                  {item.status === "Checked In" && has("manage_visitors") && (
                    <button onClick={() => setOpenId(item.id)} aria-label={`Check out ${item.ticketNumber}`} className={dangerButton}>Check Out</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>

      {creating && (
        <NewVisitor
          onClose={() => setCreating(false)}
          onSaved={(visit) => {
            setCreating(false);
            setCreated(visit);
            reload();
          }}
        />
      )}
      {openId && <VisitorCard visitId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </PageShell>
  );
}
