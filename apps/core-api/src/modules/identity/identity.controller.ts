import { NextFunction, Request, Response, Router } from "express";
import { requirePermissionKey, requireRole } from "../../middleware/auth.middleware";
import { HostelError, route, send } from "../hostel/hostel.common";
import { featuresService } from "../features/features.service";
import { formsService } from "../forms/forms.service";
import { permissionTree } from "./identity.catalog";
import { Actor, rolesService, usersService } from "./identity.service";
import { tenancyService } from "./tenancy.service";
import { activityService } from "./activity.service";
import { generateSubscriptionInvoices, subscriptionBilling } from "./billing.service";

export const actorOf = (req: Request): Actor => ({
  institutionId: req.institutionId as string,
  userId: req.user?.userId || "",
  email: req.user?.email || "",
  role: req.user?.role || "",
  permissions: req.user?.permissions || [],
});

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");

// ---- Public: plans and registration (no sign-in) -------------------------

export const publicIdentityRouter = Router();

publicIdentityRouter.get("/public/plans", route(async (_req, res) => {
  send(res, 200, await tenancyService.plans());
}));

publicIdentityRouter.post("/public/quote", route(async (req, res) => {
  send(res, 200, await tenancyService.quote(req.body?.moduleIds, req.body?.billingCycle));
}));

publicIdentityRouter.post("/public/register", route(async (req, res) => {
  send(res, 201, await tenancyService.register(req.body, req.ip || "unknown"));
}));

// ---- Signed in ------------------------------------------------------------

export const identityRouter = Router();

const canManageUsers = requirePermissionKey("system.manage_users");
const canManageRoles = requirePermissionKey("system.manage_roles");
const canSeeRoles = requirePermissionKey("system.manage_roles", "system.manage_users", "system.read");

identityRouter.get("/system/permissions/tree", canSeeRoles, route(async (req, res) => {
  const features = (await featuresService.list(req.institutionId as string)).filter((item) => item.status === "PUBLISHED");
  const extra = features.map((item) => ({
    moduleId: item.moduleId,
    feature: `Custom: ${item.name}`,
    permissions: ["read", "create", "update", "delete"].map((action) => ({ action: `feature.${item.key}.${action}`, label: { read: "View", create: "Add", update: "Edit", delete: "Delete" }[action] as string })),
  }));
  send(res, 200, permissionTree(new Set(req.user!.modules), extra));
}));

identityRouter.get("/system/roles", canSeeRoles, route(async (req, res) => {
  send(res, 200, await rolesService.list(req.institutionId as string));
}));

identityRouter.post("/system/roles", canManageRoles, route(async (req, res) => {
  send(res, 201, await rolesService.create(actorOf(req), req.body));
}));

identityRouter.put("/system/roles/:id", canManageRoles, route(async (req, res) => {
  send(res, 200, await rolesService.update(actorOf(req), req.params.id, req.body));
}));

identityRouter.post("/system/roles/:id/clone", canManageRoles, route(async (req, res) => {
  send(res, 201, await rolesService.clone(actorOf(req), req.params.id, req.body));
}));

identityRouter.put("/system/roles/:id/form", canManageRoles, route(async (req, res) => {
  send(res, 200, await rolesService.setForm(actorOf(req), req.params.id, req.body?.formId));
}));

identityRouter.get("/system/roles/:id/registration-form", canManageUsers, route(async (req, res) => {
  send(res, 200, await rolesService.registrationForm(req.institutionId as string, req.params.id));
}));

identityRouter.delete("/system/roles/:id", canManageRoles, route(async (req, res) => {
  send(res, 200, await rolesService.remove(actorOf(req), req.params.id));
}));

identityRouter.get("/system/users", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.list(req.institutionId as string, {
    search: query(req, "search"), role: query(req, "role"), status: query(req, "status"), includeOwner: query(req, "includeOwner") === "true",
  }));
}));

const activityFilters = (req: Request) => ({
  userId: query(req, "userId"), roleId: query(req, "roleId"), search: query(req, "search"), before: query(req, "before"), limit: Number(query(req, "limit")) || undefined,
});

// What the institution's users have been doing. Only people who manage users see it.
identityRouter.get("/system/activity", canManageUsers, route(async (req, res) => {
  send(res, 200, await activityService.list(req.institutionId as string, activityFilters(req)));
}));

identityRouter.get("/system/users/:id/activity", canManageUsers, route(async (req, res) => {
  send(res, 200, await activityService.user(req.institutionId as string, req.params.id, activityFilters(req)));
}));

identityRouter.get("/system/users/owner", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.owner(req.institutionId as string));
}));

// Role first: the account is made from the role's registration form.
identityRouter.post("/system/users/register", canManageUsers, route(async (req, res) => {
  send(res, 201, await usersService.register(actorOf(req), req.body));
}));

identityRouter.get("/system/users/lookup", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.lookup(req.institutionId as string, {
    email: query(req, "email"), phone: query(req, "phone"), linkedType: query(req, "linkedType"), linkedId: query(req, "linkedId"),
  }));
}));

