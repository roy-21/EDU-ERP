import { NextFunction, Request, Response, Router } from "express";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { fail } from "./academics.common";
import { studentsService, teachersService } from "./people.service";
import { STRUCTURE_KINDS, structureService } from "./structure.service";
import { attendanceService, classesService, examsService } from "./teaching.service";

export const academicsRouter = Router();

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");

// Lists used in many screens can be read by anyone who works with any academic module.
const canReadStructure = requirePermissionKey("institution.read", "classroom.read", "student.read", "teacher.read", "attendance.read", "examination.read");

// Classes are scheduling (classroom); the rest of the structure is institution setup.
const writePermission = (action: "create" | "update" | "delete") => (req: Request, res: Response, next: NextFunction) =>
  requirePermissionKey(`${req.params.kind === "classes" ? "classroom" : "institution"}.${action}`)(req, res, next);

const knownKind = (req: Request, _res: Response, next: NextFunction) => {
  if (!STRUCTURE_KINDS.includes(req.params.kind)) return next("route");
  next();
};

academicsRouter.get("/academics/:kind", knownKind, canReadStructure, route(async (req, res) => {
  send(res, 200, await structureService.list(req.institutionId as string, req.params.kind));
}));

academicsRouter.post("/academics/:kind", knownKind, writePermission("create"), route(async (req, res) => {
  send(res, 201, await structureService.create(actorOf(req), req.params.kind, req.body));
}));

academicsRouter.put("/academics/:kind/:id", knownKind, writePermission("update"), route(async (req, res) => {
  send(res, 200, await structureService.update(actorOf(req), req.params.kind, req.params.id, req.body));
}));

academicsRouter.delete("/academics/:kind/:id", knownKind, writePermission("delete"), route(async (req, res) => {
  send(res, 200, await structureService.remove(actorOf(req), req.params.kind, req.params.id));
}));

// ---- Teachers -----------------------------------------------------------------------

academicsRouter.get("/teachers", requirePermissionKey("teacher.read"), route(async (req, res) => {
  send(res, 200, await teachersService.list(req.institutionId as string, { search: query(req, "search"), departmentId: query(req, "departmentId"), status: query(req, "status") }));
}));

academicsRouter.get("/teachers/:id", requirePermissionKey("teacher.read"), route(async (req, res) => {
  send(res, 200, await teachersService.get(req.institutionId as string, req.params.id));
}));

academicsRouter.post("/teachers", requirePermissionKey("teacher.create"), route(async (req, res) => {
  send(res, 201, await teachersService.create(actorOf(req), req.body));
}));

academicsRouter.put("/teachers/:id", requirePermissionKey("teacher.update"), route(async (req, res) => {
  send(res, 200, await teachersService.update(actorOf(req), req.params.id, req.body));
}));

academicsRouter.post("/teachers/:id/account", requirePermissionKey("teacher.update"), route(async (req, res) => {
  send(res, 201, await teachersService.createAccount(actorOf(req), req.params.id));
}));

// ---- Students -----------------------------------------------------------------------

academicsRouter.get("/students", requirePermissionKey("student.read"), route(async (req, res) => {
  send(res, 200, await studentsService.list(req.institutionId as string, {
    search: query(req, "search"), programId: query(req, "programId"), sectionId: query(req, "sectionId"), status: query(req, "status"),
  }));
}));

academicsRouter.post("/students/move", requirePermissionKey("student.update"), route(async (req, res) => {
  send(res, 200, await studentsService.move(actorOf(req), req.body));
}));

// The full record: profile, guardian accounts, attendance and published results.
academicsRouter.get("/students/:id", requirePermissionKey("student.read"), route(async (req, res) => {
  const institutionId = req.institutionId as string;
  const student = await studentsService.get(institutionId, req.params.id);
  const [attendance, transcript, guardians] = await Promise.all([
    attendanceService.studentSummary(institutionId, student.id),
    examsService.transcript(institutionId, student.id),
    studentsService.guardianAccounts(institutionId, student.studentNo),
  ]);
  send(res, 200, { student, attendance, transcript, guardians });
}));

academicsRouter.post("/students", requirePermissionKey("student.create"), route(async (req, res) => {
  send(res, 201, await studentsService.create(actorOf(req), req.body));
}));

academicsRouter.put("/students/:id", requirePermissionKey("student.update"), route(async (req, res) => {
  send(res, 200, await studentsService.update(actorOf(req), req.params.id, req.body));
}));

