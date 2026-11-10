import { NextFunction, Request, Response, Router } from "express";
import { postgresService } from "../../database/postgres";
import { HostelContext, HostelError, contextOf, route, send, toIso } from "../hostel/hostel.common";
import { hostelBillingService } from "../hostel/hostel-billing.service";
import { hostelMealsService } from "../hostel/hostel-meals.service";
import { issuePaymentLink } from "../hostel/hostel-payment-links";
import { getRentSettings } from "../hostel/hostel-rent.repository";
import { requirePermission } from "../hostel/hostel.permissions";
import { usersService } from "../identity/identity.service";
import { actorOf } from "../identity/identity.controller";
import { attendanceService, examsService } from "../academics/teaching.service";
import { financeReports } from "../finance/finance.service";
import { noticesService } from "../notice/notice.service";
import { loansService } from "../library/library.service";

// The student and guardian portal. A student sees their own record; a guardian sees only
// the students linked to them. Other students' ids from the browser are never trusted.
export const portalRouter = Router();

const isStudent = (req: Request) => req.user?.role === "STUDENT" && req.user.linkedType === "STUDENT" && Boolean(req.user.linkedId);
const isGuardian = (req: Request) => req.user?.role === "GUARDIAN";

const portalUser = (req: Request, res: Response, next: NextFunction) => {
  if (isStudent(req) || isGuardian(req)) return next();
  res.status(403).json({ success: false, statusCode: 403, error: "The portal is for student and guardian accounts." });
};

const studentOnly = (req: Request, res: Response, next: NextFunction) => {
  if (isStudent(req)) return next();
  res.status(403).json({ success: false, statusCode: 403, error: "Only the student can do this." });
};

const hostelEnabled = (req: Request) => req.user!.modules.includes("hostel");

type Ward = { studentId: string; name: string; relationship: string };

const wardsOf = async (req: Request): Promise<Ward[]> =>
  (await postgresService.query(
    `SELECT l.student_id, l.relationship,
       (SELECT full_name FROM acad_students s WHERE s.institution_id = l.institution_id AND LOWER(s.student_no) = LOWER(l.student_id)) AS academic_name,
       (SELECT student_name FROM hostel_allocations a WHERE a.institution_id = l.institution_id AND LOWER(a.student_id) = LOWER(l.student_id)
        ORDER BY a.created_at DESC LIMIT 1) AS hostel_name,
       (SELECT full_name FROM erp_users s WHERE s.institution_id = l.institution_id AND s.linked_type = 'STUDENT' AND s.linked_id = l.student_id LIMIT 1) AS account_name
     FROM erp_guardian_links l WHERE l.guardian_user_id = $1 AND l.institution_id = $2 ORDER BY l.created_at`,
    [req.user!.userId, req.institutionId]
  )).rows.map((row: any) => ({ studentId: row.student_id, name: row.academic_name || row.hostel_name || row.account_name || row.student_id, relationship: row.relationship }));

// Whose records this request is about. A guardian picks a ward with ?student=, checked against their links.
const subjectOf = async (req: Request): Promise<string> => {
  if (isStudent(req)) return req.user!.linkedId as string;
  const wards = await wardsOf(req);
  if (wards.length === 0) throw new HostelError(404, "No students are linked to this guardian account yet. Ask the institution to link them.");
  const wanted = typeof req.query.student === "string" ? req.query.student : wards[0].studentId;
  const ward = wards.find((item) => item.studentId.toLowerCase() === wanted.toLowerCase());
  if (!ward) throw new HostelError(404, "This student is not linked to your account.");
  return ward.studentId;
};

// The student's current stay, or their latest one if they have left.
const myAllocation = async (req: Request) => {
  const { rows } = await postgresService.query(
    `SELECT * FROM hostel_allocations WHERE institution_id = $1 AND LOWER(student_id) = LOWER($2)
     ORDER BY (status = 'Allocated') DESC, created_at DESC LIMIT 1`,
    [req.institutionId, await subjectOf(req)]
  );
  return rows[0] || null;
};

const studentCtx = (req: Request): HostelContext => ({ ...contextOf(req), actorEmail: req.user!.email || req.user!.username || "student" });

