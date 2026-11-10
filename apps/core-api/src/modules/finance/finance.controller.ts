import { Request, Router } from "express";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { postgresService } from "../../database/postgres";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { feeHeadsService, financeReports, invoicesService, paymentsService } from "./finance.service";

// Tuition and other student fees. Hostel rent has its own billing under /hostel.
export const financeRouter = Router();

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");
const tenant = (req: Request) => req.institutionId as string;

const canRead = requirePermissionKey("finance.read");
const canCreate = requirePermissionKey("finance.create");
const canUpdate = requirePermissionKey("finance.update");
const canDelete = requirePermissionKey("finance.delete");
// Waivers, discounts and reversals change what the institution is owed, so they need approval rights.
const canApprove = requirePermissionKey("finance.approve");

financeRouter.get("/finance/summary", canRead, route(async (req, res) => send(res, 200, await financeReports.summary(tenant(req)))));

financeRouter.get("/finance/fee-heads", canRead, route(async (req, res) => send(res, 200, await feeHeadsService.list(tenant(req)))));
financeRouter.post("/finance/fee-heads", canCreate, route(async (req, res) => send(res, 201, await feeHeadsService.create(actorOf(req), req.body))));
financeRouter.put("/finance/fee-heads/:id", canUpdate, route(async (req, res) => send(res, 200, await feeHeadsService.update(actorOf(req), req.params.id, req.body))));
financeRouter.delete("/finance/fee-heads/:id", canDelete, route(async (req, res) => send(res, 200, await feeHeadsService.remove(actorOf(req), req.params.id))));

financeRouter.get("/finance/fee-structure", canRead, route(async (req, res) => send(res, 200, await feeHeadsService.structure(tenant(req)))));
financeRouter.put("/finance/fee-structure", canUpdate, route(async (req, res) => send(res, 200, await feeHeadsService.setRate(actorOf(req), req.body))));

financeRouter.get("/finance/invoices", canRead, route(async (req, res) => {
  send(res, 200, await invoicesService.list(tenant(req), { search: query(req, "search"), state: query(req, "state"), studentId: query(req, "studentId") }));
}));
financeRouter.get("/finance/invoices/:id", canRead, route(async (req, res) => send(res, 200, await invoicesService.get(tenant(req), req.params.id))));
financeRouter.post("/finance/invoices", canCreate, route(async (req, res) => send(res, 201, await invoicesService.create(actorOf(req), req.body))));
financeRouter.post("/finance/invoices/generate", canCreate, route(async (req, res) => send(res, 201, await invoicesService.generate(actorOf(req), req.body))));
financeRouter.post("/finance/invoices/:id/cancel", canDelete, route(async (req, res) => send(res, 200, await invoicesService.cancel(actorOf(req), req.params.id, req.body))));
financeRouter.post("/finance/invoices/:id/adjustments", canApprove, route(async (req, res) => send(res, 201, await invoicesService.adjust(actorOf(req), req.params.id, req.body))));

financeRouter.get("/finance/payments", canRead, route(async (req, res) => {
  send(res, 200, await paymentsService.list(tenant(req), {
    search: query(req, "search"), method: query(req, "method"), from: query(req, "from"), to: query(req, "to"), status: query(req, "status"),
  }));
}));
financeRouter.get("/finance/payments/:id", canRead, route(async (req, res) => send(res, 200, await paymentsService.get(tenant(req), req.params.id))));
financeRouter.post("/finance/payments", canCreate, route(async (req, res) => send(res, 201, await paymentsService.record(actorOf(req), req.body))));
financeRouter.post("/finance/payments/:id/reverse", canApprove, route(async (req, res) => send(res, 200, await paymentsService.reverse(actorOf(req), req.params.id, req.body))));

financeRouter.get("/finance/students/:studentNo/statement", canRead, route(async (req, res) => send(res, 200, await financeReports.statement(tenant(req), req.params.studentNo))));

// Just enough to pick a student to bill: no contact details, guardians or documents.
financeRouter.get("/finance/students", canRead, route(async (req, res) => {
  const { rows } = await postgresService.query(
    `SELECT s.id, s.student_no, s.full_name, s.status, p.code AS program_code FROM acad_students s JOIN acad_programs p ON p.id = s.program_id
     WHERE s.institution_id = $1 AND ($2 = '' OR s.full_name ILIKE '%' || $2 || '%' OR s.student_no ILIKE '%' || $2 || '%')
     ORDER BY s.student_no LIMIT 20`,
    [tenant(req), query(req, "search").trim()]
  );
  send(res, 200, rows.map((row: any) => ({ id: row.id, studentNo: row.student_no, fullName: row.full_name, status: row.status, programCode: row.program_code })));
}));

// Programs and sections, for choosing whom to bill.
financeRouter.get("/finance/targets", canRead, route(async (req, res) => {
  const [programs, sections] = await Promise.all([
    postgresService.query("SELECT id, code, name FROM acad_programs WHERE institution_id = $1 AND status = 'ACTIVE' ORDER BY code", [tenant(req)]),
    postgresService.query(
      `SELECT s.id, p.code AS program_code, p.term_label, s.term_no, s.name, se.name AS session_name,
         (SELECT COUNT(*) FROM acad_students st WHERE st.section_id = s.id AND st.status = 'ACTIVE') AS students
       FROM acad_sections s JOIN acad_programs p ON p.id = s.program_id JOIN acad_sessions se ON se.id = s.session_id
       WHERE s.institution_id = $1 ORDER BY se.is_current DESC, p.code, s.term_no, s.name`,
      [tenant(req)]
    ),
  ]);
  send(res, 200, {
    programs: programs.rows,
    sections: sections.rows.map((row: any) => ({ id: row.id, label: `${row.program_code} ${row.term_label} ${row.term_no} (${row.name}) · ${row.session_name}`, students: Number(row.students) })),
  });
}));