academicsRouter.post("/students/:id/status", requirePermissionKey("student.update"), route(async (req, res) => {
  send(res, 200, await studentsService.setStatus(actorOf(req), req.params.id, req.body));
}));

academicsRouter.post("/students/:id/account", requirePermissionKey("student.update"), route(async (req, res) => {
  send(res, 201, await studentsService.createAccount(actorOf(req), req.params.id));
}));

academicsRouter.post("/students/:id/guardian-account", requirePermissionKey("student.update"), route(async (req, res) => {
  send(res, 201, await studentsService.createGuardianAccount(actorOf(req), req.params.id));
}));

// ---- Teaching: attendance and exams ---------------------------------------------------

academicsRouter.get("/teaching/classes", requirePermissionKey("attendance.read", "attendance.create", "examination.read", "examination.create"), route(async (req, res) => {
  send(res, 200, await classesService.mine(req, query(req, "for") === "exams" ? "examination.approve" : "attendance.approve"));
}));

academicsRouter.get("/attendance/classes/:id/sheet", requirePermissionKey("attendance.read", "attendance.create"), route(async (req, res) => {
  send(res, 200, await attendanceService.sheet(req, req.params.id, query(req, "date"), query(req, "slot")));
}));

academicsRouter.post("/attendance/classes/:id", requirePermissionKey("attendance.create", "attendance.update"), route(async (req, res) => {
  send(res, 200, await attendanceService.save(req, req.params.id, req.body));
}));

academicsRouter.get("/attendance/classes/:id/report", requirePermissionKey("attendance.read", "attendance.create"), route(async (req, res) => {
  send(res, 200, await attendanceService.classReport(req, req.params.id));
}));

academicsRouter.get("/exams", requirePermissionKey("examination.read"), route(async (req, res) => {
  send(res, 200, await examsService.list(req.institutionId as string, query(req, "sessionId")));
}));

academicsRouter.post("/exams", requirePermissionKey("examination.approve"), route(async (req, res) => {
  send(res, 201, await examsService.create(actorOf(req), req.body));
}));

academicsRouter.put("/exams/:id", requirePermissionKey("examination.approve"), route(async (req, res) => {
  send(res, 200, await examsService.update(actorOf(req), req.params.id, req.body));
}));

academicsRouter.delete("/exams/:id", requirePermissionKey("examination.approve"), route(async (req, res) => {
  send(res, 200, await examsService.remove(actorOf(req), req.params.id));
}));

academicsRouter.get("/exams/classes/:id/assessments", requirePermissionKey("examination.read", "examination.create"), route(async (req, res) => {
  send(res, 200, await examsService.classAssessments(req, req.params.id));
}));

academicsRouter.get("/exams/assessments/:id", requirePermissionKey("examination.read", "examination.create"), route(async (req, res) => {
  send(res, 200, await examsService.marksSheet(req, req.params.id));
}));

academicsRouter.put("/exams/assessments/:id/marks", requirePermissionKey("examination.create", "examination.update"), route(async (req, res) => {
  send(res, 200, await examsService.saveMarks(req, req.params.id, req.body));
}));

academicsRouter.post("/exams/assessments/:id/lock", requirePermissionKey("examination.create", "examination.update"), route(async (req, res) => {
  send(res, 200, await examsService.setLocked(req, req.params.id, true));
}));

academicsRouter.post("/exams/assessments/:id/unlock", requirePermissionKey("examination.approve"), route(async (req, res) => {
  send(res, 200, await examsService.setLocked(req, req.params.id, false));
}));

academicsRouter.get("/exams/classes/:id/results", requirePermissionKey("examination.read", "examination.create"), route(async (req, res) => {
  send(res, 200, await examsService.classResults(req, req.params.id));
}));

academicsRouter.post("/exams/classes/:id/publish", requirePermissionKey("examination.approve"), route(async (req, res) => {
  send(res, 200, await examsService.publish(req, req.params.id, true));
}));

academicsRouter.post("/exams/classes/:id/withdraw", requirePermissionKey("examination.approve"), route(async (req, res) => {
  send(res, 200, await examsService.publish(req, req.params.id, false));
}));

// Keeps unknown academic lists from falling through to older demo routes.
academicsRouter.all("/academics/:kind", route(async () => fail(404, "Unknown list.")));
