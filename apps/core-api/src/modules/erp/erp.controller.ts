import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/db";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { HostelError, route, send } from "../hostel/hostel.common";
import { usersService } from "../identity/identity.service";
import { postgresService } from "../../database/postgres";
import { actorOf } from "../identity/identity.controller";

export const erpRouter = Router();

// ==========================================
// ALL 32 INSTITUTIONAL ERP MODULES
// ==========================================
export const ALL_32_MODULES = [
  { id: "system", name: "1. System Configuration & RBAC", category: "Governance", icon: "⚙️" },
  { id: "institution", name: "2. Institution & Campus Setup", category: "Governance", icon: "🏛️" },
  { id: "student", name: "3. Student Information & Profiles", category: "Academics", icon: "🎓" },
  { id: "guardian", name: "4. Guardian Management & Portal", category: "Academics", icon: "👨‍👩‍👧" },
  { id: "teacher", name: "5. Teacher & Faculty Directory", category: "Academics", icon: "👨‍🏫" },
  { id: "classroom", name: "6. Classroom & Schedules", category: "Academics", icon: "🏫" },
  { id: "application", name: "7. Admissions & Applications", category: "Enrollment", icon: "📝" },
  { id: "attendance", name: "8. Attendance & Biometrics", category: "Operations", icon: "📋" },
  { id: "examination", name: "9. Examination & Grading", category: "Academics", icon: "📑" },
  { id: "finance", name: "10. Finance, Billing & Fees", category: "Finance", icon: "💳" },
  { id: "hr", name: "11. HR Management & Payroll", category: "HR", icon: "🧑‍💼" },
  { id: "library", name: "12. Library Catalog & LMS", category: "Academics", icon: "📚" },
  { id: "hostel", name: "13. Hostel & Accommodation", category: "Operations", icon: "🛏️" },
  { id: "transport", name: "14. Transport & Fleet Management", category: "Operations", icon: "🚌" },
  { id: "notice", name: "15. Notice Board & Bulletins", category: "Communication", icon: "📢" },
  { id: "notification", name: "16. Multi-Channel Notifications", category: "Communication", icon: "🔔" },
  { id: "objection", name: "17. Objection & Grievance Cell", category: "Governance", icon: "⚖️" },
  { id: "certificate", name: "18. Certificate & Transcript Generation", category: "Academics", icon: "📜" },
  { id: "scholarship", name: "19. Scholarships & Financial Aid", category: "Finance", icon: "🎗️" },
  { id: "inventory", name: "20. Inventory & Assets", category: "Operations", icon: "📦" },
  { id: "lms", name: "21. Learning Management (LMS)", category: "Academics", icon: "💻" },
  { id: "research", name: "22. Research & Grants", category: "Academics", icon: "🔬" },
  { id: "voting", name: "23. Voting & Elections", category: "Governance", icon: "🗳️" },
  { id: "workflow", name: "24. Automated Workflow Engine", category: "Operations", icon: "🔄" },
  { id: "reports", name: "25. Institutional Reports & BI", category: "Analytics", icon: "📊" },
  { id: "ai-analytics", name: "26. AI Risk & Dropout Analytics", category: "AI & Intelligence", icon: "🧠" },
  { id: "voice-ai", name: "27. Voice & Message Assistant", category: "AI & Intelligence", icon: "🎙️" },
  { id: "api", name: "28. API Gateway & Integrations", category: "Infrastructure", icon: "🔌" },
  { id: "document", name: "29. Document Management Vault", category: "Operations", icon: "📁" },
  { id: "import-export", name: "30. Data Import & Export Hub", category: "Infrastructure", icon: "💾" },
  { id: "monitoring", name: "31. Live System Monitoring & Audit", category: "Infrastructure", icon: "📈" },
  { id: "settings", name: "32. System & Security Settings", category: "Governance", icon: "🔒" },
];

