// Which admin pages a signed-in user may open, decided from the permissions the server resolved for them
// (role + their own overrides, limited to the subscription). The server enforces every request anyway;
// this keeps the menu and the pages honest so nobody sees a page they cannot use.

// Pages every signed-in staff member may open, whatever their role.
const SELF_SERVICE = ["/admin/hr/me"];

// Pages that need a particular permission, not just any permission in their module.
const PAGE_RULES = [
  { prefix: "/admin/system/users", any: ["system.manage_users"] },
  { prefix: "/admin/system/role-permission", any: ["system.manage_roles", "system.manage_users", "system.read"] },
  { prefix: "/admin/system/form-builder", any: ["system.manage_forms"] },
  { prefix: "/admin/system/features", any: ["system.manage_features"] },
];

const under = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// Any one permission inside the module opens it. Built-in admin roles hold every permission of their subscription.
export const hasModuleAccess = (me, moduleId) => !me || (me.permissions || []).some((key) => key.startsWith(`${moduleId}.`));

// { ok: true } or { ok: false, reason } for an /admin path.
export const pathAccess = (me, pathname) => {
  if (!me || !pathname?.startsWith("/admin")) return { ok: true };
  const path = pathname.split("?")[0].replace(/\/$/, "");
  if (path === "/admin" || SELF_SERVICE.some((prefix) => under(path, prefix))) return { ok: true };
  const [, , section, moduleId, featureKey] = path.split("/");
  if (section === "platform") return me.role === "SUPER_ADMIN" ? { ok: true } : { ok: false, reason: "Only the platform's super admin can open this page." };
  if (section === "features") {
    if (!moduleId || !featureKey) return { ok: true };
    return (me.permissions || []).includes(`${moduleId}.feature.${featureKey}.read`) ? { ok: true } : { ok: false, reason: "You do not have permission to open this feature." };
  }
  if (me.modules && !me.modules.includes(section)) return { ok: false, notSubscribed: true, reason: "Your institution's subscription does not include this module." };
  const rule = PAGE_RULES.find((item) => under(path, item.prefix));
  if (rule) return rule.any.some((key) => (me.permissions || []).includes(key)) ? { ok: true } : { ok: false, reason: "You do not have permission to open this page." };
  return hasModuleAccess(me, section) ? { ok: true } : { ok: false, reason: "You do not have permission to open this module." };
};
