import { Request, Router } from "express";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { has } from "../academics/academics.common";
import { noticesService } from "./notice.service";

export const noticeRouter = Router();

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");

// Drafts are only for the people who write notices. Everyone signed in reads the feed.
const canManage = requirePermissionKey("notice.create", "notice.update", "notice.approve", "notice.delete");

noticeRouter.get("/notices/feed", route(async (req, res) => {
  send(res, 200, await noticesService.feed(req.institutionId as string, req.user!.role, query(req, "display")));
}));

noticeRouter.get("/notices", canManage, route(async (req, res) => {
  send(res, 200, await noticesService.list(req.institutionId as string, { status: query(req, "status"), search: query(req, "search") }));
}));

noticeRouter.get("/notices/:id/recipients", canManage, route(async (req, res) => {
  const audience = query(req, "audience") || "ALL";
  const people = await noticesService.recipients(req.institutionId as string, audience);
  send(res, 200, { count: people.length });
}));

// Publishing at creation needs the same right as publishing later.
noticeRouter.post("/notices", requirePermissionKey("notice.create"), route(async (req, res) => {
  if (req.body?.publish && !has(req, "notice.approve")) {
    res.status(403).json({ success: false, statusCode: 403, error: "Publishing needs the notice approve permission. Save it as a draft instead." });
    return;
  }
  send(res, 201, await noticesService.create(actorOf(req), req.body));
}));

noticeRouter.put("/notices/:id", requirePermissionKey("notice.update"), route(async (req, res) => {
  send(res, 200, await noticesService.update(actorOf(req), req.params.id, req.body));
}));

noticeRouter.post("/notices/:id/publish", requirePermissionKey("notice.approve"), route(async (req, res) => {
  send(res, 200, await noticesService.setStatus(actorOf(req), req.params.id, "PUBLISHED"));
}));

noticeRouter.post("/notices/:id/archive", requirePermissionKey("notice.approve"), route(async (req, res) => {
  send(res, 200, await noticesService.setStatus(actorOf(req), req.params.id, "ARCHIVED"));
}));

noticeRouter.post("/notices/:id/email", requirePermissionKey("notice.approve"), route(async (req, res) => {
  send(res, 200, await noticesService.email(actorOf(req), req.params.id));
}));

noticeRouter.delete("/notices/:id", requirePermissionKey("notice.delete"), route(async (req, res) => {
  send(res, 200, await noticesService.remove(actorOf(req), req.params.id));
}));
