"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formsApi, identityService } from "@/lib/identityServices";
import { refreshMe, useMe } from "@/lib/useMe";
import PermissionTree from "@/components/erp/PermissionTree";
import { ActivityList } from "@/components/erp/ActivityViews";
import {
  ErrorBanner,
  FormModal,
  NoAccess,
  SelectField,
  SystemShell,
  TextField,
  dangerButton,
  friendlyError,
  linkButton,
  primaryButton,
  secondaryButton,
  useData,
  ViewModal,
} from "@/components/erp/ui";

const PORTALS = ["STAFF", "TEACHER", "ADMIN", "STUDENT", "GUARDIAN"];
const PARENTABLE = ["HOSTEL_WARDEN", "ACCOUNTANT", "STOREKEEPER", "TEACHER", "STAFF"];

// Roles this one may build on: staff built-ins and other custom roles (not itself).
const parentOptions = (roles, selfId) => [
  { value: "", label: "None" },
  ...roles.filter((role) => (role.isSystem ? PARENTABLE.includes(role.id) : role.id !== selfId)).map((role) => ({ value: role.id, label: `${role.name}${role.isSystem ? " (built-in)" : ""}` })),
];

// Everything a parent gives: its own and its ancestors' permissions.
const inheritedFrom = (roles, parentId) => {
  const parent = roles.find((role) => role.id === parentId);
  if (!parent) return [];
  return parent.isSystem ? parent.permissionKeys : parent.effectiveKeys || parent.permissionKeys;
};
const loadRoles = () => identityService.roles();
const loadTree = () => identityService.permissionTree();
const loadProfileForms = () => formsApi.list("USER_PROFILE");

