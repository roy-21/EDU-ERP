// The modules a tenant can subscribe to, and the permission tree built from them.
// A permission key is "<module>.<action>", for example "hostel.manage_payments".

export type ModuleDefinition = {
  id: string;
  name: string;
  category: string;
  icon: string;
  monthlyPrice: number;
  isCore: boolean;
};

const m = (id: string, name: string, category: string, icon: string, monthlyPrice: number, isCore = false): ModuleDefinition => ({
  id, name, category, icon, monthlyPrice, isCore,
});

// Core modules come with every subscription. Prices are defaults; a platform admin can change them.
export const MODULES: ModuleDefinition[] = [
  m("system", "System Configuration & RBAC", "Governance", "⚙️", 0, true),
  m("institution", "Institution & Campus Setup", "Governance", "🏛️", 0, true),
  m("student", "Student Information & Profiles", "Academics", "🎓", 1500),
  m("guardian", "Guardian Management & Portal", "Academics", "👨‍👩‍👧", 800),
  m("teacher", "Teacher & Faculty Directory", "Academics", "👨‍🏫", 1000),
  m("classroom", "Classroom & Schedules", "Academics", "🏫", 800),
  m("application", "Admissions & Applications", "Enrollment", "📝", 1200),
  m("attendance", "Attendance & Biometrics", "Operations", "📋", 1200),
  m("examination", "Examination & Grading", "Academics", "📑", 1500),
  m("finance", "Finance, Billing & Fees", "Finance", "💳", 2000),
  m("hr", "HR Management & Payroll", "HR", "🧑‍💼", 1500),
  m("library", "Library Catalog & LMS", "Academics", "📚", 800),
  m("hostel", "Hostel & Accommodation", "Operations", "🛏️", 2500),
  m("transport", "Transport & Fleet Management", "Operations", "🚌", 1200),
  m("notice", "Notice Board & Bulletins", "Communication", "📢", 0, true),
  m("notification", "Multi-Channel Notifications", "Communication", "🔔", 800),
  m("objection", "Objection & Grievance Cell", "Governance", "⚖️", 600),
  m("certificate", "Certificate & Transcript Generation", "Academics", "📜", 800),
  m("scholarship", "Scholarships & Financial Aid", "Finance", "🎗️", 800),
  m("inventory", "Inventory & Assets", "Operations", "📦", 1000),
  m("lms", "Learning Management (LMS)", "Academics", "💻", 2000),
  m("research", "Research & Grants", "Academics", "🔬", 1000),
  m("voting", "Voting & Elections", "Governance", "🗳️", 500),
  m("workflow", "Automated Workflow Engine", "Operations", "🔄", 1500),
  m("reports", "Institutional Reports & BI", "Analytics", "📊", 1500),
  m("ai-analytics", "AI Risk & Dropout Analytics", "AI & Intelligence", "🧠", 3000),
  m("voice-ai", "Voice & Message Assistant", "AI & Intelligence", "🎙️", 3000),
  m("api", "API Gateway & Integrations", "Infrastructure", "🔌", 1000),
  m("document", "Document Management Vault", "Operations", "📁", 800),
  m("import-export", "Data Import & Export Hub", "Infrastructure", "💾", 500),
  m("monitoring", "Live System Monitoring & Audit", "Infrastructure", "📈", 800),
  m("settings", "System & Security Settings", "Governance", "🔒", 0, true),
];

export const CORE_MODULES = MODULES.filter((item) => item.isCore).map((item) => item.id);
export const MODULE_IDS = MODULES.map((item) => item.id);

export const STANDARD_ACTIONS: { action: string; label: string; legacy: string }[] = [
  { action: "read", label: "View", legacy: "canRead" },
  { action: "create", label: "Create", legacy: "canCreate" },
  { action: "update", label: "Edit", legacy: "canUpdate" },
  { action: "delete", label: "Delete", legacy: "canDelete" },
  { action: "approve", label: "Approve", legacy: "canApprove" },
  { action: "export", label: "Export", legacy: "canExport" },
];

