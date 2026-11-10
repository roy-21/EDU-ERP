"use client";

import Link from "next/link";
import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  DataTable,
  ErrorBanner,
  Field,
  FormModal,
  PageShell,
  SelectField,
  StatGrid,
  StatusBadge,
  TextField,
  dangerButton,
  formatDateTime,
  inputClass,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelAction,
  useHostelData,
} from "./hostelUi";
import { CATEGORY_LABELS } from "./hostelViews";

const todayText = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const FREQUENCIES = [
  { value: "ONE_TIME", label: "One time" },
  { value: "MONTHLY", label: "Every month" },
];
const SCOPES = [
  { value: "ALL", label: "All students" },
  { value: "BUILDING", label: "Specific buildings" },
  { value: "ROOM", label: "Specific rooms" },
  { value: "SEAT", label: "Specific seats" },
  { value: "STUDENTS", label: "Selected students" },
  { value: "GROUP", label: "Student groups" },
];

function GroupForm({ group, onClose, onSaved }) {
  const { data: allocations } = useHostelData(hostelService.getAllocations);
  const [name, setName] = useState(group?.name || "");
  const [description, setDescription] = useState(group?.description || "");
  const [members, setMembers] = useState(group?.allocationIds || []);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const students = (allocations || [])
    .filter((item) => item.status === "Allocated" || members.includes(item.id))
    .filter((item) => !query || `${item.studentName} ${item.studentId} ${item.roomLabel}`.toLowerCase().includes(query));
  const toggle = (id) => setMembers((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

  const handleSubmit = async () => {
    const body = { name, description, allocationIds: members };
    if (group) await hostelService.updateFeeGroup(group.id, body);
    else await hostelService.createFeeGroup(body);
    onSaved();
  };

  return (
    <FormModal title={group ? `Edit Group: ${group.name}` : "New Student Group"} submitLabel="Save Group" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="group-name" label="Group Name *" value={name} maxLength={100} onChange={setName} />
      <TextField id="group-description" label="Description" value={description} maxLength={500} onChange={setDescription} />
      <Field id="group-search" label={`Members (${members.length} selected)`} wide>
        <input id="group-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, ID or room" className={inputClass} />
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {!allocations && <p className="text-sm text-slate-500">Loading students...</p>}
          {allocations && students.length === 0 && <p className="text-sm text-slate-500">No students match.</p>}
          {students.map((item) => (
            <label key={item.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={members.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`Member ${item.studentName}`} />
              <span className="text-slate-800">{item.studentName}</span>
              <span className="text-slate-500">({item.studentId}) · {item.roomLabel}</span>
            </label>
          ))}
        </div>
      </Field>
      <p className="text-xs text-slate-500 sm:col-span-2">Fees assigned to this group bill new members from now on. Charges already raised stay.</p>
    </FormModal>
  );
}

function FeeForm({ fee, onClose, onSaved }) {
  const [form, setForm] = useState(
    fee
      ? { ...fee, amount: String(fee.amount), dueDays: String(fee.dueDays) }
      : { name: "", description: "", amount: "", frequency: "ONE_TIME", dueDays: "7", effectiveDate: todayText(), active: true }
  );
  const setValue = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const handleSubmit = async () => {
    const body = { ...form, amount: Number(form.amount), dueDays: Number(form.dueDays) };
    if (fee) await hostelService.updateFee(fee.id, body);
    else await hostelService.createFee(body);
    onSaved();
  };
  return (
    <FormModal title={fee ? `Edit ${fee.name}` : "New Fee Type"} submitLabel="Save Fee" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="fee-name" label="Fee Name *" value={form.name} maxLength={100} onChange={setValue("name")} />
      <TextField id="fee-amount" label="Amount (৳) *" type="number" min="0" step="0.01" value={form.amount} onChange={setValue("amount")} />
      <SelectField id="fee-frequency" label="Billing Frequency *" value={form.frequency} onChange={setValue("frequency")} options={fee ? FREQUENCIES.filter((item) => item.value === fee.frequency) : FREQUENCIES} />
      <TextField id="fee-due-days" label="Days to Pay After Billing" type="number" min="0" max="90" value={form.dueDays} onChange={setValue("dueDays")} />
      <TextField id="fee-effective" label="Effective From *" type="date" value={form.effectiveDate} onChange={setValue("effectiveDate")} />
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={form.active} onChange={(event) => setValue("active")(event.target.checked)} />
        Active
      </label>
      <Field id="fee-description" label="Description" wide>
        <textarea id="fee-description" rows={2} maxLength={500} value={form.description} onChange={(event) => setValue("description")(event.target.value)} className={inputClass} />
      </Field>
      {fee && <p className="text-xs text-slate-500 sm:col-span-2">A new amount applies to charges raised from now on. Issued invoices do not change.</p>}
    </FormModal>
  );
}

function AssignForm({ feeTypes, groups, onClose, onSaved }) {
  const { data: seats } = useHostelData(hostelService.getSeats);
  const { data: allocations } = useHostelData(hostelService.getAllocations);
  const [feeTypeId, setFeeTypeId] = useState(feeTypes.find((item) => item.active)?.id || "");
  const [scope, setScope] = useState("ALL");
  const [targets, setTargets] = useState([]);

  const options = (() => {
    const list = seats || [];
    if (scope === "BUILDING") return [...new Map(list.map((seat) => [seat.buildingId, `${seat.hostelName} · ${seat.building}`])).entries()];
    if (scope === "ROOM") return [...new Map(list.map((seat) => [seat.roomId, `${seat.hostelName} · ${seat.building} · Room ${seat.roomNumber}`])).entries()];
    if (scope === "SEAT") return list.map((seat) => [seat.id, `${seat.hostelName} · Room ${seat.roomNumber} · Seat ${seat.seatNumber}${seat.studentName ? ` (${seat.studentName})` : ""}`]);
    if (scope === "STUDENTS") return (allocations || []).filter((item) => item.status === "Allocated").map((item) => [item.id, `${item.studentName} (${item.studentId}) · ${item.roomLabel}`]);
    if (scope === "GROUP") return groups.map((item) => [item.id, `${item.name} (${item.members.length} students)`]);
    return [];
  })();

  const handleSubmit = async () => {
    if (!feeTypeId) throw new Error("Choose a fee.");
    const result = await hostelService.assignFee({ feeTypeId, scope, targetIds: targets });
    onSaved(result);
  };

  return (
    <FormModal title="Assign a Fee" submitLabel="Assign and Bill" onSubmit={handleSubmit} onClose={onClose}>
      <SelectField
        id="assign-fee"
        label="Fee *"
        value={feeTypeId}
        onChange={setFeeTypeId}
        options={feeTypes.filter((item) => item.active).map((item) => ({ value: item.id, label: `${item.name} · ${money(item.amount)}` }))}
      />
      <SelectField id="assign-scope" label="Apply To *" value={scope} onChange={(value) => { setScope(value); setTargets([]); }} options={SCOPES} />
      {scope !== "ALL" && (
        <Field id="assign-targets" label={`Choose (${targets.length} selected)`} wide>
          <select
            id="assign-targets"
            multiple
            size={8}
            value={targets}
            onChange={(event) => setTargets([...event.target.selectedOptions].map((option) => option.value))}
            className={inputClass}
          >
            {options.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      )}
      <p className="text-xs text-slate-500 sm:col-span-2">
        Each student gets their own invoice for this fee. A monthly fee is billed for each month from its effective date. Running billing again never charges twice.
      </p>
    </FormModal>
  );
}

const loadFees = () => hostelService.getFees();
const loadGroups = () => hostelService.getFeeGroups();
const loadNoGroups = () => Promise.resolve([]);

export default function FeeManagement() {
  const { has } = useHostelPermissions();
  const canManage = has("manage_fees");
  const { data, error: loadError, isLoading, reload } = useHostelData(loadFees);
  const { data: groups, reload: reloadGroups } = useHostelData(canManage ? loadGroups : loadNoGroups);
  const reloadAll = () => {
    reload();
    if (canManage) reloadGroups();
  };
  const { error: actionError, clearError, run } = useHostelAction(reloadAll);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");

  const overview = data?.overview;
  const stats = overview
    ? [
        { label: "Total Expected", value: money(overview.expected), color: "text-indigo-600" },
        { label: "Collected", value: money(overview.collected), color: "text-green-600" },
        { label: "Outstanding", value: money(overview.outstanding), color: "text-orange-600" },
        { label: "Overdue", value: money(overview.overdue), color: "text-red-600" },
        { label: "Paid / Partly / Unpaid", value: `${overview.paidRecords} / ${overview.partialRecords} / ${overview.unpaidRecords}` },
      ]
    : [];

  const done = (message) => {
    setForm(null);
    setNotice(message);
    reloadAll();
  };

  return (
    <PageShell
      title="Hostel Fees"
      subtitle="One place for every charge: rent, meals, deposits and the fees you define. All of them are invoices, paid and tracked the same way."
      actions={
        canManage && (
          <>
            <button onClick={() => setForm({ type: "group" })} className={secondaryButton}>New Group</button>
            <button onClick={() => setForm({ type: "assign" })} disabled={!data?.feeTypes.some((item) => item.active)} className={`${secondaryButton} disabled:opacity-50`}>
              Assign Fee
            </button>
            <button onClick={() => setForm({ type: "fee" })} className={primaryButton}>New Fee Type</button>
          </>
        )
      }
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      <ErrorBanner message={loadError || actionError} onDismiss={actionError ? clearError : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">By Category</h2>
          <Link href="/admin/hostel/invoices" className={linkButton}>All invoices</Link>
        </div>
        <DataTable columns={["Category", "Expected", "Collected", "Outstanding", "Overdue"]} hasRows={(overview?.categories || []).length > 0} emptyMessage="No charges yet." minWidth="min-w-[560px]">
          {(overview?.categories || []).map((item) => (
            <tr key={item.category} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{CATEGORY_LABELS[item.category]}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.expected)}</td>
              <td className="px-4 py-3 tabular-nums text-green-700">{money(item.collected)}</td>
              <td className="px-4 py-3 tabular-nums text-orange-700">{money(item.outstanding)}</td>
              <td className="px-4 py-3 tabular-nums text-red-700">{money(item.overdue)}</td>
            </tr>
          ))}
        </DataTable>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-800">Fee Types</h2>
        <DataTable columns={["Fee", "Amount", "Frequency", "Days to Pay", "Effective", "Assignments", "Status", "Action"]} hasRows={(data?.feeTypes || []).length > 0} emptyMessage="No fee types yet. Rent, meals and deposits are already billed." minWidth="min-w-[860px]">
          {(data?.feeTypes || []).map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.name}</p><p className="text-xs text-slate-500">{item.description}</p></td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.amount)}</td>
              <td className="px-4 py-3 text-slate-600">{FREQUENCIES.find((option) => option.value === item.frequency)?.label}</td>
              <td className="px-4 py-3 text-slate-600">{item.dueDays}</td>
              <td className="px-4 py-3 text-slate-600">{item.effectiveDate}</td>
              <td className="px-4 py-3 text-slate-600">{item.assignments}</td>
              <td className="px-4 py-3"><StatusBadge status={item.active ? "Active" : "Inactive"} /></td>
              <td className="px-4 py-3">
                {canManage && <button onClick={() => setForm({ type: "fee", fee: item })} aria-label={`Edit ${item.name}`} className={linkButton}>Edit</button>}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-800">Assignments</h2>
        <DataTable columns={["Fee", "Applies To", "Targets", "By", "When", "Status", "Action"]} hasRows={(data?.assignments || []).length > 0} emptyMessage="No fees assigned yet." minWidth="min-w-[760px]">
          {(data?.assignments || []).map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-slate-800">{item.feeName}</td>
              <td className="px-4 py-3 text-slate-600">{SCOPES.find((option) => option.value === item.scope)?.label}</td>
              <td className="px-4 py-3 text-slate-600">{item.scope === "ALL" ? "Everyone" : item.targetIds.length}</td>
              <td className="px-4 py-3 text-slate-600">{item.createdBy}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
              <td className="px-4 py-3"><StatusBadge status={item.active ? "Active" : "Inactive"} /></td>
              <td className="px-4 py-3">
                {canManage && item.active && (
                  <button
                    onClick={() => {
                      const reason = window.prompt("Why stop this fee? Charges already raised stay.");
                      if (reason) run(() => hostelService.stopFeeAssignment(item.id, reason));
                    }}
                    aria-label={`Stop ${item.feeName} assignment`}
                    className={dangerButton}
                  >
                    Stop
                  </button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-bold text-slate-800">Student Groups</h2>
          <DataTable columns={["Group", "Members", "Created By", "Action"]} hasRows={(groups || []).length > 0} emptyMessage="No groups yet. Make one to charge a fee to some students only." minWidth="min-w-[560px]">
            {(groups || []).map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.name}</p><p className="text-xs text-slate-500">{item.description}</p></td>
                <td className="px-4 py-3 text-slate-600" title={item.members.map((member) => member.studentName).join(", ")}>{item.members.length}</td>
                <td className="px-4 py-3 text-slate-600">{item.createdBy}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => setForm({ type: "group", group: item })} aria-label={`Edit group ${item.name}`} className={linkButton}>Edit</button>
                    <button
                      onClick={() => window.confirm(`Delete group ${item.name}?`) && run(() => hostelService.deleteFeeGroup(item.id))}
                      aria-label={`Delete group ${item.name}`}
                      className={dangerButton}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}

      {form?.type === "group" && <GroupForm group={form.group} onClose={() => setForm(null)} onSaved={() => done("Group saved.")} />}
      {form?.type === "fee" && <FeeForm fee={form.fee} onClose={() => setForm(null)} onSaved={() => done("Fee saved.")} />}
      {form?.type === "assign" && (
        <AssignForm
          feeTypes={data.feeTypes}
          groups={groups || []}
          onClose={() => setForm(null)}
          onSaved={(result) => done(`Fee assigned. ${result.billing.created} invoice(s) raised.`)}
        />
      )}
    </PageShell>
  );
}