function RoleForm({ forms, roles, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", description: "", portalType: "STAFF", formId: "", parentRoleId: "" });
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const handleSubmit = async () => {
    const role = await identityService.createRole({ ...form, formId: form.formId || null, parentRoleId: form.parentRoleId || null, permissionKeys: [] });
    onSaved(role);
  };
  return (
    <FormModal title="New Role" submitLabel="Create Role" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="role-name" label="Role Name *" value={form.name} maxLength={100} onChange={set("name")} />
      <SelectField id="role-portal" label="Portal" value={form.portalType} onChange={set("portalType")} options={PORTALS} />
      <TextField id="role-description" label="Description" value={form.description} maxLength={500} onChange={set("description")} wide />
      <SelectField id="role-parent" label="Builds On (inherits its permissions)" value={form.parentRoleId} onChange={set("parentRoleId")} options={parentOptions(roles, null)} wide />
      <SelectField
        id="role-form"
        label="Registration Form (needed to add its users)"
        value={form.formId}
        onChange={set("formId")}
        options={[{ value: "", label: "None" }, ...forms.filter((item) => item.status === "PUBLISHED").map((item) => ({ value: item.id, label: item.title }))]}
        wide
      />
      <p className="text-xs text-slate-500 sm:col-span-2">The role starts with its parent&apos;s permissions only. Add its own in the tree after it is created; a parent&apos;s later changes reach it too.</p>
    </FormModal>
  );
}

export default function RolePermissionPageFrame() {
  return (
    <Suspense fallback={null}>
      <RolePermissionPage />
    </Suspense>
  );
}

// A built-in role cannot be edited, but it can still be given the form its new users are registered with.
function BuiltInRoleForm({ role, forms, onSave }) {
  const options = [{ value: "", label: "None (users of this role cannot be added yet)" }, ...forms.filter((item) => item.status === "PUBLISHED").map((item) => ({ value: item.id, label: item.title }))];
  return (
    <div className="mt-3 max-w-md">
      <SelectField id="system-role-form" label="Registration Form for New Users" value={role.formId || ""} onChange={(value) => onSave(value)} options={options} />
      <p className="mt-1 text-xs text-slate-500">Shown when someone adds a {role.name} on the Users page. Make one in the Form Builder with the purpose &quot;User profile&quot;.</p>
    </div>
  );
}

// Everything the users of one role have done.
function RoleActivityModal({ role, onClose }) {
  const load = useCallback((params) => identityService.activity({ ...params, roleId: role.id }), [role.id]);
  return (
    <ViewModal title={`Activity: ${role.name}`} onClose={onClose} wide>
      <p className="text-sm text-slate-600">What every user with the {role.name} role has done, newest first.</p>
      <ActivityList load={load} />
    </ViewModal>
  );
}

function RolePermissionPage() {
  const { can, isReady } = useMe();
  const params = useSearchParams();
  const { data: roles, error, reload } = useData(loadRoles);
  const { data: tree } = useData(loadTree);
  const { data: forms } = useData(loadProfileForms);
  const [selectedId, setSelectedId] = useState(() => params.get("role") || "");
  const [edits, setEdits] = useState({});
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [creating, setCreating] = useState(false);
  const [activityRole, setActivityRole] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const selected = useMemo(() => roles?.find((role) => role.id === selectedId) || roles?.[0], [roles, selectedId]);

  // Unsaved changes are kept per role, so switching roles never mixes them up.
  const draft = selected ? edits[selected.id] || { ...selected, permissionKeys: [...selected.permissionKeys] } : null;
  const setDraft = (next) => setEdits((previous) => ({ ...previous, [selected.id]: typeof next === "function" ? next(draft) : next }));
  const discard = (id) => setEdits((previous) => {
    const rest = { ...previous };
    delete rest[id];
    return rest;
  });

  const act = useCallback(async (work, message) => {
    setActionError("");
    setNotice("");
    try {
      const result = await work();
      setNotice(message);
      reload();
      refreshMe(true);
      return result;
    } catch (err) {
      setActionError(friendlyError(err));
      return null;
    }
  }, [reload]);

  if (isReady && !can("system.manage_roles", "system.manage_users", "system.read")) return <NoAccess />;

  const canEdit = can("system.manage_roles") && draft && !draft.isSystem;
  const changed = draft && selected && (draft.name !== selected.name || draft.description !== selected.description || (draft.formId || "") !== (selected.formId || "") || (draft.parentRoleId || "") !== (selected.parentRoleId || "") ||
    draft.permissionKeys.slice().sort().join() !== selected.permissionKeys.slice().sort().join());

  const toggle = (keys, on) =>
    setDraft((previous) => {
      const next = new Set(previous.permissionKeys);
      keys.forEach((key) => (on ? next.add(key) : next.delete(key)));
      return { ...previous, permissionKeys: [...next] };
    });

  const save = () => {
    if (!draft) return;
    setIsSaving(true);
    act(() => identityService.updateRole(draft.id, { name: draft.name, description: draft.description, formId: draft.formId || null, parentRoleId: draft.parentRoleId || null, permissionKeys: draft.permissionKeys }), `Saved ${draft.name}. The change applies to its users right away.`)
      .then((role) => role && discard(role.id))
      .finally(() => setIsSaving(false));
  };

  return (
    <SystemShell
      title="Roles & Permissions"
      subtitle="Built-in roles are fixed. Make custom roles for everything else; a change applies to every user with that role on their next click."
      crumbs={[{ href: "/admin/system/users", label: "Users" }]}
      actions={can("system.manage_roles") && <button onClick={() => setCreating(true)} className={primaryButton}>New Role</button>}
    >
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-1" aria-label="Roles">
          <ul className="space-y-1">
            {(roles || []).map((role) => (
              <li key={role.id}>
                <button
                  onClick={() => setSelectedId(role.id)}
                  aria-current={selected?.id === role.id}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${selected?.id === role.id ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{role.name}</span>
                    <span className="text-xs text-slate-500">{role.userCount} user(s)</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {role.isSystem ? "Built-in" : "Custom"} · {role.portalType}{role.canLogIn === false ? " · cannot sign in" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          {draft && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1">
                  {canEdit ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <TextField id="edit-role-name" label="Role Name" value={draft.name} maxLength={100} onChange={(value) => setDraft({ ...draft, name: value })} />
                      <SelectField
                        id="edit-role-form"
                        label="Registration Form for New Users"
                        value={draft.formId || ""}
                        onChange={(value) => setDraft({ ...draft, formId: value })}
                        options={[{ value: "", label: "None" }, ...(forms || []).filter((item) => item.status === "PUBLISHED").map((item) => ({ value: item.id, label: item.title }))]}
                      />
                      <SelectField id="edit-role-parent" label="Builds On" value={draft.parentRoleId || ""} onChange={(value) => setDraft({ ...draft, parentRoleId: value })} options={parentOptions(roles || [], draft.id)} />
                      <TextField id="edit-role-description" label="Description" value={draft.description} maxLength={500} onChange={(value) => setDraft({ ...draft, description: value })} />
                    </div>
                  ) : (
                    <>
                      <h2 className="text-lg font-bold text-slate-800">{draft.name}</h2>
                      <p className="text-sm text-slate-500">{draft.description}</p>
                      {draft.isSystem && <p className="mt-1 text-xs text-amber-700">Built-in role: its permissions are fixed. Clone it to make a changeable copy.</p>}
                      {draft.isSystem && draft.id !== "SUPER_ADMIN" && can("system.manage_roles") && (
                        <BuiltInRoleForm
                          role={selected}
                          forms={forms || []}
                          onSave={(formId) => act(() => identityService.setRoleForm(selected.id, formId), formId ? `${selected.name} users are now registered with the chosen form.` : `${selected.name} no longer has a registration form.`)}
                        />
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {can("system.manage_roles") && draft.id !== "NOT_SYSTEM_USER" && (
                    <button
                      onClick={() => {
                        const name = window.prompt("Name for the copy:", `${draft.name} (copy)`);
                        if (name) act(() => identityService.cloneRole(draft.id, name), `Made ${name}.`).then((role) => role && setSelectedId(role.id));
                      }}
                      className={secondaryButton}
                    >
                      Clone
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => window.confirm(`Delete the role ${draft.name}?`) && act(() => identityService.deleteRole(draft.id), `Deleted ${draft.name}.`).then(() => setSelectedId(""))}
                      className={`${dangerButton} rounded-lg border border-red-200 px-3 py-2 text-sm`}
                    >
                      Delete
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={save} disabled={!changed || isSaving} className={`${primaryButton} disabled:opacity-50`}>
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-slate-600">
                {draft.permissionKeys.length} own permission(s)
                {!draft.isSystem && draft.parentRoleId ? `, plus ${inheritedFrom(roles || [], draft.parentRoleId).length} from the parent role` : ""}.{" "}
                <Link href={`/admin/system/users?role=${encodeURIComponent(draft.id)}`} className={linkButton}>See its users</Link>
                {can("system.manage_users") && <> · <button onClick={() => setActivityRole(selected)} className={linkButton} aria-label={`Activity of the ${draft.name} role`}>See activity</button></>}
              </p>
              {tree ? (
                <PermissionTree tree={tree} selected={draft.permissionKeys} inherited={draft.isSystem ? [] : inheritedFrom(roles || [], draft.parentRoleId)} onToggle={toggle} readOnly={!canEdit} />
              ) : (
                <p className="text-sm text-slate-500">Loading permissions...</p>
              )}
            </>
          )}
        </section>
      </div>

      {activityRole && <RoleActivityModal role={activityRole} onClose={() => setActivityRole(null)} />}
      {creating && (
        <RoleForm
          forms={forms || []}
          roles={roles || []}
          onClose={() => setCreating(false)}
          onSaved={(role) => {
            setCreating(false);
            setNotice(`Created ${role.name}. Now choose its permissions.`);
            reload();
            setSelectedId(role.id);
          }}
        />
      )}
    </SystemShell>
  );
}