// Finer permissions inside a module, grouped by feature.
export const MODULE_FEATURES: Record<string, { feature: string; permissions: { action: string; label: string }[] }[]> = {
  hostel: [
    { feature: "Rooms and seats", permissions: [
      { action: "view_rooms", label: "View rooms and seats" },
      { action: "manage_rooms", label: "Manage rooms, seats and seat rent" },
    ] },
    { feature: "Students", permissions: [
      { action: "manage_allocations", label: "Allocate, transfer and vacate" },
      { action: "manage_students", label: "See full student details and NID" },
    ] },
    { feature: "Rent and payments", permissions: [
      { action: "configure_rent", label: "Configure rent and billing" },
      { action: "manage_payments", label: "Record and reverse payments" },
      { action: "view_due_rent", label: "View dues and ledgers" },
      { action: "send_reminders", label: "Send reminders" },
      { action: "export_reports", label: "Export reports" },
    ] },
    { feature: "Operations", permissions: [
      { action: "manage_meals", label: "Manage meals and orders" },
      { action: "manage_visitors", label: "Manage visitors" },
      { action: "manage_fees", label: "Manage fees and student groups" },
    ] },
  ],
  inventory: [
    { feature: "Stock", permissions: [
      { action: "manage_stock", label: "Receive, issue and take back stock" },
      { action: "adjust_stock", label: "Adjust counts and write off damage or loss" },
      { action: "transfer_stock", label: "Request and receive store transfers" },
      { action: "manage_kitchen", label: "Record kitchen use, wastage and meals served" },
    ] },
    { feature: "Requisitions", permissions: [
      { action: "request_items", label: "Ask the store for items (sees only their own requisitions)" },
    ] },
    { feature: "Purchasing", permissions: [
      { action: "manage_purchases", label: "Manage suppliers and draft purchase orders" },
    ] },
    { feature: "Assets", permissions: [
      { action: "manage_assets", label: "Assign, return, repair and dispose of assets" },
    ] },
  ],
  system: [
    { feature: "Users and roles", permissions: [
      { action: "manage_users", label: "Create and edit users" },
      { action: "manage_roles", label: "Create and edit roles" },
      { action: "manage_forms", label: "Build forms" },
      { action: "manage_features", label: "Build custom features" },
    ] },
  ],
};

export const permissionKey = (moduleId: string, action: string) => `${moduleId}.${action}`;
export const moduleOf = (key: string) => key.split(".")[0];

// Every permission that exists, before custom features are added.
export const ALL_PERMISSION_KEYS: string[] = MODULES.flatMap((module) => [
  ...STANDARD_ACTIONS.map((item) => permissionKey(module.id, item.action)),
  ...(MODULE_FEATURES[module.id] || []).flatMap((group) => group.permissions.map((item) => permissionKey(module.id, item.action))),
]);

// Built-in roles. They cannot be edited or deleted; custom roles cover everything else.
export const SYSTEM_ROLES: Record<string, { name: string; portalType: string; description: string; permissions: "ALL" | string[]; canLogIn: boolean }> = {
  SUPER_ADMIN: { name: "Super Admin", portalType: "ADMIN", description: "Runs the platform: every permission, plus tenants and subscriptions.", permissions: "ALL", canLogIn: true },
  ADMIN: { name: "Institution Admin", portalType: "ADMIN", description: "Every permission inside this institution.", permissions: "ALL", canLogIn: true },
  HOSTEL_WARDEN: {
    name: "Hostel Warden", portalType: "STAFF", description: "Runs the hostel day to day.", canLogIn: true,
    permissions: ["hostel.read", "hostel.view_rooms", "hostel.manage_rooms", "hostel.manage_allocations", "hostel.manage_students",
      "hostel.manage_payments", "hostel.view_due_rent", "hostel.send_reminders", "hostel.manage_meals", "hostel.manage_visitors"],
  },
  ACCOUNTANT: {
    name: "Accountant", portalType: "STAFF", description: "Bills fees and records payments for tuition and the hostel.", canLogIn: true,
    permissions: ["hostel.read", "hostel.view_rooms", "hostel.manage_payments", "hostel.view_due_rent", "hostel.send_reminders",
      "hostel.export_reports", "hostel.manage_fees", "finance.read", "finance.create", "finance.update", "finance.export", "notice.read"],
  },
  TEACHER: {
    name: "Teacher", portalType: "TEACHER", description: "Teaching staff.", canLogIn: true,
    permissions: ["student.read", "classroom.read", "attendance.read", "attendance.create", "attendance.update", "examination.read",
      "examination.create", "library.read", "lms.read", "notice.read", "inventory.request_items"],
  },
  STOREKEEPER: {
    name: "Storekeeper", portalType: "STAFF", description: "Runs the stores: receives, issues and transfers stock, records kitchen use and looks after assets.", canLogIn: true,
    permissions: ["inventory.read", "inventory.manage_stock", "inventory.transfer_stock", "inventory.manage_assets", "inventory.manage_kitchen",
      "inventory.request_items", "inventory.export", "notice.read"],
  },
  STAFF: { name: "Staff", portalType: "STAFF", description: "General staff: notices, and asking the store for items.", permissions: ["notice.read", "inventory.request_items"], canLogIn: true },
  STUDENT: { name: "Student", portalType: "STUDENT", description: "Uses the student portal for their own records.", permissions: [], canLogIn: true },
  GUARDIAN: { name: "Guardian", portalType: "GUARDIAN", description: "Uses the guardian portal.", permissions: [], canLogIn: true },
  NOT_SYSTEM_USER: {
    name: "Not System User", portalType: "NONE", canLogIn: false, permissions: [],
    description: "A person kept on record who cannot sign in, such as a contact or a guardian without portal access.",
  },
};

