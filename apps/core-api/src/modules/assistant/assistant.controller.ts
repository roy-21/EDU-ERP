import { NextFunction, Request, Response, Router } from "express";
import { postgresService } from "../../database/postgres";
import { hasPermissionKey, requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { contactsService, escalationsService, publicReplyService, settingsService } from "./assistant-escalation.service";
import { documentsService, knowledgeService } from "./assistant-knowledge.service";
import { Asker } from "./assistant-live.service";
import { analyticsService, askService, reviewsService } from "./assistant.service";
import { voiceCallService } from "./assistant-voice.service";

// The AI knowledge assistant (module "voice-ai"). Anyone signed in to a subscribing
// institution may ask; running it needs the module's own permissions. The assistant has no
// route that changes ERP records, only its own questions, knowledge and forwarding records.

export const assistantRouter = Router();
export const assistantPublicRouter = Router();

const tenant = (req: Request) => req.institutionId as string;
const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");

// Service-to-service calls carry no person, so they cannot ask as anyone.
const assistantUser = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role === "SERVICE_INTERNAL") {
    res.status(403).json({ success: false, statusCode: 403, error: "The assistant answers signed-in people only." });
    return;
  }
  if (!(req.user.modules || []).includes("voice-ai")) {
    res.status(403).json({ success: false, statusCode: 403, error: "Your institution does not subscribe to the AI assistant." });
    return;
  }
  next();
};

const askerOf = (req: Request): Asker => ({
  institutionId: tenant(req),
  userId: req.user!.userId,
  role: req.user!.role,
  fullName: req.user!.fullName || req.user!.email || "",
  linkedType: req.user!.linkedType || null,
  linkedId: req.user!.linkedId || null,
  modules: req.user!.modules || [],
});

const canKnowledge = requirePermissionKey("voice-ai.manage_knowledge");
const canReview = requirePermissionKey("voice-ai.review_knowledge");
const canEscalate = requirePermissionKey("voice-ai.manage_escalations");
const canAnalytics = requirePermissionKey("voice-ai.view_analytics");
const canSeeKnowledge = requirePermissionKey("voice-ai.manage_knowledge", "voice-ai.review_knowledge");
const canManageAny = requirePermissionKey("voice-ai.manage_knowledge", "voice-ai.review_knowledge", "voice-ai.manage_escalations", "voice-ai.view_analytics");

assistantRouter.use("/assistant", assistantUser);

// Asking
assistantRouter.post("/assistant/ask", route(async (req, res) => send(res, 201, await askService.ask(askerOf(req), req.body))));
assistantRouter.get("/assistant/questions/mine", route(async (req, res) => send(res, 200, await askService.history(askerOf(req)))));
assistantRouter.post("/assistant/questions/:id/feedback", route(async (req, res) => send(res, 200, await askService.feedback(askerOf(req), req.params.id, req.body))));

// Website voice calls: the same assistant, by speaking. Speech runs in voice-api.
assistantRouter.get("/assistant/voice/status", route(async (_req, res) => send(res, 200, await voiceCallService.status())));
assistantRouter.post("/assistant/voice/calls", route(async (req, res) => send(res, 201, await voiceCallService.start(askerOf(req)))));
assistantRouter.get("/assistant/voice/calls/mine", route(async (req, res) => send(res, 200, await voiceCallService.mine(askerOf(req)))));
assistantRouter.get("/assistant/voice/calls/mine/:id", route(async (req, res) =>
  send(res, 200, await voiceCallService.transcript(tenant(req), req.params.id, req.user!.userId))));
assistantRouter.post("/assistant/voice/calls/:id/turn", route(async (req, res) => send(res, 200, await voiceCallService.turn(askerOf(req), req.params.id, req.body))));
assistantRouter.post("/assistant/voice/calls/:id/end", route(async (req, res) => send(res, 200, await voiceCallService.end(askerOf(req), req.params.id))));

