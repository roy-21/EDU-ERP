"use client";

import { useCallback, useEffect, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  Field,
  FormModal,
  SelectField,
  TextField,
  friendlyError,
  inputClass,
  linkButton,
  money,
  useHostelData,
} from "./hostelUi";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];

const DOCUMENT_LABELS = {
  STUDENT_CARD: "Student ID Card",
  STUDENT_NID: "Student NID Card",
  GUARDIAN_NID: "Guardian NID Card",
};

const todayText = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const emptyForm = {
  studentName: "",
  studentId: "",
  department: "",
  studentPhone: "",
  studentEmail: "",
  studentNid: "",
  guardianName: "",
  guardianPhone: "",
  guardianNid: "",
  guardianRelationship: "",
  preferredHostel: "",
  notes: "",
  monthlyRent: "",
  securityDeposit: "0",
  startDate: "",
  firstDueDate: "",
  billingActive: "active",
};

const toForm = (allocation) => ({
  ...emptyForm,
  ...Object.fromEntries(
    Object.keys(emptyForm)
      .filter((key) => typeof allocation[key] === "string")
      .map((key) => [key, allocation[key]])
  ),
  monthlyRent: allocation.monthlyRent ? String(allocation.monthlyRent) : "",
  securityDeposit: String(allocation.securityDeposit ?? 0),
  startDate: allocation.startDate || "",
  firstDueDate: allocation.firstDueDate || "",
  billingActive: allocation.billingActive === false ? "inactive" : "active",
});

// Converts text inputs into what the API expects.
const toPayload = (form) => ({
  ...form,
  monthlyRent: form.monthlyRent === "" ? 0 : Number(form.monthlyRent),
  securityDeposit: form.securityDeposit === "" ? 0 : Number(form.securityDeposit),
  startDate: form.startDate || null,
  firstDueDate: form.firstDueDate || null,
  billingActive: form.billingActive === "active",
});

const readAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });

export const openDocument = async (id) => {
  const file = await hostelService.getDocument(id);
  const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
};

function SectionTitle({ children }) {
  return (
    <h3 className="border-b border-slate-100 pb-2 pt-2 text-sm font-bold text-slate-800 sm:col-span-2">
      {children}
    </h3>
  );
}

