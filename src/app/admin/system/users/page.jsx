"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formsApi, identityService } from "@/lib/identityServices";
import { useMe } from "@/lib/useMe";
import DynamicFields, { displayValue, visibleValues } from "@/components/erp/DynamicForm";
import PermissionTree from "@/components/erp/PermissionTree";
import { UserActivity } from "@/components/erp/ActivityViews";
import {
  DataTable,
  Detail,
  ErrorBanner,
  Field,
  FormModal,
  NoAccess,
  SelectField,
  StatusBadge,
  SystemShell,
  TextField,
  ViewModal,
  dangerButton,
  filterClass,
  formatDateTime,
  friendlyError,
  inputClass,
  linkButton,
  primaryButton,
  useData,
} from "@/components/erp/ui";

const PAGE_SIZE = 20;
const LINK_TYPES = [
  { value: "", label: "Not linked" },
  { value: "STUDENT", label: "Student record" },
  { value: "TEACHER", label: "Teacher record" },
  { value: "STAFF", label: "Staff record" },
  { value: "GUARDIAN", label: "Guardian record" },
];
// Portal roles are usually tied to a record, so their accounts can be linked to one.
const LINKABLE_ROLES = new Set(["STUDENT", "GUARDIAN", "TEACHER"]);
const EMAIL_KINDS = { ACCOUNT_CREATED: "Sign-in details", PASSWORD_RESET: "New password", ADMIN_APPROVED: "Approval", ADMIN_RESEND: "New sign-in details" };
const loadRoles = () => identityService.roles();
const loadTree = () => identityService.permissionTree();
const loadOwner = () => identityService.owner();

const assignableRoles = (roles, me) => roles.filter((item) => item.id !== "SUPER_ADMIN" || me?.role === "SUPER_ADMIN");

// Loads the profile form of the chosen role, if it has one (used when editing).
function useRoleForm(role) {
  const [form, setForm] = useState({ formId: null, fields: [] });
  useEffect(() => {
    let isCurrent = true;
    if (!role?.formId) {
      Promise.resolve().then(() => isCurrent && setForm({ formId: null, fields: [] }));
    } else {
      formsApi.get(role.formId)
        .then((result) => isCurrent && setForm({ formId: role.formId, fields: result.publishedFields || [] }))
        .catch(() => isCurrent && setForm({ formId: role.formId, fields: [] }));
    }
    return () => { isCurrent = false; };
  }, [role?.formId]);
  return form.formId === (role?.formId || null) ? form.fields : [];
}

function ExistingWarning({ matches }) {
  if (!matches?.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2">
      <p className="font-medium">This person may already have an account:</p>
      <ul className="mt-1 list-disc pl-5">
        {matches.map((item) => (
          <li key={item.id}>{item.fullName} ({item.username}), {item.roleName}, same {item.matchedOn.join(" and ")}. Edit that account instead of making a new one.</li>
        ))}
      </ul>
    </div>
  );
}