portalRouter.get("/portal/me", portalUser, route(async (req, res) => {
  const wards = isGuardian(req) ? await wardsOf(req) : [];
  const studentId = isGuardian(req) && wards.length === 0 ? null : await subjectOf(req);
  const allocation = hostelEnabled(req) && studentId ? await myAllocation(req) : null;
  send(res, 200, {
    fullName: req.user!.fullName,
    username: req.user!.username,
    role: req.user!.role,
    isGuardian: isGuardian(req),
    wards,
    studentId,
    studentName: isGuardian(req) ? wards.find((item) => item.studentId === studentId)?.name || null : req.user!.fullName,
    modules: req.user!.modules,
    hostel: allocation && {
      allocationId: allocation.id,
      status: allocation.status,
      room: allocation.room_label,
      seatNumber: allocation.seat_number,
      monthlyRent: Number(allocation.monthly_rent),
      startDate: allocation.start_date,
      endDate: allocation.end_date,
    },
  });
}));

// Attendance and published results, for the student or a guardian's ward.
portalRouter.get("/portal/academics", portalUser, route(async (req, res) => {
  const studentNo = await subjectOf(req);
  const { rows } = await postgresService.query(
    `SELECT st.id, st.student_no, st.full_name, st.status, p.name AS program_name, p.term_label, s.term_no, s.name AS section_name, se.name AS session_name
     FROM acad_students st JOIN acad_programs p ON p.id = st.program_id LEFT JOIN acad_sections s ON s.id = st.section_id
     LEFT JOIN acad_sessions se ON se.id = s.session_id WHERE st.institution_id = $1 AND LOWER(st.student_no) = LOWER($2)`,
    [req.institutionId, studentNo]
  );
  const student = rows[0];
  if (!student) return send(res, 200, { enrolled: false });
  const [attendance, transcript] = await Promise.all([
    attendanceService.studentSummary(req.institutionId as string, student.id),
    examsService.transcript(req.institutionId as string, student.id),
  ]);
  send(res, 200, {
    enrolled: true,
    program: student.program_name,
    section: student.section_name ? `${student.term_label} ${student.term_no} (${student.section_name}), ${student.session_name}` : null,
    status: student.status,
    attendance,
    transcript,
  });
}));

// Tuition and other fees billed through finance, for the student or a guardian's ward.
portalRouter.get("/portal/fees", portalUser, route(async (req, res) => {
  if (!req.user!.modules.includes("finance")) return send(res, 200, { invoices: [], payments: [], totalOutstanding: 0, totalOverdue: 0 });
  send(res, 200, await financeReports.statement(req.institutionId as string, await subjectOf(req)));
}));

// Notices for this account's audience: students or guardians.
portalRouter.get("/portal/notices", portalUser, route(async (req, res) => {
  send(res, 200, await noticesService.feed(req.institutionId as string, req.user!.role));
}));

portalRouter.get("/portal/library", portalUser, route(async (req, res) => {
  if (!req.user!.modules.includes("library")) return send(res, 200, []);
  send(res, 200, await loansService.ofPerson(req.institutionId as string, "STUDENT", await subjectOf(req)));
}));

portalRouter.get("/portal/invoices", portalUser, route(async (req, res) => {
  const allocation = hostelEnabled(req) ? await myAllocation(req) : null;
  if (!allocation) return send(res, 200, { invoices: [], payments: [], totalOutstanding: 0, totalOverdue: 0 });
  const ledger = await hostelBillingService.getLedger(req.institutionId as string, allocation.id);
  send(res, 200, { invoices: ledger.invoices, payments: ledger.payments, totalOutstanding: ledger.totalOutstanding, totalOverdue: ledger.totalOverdue });
}));

// A fresh, single-use payment link for one of the student's own invoices.
portalRouter.post("/portal/invoices/:id/pay", portalUser, route(async (req, res) => {
  const allocation = await myAllocation(req);
  const { rows } = await postgresService.query(
    "SELECT outstanding_amount FROM hostel_invoice_balances WHERE institution_id = $1 AND id = $2 AND allocation_id = $3",
    [req.institutionId, req.params.id, allocation?.id || ""]
  );
  if (!rows[0]) throw new HostelError(404, "Invoice not found.");
  if (Number(rows[0].outstanding_amount) <= 0) throw new HostelError(409, "This invoice is already paid.");
  send(res, 200, { url: await issuePaymentLink(req.institutionId as string, req.params.id) });
}));