// Questions forwarded to the signed-in person
assistantRouter.get("/assistant/assigned", route(async (req, res) => send(res, 200, await escalationsService.assignedTo(tenant(req), req.user!.userId))));
assistantRouter.post("/assistant/assigned/:id/answer", route(async (req, res) =>
  send(res, 200, await escalationsService.answerInPanel(actorOf(req), req.params.id, req.body, false))));

// Overview
assistantRouter.get("/assistant/status", canManageAny, route(async (_req, res) => send(res, 200, await analyticsService.status())));
assistantRouter.get("/assistant/analytics", canAnalytics, route(async (req, res) => send(res, 200, await analyticsService.summary(tenant(req)))));
assistantRouter.get("/assistant/questions", canAnalytics, route(async (req, res) =>
  send(res, 200, await askService.all(tenant(req), { status: query(req, "status") || undefined, kind: query(req, "kind") || undefined, search: query(req, "search") || undefined }))));

// Every voice call with its transcript
assistantRouter.get("/assistant/voice/calls", canAnalytics, route(async (req, res) => send(res, 200, await voiceCallService.all(tenant(req)))));
assistantRouter.get("/assistant/voice/calls/:id", canAnalytics, route(async (req, res) => send(res, 200, await voiceCallService.transcript(tenant(req), req.params.id))));

// Documents
assistantRouter.get("/assistant/documents", canSeeKnowledge, route(async (req, res) => send(res, 200, await documentsService.list(tenant(req)))));
assistantRouter.post("/assistant/documents", canKnowledge, route(async (req, res) => send(res, 201, await documentsService.upload(actorOf(req), req.body))));
assistantRouter.get("/assistant/documents/:id", canSeeKnowledge, route(async (req, res) => send(res, 200, await documentsService.get(tenant(req), req.params.id))));
assistantRouter.get("/assistant/documents/:id/preview", canSeeKnowledge, route(async (req, res) => send(res, 200, await documentsService.preview(tenant(req), req.params.id))));
assistantRouter.put("/assistant/documents/:id", canKnowledge, route(async (req, res) => send(res, 200, await documentsService.replace(actorOf(req), req.params.id, req.body))));
assistantRouter.post("/assistant/documents/:id/retry", canKnowledge, route(async (req, res) => send(res, 200, await documentsService.retry(actorOf(req), req.params.id))));
assistantRouter.delete("/assistant/documents/:id", canKnowledge, route(async (req, res) => send(res, 200, await documentsService.remove(actorOf(req), req.params.id))));

// Approved knowledge
assistantRouter.get("/assistant/knowledge", canSeeKnowledge, route(async (req, res) => send(res, 200, await knowledgeService.list(tenant(req), query(req, "status") || "ACTIVE"))));
assistantRouter.post("/assistant/knowledge", canReview, route(async (req, res) => send(res, 201, await reviewsService.addDirect(actorOf(req), req.body))));
assistantRouter.post("/assistant/knowledge/:id/retire", canReview, route(async (req, res) => send(res, 200, await knowledgeService.retire(actorOf(req), req.params.id))));

// Review
assistantRouter.get("/assistant/reviews", canReview, route(async (req, res) => send(res, 200, await reviewsService.list(tenant(req), query(req, "status") || "PENDING"))));
assistantRouter.get("/assistant/reviews/:id", canReview, route(async (req, res) => send(res, 200, await reviewsService.get(tenant(req), req.params.id))));
assistantRouter.put("/assistant/reviews/:id", canReview, route(async (req, res) => send(res, 200, await reviewsService.update(actorOf(req), req.params.id, req.body))));
assistantRouter.post("/assistant/reviews/:id/approve", canReview, route(async (req, res) => send(res, 200, await reviewsService.approve(actorOf(req), req.params.id, req.body))));
assistantRouter.post("/assistant/reviews/:id/reject", canReview, route(async (req, res) => send(res, 200, await reviewsService.reject(actorOf(req), req.params.id, req.body))));

