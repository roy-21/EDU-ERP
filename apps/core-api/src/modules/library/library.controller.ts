import { Request, Router } from "express";
import { requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { booksService, loansService } from "./library.service";

export const libraryRouter = Router();

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");
const tenant = (req: Request) => req.institutionId as string;

const canRead = requirePermissionKey("library.read");
// Lending and taking books back is the desk's daily work.
const canLend = requirePermissionKey("library.create", "library.update");

libraryRouter.get("/library/summary", canRead, route(async (req, res) => send(res, 200, await loansService.summary(tenant(req)))));
libraryRouter.get("/library/settings", canRead, route(async (req, res) => send(res, 200, await loansService.settings(tenant(req)))));
libraryRouter.put("/library/settings", requirePermissionKey("library.update"), route(async (req, res) => send(res, 200, await loansService.saveSettings(actorOf(req), req.body))));

libraryRouter.get("/library/books", canRead, route(async (req, res) => {
  send(res, 200, await booksService.list(tenant(req), { search: query(req, "search"), category: query(req, "category") }));
}));
libraryRouter.post("/library/books", requirePermissionKey("library.create"), route(async (req, res) => send(res, 201, await booksService.create(actorOf(req), req.body))));
libraryRouter.put("/library/books/:id", requirePermissionKey("library.update"), route(async (req, res) => send(res, 200, await booksService.update(actorOf(req), req.params.id, req.body))));
libraryRouter.delete("/library/books/:id", requirePermissionKey("library.delete"), route(async (req, res) => send(res, 200, await booksService.remove(actorOf(req), req.params.id))));

// A teacher account sees its own loans without library permissions.
libraryRouter.get("/library/my-loans", route(async (req, res) => {
  if (req.user?.linkedType !== "TEACHER" || !req.user.linkedId) return send(res, 200, []);
  send(res, 200, await loansService.ofPerson(tenant(req), "TEACHER", req.user.linkedId));
}));

libraryRouter.get("/library/loans", canRead, route(async (req, res) => {
  send(res, 200, await loansService.list(tenant(req), { state: query(req, "state"), search: query(req, "search"), borrowerType: query(req, "borrowerType") }));
}));
libraryRouter.post("/library/loans", canLend, route(async (req, res) => send(res, 201, await loansService.issue(actorOf(req), req.body))));
libraryRouter.post("/library/loans/:id/renew", canLend, route(async (req, res) => send(res, 200, await loansService.renew(actorOf(req), req.params.id))));
libraryRouter.post("/library/loans/:id/return", canLend, route(async (req, res) => send(res, 200, await loansService.giveBack(actorOf(req), req.params.id))));
// Taking fine money is desk work; waiving a fine needs approval rights.
libraryRouter.post("/library/loans/:id/fine", canLend, route(async (req, res) => {
  if (req.body?.action === "WAIVED" && !(req.user?.permissions || []).includes("library.approve")) {
    res.status(403).json({ success: false, statusCode: 403, error: "Waiving a fine needs the library approve permission." });
    return;
  }
  send(res, 200, await loansService.settleFine(actorOf(req), req.params.id, req.body));
}));