// Step 1: choose the role. Step 2: fill that role's own registration form. Step 3: the server makes the account.
function AddUserModal({ roles, canConfigure, onClose, onSaved }) {
  const { me } = useMe();
  const [roleId, setRoleId] = useState("");
  const [answers, setAnswers] = useState({});
  const [account, setAccount] = useState({ fullName: "", email: "", phone: "", username: "", linkedType: "", linkedId: "" });
  const [matches, setMatches] = useState([]);
  const loadForm = useCallback(() => (roleId ? identityService.registrationForm(roleId) : Promise.resolve(null)), [roleId]);
  const { data, error: formError } = useData(loadForm);
  const registration = data && data.roleId === roleId ? data : null;
  const form = registration?.form || null;
  const mapped = registration?.accountFields || {};
  const set = (key) => (value) => setAccount((previous) => ({ ...previous, [key]: value }));

  const chooseRole = (value) => {
    setRoleId(value);
    setAnswers({});
    setMatches([]);
  };

  const emailNow = () => (mapped.email ? answers[mapped.email] : account.email) || "";
  const phoneNow = () => (mapped.phone ? answers[mapped.phone] : account.phone) || "";
  const check = async () => {
    const found = await identityService.lookupUsers({ email: emailNow(), phone: phoneNow(), linkedType: account.linkedType, linkedId: account.linkedId }).catch(() => []);
    setMatches(found);
  };

  const handleSubmit = async () => {
    if (!form) throw new Error("Choose a role that has a registration form.");
    const body = {
      role: roleId,
      answers: visibleValues(form.fields, answers),
      fullName: mapped.fullName ? undefined : account.fullName,
      email: mapped.email ? undefined : account.email,
      phone: mapped.phone ? undefined : account.phone,
      username: account.username || undefined,
      linkedType: account.linkedType || undefined,
      linkedId: account.linkedType ? account.linkedId : undefined,
    };
    try {
      const result = await identityService.registerUser(body);
      onSaved(result.user, result.credentials);
    } catch (err) {
      await check();
      throw err;
    }
  };

  return (
    <FormModal title="Add New User" submitLabel="Create Account" onSubmit={handleSubmit} onClose={onClose} submitDisabled={!form}>
      <SelectField
        id="new-user-role"
        label="Role *"
        value={roleId}
        onChange={chooseRole}
        wide
        options={[{ value: "", label: "Choose a role..." }, ...assignableRoles(roles, me).map((item) => ({ value: item.id, label: `${item.name}${item.isSystem ? "" : " (custom)"}${item.formId ? "" : " — no form yet"}` }))]}
      />
      {!roleId && <p className="text-sm text-slate-500 sm:col-span-2">Choose the role first. The registration form made for that role opens here.</p>}
      {roleId && formError && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{formError}</p>}
      {roleId && !registration && !formError && <p className="text-sm text-slate-500 sm:col-span-2">Loading the form...</p>}
      {registration && !form && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2">
          <p className="font-medium">{registration.problem}</p>
          <p className="mt-1">Users of this role are added with the role&apos;s own form. Build a form with the purpose &quot;User profile&quot;, publish it, and choose it for the role.</p>
          {canConfigure ? (
            <p className="mt-2 flex flex-wrap gap-4">
              <Link href={`/admin/system/role-permission?role=${encodeURIComponent(roleId)}`} className={linkButton}>Set the role&apos;s form</Link>
              <Link href="/admin/system/form-builder" className={linkButton}>Open the Form Builder</Link>
            </p>
          ) : (
            <p className="mt-1">Ask someone who manages roles to set it up.</p>
          )}
        </div>
      )}
      {form && (
        <>
          <div className="border-t border-slate-200 pt-3 sm:col-span-2">
            <p className="text-sm font-semibold text-slate-700">{form.title}</p>
            {form.description && <p className="text-xs text-slate-500">{form.description}</p>}
          </div>
          {!mapped.fullName && <TextField id="new-user-name" label="Full Name *" value={account.fullName} maxLength={150} onChange={set("fullName")} />}
          {!mapped.email && registration.canLogIn && <TextField id="new-user-email" label="Email * (sign-in details go here)" type="email" value={account.email} maxLength={255} onChange={set("email")} onBlur={check} />}
          {!mapped.phone && <TextField id="new-user-phone" label="Phone" value={account.phone} maxLength={30} onChange={set("phone")} onBlur={check} />}
          <DynamicFields fields={form.fields} values={answers} onChange={setAnswers} idPrefix="reg" />
          <TextField id="new-user-username" label="Username (blank = made from the name)" value={account.username} maxLength={50} onChange={(value) => set("username")(value.toLowerCase())} />
          {LINKABLE_ROLES.has(roleId) && (
            <>
              <SelectField id="new-user-link-type" label="Linked Record" value={account.linkedType} onChange={set("linkedType")} options={LINK_TYPES} />
              {account.linkedType && <TextField id="new-user-link-id" label="Record ID (e.g. student ID) *" value={account.linkedId} maxLength={64} onChange={set("linkedId")} onBlur={check} />}
            </>
          )}
          <ExistingWarning matches={matches} />
          <p className="text-xs text-slate-500 sm:col-span-2">
            {registration.canLogIn
              ? "A temporary password is emailed to the user and never shown here; they must change it when they first sign in. The account is saved only if that email goes out, so if sending fails nothing is created and you can submit again."
              : "This person is kept on record but can never sign in."}
          </p>
        </>
      )}
    </FormModal>
  );
}

