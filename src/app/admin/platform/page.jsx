"use client";

import { useCallback, useState } from "react";
import { tenancyApi } from "@/lib/identityServices";
import { useMe } from "@/lib/useMe";
import { ActivityList, Origin, UserActivity } from "@/components/erp/ActivityViews";
import {
  DataTable,
  ErrorBanner,
  NoAccess,
  StatusBadge,
  SystemShell,
  ViewModal,
  dangerButton,
  formatDateTime,
  friendlyError,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useData,
} from "@/components/erp/ui";

const TABS = [
  { id: "requests", label: "Requests" },
  { id: "tenants", label: "Institutions" },
  { id: "billing", label: "Billing" },
  { id: "pricing", label: "Module Prices" },
];
const PAY_METHODS = ["Bank Transfer", "bKash", "Nagad", "Cash", "Cheque", "Card"];

function PaymentModal({ invoice, onClose, onSaved }) {
  const [form, setForm] = useState({ amount: String(invoice.balance), method: "Bank Transfer", reference: "", paidOn: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const save = async () => {
    setError("");
    try {
      await tenancyApi.recordBillingPayment(invoice.id, { ...form, amount: Number(form.amount) });
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  return (
    <ViewModal title={`Payment for ${invoice.invoiceNumber}`} onClose={onClose} actions={<button onClick={save} className={primaryButton}>Record Payment</button>}>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-slate-600">{invoice.tenantName}: {money(invoice.balance)} left of {money(invoice.amount)}.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-700">Amount (৳)<input type="number" min="0" step="0.01" value={form.amount} onChange={set("amount")} className={input} /></label>
        <label className="text-sm text-slate-700">Method<select value={form.method} onChange={set("method")} className={input}>{PAY_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="text-sm text-slate-700">Reference{form.method === "Cash" ? " (optional)" : " *"}<input value={form.reference} maxLength={100} onChange={set("reference")} className={input} /></label>
        <label className="text-sm text-slate-700">Paid On<input type="date" value={form.paidOn} onChange={set("paidOn")} className={input} /></label>
      </div>
    </ViewModal>
  );
}
const STATUS_LABELS = { PENDING: "Pending", ACTIVE: "Active", SUSPENDED: "Suspended", REJECTED: "Rejected", APPROVED: "Approved" };

function ModulesModal({ tenant, catalog, onClose, onSaved }) {
  const [rows, setRows] = useState(() =>
    catalog.map((module) => {
      const current = tenant.modules.find((item) => item.moduleId === module.id);
      return { moduleId: module.id, name: module.name, isCore: module.isCore, on: current?.status === "ACTIVE", endsOn: current?.endsOn || "" };
    })
  );
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      await tenancyApi.setTenantModules(tenant.id, rows.filter((row) => row.on || tenant.modules.some((item) => item.moduleId === row.moduleId)).map((row) => ({ moduleId: row.moduleId, status: row.on ? "ACTIVE" : "SUSPENDED", endsOn: row.endsOn || null })));
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  return (
    <ViewModal title={`Modules: ${tenant.name}`} onClose={onClose} wide actions={<button onClick={save} className={primaryButton}>Save Modules</button>}>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-slate-600">Switching a module off removes it from every user of this institution on their next click. Their data is kept.</p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {rows.map((row, index) => (
          <div key={row.moduleId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={row.on} disabled={row.isCore} onChange={(e) => setRows(rows.map((item, i) => (i === index ? { ...item, on: e.target.checked } : item)))} />
              {row.name}{row.isCore ? " (core)" : ""}
            </label>
            {row.on && !row.isCore && (
              <input type="date" aria-label={`End date for ${row.name}`} value={row.endsOn} onChange={(e) => setRows(rows.map((item, i) => (i === index ? { ...item, endsOn: e.target.value } : item)))} className="rounded border border-slate-300 px-2 py-1 text-xs" />
            )}
          </div>
        ))}
      </div>
    </ViewModal>
  );
}

const loadAll = () => Promise.all([tenancyApi.requests(), tenancyApi.tenants(), tenancyApi.modules(), tenancyApi.billing()]);

// Inside one institution: who its users are, the roles it made, and what everyone has done.
function TenantDetailsModal({ tenant, onClose }) {
  const loadOverview = useCallback(() => tenancyApi.tenantOverview(tenant.id), [tenant.id]);
  const { data, error } = useData(loadOverview);
  const [tab, setTab] = useState("users");
  const [focus, setFocus] = useState(null);
  const loadTenantActivity = useCallback((params) => tenancyApi.tenantActivity(tenant.id, params), [tenant.id]);
  const loadUser = useCallback((params) => (focus?.type === "user" ? tenancyApi.tenantUserActivity(tenant.id, focus.id, params) : Promise.resolve(null)), [tenant.id, focus]);
  const loadRole = useCallback((params) => tenancyApi.tenantActivity(tenant.id, { ...params, roleId: focus?.type === "role" ? focus.id : "" }), [tenant.id, focus]);

  return (
    <ViewModal title={`Details: ${tenant.name}`} onClose={onClose} wide>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading...</p>}
      {data && focus && (
        <div className="space-y-3">
          <button onClick={() => setFocus(null)} className={`${linkButton} text-sm`}>&larr; Back to {tenant.name}</button>
          <h3 className="text-base font-semibold text-slate-800">{focus.type === "user" ? `Activity of ${focus.name}` : `Activity of the ${focus.name} role`}</h3>
          {focus.type === "user" ? <UserActivity key={focus.id} load={loadUser} /> : <ActivityList key={focus.id} load={loadRole} />}
        </div>
      )}
      {data && !focus && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">Status</p><StatusBadge status={STATUS_LABELS[data.tenant.status]} /></div>
            <div><p className="text-xs text-slate-500">Code</p><p className="text-sm text-slate-800">{data.tenant.code}</p></div>
            <div><p className="text-xs text-slate-500">Users</p><p className="text-sm text-slate-800">{data.users.length}</p></div>
            <div><p className="text-xs text-slate-500">Custom roles</p><p className="text-sm text-slate-800">{data.roles.length}</p></div>
          </div>
          <div className="flex flex-wrap gap-1" aria-label="Bought modules">
            {data.modules.length === 0 ? <span className="text-xs text-slate-500">Only the core modules.</span> : data.modules.map((id) => <span key={id} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{id}</span>)}
          </div>
          <div role="tablist" className="flex gap-2 border-b border-slate-200">
            {[["users", `Users (${data.users.length})`], ["roles", `Roles (${data.roles.length})`], ["activity", "All activity"]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`px-4 py-2 text-sm font-medium ${tab === id ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
            ))}
          </div>
          {tab === "users" && (
            <DataTable columns={["User", "Role", "Status", "Last sign-in", "Last seen from", "Actions (30 days)", "Created by", ""]} hasRows={data.users.length > 0} emptyMessage="No users." minWidth="min-w-[1100px]">
              {data.users.map((user) => (
                <tr key={user.id} className="border-b border-slate-100">
                  <td className="px-4 py-3"><p className="font-medium text-slate-800">{user.fullName}{user.isOwner && <span className="ml-2 rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Subscription owner</span>}</p><p className="font-mono text-xs text-slate-500">{user.username}</p><p className="text-xs text-slate-500">{user.email}</p></td>
                  <td className="px-4 py-3 text-slate-700">{user.roleName}</td>
                  <td className="px-4 py-3"><StatusBadge status={user.status === "ACTIVE" ? "Active" : "Inactive"} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</td>
                  <td className="px-4 py-3">{user.lastSeenFrom ? <Origin origin={user.lastSeenFrom} /> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-slate-700">{user.actionsLast30Days}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{user.createdBy || "—"}</td>
                  <td className="px-4 py-3"><button onClick={() => setFocus({ type: "user", id: user.id, name: user.fullName })} aria-label={`Activity of ${user.fullName}`} className={linkButton}>Activity</button></td>
                </tr>
              ))}
            </DataTable>
          )}
          {tab === "roles" && (
            <DataTable columns={["Role", "Created by", "Permissions", "Users", "Created", ""]} hasRows={data.roles.length > 0} emptyMessage="This institution uses only the built-in roles." minWidth="min-w-[720px]">
              {data.roles.map((role) => (
                <tr key={role.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{role.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{role.createdBy || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{role.permissions}</td>
                  <td className="px-4 py-3 text-slate-700">{role.users}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(role.createdAt)}</td>
                  <td className="px-4 py-3"><button onClick={() => setFocus({ type: "role", id: role.id, name: role.name })} aria-label={`Activity of the ${role.name} role`} className={linkButton}>Activity</button></td>
                </tr>
              ))}
            </DataTable>
          )}
          {tab === "activity" && <ActivityList load={loadTenantActivity} />}
        </>
      )}
    </ViewModal>
  );
}

export default function PlatformPage() {
  const { isRole, isReady } = useMe();
  const { data, error, isLoading, reload } = useData(loadAll);
  const [tab, setTab] = useState("requests");
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [prices, setPrices] = useState({});

  const act = useCallback(async (work, message) => {
    setActionError("");
    setNotice("");
    try {
      const result = await work();
      setNotice(typeof message === "function" ? message(result) : message);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  }, [reload]);

  if (isReady && !isRole("SUPER_ADMIN")) return <NoAccess message="Only the platform's super admin can open this page." />;

  const [requests, tenants, catalog, invoices] = data || [[], [], [], []];
  const pending = requests.filter((item) => item.status === "PENDING");

  return (
    <SystemShell title="Platform" subtitle="Institutions on this platform, their modules and their sign-up requests. Prices are set here; the sign-up page reads them from the server.">
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div role="tablist" className="flex gap-2 border-b border-slate-200">
        {TABS.map((item) => (
          <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`px-4 py-2 text-sm font-medium ${tab === item.id ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"}`}>
            {item.label}{item.id === "requests" && pending.length > 0 ? ` (${pending.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <DataTable columns={["Institution", "Kind", "Modules", "Monthly", "Requested", "Status", "Actions"]} isLoading={isLoading} hasRows={requests.length > 0} emptyMessage="No requests." minWidth="min-w-[900px]">
            {requests.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.tenantName}</p><p className="text-xs text-slate-500">{item.tenantCode} · {item.requestedBy}</p></td>
                <td className="px-4 py-3 text-slate-600">{item.kind === "REGISTRATION" ? "New sign-up" : "More modules"}</td>
                <td className="max-w-[16rem] px-4 py-3 text-xs text-slate-600">{item.moduleIds.join(", ")}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{money(item.monthlyTotal)}<p className="text-xs text-slate-500">{item.billingCycle === "YEARLY" ? "billed yearly" : "billed monthly"}</p></td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
                <td className="px-4 py-3"><StatusBadge status={STATUS_LABELS[item.status]} />{item.decisionNote && <p className="mt-1 text-xs text-slate-500">{item.decisionNote}</p>}</td>
                <td className="px-4 py-3">
                  {item.status === "PENDING" && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          const note = window.prompt("Note for the record (optional):", "");
                          if (note !== null) act(() => tenancyApi.approve(item.id, note), (result) => result.adminCredentials
                            ? (result.adminCredentials.delivered ? `Approved ${item.tenantName}. The admin's sign-in was emailed.` : `Approved ${item.tenantName}, but the admin email failed: ${result.adminCredentials.reason}`)
                            : `Approved for ${item.tenantName}.`);
                        }}
                        aria-label={`Approve ${item.tenantName}`}
                        className={linkButton}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          const note = window.prompt("Why is this rejected? The reason is kept.");
                          if (note) act(() => tenancyApi.reject(item.id, note), `Rejected ${item.tenantName}.`);
                        }}
                        aria-label={`Reject ${item.tenantName}`}
                        className={dangerButton}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}

      {tab === "tenants" && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <DataTable columns={["Institution", "Contact", "Users", "Modules", "Status", "Actions"]} isLoading={isLoading} hasRows={tenants.length > 0} emptyMessage="No institutions." minWidth="min-w-[900px]">
            {tenants.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.name}</p><p className="text-xs text-slate-500">{item.code} · {item.type}</p></td>
                <td className="px-4 py-3 text-xs text-slate-600"><p>{item.contactName}</p><p>{item.contactEmail}</p><p>{item.contactPhone}</p></td>
                <td className="px-4 py-3 text-slate-600">{item.users}</td>
                <td className="px-4 py-3 text-slate-600">{item.modules.filter((module) => module.status === "ACTIVE").length} active</td>
                <td className="px-4 py-3"><StatusBadge status={STATUS_LABELS[item.status]} />{item.statusReason && <p className="mt-1 text-xs text-slate-500">{item.statusReason}</p>}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-3 whitespace-nowrap">
                    <button onClick={() => setModal({ details: item })} aria-label={`Details of ${item.name}`} className={linkButton}>Details</button>
                    {["ACTIVE", "SUSPENDED"].includes(item.status) && <button onClick={() => setModal({ tenant: item })} aria-label={`Modules of ${item.name}`} className={linkButton}>Modules</button>}
                    {item.status === "ACTIVE" && (
                      <button
                        onClick={() => {
                          const reason = window.prompt(`Why suspend ${item.name}? All its users will be signed out.`);
                          if (reason) act(() => tenancyApi.setTenantStatus(item.id, "SUSPENDED", reason), `Suspended ${item.name}.`);
                        }}
                        aria-label={`Suspend ${item.name}`}
                        className={dangerButton}
                      >
                        Suspend
                      </button>
                    )}
                    <button
                      onClick={() => act(() => tenancyApi.setTenantBilling(item.id, !item.billingEnabled), `Billing ${item.billingEnabled ? "turned off" : "turned on"} for ${item.name}.`)}
                      aria-label={`Billing for ${item.name}`}
                      className={linkButton}
                    >
                      Billing: {item.billingEnabled ? "On" : "Off"}
                    </button>
                    {item.status === "ACTIVE" && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Email a new temporary password to the admin of ${item.name}? Their current password stops working once it is sent.`)) {
                            act(() => tenancyApi.resendAdminSignIn(item.id), (result) => `New sign-in details for ${result.username} were emailed to ${result.email}.`);
                          }
                        }}
                        aria-label={`Resend admin sign-in for ${item.name}`}
                        className={linkButton}
                      >
                        Resend Admin Sign-in
                      </button>
                    )}
                    {item.status === "SUSPENDED" && <button onClick={() => act(() => tenancyApi.setTenantStatus(item.id, "ACTIVE", ""), `Reactivated ${item.name}.`)} aria-label={`Reactivate ${item.name}`} className={linkButton}>Reactivate</button>}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}

      {tab === "billing" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Invoices are raised automatically each period for institutions with billing on, from the module prices they signed up at.
              Payments are recorded here; online collection is not connected yet.
            </p>
            <button onClick={() => act(() => tenancyApi.generateBilling(), (result) => `${result.created} invoice(s) raised.${result.errors.length ? ` Problems: ${result.errors.join("; ")}` : ""}`)} className={secondaryButton}>
              Raise Due Invoices Now
            </button>
          </div>
          <DataTable columns={["Invoice", "Institution", "Period", "Amount", "Paid", "Balance", "Due", "Status", "Actions"]} isLoading={isLoading} hasRows={invoices.length > 0} emptyMessage="No subscription invoices yet." minWidth="min-w-[1000px]">
            {invoices.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.invoiceNumber}</td>
                <td className="px-4 py-3 text-slate-800">{item.tenantName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.periodStart} to {item.periodEnd}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700" title={item.lines.map((line) => `${line.name}: ${line.amount}`).join(", ")}>{money(item.amount)}</td>
                <td className="px-4 py-3 tabular-nums text-green-700">{money(item.paid)}</td>
                <td className="px-4 py-3 tabular-nums text-orange-700">{money(item.balance)}</td>
                <td className="px-4 py-3 text-slate-600">{item.dueDate}</td>
                <td className="px-4 py-3"><StatusBadge status={item.status} />{item.voidReason && <p className="mt-1 text-xs text-slate-500">{item.voidReason}</p>}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 whitespace-nowrap">
                    {item.balance > 0 && item.status !== "Void" && <button onClick={() => setModal({ pay: item })} aria-label={`Record payment for ${item.invoiceNumber}`} className={linkButton}>Record Payment</button>}
                    {item.paid === 0 && item.status !== "Void" && (
                      <button
                        onClick={() => {
                          const reason = window.prompt(`Why void ${item.invoiceNumber}?`);
                          if (reason) act(() => tenancyApi.voidBilling(item.id, reason), `Voided ${item.invoiceNumber}.`);
                        }}
                        aria-label={`Void ${item.invoiceNumber}`}
                        className={dangerButton}
                      >
                        Void
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}

      {tab === "pricing" && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <DataTable columns={["Module", "Category", "Monthly Price (৳)", "Offered", "Action"]} isLoading={isLoading} hasRows={catalog.length > 0} emptyMessage="No modules." minWidth="min-w-[700px]">
            {catalog.map((item) => {
              const edit = prices[item.id] || { monthlyPrice: String(item.monthlyPrice), isAvailable: item.isAvailable };
              const changed = Number(edit.monthlyPrice) !== item.monthlyPrice || edit.isAvailable !== item.isAvailable;
              return (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 text-slate-800">{item.icon} {item.name}{item.isCore ? <span className="ml-2 text-xs text-slate-500">core</span> : null}</td>
                  <td className="px-4 py-3 text-slate-600">{item.category}</td>
                  <td className="px-4 py-3">
                    <input type="number" min="0" step="0.01" aria-label={`Price of ${item.name}`} value={edit.monthlyPrice} onChange={(e) => setPrices({ ...prices, [item.id]: { ...edit, monthlyPrice: e.target.value } })} className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" />
                  </td>
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`Offer ${item.name} at sign-up`} checked={edit.isAvailable} disabled={item.isCore} onChange={(e) => setPrices({ ...prices, [item.id]: { ...edit, isAvailable: e.target.checked } })} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      disabled={!changed}
                      onClick={() => act(() => tenancyApi.updateModule(item.id, { monthlyPrice: Number(edit.monthlyPrice), isAvailable: edit.isAvailable }), `Saved the price of ${item.name}. Current subscribers keep their price.`).then(() => setPrices((previous) => { const next = { ...previous }; delete next[item.id]; return next; }))}
                      className={`${secondaryButton} disabled:opacity-40`}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </section>
      )}

      {modal?.pay && (
        <PaymentModal invoice={modal.pay} onClose={() => setModal(null)} onSaved={() => { setModal(null); setNotice(`Payment recorded on ${modal.pay.invoiceNumber}.`); reload(); }} />
      )}
      {modal?.details && <TenantDetailsModal tenant={modal.details} onClose={() => setModal(null)} />}
      {modal?.tenant && (
        <ModulesModal
          tenant={modal.tenant}
          catalog={catalog}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setNotice(`Saved the modules of ${modal.tenant.name}.`);
            reload();
          }}
        />
      )}
    </SystemShell>
  );
}
