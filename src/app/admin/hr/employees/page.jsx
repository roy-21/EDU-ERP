"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { hrApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import QuickForm, { label } from "@/components/erp/QuickForm";
import { DataTable, ErrorBanner, NoAccess, SystemShell, dangerButton, filterClass, friendlyError, linkButton, money, primaryButton, useData } from "@/components/erp/ui";

const STAFF_FIELDS = [
  { name: "employeeNo", label: "Employee number *" },
  { name: "fullName", label: "Full name *" },
  { name: "designation", label: "Designation" },
  { name: "department", label: "Department / office" },
  { name: "email", label: "Email" },
  { name: "phone", label: "Phone" },
  { name: "joinedOn", label: "Joined on", type: "date" },
  { name: "status", label: "Status", type: "select", noBlank: true, options: [["ACTIVE", "Active"], ["ON_LEAVE", "On leave"], ["INACTIVE", "Inactive"]] },
];

const money2 = { type: "number", step: "0.01", min: 0 };
const SALARY_FIELDS = [
  { name: "basic", label: "Basic *", ...money2 },
  { name: "houseRent", label: "House rent", ...money2 },
  { name: "medical", label: "Medical", ...money2 },
  { name: "transport", label: "Transport", ...money2 },
  { name: "otherAllowance", label: "Other allowance", ...money2 },
  { name: "tax", label: "Tax (deduction)", ...money2 },
  { name: "providentFund", label: "Provident fund (deduction)", ...money2 },
  { name: "otherDeduction", label: "Other deduction", ...money2 },
  { name: "bankAccount", label: "Bank account", wide: true },
];

export default function EmployeesPage() {
  const { can, isReady } = useMe();
  const [filters, setFilters] = useState({ search: "", personType: "", status: "" });
  const load = useCallback(() => hrApi.employees(filters), [filters]);
  const { data, error, isLoading, reload } = useData(load);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("hr.read")) return <NoAccess />;
  const rows = data || [];
  const payroll = rows.filter((row) => row.salary && row.status !== "INACTIVE").reduce((sum, row) => sum + row.salary.net, 0);

  const remove = async (person) => {
    if (!window.confirm(`Delete ${person.fullName}?`)) return;
    setActionError("");
    try {
      await hrApi.removeStaff(person.id);
      setNotice("Staff member deleted.");
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <SystemShell title="Employees" subtitle="Teachers and non-teaching staff. Teachers are edited on the Teachers page; salaries for both are set here."
      crumbs={[{ href: "/admin/hr", label: "HR" }]}
      actions={can("hr.create") && <button onClick={() => setModal({ kind: "staff" })} className={primaryButton}>Add Staff</button>}>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search employees" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Name, number or designation" className={`${filterClass} min-w-[16rem]`} />
        <select aria-label="Type" value={filters.personType} onChange={(e) => setFilters({ ...filters, personType: e.target.value })} className={filterClass}>
          <option value="">Teachers and staff</option><option value="TEACHER">Teachers</option><option value="STAFF">Staff</option>
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={filterClass}>
          <option value="">Any status</option><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="INACTIVE">Inactive</option>
        </select>
      </div>
      {rows.length > 0 && <p className="text-sm text-slate-600">{rows.length} people · {rows.filter((r) => !r.salary).length} without a salary · monthly net {money(payroll)}</p>}
      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Employee", "Type", "Designation", "Department", "Status", "Gross", "Net", "Actions"]} isLoading={isLoading} hasRows={rows.length > 0} emptyMessage="No employees yet.">
          {rows.map((person) => (
            <tr key={`${person.personType}-${person.id}`} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-800">{person.fullName}<span className="block font-mono text-xs text-slate-500">{person.employeeNo}</span></td>
              <td className="px-4 py-3">{label(person.personType)}</td>
              <td className="px-4 py-3">{person.designation || "—"}</td>
              <td className="px-4 py-3">{person.department || "—"}</td>
              <td className="px-4 py-3">{label(person.status)}</td>
              <td className="px-4 py-3">{person.salary ? money(person.salary.gross) : <span className="text-amber-700">Not set</span>}</td>
              <td className="px-4 py-3 font-medium">{person.salary ? money(person.salary.net) : "—"}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  {can("hr.update") && <button onClick={() => setModal({ kind: "salary", person })} className={linkButton} aria-label={`Salary of ${person.fullName}`}>Salary</button>}
                  {person.personType === "STAFF" && can("hr.update") && <button onClick={() => setModal({ kind: "staff", person })} className={linkButton} aria-label={`Edit ${person.fullName}`}>Edit</button>}
                  {person.personType === "TEACHER" && <Link href="/admin/teacher/profile" className={linkButton}>Profile</Link>}
                  {person.personType === "STAFF" && can("hr.delete") && <button onClick={() => remove(person)} className={dangerButton} aria-label={`Delete ${person.fullName}`}>Delete</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      {modal?.kind === "staff" && (
        <QuickForm title={modal.person ? `Edit ${modal.person.fullName}` : "Add Staff"} fields={STAFF_FIELDS} initial={modal.person || { status: "ACTIVE" }} onClose={() => setModal(null)}
          onSubmit={async (body) => {
            if (modal.person) await hrApi.updateStaff(modal.person.id, body);
            else await hrApi.createStaff(body);
            setModal(null);
            setNotice("Staff member saved.");
            reload();
          }} />
      )}
      {modal?.kind === "salary" && (
        <QuickForm title={`Salary · ${modal.person.fullName}`} fields={SALARY_FIELDS} initial={modal.person.salary || {}} onClose={() => setModal(null)}
          onSubmit={async (body) => {
            await hrApi.setSalary(modal.person.personType, modal.person.id, body);
            setModal(null);
            setNotice("Salary saved. It applies to payrolls built from now on.");
            reload();
          }} />
      )}
    </SystemShell>
  );
}