identityRouter.get("/system/users/:id", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.get(req.institutionId as string, req.params.id));
}));

identityRouter.get("/system/users/:id/details", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.details(req.institutionId as string, req.params.id));
}));

identityRouter.delete("/system/users/:id", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.remove(actorOf(req), req.params.id));
}));

identityRouter.post("/system/users", canManageUsers, route(async (req, res) => {
  send(res, 201, await usersService.create(actorOf(req), req.body));
}));

identityRouter.put("/system/users/:id", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.update(actorOf(req), req.params.id, req.body));
}));

identityRouter.post("/system/users/:id/reset-password", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.resetPassword(actorOf(req), req.params.id));
}));

identityRouter.get("/system/users/:id/permissions", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.permissions(req.institutionId as string, req.params.id));
}));

identityRouter.put("/system/users/:id/overrides", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.setOverrides(actorOf(req), req.params.id, req.body));
}));

identityRouter.delete("/system/users/:id/overrides/:key", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.removeOverride(actorOf(req), req.params.id, req.params.key));
}));

identityRouter.get("/system/users/:id/wards", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.wards(req.institutionId as string, req.params.id));
}));

identityRouter.put("/system/users/:id/wards", canManageUsers, route(async (req, res) => {
  send(res, 200, await usersService.setWards(actorOf(req), req.params.id, req.body));
}));

identityRouter.get("/system/audit", requirePermissionKey("system.manage_users", "system.manage_roles"), route(async (req, res) => {
  send(res, 200, await usersService.auditLog(req.institutionId as string, Number(query(req, "limit")) || 100));
}));

// ---- Forms ----------------------------------------------------------------

const canBuildForms = requirePermissionKey("system.manage_forms");

identityRouter.get("/system/forms", requirePermissionKey("system.manage_forms", "system.manage_roles", "system.manage_features", "system.read"), route(async (req, res) => {
  send(res, 200, await formsService.list(req.institutionId as string, query(req, "purpose")));
}));

identityRouter.post("/system/forms", canBuildForms, route(async (req, res) => {
  send(res, 201, await formsService.create(actorOf(req), req.body));
}));

identityRouter.get("/system/forms/:id", requirePermissionKey("system.manage_forms", "system.manage_users", "system.read"), route(async (req, res) => {
  send(res, 200, await formsService.get(req.institutionId as string, req.params.id));
}));

identityRouter.put("/system/forms/:id", canBuildForms, route(async (req, res) => {
  send(res, 200, await formsService.update(actorOf(req), req.params.id, req.body));
}));

identityRouter.post("/system/forms/:id/publish", canBuildForms, route(async (req, res) => {
  send(res, 200, await formsService.publish(actorOf(req), req.params.id));
}));

identityRouter.post("/system/forms/:id/archive", canBuildForms, route(async (req, res) => {
  send(res, 200, await formsService.archive(actorOf(req), req.params.id));
}));

identityRouter.get("/system/forms/:id/versions/:version", canBuildForms, route(async (req, res) => {
  send(res, 200, await formsService.version(req.institutionId as string, req.params.id, Number(req.params.version)));
}));

identityRouter.get("/system/forms/:id/submissions", canBuildForms, route(async (req, res) => {
  send(res, 200, await formsService.submissions(req.institutionId as string, req.params.id));
}));

// Anyone signed in to the institution can fill a published general form.
identityRouter.get("/forms/:id", route(async (req, res) => {
  const form = await formsService.publishedFields(req.institutionId as string, req.params.id);
  const meta = await formsService.get(req.institutionId as string, req.params.id);
  if (meta.purpose !== "GENERAL") throw new HostelError(404, "Form not found.");
  send(res, 200, { id: meta.id, slug: meta.slug, title: meta.title, description: meta.description, version: form.version, fields: form.fields });
}));

identityRouter.post("/system/forms/:id/submissions", route(async (req, res) => {
  send(res, 201, await formsService.submit(actorOf(req), req.params.id, req.body?.data ?? req.body?.answers ?? req.body));
}));

// ---- Feature builder --------------------------------------------------------

const canBuildFeatures = requirePermissionKey("system.manage_features");

identityRouter.get("/system/features", canBuildFeatures, route(async (req, res) => {
  send(res, 200, await featuresService.list(req.institutionId as string));
}));

identityRouter.post("/system/features", canBuildFeatures, route(async (req, res) => {
  send(res, 201, await featuresService.create(actorOf(req), req.body));
}));

identityRouter.put("/system/features/:id", canBuildFeatures, route(async (req, res) => {
  send(res, 200, await featuresService.update(actorOf(req), req.params.id, req.body));
}));

identityRouter.post("/system/features/:id/publish", canBuildFeatures, route(async (req, res) => {
  send(res, 200, await featuresService.publish(actorOf(req), req.params.id));
}));

identityRouter.post("/system/features/:id/archive", canBuildFeatures, route(async (req, res) => {
  send(res, 200, await featuresService.archive(actorOf(req), req.params.id));
}));

