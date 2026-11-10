import { Request, Response, Router } from "express";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { has, todayBd } from "../academics/academics.common";
import { employeesService, leaveService, myPerson, payrollService } from "./hr.service";

export const hrRouter = Router();

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");
const tenant = (req: Request) => req.institutionId as string;

const canRead = requirePermissionKey("hr.read");
const notLinked = (res: Response): void => {
  res.status(404).json({ success: false, statusCode: 404, error: "This account is not linked to an employee record." });
};

// ---- Self service: a teacher or staff account's own leave and payslips ----------------

hrRouter.get("/hr/me", route(async (req, res) => {
  const me = await myPerson(req);
  if (!me) return notLinked(res);
  const [balances, requests, payslips] = await Promise.all([
    leaveService.balances(tenant(req), me.type, me.id, Number(todayBd().slice(0, 4))),
    leaveService.list(tenant(req), { personType: me.type, personId: me.id }),
    payrollService.mine(tenant(req), me.type, me.id),
  ]);
  send(res, 200, { employee: me, balances, requests, payslips });
}));

hrRouter.post("/hr/me/leave", route(async (req, res) => {
  const me = await myPerson(req);
  if (!me) return notLinked(res);
  send(res, 201, await leaveService.apply(actorOf(req), me.type, me.id, req.body));
}));

hrRouter.post("/hr/me/leave/:id/cancel", route(async (req, res) => {
  const me = await myPerson(req);
  if (!me) return notLinked(res);
  send(res, 200, await leaveService.cancel(actorOf(req), req.params.id, { type: me.type, id: me.id }, false));
}));

// Anyone signed in may see the leave types, so they can apply.
hrRouter.get("/hr/leave-types", route(async (req, res) => send(res, 200, await leaveService.types(tenant(req)))));

// ---- HR office ---------------------------------------------------------------------

hrRouter.get("/hr/employees", canRead, route(async (req, res) => {
  send(res, 200, await employeesService.list(tenant(req), { search: query(req, "search"), personType: query(req, "personType"), status: query(req, "status") }));
}));
hrRouter.post("/hr/staff", requirePermissionKey("hr.create"), route(async (req, res) => send(res, 201, await employeesService.createStaff(actorOf(req), req.body))));
hrRouter.put("/hr/staff/:id", requirePermissionKey("hr.update"), route(async (req, res) => send(res, 200, await employeesService.updateStaff(actorOf(req), req.params.id, req.body))));
hrRouter.delete("/hr/staff/:id", requirePermissionKey("hr.delete"), route(async (req, res) => send(res, 200, await employeesService.removeStaff(actorOf(req), req.params.id))));
hrRouter.put("/hr/salaries/:type/:id", requirePermissionKey("hr.update"), route(async (req, res) => {
  send(res, 200, await employeesService.setSalary(actorOf(req), req.params.type, req.params.id, req.body));
}));

hrRouter.post("/hr/leave-types", requirePermissionKey("hr.update"), route(async (req, res) => send(res, 201, await leaveService.saveType(actorOf(req), null, req.body))));
hrRouter.put("/hr/leave-types/:id", requirePermissionKey("hr.update"), route(async (req, res) => send(res, 200, await leaveService.saveType(actorOf(req), req.params.id, req.body))));
hrRouter.delete("/hr/leave-types/:id", requirePermissionKey("hr.update"), route(async (req, res) => send(res, 200, await leaveService.removeType(actorOf(req), req.params.id))));

hrRouter.get("/hr/leave", canRead, route(async (req, res) => {
  send(res, 200, await leaveService.list(tenant(req), { status: query(req, "status"), personType: query(req, "personType"), personId: query(req, "personId") }));
}));
hrRouter.get("/hr/leave/balances/:type/:id", canRead, route(async (req, res) => {
  send(res, 200, await leaveService.balances(tenant(req), req.params.type, req.params.id, Number(query(req, "year")) || Number(todayBd().slice(0, 4))));
}));
// HR records leave on someone's behalf, for example a phoned-in sick day.
hrRouter.post("/hr/leave", requirePermissionKey("hr.create"), route(async (req, res) => {
  send(res, 201, await leaveService.apply(actorOf(req), req.body?.personType, req.body?.personId, req.body));
}));
hrRouter.post("/hr/leave/:id/decide", requirePermissionKey("hr.approve"), route(async (req, res) => send(res, 200, await leaveService.decide(actorOf(req), req.params.id, req.body))));
hrRouter.post("/hr/leave/:id/cancel", requirePermissionKey("hr.update"), route(async (req, res) => {
  send(res, 200, await leaveService.cancel(actorOf(req), req.params.id, null, has(req, "hr.update")));
}));

hrRouter.get("/hr/payroll", canRead, route(async (req, res) => send(res, 200, await payrollService.list(tenant(req)))));
hrRouter.get("/hr/payroll/:id", canRead, route(async (req, res) => send(res, 200, await payrollService.get(tenant(req), req.params.id))));
hrRouter.post("/hr/payroll", requirePermissionKey("hr.create"), route(async (req, res) => send(res, 201, await payrollService.generate(actorOf(req), req.body))));
hrRouter.post("/hr/payroll/:id/approve", requirePermissionKey("hr.approve"), route(async (req, res) => send(res, 200, await payrollService.advance(actorOf(req), req.params.id, "APPROVED"))));
hrRouter.post("/hr/payroll/:id/paid", requirePermissionKey("hr.approve"), route(async (req, res) => send(res, 200, await payrollService.advance(actorOf(req), req.params.id, "PAID"))));
hrRouter.delete("/hr/payroll/:id", requirePermissionKey("hr.delete"), route(async (req, res) => send(res, 200, await payrollService.removeDraft(actorOf(req), req.params.id))));