// Forwarded questions
assistantRouter.get("/assistant/escalations", canEscalate, route(async (req, res) => send(res, 200, await escalationsService.list(tenant(req), { status: query(req, "status") }))));
assistantRouter.get("/assistant/escalations/:id", canEscalate, route(async (req, res) => send(res, 200, await escalationsService.get(tenant(req), req.params.id))));
assistantRouter.post("/assistant/escalations/:id/answer", canEscalate, route(async (req, res) =>
  send(res, 200, await escalationsService.answerInPanel(actorOf(req), req.params.id, req.body, true))));
assistantRouter.post("/assistant/escalations/:id/resend", canEscalate, route(async (req, res) => send(res, 200, await escalationsService.resend(actorOf(req), req.params.id, req.body))));
assistantRouter.post("/assistant/escalations/:id/close", canEscalate, route(async (req, res) => send(res, 200, await escalationsService.close(actorOf(req), req.params.id, req.body))));

// Responsible persons and settings
assistantRouter.get("/assistant/contacts", canEscalate, route(async (req, res) => send(res, 200, await contactsService.list(tenant(req)))));
assistantRouter.post("/assistant/contacts", canEscalate, route(async (req, res) => send(res, 201, await contactsService.save(actorOf(req), null, req.body))));
assistantRouter.put("/assistant/contacts/:id", canEscalate, route(async (req, res) => send(res, 200, await contactsService.save(actorOf(req), req.params.id, req.body))));
assistantRouter.delete("/assistant/contacts/:id", canEscalate, route(async (req, res) => send(res, 200, await contactsService.remove(actorOf(req), req.params.id))));
assistantRouter.get("/assistant/staff", canEscalate, route(async (req, res) => {
  const { rows } = await postgresService.query(
    `SELECT id, full_name, email, phone, role FROM erp_users WHERE institution_id = $1 AND status = 'ACTIVE' AND role NOT IN ('STUDENT', 'GUARDIAN')
       AND ($2 = '' OR full_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%') ORDER BY full_name LIMIT 50`,
    [tenant(req), query(req, "search")]
  );
  send(res, 200, rows.map((row: any) => ({ id: row.id, name: row.full_name, email: row.email || "", phone: row.phone || "", role: row.role })));
}));
assistantRouter.get("/assistant/settings", canManageAny, route(async (req, res) => send(res, 200, await settingsService.get(tenant(req)))));
assistantRouter.put("/assistant/settings", canEscalate, route(async (req, res) => send(res, 200, await settingsService.save(actorOf(req), req.body))));

// What the signed-in person may do here, for the panel's menus.
assistantRouter.get("/assistant/me", route(async (req, res) => send(res, 200, {
  canManageKnowledge: hasPermissionKey(req, "voice-ai.manage_knowledge"),
  canReview: hasPermissionKey(req, "voice-ai.review_knowledge"),
  canEscalate: hasPermissionKey(req, "voice-ai.manage_escalations"),
  canAnalytics: hasPermissionKey(req, "voice-ai.view_analytics"),
})));

// ---- The responsible person's private answer link (no sign-in) ---------------------------

const replies = new Map<string, number[]>();
const limitReplies = (req: Request, res: Response, next: NextFunction) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const hits = (replies.get(key) || []).filter((at) => now - at < 60_000);
  if (hits.length >= 30) {
    res.status(429).json({ success: false, statusCode: 429, error: "Too many requests. Try again in a minute." });
    return;
  }
  hits.push(now);
  replies.set(key, hits);
  next();
};

assistantPublicRouter.get("/public/assistant/answer/:token", limitReplies, route(async (req, res) => send(res, 200, await publicReplyService.view(req.params.token))));
assistantPublicRouter.post("/public/assistant/answer/:token", limitReplies, route(async (req, res) => send(res, 200, await publicReplyService.answer(req.params.token, req.body))));