identityRouter.get("/features", route(async (req, res) => {
  send(res, 200, await featuresService.available(req.institutionId as string, req.user!.permissions));
}));

// Each feature action is checked against that feature's own permission.
const featureAction = (action: string) => (req: Request, res: Response, next: NextFunction) =>
  requirePermissionKey(`${req.params.moduleId}.feature.${req.params.key}.${action}`)(req, res, next);

identityRouter.get("/features/:moduleId/:key/records", featureAction("read"), route(async (req, res) => {
  send(res, 200, await featuresService.records(req.institutionId as string, req.params.moduleId, req.params.key, query(req, "search")));
}));

identityRouter.post("/features/:moduleId/:key/records", featureAction("create"), route(async (req, res) => {
  send(res, 201, await featuresService.createRecord(actorOf(req), req.params.moduleId, req.params.key, req.body?.data));
}));

identityRouter.put("/features/:moduleId/:key/records/:recordId", featureAction("update"), route(async (req, res) => {
  send(res, 200, await featuresService.updateRecord(actorOf(req), req.params.moduleId, req.params.key, req.params.recordId, req.body?.data));
}));

identityRouter.delete("/features/:moduleId/:key/records/:recordId", featureAction("delete"), route(async (req, res) => {
  send(res, 200, await featuresService.deleteRecord(actorOf(req), req.params.moduleId, req.params.key, req.params.recordId));
}));

// ---- The institution's own subscription -----------------------------------

identityRouter.get("/tenant/subscription", requireRole(["ADMIN"]), route(async (req, res) => {
  send(res, 200, await tenancyService.mySubscription(req.institutionId as string));
}));

identityRouter.post("/tenant/subscription/requests", requireRole(["ADMIN"]), route(async (req, res) => {
  send(res, 201, await tenancyService.requestModules(actorOf(req), req.body));
}));

// ---- Platform owner only --------------------------------------------------

const platformOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role === "SUPER_ADMIN") return next();
  res.status(403).json({ success: false, statusCode: 403, error: "Only the platform's super admin can do this." });
};

identityRouter.get("/platform/tenants", platformOnly, route(async (_req, res) => {
  send(res, 200, await tenancyService.listTenants());
}));

identityRouter.get("/platform/tenants/:id", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.getTenant(req.params.id));
}));

// The platform owner looks inside one institution: its users, roles and what they have done.
identityRouter.get("/platform/tenants/:id/overview", platformOnly, route(async (req, res) => {
  send(res, 200, await activityService.tenantOverview(req.params.id));
}));

identityRouter.get("/platform/tenants/:id/activity", platformOnly, route(async (req, res) => {
  await tenancyService.getTenant(req.params.id);
  send(res, 200, await activityService.list(req.params.id, activityFilters(req)));
}));

identityRouter.get("/platform/tenants/:id/users/:userId/activity", platformOnly, route(async (req, res) => {
  send(res, 200, await activityService.user(req.params.id, req.params.userId, activityFilters(req)));
}));

identityRouter.post("/platform/tenants/:id/status", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.setStatus(actorOf(req), req.params.id, req.body?.status, req.body?.reason));
}));

identityRouter.post("/platform/tenants/:id/resend-admin", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.resendAdminSignIn(actorOf(req), req.params.id));
}));

identityRouter.put("/platform/tenants/:id/modules", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.setModules(actorOf(req), req.params.id, req.body));
}));

identityRouter.get("/platform/subscriptions", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.listRequests(query(req, "status")));
}));

identityRouter.post("/platform/subscriptions/:id/approve", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.decide(actorOf(req), req.params.id, true, req.body?.note));
}));

identityRouter.post("/platform/subscriptions/:id/reject", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.decide(actorOf(req), req.params.id, false, req.body?.note));
}));

identityRouter.get("/platform/billing", platformOnly, route(async (req, res) => {
  send(res, 200, await subscriptionBilling.list(query(req, "tenantId")));
}));

identityRouter.post("/platform/tenants/:id/billing", platformOnly, route(async (req, res) => {
  send(res, 200, await subscriptionBilling.setEnabled(actorOf(req), req.params.id, req.body?.enabled === true));
}));

identityRouter.post("/platform/billing/generate", platformOnly, route(async (_req, res) => {
  send(res, 200, await generateSubscriptionInvoices());
}));

identityRouter.post("/platform/billing/:id/payments", platformOnly, route(async (req, res) => {
  send(res, 201, await subscriptionBilling.recordPayment(actorOf(req), req.params.id, req.body));
}));

identityRouter.post("/platform/billing/:id/void", platformOnly, route(async (req, res) => {
  send(res, 200, await subscriptionBilling.voidInvoice(actorOf(req), req.params.id, req.body?.reason));
}));

identityRouter.get("/platform/modules", platformOnly, route(async (_req, res) => {
  send(res, 200, await tenancyService.catalogAll());
}));

identityRouter.put("/platform/modules/:id", platformOnly, route(async (req, res) => {
  send(res, 200, await tenancyService.updateModulePrice(actorOf(req), req.params.id, req.body));
}));