portalRouter.get("/portal/meals", portalUser, route(async (req, res) => {
  if (!hostelEnabled(req)) return send(res, 200, { meals: [], orders: [], canBook: false });
  const allocation = await myAllocation(req);
  const [meals, mine, settings] = await Promise.all([
    hostelMealsService.list(req.institutionId as string),
    allocation ? hostelMealsService.memberSummary(req.institutionId as string, allocation.id) : null,
    getRentSettings(req.institutionId as string),
  ]);
  // Drafts and cancelled meals are staff business.
  const visible = meals
    .filter((meal: any) => ["Published", "Booking Open", "Booking Closed"].includes(meal.status))
    .map(({ totalOrders, totalMeals, expectedRevenue, createdBy, publishedBy, ...meal }: any) => meal);
  send(res, 200, {
    meals: visible,
    orders: mine?.orders || [],
    summary: mine && { totalMealsOrdered: mine.totalMealsOrdered, totalCost: mine.totalCost, totalPaid: mine.totalPaid, totalOutstanding: mine.totalOutstanding },
    // Guardians can see orders, but only the student orders.
    canBook: isStudent(req) && allocation?.status === "Allocated",
    timezone: settings.timezone,
  });
}));

portalRouter.get("/portal/meals/:id/image", portalUser, route(async (req, res) => {
  const { meal } = await hostelMealsService.get(req.institutionId as string, req.params.id);
  if (!["Published", "Booking Open", "Booking Closed"].includes(meal.status)) throw new HostelError(404, "Meal not found.");
  send(res, 200, await hostelMealsService.image(req.institutionId as string, req.params.id));
}));

// The same booking rules as staff use: the deadline is checked by the database clock.
portalRouter.post("/portal/meals/:id/book", studentOnly, route(async (req, res) => {
  const allocation = await myAllocation(req);
  if (!allocation || allocation.status !== "Allocated") throw new HostelError(409, "Only a student with a hostel seat can book meals.");
  send(res, 201, await hostelMealsService.book(studentCtx(req), req.params.id, { allocationId: allocation.id, quantity: req.body?.quantity }));
}));

const ownBooking = async (req: Request) => {
  const allocation = await myAllocation(req);
  const { rows } = await postgresService.query(
    "SELECT id FROM hostel_meal_bookings WHERE institution_id = $1 AND id = $2 AND allocation_id = $3",
    [req.institutionId, req.params.id, allocation?.id || ""]
  );
  if (!rows[0]) throw new HostelError(404, "Order not found.");
};

portalRouter.put("/portal/meal-bookings/:id", studentOnly, route(async (req, res) => {
  await ownBooking(req);
  send(res, 200, await hostelMealsService.changeBooking(studentCtx(req), req.params.id, { quantity: req.body?.quantity }));
}));

portalRouter.post("/portal/meal-bookings/:id/cancel", studentOnly, route(async (req, res) => {
  await ownBooking(req);
  send(res, 200, await hostelMealsService.changeBooking(studentCtx(req), req.params.id, { cancel: true }));
}));

// ---- Staff: a portal account for a hostel student --------------------------

portalRouter.get("/hostel/allocations/:id/account", requirePermission("manage_allocations", "manage_students", "view_due_rent"), route(async (req, res) => {
  const { rows } = await postgresService.query("SELECT student_id FROM hostel_allocations WHERE institution_id = $1 AND id = $2", [req.institutionId, req.params.id]);
  if (!rows[0]) throw new HostelError(404, "Allocation not found.");
  const [user] = await usersService.lookup(req.institutionId as string, { linkedType: "STUDENT", linkedId: rows[0].student_id });
  send(res, 200, user ? { id: user.id, username: user.username, status: user.status, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt } : null);
}));

portalRouter.post("/hostel/allocations/:id/account", requirePermission("manage_allocations", "manage_students"), route(async (req, res) => {
  const { rows } = await postgresService.query("SELECT * FROM hostel_allocations WHERE institution_id = $1 AND id = $2", [req.institutionId, req.params.id]);
  const allocation = rows[0];
  if (!allocation) throw new HostelError(404, "Allocation not found.");
  if (!allocation.student_email) throw new HostelError(400, "Add the student's email first. The sign-in details are sent there.");
  const result = await usersService.create(actorOf(req), {
    fullName: allocation.student_name,
    email: allocation.student_email,
    phone: allocation.student_phone || undefined,
    role: "STUDENT",
    linkedType: "STUDENT",
    linkedId: allocation.student_id,
  });
  send(res, 201, { user: { id: result.user.id, username: result.user.username, status: result.user.status, createdAt: toIso(result.user.createdAt) }, credentials: result.credentials });
}));
