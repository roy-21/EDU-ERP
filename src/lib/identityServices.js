import api from "./api";

const qs = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const text = search.toString();
  return text ? `?${text}` : "";
};

// Users, roles and permissions.
export const identityService = {
  me: () => api.get("/auth/me"),
  permissionTree: () => api.get("/system/permissions/tree"),
  roles: () => api.get("/system/roles"),
  createRole: (role) => api.post("/system/roles", role),
  updateRole: (id, role) => api.put(`/system/roles/${id}`, role),
  cloneRole: (id, name) => api.post(`/system/roles/${id}/clone`, { name }),
  deleteRole: (id) => api.delete(`/system/roles/${id}`),
  setRoleForm: (id, formId) => api.put(`/system/roles/${id}/form`, { formId: formId || null }),
  registrationForm: (roleId) => api.get(`/system/roles/${roleId}/registration-form`),
  users: (filters = {}) => api.get(`/system/users${qs(filters)}`),
  user: (id) => api.get(`/system/users/${id}`),
  lookupUsers: (query) => api.get(`/system/users/lookup${qs(query)}`),
  createUser: (user) => api.post("/system/users", user),
  registerUser: (body) => api.post("/system/users/register", body),
  owner: () => api.get("/system/users/owner"),
  userDetails: (id) => api.get(`/system/users/${id}/details`),
  userActivity: (id, params = {}) => api.get(`/system/users/${id}/activity${qs(params)}`),
  activity: (params = {}) => api.get(`/system/activity${qs(params)}`),
  deleteUser: (id) => api.delete(`/system/users/${id}`),
  removeOverride: (id, key) => api.delete(`/system/users/${id}/overrides/${encodeURIComponent(key)}`),
  updateUser: (id, user) => api.put(`/system/users/${id}`, user),
  resetPassword: (id) => api.post(`/system/users/${id}/reset-password`, {}),
  userPermissions: (id) => api.get(`/system/users/${id}/permissions`),
  setOverrides: (id, overrides) => api.put(`/system/users/${id}/overrides`, { overrides }),
  audit: (limit = 100) => api.get(`/system/audit?limit=${limit}`),
  wards: (id) => api.get(`/system/users/${id}/wards`),
  setWards: (id, wards) => api.put(`/system/users/${id}/wards`, { wards }),
};

export const formsApi = {
  list: (purpose) => api.get(`/system/forms${qs({ purpose })}`),
  get: (id) => api.get(`/system/forms/${id}`),
  create: (form) => api.post("/system/forms", form),
  update: (id, form) => api.put(`/system/forms/${id}`, form),
  publish: (id) => api.post(`/system/forms/${id}/publish`, {}),
  archive: (id) => api.post(`/system/forms/${id}/archive`, {}),
  version: (id, version) => api.get(`/system/forms/${id}/versions/${version}`),
  submissions: (id) => api.get(`/system/forms/${id}/submissions`),
  submit: (id, data) => api.post(`/system/forms/${id}/submissions`, { data }),
};

export const featuresApi = {
  list: () => api.get("/system/features"),
  create: (feature) => api.post("/system/features", feature),
  update: (id, feature) => api.put(`/system/features/${id}`, feature),
  publish: (id) => api.post(`/system/features/${id}/publish`, {}),
  archive: (id) => api.post(`/system/features/${id}/archive`, {}),
  available: () => api.get("/features"),
  records: (moduleId, key, search) => api.get(`/features/${moduleId}/${key}/records${qs({ search })}`),
  createRecord: (moduleId, key, data) => api.post(`/features/${moduleId}/${key}/records`, { data }),
  updateRecord: (moduleId, key, id, data) => api.put(`/features/${moduleId}/${key}/records/${id}`, { data }),
  deleteRecord: (moduleId, key, id) => api.delete(`/features/${moduleId}/${key}/records/${id}`),
};

export const tenancyApi = {
  plans: () => api.get("/public/plans"),
  quote: (moduleIds, billingCycle) => api.post("/public/quote", { moduleIds, billingCycle }),
  register: (details) => api.post("/public/register", details),
  mySubscription: () => api.get("/tenant/subscription"),
  requestModules: (moduleIds, note) => api.post("/tenant/subscription/requests", { moduleIds, note }),
  tenants: () => api.get("/platform/tenants"),
  setTenantStatus: (id, status, reason) => api.post(`/platform/tenants/${id}/status`, { status, reason }),
  resendAdminSignIn: (id) => api.post(`/platform/tenants/${id}/resend-admin`, {}),
  tenantOverview: (id) => api.get(`/platform/tenants/${id}/overview`),
  tenantActivity: (id, params = {}) => api.get(`/platform/tenants/${id}/activity${qs(params)}`),
  tenantUserActivity: (id, userId, params = {}) => api.get(`/platform/tenants/${id}/users/${userId}/activity${qs(params)}`),
  setTenantModules: (id, modules) => api.put(`/platform/tenants/${id}/modules`, { modules }),
  requests: (status) => api.get(`/platform/subscriptions${qs({ status })}`),
  approve: (id, note) => api.post(`/platform/subscriptions/${id}/approve`, { note }),
  reject: (id, note) => api.post(`/platform/subscriptions/${id}/reject`, { note }),
  modules: () => api.get("/platform/modules"),
  updateModule: (id, details) => api.put(`/platform/modules/${id}`, details),
  billing: (tenantId) => api.get(`/platform/billing${qs({ tenantId })}`),
  generateBilling: () => api.post("/platform/billing/generate", {}),
  recordBillingPayment: (id, payment) => api.post(`/platform/billing/${id}/payments`, payment),
  voidBilling: (id, reason) => api.post(`/platform/billing/${id}/void`, { reason }),
  setTenantBilling: (id, enabled) => api.post(`/platform/tenants/${id}/billing`, { enabled }),
};

// A guardian passes the ward's student ID; a student's own requests leave it out.
export const portalApi = {
  me: (student) => api.get(`/portal/me${qs({ student })}`),
  invoices: (student) => api.get(`/portal/invoices${qs({ student })}`),
  academics: (student) => api.get(`/portal/academics${qs({ student })}`),
  fees: (student) => api.get(`/portal/fees${qs({ student })}`),
  notices: () => api.get("/portal/notices"),
  library: (student) => api.get(`/portal/library${qs({ student })}`),
  payLink: (invoiceId, student) => api.post(`/portal/invoices/${invoiceId}/pay${qs({ student })}`, {}),
  meals: (student) => api.get(`/portal/meals${qs({ student })}`),
  mealImage: (id, student) => api.get(`/portal/meals/${id}/image${qs({ student })}`),
  book: (mealId, quantity) => api.post(`/portal/meals/${mealId}/book`, { quantity }),
  changeBooking: (id, quantity) => api.put(`/portal/meal-bookings/${id}`, { quantity }),
  cancelBooking: (id) => api.post(`/portal/meal-bookings/${id}/cancel`, {}),
};