export const isSystemRole = (role: string) => Object.prototype.hasOwnProperty.call(SYSTEM_ROLES, role);

// The tree an admin ticks through: module, then feature, then action.
export const permissionTree = (entitled: Set<string>, extra: { moduleId: string; feature: string; permissions: { action: string; label: string }[] }[] = []) =>
  MODULES.map((module) => ({
    id: module.id,
    name: module.name,
    category: module.category,
    icon: module.icon,
    entitled: entitled.has(module.id),
    groups: [
      { feature: "Standard actions", permissions: STANDARD_ACTIONS.map((item) => ({ key: permissionKey(module.id, item.action), label: item.label })) },
      ...[...(MODULE_FEATURES[module.id] || []), ...extra.filter((item) => item.moduleId === module.id)].map((group) => ({
        feature: group.feature,
        permissions: group.permissions.map((item) => ({ key: permissionKey(module.id, item.action), label: item.label })),
      })),
    ],
  }));

// The old screen sends one row of tick boxes per module. These convert both ways.
export const keysFromLegacy = (rows: any[]): string[] => {
  const keys = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.moduleId !== "string") continue;
    if (row.moduleId === "all") {
      ALL_PERMISSION_KEYS.forEach((key) => keys.add(key));
      continue;
    }
    if (!MODULE_IDS.includes(row.moduleId)) continue;
    STANDARD_ACTIONS.forEach((item) => row[item.legacy] === true && keys.add(permissionKey(row.moduleId, item.action)));
    const finer = row.featurePermissions ?? row.hostelPermissions;
    if (Array.isArray(finer)) {
      const allowed = (MODULE_FEATURES[row.moduleId] || []).flatMap((group) => group.permissions.map((item) => item.action));
      finer.filter((action: unknown) => typeof action === "string" && allowed.includes(action)).forEach((action: string) => keys.add(permissionKey(row.moduleId, action)));
    } else if (row.moduleId === "hostel" && row.canRead === true) {
      keys.add("hostel.view_rooms");
    }
  }
  return [...keys];
};

export const legacyFromKeys = (keys: string[]) => {
  const set = new Set(keys);
  return MODULES.map((module) => {
    const row: Record<string, any> = { moduleId: module.id };
    STANDARD_ACTIONS.forEach((item) => (row[item.legacy] = set.has(permissionKey(module.id, item.action))));
    const finer = (MODULE_FEATURES[module.id] || []).flatMap((group) => group.permissions.map((item) => item.action));
    if (finer.length > 0) {
      row.featurePermissions = finer.filter((action) => set.has(permissionKey(module.id, action)));
      if (module.id === "hostel") row.hostelPermissions = row.featurePermissions;
    }
    return row;
  }).filter((row) => Object.entries(row).some(([key, value]) => key !== "moduleId" && (value === true || (Array.isArray(value) && value.length > 0))));
};