// ==========================================
// 1. MASTER MODULE CATALOG (ALL 32 MODULES)
// ==========================================
erpRouter.get("/system/modules", (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    statusCode: 200,
    data: {
      totalModules: ALL_32_MODULES.length,
      modules: ALL_32_MODULES,
      defaultActions: ["create", "read", "update", "delete", "export", "approve"],
      defaultScopes: ["all", "department", "assigned_only"]
    }
  });
});

// ==========================================
// 2. INSTITUTIONAL OVERVIEW & KPIS (live counts)
// ==========================================
erpRouter.get("/overview/kpis", route(async (req: Request, res: Response) => {
  const inst = req.institutionId as string;
  const { rows } = await postgresService.query(
    `SELECT
       (SELECT COUNT(*) FROM acad_students WHERE institution_id = $1 AND status = 'ACTIVE')::int AS students,
       (SELECT COUNT(*) FROM acad_teachers WHERE institution_id = $1 AND status <> 'INACTIVE')::int AS teachers,
       (SELECT COUNT(*) FROM acad_departments WHERE institution_id = $1 AND status = 'ACTIVE')::int AS departments,
       (SELECT COALESCE(SUM(amount), 0) FROM hostel_payments WHERE institution_id = $1 AND status = 'Confirmed') AS revenue,
       (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE m.status IN ('PRESENT', 'LATE')) / NULLIF(COUNT(*) FILTER (WHERE m.status <> 'EXCUSED'), 0), 1)
          FROM acad_attendance_marks m JOIN acad_attendance_sessions a ON a.id = m.session_id WHERE a.institution_id = $1) AS attendance,
       (SELECT COUNT(*) FROM erp_tenant_modules WHERE tenant_id = $1 AND status = 'ACTIVE')::int AS modules,
       (SELECT name FROM erp_tenants WHERE id = $1) AS name`,
    [inst]
  );
  const row = rows[0];
  send(res, 200, {
    totalStudents: row.students,
    totalTeachers: row.teachers,
    totalDepartments: row.departments,
    totalRevenue: Number(row.revenue),
    attendanceAverage: row.attendance === null ? null : Number(row.attendance),
    currency: "BDT",
    systemName: row.name,
    activeModulesCount: row.modules,
  });
}));


// ==========================================
// 10. GUARDIANS & CREDENTIALS
// ==========================================
erpRouter.get("/guardians", requirePermissionKey("guardian.read"), (req: Request, res: Response): void => {
  const instId = (req as any).institutionId || "inst-001";
  const guardians = db.guardians.filter(g => g.institutionId === instId);
  res.status(200).json({ success: true, statusCode: 200, data: guardians });
});

erpRouter.post("/guardians/provision", requirePermissionKey("guardian.create"), route(async (req: Request, res: Response) => {
  const instId = req.institutionId as string;
  const { fullName, phone, email, wardStudentId, relationship } = req.body || {};
  if (!fullName) throw new HostelError(400, "Full name is required.");
  const account = await usersService.create(actorOf(req), { fullName, phone, email, role: "GUARDIAN" });

  const newGuardian = {
    id: uuidv4(),
    institutionId: instId,
    fullName,
    email: account.user.email || "",
    phone: phone || "",
    relationship: relationship || "Guardian",
    wardStudentId: wardStudentId || "",
    portalUsername: account.user.username,
    status: "ACTIVE" as const
  };
  db.guardians.push(newGuardian);

  send(res, 201, { guardian: newGuardian, credentials: { username: account.user.username, ...account.credentials, mustChangePassword: true } });
}));

// Finance, HR, library and notices have their own modules now.
erpRouter.get("/transport/routes", requirePermissionKey("transport.read"), (req: Request, res: Response): void => {
  const instId = (req as any).institutionId || "inst-001";
  res.status(200).json({ success: true, statusCode: 200, data: db.transportRoutes.filter(r => r.institutionId === instId) });
});

// ==========================================
// 14. SYSTEM SETTINGS
// ==========================================
// Settings moved to the settings module (per institution, in Postgres).