function EditUserModal({ user, roles, onClose, onSaved }) {
  const { me } = useMe();
  const [form, setForm] = useState(() => ({ fullName: user.fullName || "", email: user.email || "", phone: user.phone || "", role: user.role, status: user.status }));
  const [profile, setProfile] = useState(user.profile || {});
  const role = roles.find((item) => item.id === form.role);
  const fields = useRoleForm(role);
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async () => {
    onSaved(await identityService.updateUser(user.id, { ...form, profile: visibleValues(fields, profile) }), null);
  };

  return (
    <FormModal title={`Edit ${user.fullName}`} submitLabel="Save" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="user-name" label="Full Name *" value={form.fullName} maxLength={150} onChange={set("fullName")} />
      <SelectField id="user-role" label="Role *" value={form.role} onChange={set("role")} options={assignableRoles(roles, me).map((item) => ({ value: item.id, label: `${item.name}${item.canLogIn === false ? " (no sign-in)" : ""}` }))} />
      <TextField id="user-email" label="Email" type="email" value={form.email} maxLength={255} onChange={set("email")} />
      <TextField id="user-phone" label="Phone" value={form.phone} maxLength={30} onChange={set("phone")} />
      <SelectField id="user-status" label="Status" value={form.status} onChange={set("status")} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive (cannot sign in)" }]} />
      {fields.length > 0 && (
        <>
          <p className="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-700 sm:col-span-2">{role.name} details</p>
          <DynamicFields fields={fields} values={profile} onChange={setProfile} idPrefix="profile" />
        </>
      )}
    </FormModal>
  );
}

