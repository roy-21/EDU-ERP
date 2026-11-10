import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/db";

export const objectionRouter = Router();

// GET all objections / tickets
objectionRouter.get("/objections", (req: Request, res: Response): void => {
  const instId = req.institutionId || "inst-001";
  const tickets = db.objections.filter(o => o.institutionId === instId);
  res.status(200).json({ success: true, statusCode: 200, data: tickets });
});

// CREATE objection (can be called by Web Portal OR Voice Assistant Backend)
objectionRouter.post("/objections", (req: Request, res: Response): void => {
  const instId = req.institutionId || req.body.institutionId || "inst-001";
  const { studentId, source, category, severity, title, description, callSessionId } = req.body;

  if (!title || !description) {
    res.status(400).json({ success: false, statusCode: 400, error: "Title and description are required." });
    return;
  }

  const newObjection = {
    id: uuidv4(),
    institutionId: instId,
    studentId,
    source: source || "MANUAL",
    category: category || "GENERAL_COMPLAINT",
    severity: severity || "MEDIUM",
    title,
    description,
    status: "OPEN" as const,
    callSessionId,
    createdAt: new Date().toISOString()
  };

  db.objections.unshift(newObjection);

  res.status(201).json({
    success: true,
    statusCode: 201,
    data: newObjection,
    message: "Objection registered and notification dispatched to responsible faculty/admin."
  });
});

// UPDATE objection status
objectionRouter.patch("/objections/:id/status", (req: Request, res: Response): void => {
  const instId = req.institutionId || "inst-001";
  const { id } = req.params;
  const { status } = req.body;

  const ticket = db.objections.find(o => o.institutionId === instId && o.id === id);
  if (!ticket) {
    res.status(404).json({ success: false, statusCode: 404, error: "Objection ticket not found." });
    return;
  }

  ticket.status = status;
  res.status(200).json({ success: true, statusCode: 200, data: ticket });
});