function DocumentField({ type, existing, file, onChange, disabled }) {
  const id = `document-${type}`;
  const [error, setError] = useState("");

  const handleChange = (event) => {
    const chosen = event.target.files?.[0] || null;
    setError("");

    if (chosen && !FILE_TYPES.includes(chosen.type)) {
      setError("Only JPG, PNG and PDF files are allowed.");
      event.target.value = "";
      onChange(null);
      return;
    }
    if (chosen && chosen.size > MAX_FILE_BYTES) {
      setError("The file must be 5 MB or smaller.");
      event.target.value = "";
      onChange(null);
      return;
    }
    onChange(chosen);
  };

  const handleOpen = async () => {
    setError("");
    try {
      await openDocument(existing.id);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <Field id={id} label={`${DOCUMENT_LABELS[type]} (JPG, PNG or PDF, up to 5 MB)`}>
      <input
        id={id}
        type="file"
        accept=".jpg,.jpeg,.png,.pdf"
        disabled={disabled}
        onChange={handleChange}
        className={inputClass}
      />
      {existing && !file && (
        <p className="mt-1 text-xs text-slate-500">
          Saved: {existing.fileName}{" "}
          <button type="button" onClick={handleOpen} className={linkButton}>
            Download
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </Field>
  );
}

export function SeatSelect({ seats, value, onChange, label, emptyLabel, wide = true }) {
  // Available and reserved seats in rooms that are open can take a student.
  const openSeats = seats.filter((seat) => seat.status !== "Occupied" && !seat.roomBlocked);

  const groups = new Map();
  openSeats.forEach((seat) => {
    const group = `${seat.hostelName} · ${seat.building} · Room ${seat.roomNumber}`;
    groups.set(group, [...(groups.get(group) || []), seat]);
  });

  return (
    <Field id="seat-select" label={label} wide={wide}>
      <select
        id="seat-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">{emptyLabel}</option>
        {[...groups.entries()].map(([group, groupSeats]) => (
          <optgroup key={group} label={group}>
            {groupSeats.map((seat) => (
              <option key={seat.id} value={seat.id}>
                Seat {seat.seatNumber} — Room {seat.roomNumber}
                {seat.status === "Reserved" ? " (Reserved)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {openSeats.length === 0 && (
        <p className="mt-1 text-xs text-orange-600">No free seats are available right now.</p>
      )}
    </Field>
  );
}

function BillingFields({ form, setValue, isStartLocked }) {
  return (
    <>
      <TextField
        id="allocation-rent"
        label="Monthly Rent (৳) *"
        type="number"
        min="0"
        step="0.01"
        value={form.monthlyRent}
        onChange={setValue("monthlyRent")}
      />
      <TextField
        id="allocation-deposit"
        label="Security Deposit (৳)"
        type="number"
        min="0"
        step="0.01"
        value={form.securityDeposit}
        onChange={setValue("securityDeposit")}
      />
      <TextField
        id="allocation-start"
        label="Allocation Start Date *"
        type="date"
        value={form.startDate}
        disabled={isStartLocked}
        onChange={setValue("startDate")}
      />
      <TextField
        id="allocation-first-due"
        label="Initial Rent Due Date"
        type="date"
        value={form.firstDueDate}
        onChange={setValue("firstDueDate")}
      />
    </>
  );
}

function AllocationFormBody({ allocation, documents = [], seats, fixedSeat, hostelNames, onClose, onSaved }) {
  const { has } = useHostelPermissions();
  const canEditStudent = has("manage_students");
  const canEditAllocation = has("manage_allocations");
  const [initial] = useState(() =>
    allocation
      ? toForm(allocation)
      : {
          ...emptyForm,
          startDate: todayText(),
          monthlyRent: fixedSeat?.monthlyFee ? String(fixedSeat.monthlyFee) : "",
        }
  );
  const [form, setForm] = useState(initial);
  const [seatId, setSeatId] = useState(fixedSeat?.id || "");
  const [files, setFiles] = useState({});

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSeatChange = (id) => {
    setSeatId(id);
    const seat = seats.find((item) => item.id === id);
    if (seat?.monthlyFee && !form.monthlyRent) {
      setValue("monthlyRent")(String(seat.monthlyFee));
    }
  };

  const uploadFiles = async (allocationId) => {
    const failed = [];
    for (const [documentType, file] of Object.entries(files)) {
      if (!file) continue;
      try {
        await hostelService.uploadDocument(allocationId, {
          documentType,
          fileName: file.name,
          contentBase64: await readAsBase64(file),
        });
      } catch (err) {
        failed.push(`${DOCUMENT_LABELS[documentType]}: ${friendlyError(err)}`);
      }
    }
    if (failed.length > 0) {
      window.alert(`The details were saved, but these files were not:\n${failed.join("\n")}\nOpen Edit to try again.`);
    }
  };

  const handleSubmit = async () => {
    let id = allocation?.id;

    if (allocation) {
      // Sends only what changed, so nothing else can be overwritten.
      const next = toPayload(form);
      const before = toPayload(initial);
      const changes = Object.fromEntries(
        Object.keys(next)
          .filter((key) => next[key] !== before[key])
          .map((key) => [key, next[key]])
      );
      if (Object.keys(changes).length > 0) {
        await hostelService.updateAllocation(id, changes);
      }
    } else {
      const created = await hostelService.createAllocation({
        ...toPayload(form),
        seatId: seatId || undefined,
      });
      id = created.id;
    }

    await uploadFiles(id);
    onSaved();
  };

  const isAllocating = Boolean(seatId) || allocation?.status === "Allocated";
  const title = allocation
    ? `Edit ${allocation.studentName}`
    : fixedSeat
      ? `Allocate Seat ${fixedSeat.seatNumber}, Room ${fixedSeat.roomNumber}`
      : "New Application";

  const studentInput = (id, label, key, props = {}) => (
    <TextField
      id={id}
      label={label}
      value={form[key]}
      disabled={Boolean(allocation) && !canEditStudent}
      onChange={setValue(key)}
      {...props}
    />
  );

  const hasDocument = (type) => documents.find((item) => item.documentType === type);
  const documentField = (type) => (
    <DocumentField
      type={type}
      existing={hasDocument(type)}
      file={files[type]}
      disabled={!canEditStudent}
      onChange={(file) => setFiles((previous) => ({ ...previous, [type]: file }))}
    />
  );

  const location = fixedSeat || (allocation?.seatNumber && allocation);

  return (
    <FormModal
      title={title}
      submitLabel={isAllocating && !allocation ? "Allocate Seat" : "Save"}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <SectionTitle>Student Information</SectionTitle>
      {studentInput("student-name", "Student Full Name *", "studentName")}
      {studentInput("student-id", "Student ID / Registration No. *", "studentId", { placeholder: "e.g. STU-2024-001" })}
      {studentInput("student-phone", `Student Phone${isAllocating ? " *" : ""}`, "studentPhone", { placeholder: "e.g. 01700000000" })}
      {studentInput("student-email", "Student Email", "studentEmail", { type: "email" })}
      {studentInput("student-nid", "Student NID Number", "studentNid", { placeholder: "10 to 17 digits" })}
      {studentInput("student-department", "Department", "department", { placeholder: "e.g. CSE - 3rd Year" })}
      {documentField("STUDENT_CARD")}
      {documentField("STUDENT_NID")}

      <SectionTitle>Guardian Information</SectionTitle>
      {studentInput("guardian-name", `Guardian Full Name${isAllocating ? " *" : ""}`, "guardianName")}
      {studentInput("guardian-phone", `Guardian Phone${isAllocating ? " *" : ""}`, "guardianPhone", { placeholder: "e.g. 01700000000" })}
      {studentInput("guardian-nid", "Guardian NID Number", "guardianNid", { placeholder: "10 to 17 digits" })}
      {studentInput("guardian-relationship", "Relationship with Student", "guardianRelationship", { placeholder: "e.g. Father" })}
      {documentField("GUARDIAN_NID")}

      <SectionTitle>Allocation Information</SectionTitle>
      {location ? (
        <p className="text-sm text-slate-700 sm:col-span-2">
          {fixedSeat
            ? `${fixedSeat.hostelName} · ${fixedSeat.building} · Room ${fixedSeat.roomNumber} · Seat ${fixedSeat.seatNumber}`
            : `${allocation.roomLabel} · Seat ${allocation.seatNumber}`}
        </p>
      ) : (
        !allocation && (
          <SeatSelect
            seats={seats}
            value={seatId}
            onChange={handleSeatChange}
            label="Building, Room and Seat"
            emptyLabel="Decide later (keep as pending)"
          />
        )
      )}
      <BillingFields
        form={form}
        setValue={setValue}
        isStartLocked={(Boolean(allocation) && !canEditAllocation) || allocation?.hasInvoices}
      />
      <SelectField
        id="allocation-status"
        label="Allocation Status"
        value={form.billingActive}
        onChange={setValue("billingActive")}
        options={[
          { value: "active", label: "Active (monthly rent is billed)" },
          { value: "inactive", label: "Inactive (billing paused)" },
        ]}
      />
      <TextField
        id="student-preferred-hostel"
        label="Preferred Hostel"
        value={form.preferredHostel}
        onChange={setValue("preferredHostel")}
        list="preferred-hostel-names"
      />
      <datalist id="preferred-hostel-names">
        {(hostelNames || []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <TextField
        id="student-notes"
        label="Notes"
        value={form.notes}
        maxLength={500}
        onChange={setValue("notes")}
        wide
      />
      {allocation?.status === "Allocated" && (
        <p className="text-xs text-slate-500 sm:col-span-2">
          A new rent applies from the first month without an invoice. Issued invoices do not change.
        </p>
      )}
    </FormModal>
  );
}

export const AllocationForm = AllocationFormBody;

// Loads the full record first, because tables only hold a masked copy.
export function EditAllocationForm({ allocationId, hostelNames, onClose, onSaved }) {
  const { has } = useHostelPermissions();
  const canSeeDocuments = has("manage_students");

  const load = useCallback(async () => {
    const [allocation, ledger, documents] = await Promise.all([
      hostelService.getAllocation(allocationId),
      hostelService.getLedger(allocationId).catch(() => ({ invoices: [] })),
      canSeeDocuments ? hostelService.getDocuments(allocationId) : [],
    ]);
    return {
      allocation: { ...allocation, hasInvoices: ledger.invoices.length > 0 },
      documents,
    };
  }, [allocationId, canSeeDocuments]);

  const { data, error, isLoading } = useHostelData(load);

  if (isLoading || error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="rounded-xl bg-white p-6 text-sm text-slate-600 shadow-xl">
          {isLoading ? "Loading..." : <span role="alert" className="text-red-600">{error}</span>}
          {error && (
            <button onClick={onClose} className={`ml-3 ${linkButton}`}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <AllocationFormBody
      allocation={data.allocation}
      documents={data.documents}
      hostelNames={hostelNames}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

export function AssignSeatForm({ allocation, seats, onClose, onSaved }) {
  const isTransfer = allocation.status === "Allocated";
  const [seatId, setSeatId] = useState("");
  const [form, setForm] = useState({
    monthlyRent: allocation.monthlyRent ? String(allocation.monthlyRent) : "",
    securityDeposit: String(allocation.securityDeposit ?? 0),
    startDate: allocation.startDate || todayText(),
    firstDueDate: allocation.firstDueDate || "",
  });

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSeatChange = (id) => {
    setSeatId(id);
    const seat = seats.find((item) => item.id === id);
    if (seat?.monthlyFee && !form.monthlyRent) {
      setValue("monthlyRent")(String(seat.monthlyFee));
    }
  };

  const handleSubmit = async () => {
    if (!seatId) throw new Error("Choose a seat.");

    await hostelService.assignSeat(
      allocation.id,
      isTransfer
        ? { seatId }
        : {
            seatId,
            monthlyRent: Number(form.monthlyRent || 0),
            securityDeposit: Number(form.securityDeposit || 0),
            startDate: form.startDate,
            firstDueDate: form.firstDueDate || undefined,
          }
    );
    onSaved();
  };

  return (
    <FormModal
      title={`${isTransfer ? "Transfer" : "Assign Seat for"} ${allocation.studentName}`}
      submitLabel={isTransfer ? "Transfer" : "Allocate Seat"}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {isTransfer && (
        <p className="text-sm text-slate-600 sm:col-span-2">
          Current seat: {allocation.seatNumber}, {allocation.roomLabel}. The rent stays the same; change it with Edit.
        </p>
      )}
      {allocation.preferredHostel && (
        <p className="text-sm text-slate-600 sm:col-span-2">
          Preferred hostel: {allocation.preferredHostel}
        </p>
      )}
      <SeatSelect
        seats={seats}
        value={seatId}
        onChange={handleSeatChange}
        label="New Seat *"
        emptyLabel="Select a seat..."
      />
      {!isTransfer && <BillingFields form={form} setValue={setValue} />}
    </FormModal>
  );
}

export function VacateForm({ studentName, allocationId, onClose, onSaved }) {
  const [endDate, setEndDate] = useState(todayText());
  const [dues, setDues] = useState(null);

  useEffect(() => {
    let isCurrent = true;
    hostelService
      .getLedger(allocationId)
      .then((ledger) => isCurrent && setDues(ledger))
      .catch(() => isCurrent && setDues({ unavailable: true }));
    return () => {
      isCurrent = false;
    };
  }, [allocationId]);

  const handleSubmit = async () => {
    await hostelService.vacateAllocation(allocationId, endDate);
    onSaved();
  };

  return (
    <FormModal
      title={`End Allocation of ${studentName}`}
      submitLabel="End Allocation"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <TextField
        id="vacate-end-date"
        label="End Date *"
        type="date"
        value={endDate}
        onChange={setEndDate}
      />
      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2" role="status">
        {!dues && "Checking what this student still owes..."}
        {dues?.unavailable && "Outstanding dues could not be loaded. Check the student's record before ending."}
        {dues && !dues.unavailable && (
          dues.totalOutstanding > 0
            ? `${studentName} still owes ${money(dues.totalOutstanding)} across ${dues.invoices.filter((item) => item.outstandingAmount > 0).length} invoice(s). It stays on their record after the seat is freed.`
            : `${studentName} has no outstanding dues.`
        )}
      </div>
      <p className="text-sm text-slate-600 sm:col-span-2">
        The seat becomes free and rent stops after the end month. Invoices and payments are kept. The student&apos;s
        account is not deleted.
      </p>
    </FormModal>
  );
}

export function RejectForm({ allocation, onClose, onSaved }) {
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    await hostelService.rejectAllocation(allocation.id, reason);
    onSaved();
  };

  return (
    <FormModal
      title={`Reject ${allocation.studentName}`}
      submitLabel="Reject Application"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <TextField
        id="reject-reason"
        label="Reason"
        value={reason}
        onChange={setReason}
        maxLength={500}
        wide
      />
    </FormModal>
  );
}