function DetailsModal({ user, startOn = "details", onClose }) {
  const [tab, setTab] = useState(startOn);
  const loadActivity = useCallback((params) => identityService.userActivity(user.id, params), [user.id]);
  return (
    <ViewModal title={user.fullName} onClose={onClose} wide>
      <div role="tablist" className="flex gap-2 border-b border-slate-200">
        {[["details", "Details"], ["activity", "Activity"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium ${tab === id ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
        ))}
      </div>
      {tab === "details" ? <UserDetails user={user} /> : <UserActivity load={loadActivity} />}
    </ViewModal>
  );
}

function UserDetails({ user }) {
  const load = useCallback(() => identityService.userDetails(user.id), [user.id]);
  const { data, error } = useData(load);
  return (
    <>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading...</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Detail label="Username" value={data.username} />
            <Detail label="Role" value={data.roleName} />
            <Detail label="Email" value={data.email || "—"} />
            <Detail label="Phone" value={data.phone || "—"} />
            <Detail label="Status" value={data.status === "ACTIVE" ? "Active" : "Inactive"} />
            <Detail label="Last sign-in" value={data.lastLoginAt ? formatDateTime(data.lastLoginAt) : "Never"} />
            <Detail label="Created" value={`${formatDateTime(data.createdAt)}${data.createdBy ? ` by ${data.createdBy}` : ""}`} />
            <Detail label="Sign-in details sent" value={data.credentialsSentAt ? formatDateTime(data.credentialsSentAt) : data.canLogIn ? "Not yet" : "Cannot sign in"} />
            {data.linkedType && <Detail label="Linked record" value={`${data.linkedType}: ${data.linkedId}`} />}
          </div>
          {data.profileFields.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">Registration details</p>
              <div className="grid grid-cols-2 gap-4">
                {data.profileFields.filter((field) => data.profile?.[field.id] !== undefined).map((field) => (
                  <Detail key={field.id} label={field.label} value={displayValue(field, data.profile[field.id])} />
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Account emails</p>
            {data.emails.length === 0 ? <p className="text-sm text-slate-500">None recorded.</p> : (
              <ul className="space-y-1 text-sm">
                {data.emails.map((mail, index) => (
                  <li key={index} className="flex flex-wrap gap-2">
                    <span className={mail.status === "SENT" ? "text-green-700" : "text-red-600"}>{mail.status === "SENT" ? "Sent" : "Failed"}</span>
                    <span>{EMAIL_KINDS[mail.kind] || mail.kind} to {mail.recipient}</span>
                    <span className="text-slate-500">{formatDateTime(mail.createdAt)}</span>
                    {mail.error && <span className="text-xs text-red-600">{mail.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}

function OverridesModal({ user, tree, onClose, onSaved }) {
  const load = useCallback(() => identityService.userPermissions(user.id), [user.id]);
  const { data, error, reload } = useData(load);
  const [overrides, setOverrides] = useState(null);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState("");
  const [info, setInfo] = useState("");
  const current = overrides ?? Object.fromEntries((data?.overrides || []).map((item) => [item.key, item.effect]));

  const save = async () => {
    setSaveError("");
    try {
      await identityService.setOverrides(user.id, Object.entries(current).filter(([, effect]) => effect).map(([key, effect]) => ({ key, effect, reason })));
      onSaved();
    } catch (err) {
      setSaveError(friendlyError(err));
    }
  };

  const restore = async (key) => {
    setSaveError("");
    setInfo("");
    try {
      await identityService.removeOverride(user.id, key);
      setOverrides(null);
      setInfo(`${key} follows the role again.`);
      reload();
    } catch (err) {
      setSaveError(friendlyError(err));
    }
  };

  return (
    <ViewModal
      title={`Permissions: ${user.fullName}`}
      onClose={onClose}
      wide
      actions={<button onClick={save} disabled={!data} className={`${primaryButton} disabled:opacity-50`}>Save Overrides</button>}
    >
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
      {info && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</p>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Detail label={`From role (${data.roleName})`} value={String(data.fromRole.length)} />
            <Detail label="Overrides" value={String(Object.values(current).filter(Boolean).length)} />
            <Detail label="Effective" value={String(data.effective.length)} />
          </div>
          <p className="text-sm text-slate-600">
            These changes apply to {user.fullName} only. The {data.roleName} role and its other users stay as they are.
            Allow adds a permission the role does not give, but only inside modules your subscription includes. Deny removes one and always wins.
          </p>
          {data.overrides.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">Saved overrides</p>
              <ul className="space-y-1 text-sm">
                {data.overrides.map((item) => (
                  <li key={item.key} className="flex flex-wrap items-center gap-3">
                    <span className={item.effect === "DENY" ? "text-red-700" : "text-green-700"}>{item.effect === "DENY" ? "Deny" : "Allow"}</span>
                    <span className="font-mono text-xs">{item.key}</span>
                    {item.reason && <span className="text-xs text-slate-500">{item.reason}</span>}
                    <button onClick={() => restore(item.key)} className={linkButton} aria-label={`Restore role permission for ${item.key}`}>Use role</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field id="override-reason" label="Reason (kept in the audit log)">
            <input id="override-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </Field>
          {tree && (
            <PermissionTree
              tree={tree}
              mode="override"
              fromRole={data.fromRole}
              overrides={current}
              onOverride={(key, effect) => setOverrides({ ...current, [key]: effect })}
            />
          )}
        </>
      )}
    </ViewModal>
  );
}

// The students a guardian can see in the portal.
function WardsModal({ user, onClose, onSaved }) {
  const load = useCallback(() => identityService.wards(user.id), [user.id]);
  const { data, error } = useData(load);
  const [rows, setRows] = useState(null);
  const [saveError, setSaveError] = useState("");
  const current = rows ?? (data || []).map((item) => ({ studentId: item.studentId, relationship: item.relationship, studentName: item.studentName }));
  const update = (index, change) => setRows(current.map((item, i) => (i === index ? { ...item, ...change } : item)));

  const save = async () => {
    setSaveError("");
    try {
      await identityService.setWards(user.id, current.filter((item) => item.studentId.trim()).map(({ studentId, relationship }) => ({ studentId: studentId.trim(), relationship })));
      onSaved();
    } catch (err) {
      setSaveError(friendlyError(err));
    }
  };

  return (
    <ViewModal title={`Linked Students: ${user.fullName}`} onClose={onClose} actions={<button onClick={save} disabled={!data} className={`${primaryButton} disabled:opacity-50`}>Save</button>}>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
      <p className="text-sm text-slate-600">In the portal this guardian sees only these students: their hostel bills (and can pay them) and their meal orders.</p>
      {current.map((item, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input aria-label={`Student ID ${index + 1}`} value={item.studentId} onChange={(e) => update(index, { studentId: e.target.value, studentName: "" })} placeholder="Student ID" className={`${inputClass} max-w-[12rem]`} />
          <input aria-label={`Relationship ${index + 1}`} value={item.relationship} onChange={(e) => update(index, { relationship: e.target.value })} placeholder="Relationship, e.g. Father" className={`${inputClass} max-w-[14rem]`} />
          {item.studentName && <span className="text-sm text-slate-600">{item.studentName}</span>}
          <button onClick={() => setRows(current.filter((_, i) => i !== index))} aria-label={`Remove student ${index + 1}`} className={dangerButton}>Remove</button>
        </div>
      ))}
      <button onClick={() => setRows([...current, { studentId: "", relationship: "", studentName: "" }])} disabled={!data} className={`${linkButton} text-sm`}>+ Add Student</button>
    </ViewModal>
  );
}

function OwnerCard({ owner, isMe, onActivity }) {
  if (!owner) return null;
  return (
    <section aria-label="Subscription owner" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div>
        <p className="text-xs font-semibold uppercase text-indigo-700">Subscription owner{isMe ? " (you)" : ""}</p>
        <p className="font-medium text-slate-800">{owner.fullName} <span className="font-mono text-xs text-slate-500">{owner.username}</span></p>
        <p className="text-sm text-slate-600">{owner.email}</p>
      </div>
      <button onClick={onActivity} aria-label="Activity of the subscription owner" className={linkButton}>View activity</button>
      <p className="max-w-md text-xs text-slate-600">
        This account bought the subscription and has full access to everything it includes. It is kept apart from the operational users below and only the owner can change it.
      </p>
    </section>
  );
}

export default function UsersPageFrame() {
  return (
    <Suspense fallback={null}>
      <UsersPage />
    </Suspense>
  );
}

function UsersPage() {
  const { me, can, isReady } = useMe();
  const params = useSearchParams();
  const [filters, setFilters] = useState(() => ({ search: "", role: params.get("role") || "", status: "" }));
  const [page, setPage] = useState(0);
  const load = useCallback(() => identityService.users(filters), [filters]);
  const { data: users, error, isLoading, reload } = useData(load);
  const { data: roles } = useData(loadRoles);
  const { data: tree } = useData(loadTree);
  const { data: owner } = useData(loadOwner);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (isReady && !can("system.manage_users")) return <NoAccess />;

  const rows = users || [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(Math.min(page, pages - 1) * PAGE_SIZE, Math.min(page, pages - 1) * PAGE_SIZE + PAGE_SIZE);
  const filter = (change) => {
    setFilters({ ...filters, ...change });
    setPage(0);
  };

  const act = async (work, message) => {
    setActionError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const saved = (user, credentials) => {
    setModal(null);
    reload();
    if (!credentials) return setNotice(`Saved ${user.fullName}.`);
    setNotice(credentials.delivered
      ? `Created ${user.fullName} (${user.username}). Their sign-in details were emailed to ${user.email}.`
      : `Created ${user.fullName} (${user.username}). ${credentials.reason}`);
  };

  const remove = (user) => {
    if (!window.confirm(`Delete ${user.fullName} (${user.username})? Their account, permission overrides and registration details are removed. This cannot be undone.`)) return;
    act(() => identityService.deleteUser(user.id), `Deleted ${user.fullName}.`);
  };

  return (
    <SystemShell
      title="Users & Accounts"
      subtitle="The people who work in your institution's account. Add a user by choosing their role first; the role's registration form does the rest. Every change is logged."
      crumbs={[{ href: "/admin/system/role-permission", label: "Roles" }]}
      actions={<button onClick={() => setModal({ type: "add" })} disabled={!roles} className={`${primaryButton} disabled:opacity-50`}>Add New User</button>}
    >
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <OwnerCard owner={owner} isMe={owner?.id === me?.userId} onActivity={() => owner && setModal({ type: "details", user: owner, startOn: "activity" })} />

      <div className="flex flex-wrap gap-3">
        <input aria-label="Search users" value={filters.search} onChange={(e) => filter({ search: e.target.value })} placeholder="Search name, username, email or phone" className={`${filterClass} min-w-[16rem] flex-1`} />
        <select aria-label="Filter by role" value={filters.role} onChange={(e) => filter({ role: e.target.value })} className={filterClass}>
          <option value="">All roles</option>
          {(roles || []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => filter({ status: e.target.value })} className={filterClass}>
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <DataTable columns={["Name", "Email", "Role", "Status", "Last Login", "Created", "Actions"]} isLoading={isLoading && !users} hasRows={rows.length > 0} emptyMessage={filters.search || filters.role || filters.status ? "No users match." : "No users yet. Add the first one."} minWidth="min-w-[1000px]">
          {shown.map((user) => {
            const isSelf = user.id === me?.userId;
            const notSent = user.canLogIn && !user.credentialsSentAt;
            return (
              <tr key={user.id} className="border-b border-slate-100">
                <td className="px-4 py-3">
                  <button onClick={() => setModal({ type: "details", user })} className="text-left font-medium text-slate-800 hover:text-blue-700">{user.fullName}{isSelf ? " (you)" : ""}</button>
                  <p className="font-mono text-xs text-slate-500">{user.username}</p>
                  {user.linkedType && <p className="text-xs text-slate-500">{user.linkedType}: {user.linkedId}</p>}
                </td>
                <td className="px-4 py-3 text-slate-600"><p>{user.email || "—"}</p><p className="text-xs">{user.phone}</p></td>
                <td className="px-4 py-3 text-slate-700">{user.roleName}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={user.status === "ACTIVE" ? "Active" : "Inactive"} />
                    {user.isLocked && <StatusBadge status="Locked" />}
                    {notSent && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">Sign-in details not sent</span>}
                    {!notSent && user.mustChangePassword && user.canLogIn && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Temporary password</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(user.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-3 whitespace-nowrap">
                    <button onClick={() => setModal({ type: "details", user })} aria-label={`View ${user.fullName}`} className={linkButton}>View</button>
                    <button onClick={() => setModal({ type: "details", user, startOn: "activity" })} aria-label={`Activity of ${user.fullName}`} className={linkButton}>Activity</button>
                    <button onClick={() => setModal({ type: "edit", user })} aria-label={`Edit ${user.fullName}`} className={linkButton}>Edit</button>
                    {!isSelf && <button onClick={() => setModal({ type: "permissions", user })} aria-label={`Manage permissions of ${user.fullName}`} className={linkButton}>Manage Permissions</button>}
                    {user.role === "GUARDIAN" && <button onClick={() => setModal({ type: "wards", user })} aria-label={`Linked students of ${user.fullName}`} className={linkButton}>Students</button>}
                    {user.canLogIn && (
                      <button
                        onClick={() => window.confirm(notSent ? `Email the sign-in details to ${user.fullName}?` : `Email a new temporary password to ${user.fullName}? Their current password stops working.`)
                          && act(() => identityService.resetPassword(user.id), `Sign-in details were emailed to ${user.fullName}.`)}
                        aria-label={`Send new password to ${user.fullName}`}
                        className={linkButton}
                      >
                        {notSent ? "Send Sign-in Details" : "Send New Password"}
                      </button>
                    )}
                    {user.isLocked && <button onClick={() => act(() => identityService.updateUser(user.id, { unlock: true }), `Unlocked ${user.fullName}.`)} className={linkButton}>Unlock</button>}
                    {!isSelf && (
                      <button
                        onClick={() => act(() => identityService.updateUser(user.id, { status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }), `${user.fullName} is now ${user.status === "ACTIVE" ? "inactive" : "active"}.`)}
                        aria-label={`${user.status === "ACTIVE" ? "Deactivate" : "Activate"} ${user.fullName}`}
                        className={user.status === "ACTIVE" ? dangerButton : linkButton}
                      >
                        {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </button>
                    )}
                    {!isSelf && <button onClick={() => remove(user)} aria-label={`Delete ${user.fullName}`} className={dangerButton}>Delete</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>{rows.length} user(s) · page {Math.min(page, pages - 1) + 1} of {pages}</span>
            <span className="flex gap-3">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className={`${linkButton} disabled:opacity-40`}>Previous</button>
              <button onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} className={`${linkButton} disabled:opacity-40`}>Next</button>
            </span>
          </div>
        )}
      </section>

      {modal?.type === "add" && <AddUserModal roles={roles || []} canConfigure={can("system.manage_roles")} onClose={() => setModal(null)} onSaved={saved} />}
      {modal?.type === "edit" && <EditUserModal user={modal.user} roles={roles || []} onClose={() => setModal(null)} onSaved={saved} />}
      {modal?.type === "details" && <DetailsModal user={modal.user} startOn={modal.startOn} onClose={() => setModal(null)} />}
      {modal?.type === "wards" && (
        <WardsModal user={modal.user} onClose={() => setModal(null)} onSaved={() => { setModal(null); setNotice(`Saved the linked students of ${modal?.user?.fullName}.`); }} />
      )}
      {modal?.type === "permissions" && (
        <OverridesModal user={modal.user} tree={tree} onClose={() => setModal(null)} onSaved={() => { setModal(null); setNotice(`Saved the permissions of ${modal?.user?.fullName}. They apply on their next click.`); }} />
      )}
    </SystemShell>
  );
}
