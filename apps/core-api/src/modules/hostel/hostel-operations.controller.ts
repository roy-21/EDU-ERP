import { Request, Router } from "express";
import { postgresService } from "../../database/postgres";
import { hostelFeesService, hostelGroupsService } from "./hostel-fees.service";
import { hostelMealsService } from "./hostel-meals.service";
import { hostelRefundsService } from "./hostel-refunds.service";
import { hostelNotificationService, queueDirect, queueMealReminders } from "./hostel-notifications.service";
import { renderInvoicePdf } from "./hostel-receipt.service";
import { getRentSettings } from "./hostel-rent.repository";
import { hostelRentSync } from "./hostel-rent-sync.service";
import { hostelVisitorsService } from "./hostel-visitors.service";
import { HostelContext, HostelError, contextOf, route, send, taka, toMoney } from "./hostel.common";
import { hasPermission, requirePermission } from "./hostel.permissions";
import { parseRequiredReason, parseSeat } from "./hostel.validation";

export const hostelOperationsRouter = Router();

const reason = (req: Request) => (typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "");

// ---- Allocation confirmation email --------------------------------------

// Sent after the allocation is saved, so a mail problem never undoes an allocation.
export const sendAllocationConfirmation = async (ctx: HostelContext, allocationId: string, manual: boolean) => {
  const { rows } = await postgresService.query(
    `SELECT a.*, r.hostel_name, r.building, r.room_number,
       (SELECT due_date FROM hostel_invoices i WHERE i.allocation_id = a.id AND i.category = 'RENT'
         ORDER BY billing_month LIMIT 1) AS first_rent_due
     FROM hostel_allocations a LEFT JOIN hostel_rooms r ON r.id = a.room_id
     WHERE a.institution_id = $1 AND a.id = $2`,
    [ctx.institutionId, allocationId]
  );
  const allocation = rows[0];
  if (!allocation) throw new HostelError(404, "Allocation not found.");
  if (allocation.status !== "Allocated") throw new HostelError(409, "Only an allocated student can be sent a confirmation.");

  const settings = await getRentSettings(ctx.institutionId);
  const details: [string, string][] = [
    ["Student Full Name", allocation.student_name],
    ["Student ID", allocation.student_id],
    ["Building", `${allocation.hostel_name}, ${allocation.building}`],
    ["Room Number", allocation.room_number],
    ["Seat Number", String(allocation.seat_number)],
    ["Allocation Start Date", allocation.start_date],
    ["Monthly Rent", taka(toMoney(allocation.monthly_rent))],
    ["Payment Due Date", allocation.first_rent_due || allocation.first_due_date || "-"],
    ["Security Deposit", taka(toMoney(allocation.security_deposit))],
    ["Guardian", `${allocation.guardian_name}${allocation.guardian_relationship ? ` (${allocation.guardian_relationship})` : ""}, ${allocation.guardian_phone}`],
    ...(settings.contactInfo ? ([["Hostel Contact", settings.contactInfo]] as [string, string][]) : []),
    ...(settings.hostelRules ? ([["Hostel Rules", settings.hostelRules]] as [string, string][]) : []),
  ];
  const today = new Date().toISOString().slice(0, 10);
  const key = manual ? `allocation-resend:${allocationId}:${today}` : `allocation:${allocationId}:${allocation.allocated_at?.toISOString?.() || ""}`;

  await queueDirect(ctx.institutionId, {
    scenario: "ALLOCATION",
    allocationId,
    studentId: allocation.student_id,
    studentName: allocation.student_name,
    recipients: [["EMAIL", allocation.student_email]],
    values: { studentName: allocation.student_name, studentId: allocation.student_id },
    details,
    dedupeKey: key,
    triggeredBy: ctx.actorEmail,
  });

  const log = await postgresService.query(
    "SELECT status, recipient, last_error FROM hostel_notifications WHERE institution_id = $1 AND dedupe_key = $2",
    [ctx.institutionId, `${key}:EMAIL`]
  );
  return { status: log.rows[0]?.status, recipient: log.rows[0]?.recipient, error: log.rows[0]?.last_error };
};

hostelOperationsRouter.post(
  "/hostel/allocations/:id/confirmation",
  requirePermission("manage_allocations"),
  route(async (req, res) => {
    send(res, 200, await sendAllocationConfirmation(contextOf(req), req.params.id, true));
  })
);

// ---- Seat rent ----------------------------------------------------------

hostelOperationsRouter.get(
  "/hostel/seats/:id/rent",
  requirePermission("view_rooms", "manage_rooms", "manage_allocations"),
  route(async (req, res) => {
    send(res, 200, await hostelRentSync.rentDetails(req.institutionId as string, req.params.id));
  })
);

hostelOperationsRouter.put(
  "/hostel/seats/:id/rent",
  requirePermission("manage_rooms", "manage_allocations"),
  route(async (req, res) => {
    const input = parseSeat(req.body);
    const ctx = contextOf(req);
    send(res, 200, {
      ...(await hostelRentSync.updateSeat(ctx, req.params.id, { monthlyFee: input.monthlyFee, effectiveMonth: input.effectiveMonth })),
      details: await hostelRentSync.rentDetails(ctx.institutionId, req.params.id),
    });
  })
);

// ---- Invoices: PDF and email --------------------------------------------

hostelOperationsRouter.get(
  "/hostel/invoices/:id/pdf",
  requirePermission("manage_payments", "view_due_rent", "manage_fees"),
  route(async (req, res) => {
    const file = await renderInvoicePdf(req.institutionId as string, req.params.id);
    send(res, 200, { fileName: file.fileName, contentBase64: file.content.toString("base64") });
  })
);

hostelOperationsRouter.post(
  "/hostel/invoices/:id/email",
  requirePermission("manage_payments", "send_reminders"),
  route(async (req, res) => {
    send(res, 200, await hostelNotificationService.emailInvoice(contextOf(req), req.params.id));
  })
);

// ---- Meals --------------------------------------------------------------

const canSeeMeals = requirePermission("manage_meals", "manage_payments", "view_due_rent");

hostelOperationsRouter.get("/hostel/meals", canSeeMeals, route(async (req, res) => {
  send(res, 200, await hostelMealsService.list(req.institutionId as string));
}));

hostelOperationsRouter.get("/hostel/meals/dues", requirePermission("manage_meals", "send_reminders"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.dues(req.institutionId as string));
}));

hostelOperationsRouter.post("/hostel/meals/dues/remind", requirePermission("send_reminders"), route(async (req, res) => {
  const ids = req.body?.allocationIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some((id) => typeof id !== "string")) {
    throw new HostelError(400, "Choose at least one student.");
  }
  const ctx = contextOf(req);
  send(res, 200, await queueMealReminders(ctx.institutionId, { allocationIds: ids, triggeredBy: ctx.actorEmail }));
}));

hostelOperationsRouter.get("/hostel/meals/members/:allocationId", canSeeMeals, route(async (req, res) => {
  send(res, 200, await hostelMealsService.memberSummary(req.institutionId as string, req.params.allocationId));
}));

hostelOperationsRouter.get("/hostel/meals/:id/image", canSeeMeals, route(async (req, res) => {
  send(res, 200, await hostelMealsService.image(req.institutionId as string, req.params.id));
}));

hostelOperationsRouter.get("/hostel/meals/:id", canSeeMeals, route(async (req, res) => {
  send(res, 200, await hostelMealsService.get(req.institutionId as string, req.params.id));
}));

hostelOperationsRouter.post("/hostel/meals", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 201, await hostelMealsService.create(contextOf(req), req.body));
}));

hostelOperationsRouter.put("/hostel/meals/:id", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.update(contextOf(req), req.params.id, req.body));
}));

hostelOperationsRouter.post("/hostel/meals/:id/publish", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.publish(contextOf(req), req.params.id));
}));

hostelOperationsRouter.post("/hostel/meals/:id/cancel", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.cancel(contextOf(req), req.params.id, reason(req)));
}));

hostelOperationsRouter.post("/hostel/meals/:id/bookings", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 201, await hostelMealsService.book(contextOf(req), req.params.id, req.body ?? {}));
}));

hostelOperationsRouter.put("/hostel/meal-bookings/:id", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.changeBooking(contextOf(req), req.params.id, { quantity: req.body?.quantity }));
}));

hostelOperationsRouter.post("/hostel/meal-bookings/:id/cancel", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.changeBooking(contextOf(req), req.params.id, { cancel: true }));
}));

hostelOperationsRouter.post("/hostel/meal-bookings/:id/collected", requirePermission("manage_meals"), route(async (req, res) => {
  send(res, 200, await hostelMealsService.markCollected(contextOf(req), req.params.id));
}));

// ---- Refunds --------------------------------------------------------------

hostelOperationsRouter.get("/hostel/refunds", requirePermission("manage_payments", "manage_meals", "view_due_rent"), route(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const allocationId = typeof req.query.allocationId === "string" ? req.query.allocationId : "";
  send(res, 200, await hostelRefundsService.list(req.institutionId as string, { status, allocationId }));
}));

hostelOperationsRouter.post("/hostel/refunds/:id/pay", requirePermission("manage_payments"), route(async (req, res) => {
  send(res, 200, await hostelRefundsService.pay(contextOf(req), req.params.id, req.body));
}));

// ---- Visitors -----------------------------------------------------------

const revealNid = (req: Request) => hasPermission(req, "manage_students");

hostelOperationsRouter.get("/hostel/visitors", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 200, await hostelVisitorsService.list(req.institutionId as string, revealNid(req)));
}));

hostelOperationsRouter.get("/hostel/visitors/ticket/:ticket", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 200, await hostelVisitorsService.findByTicket(req.institutionId as string, req.params.ticket, revealNid(req)));
}));

hostelOperationsRouter.get("/hostel/visitors/:id", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 200, await hostelVisitorsService.get(req.institutionId as string, req.params.id, revealNid(req)));
}));

hostelOperationsRouter.post("/hostel/visitors", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 201, await hostelVisitorsService.create(contextOf(req), req.body));
}));

hostelOperationsRouter.post("/hostel/visitors/:id/check-in", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 200, await hostelVisitorsService.checkIn(contextOf(req), req.params.id));
}));

hostelOperationsRouter.post("/hostel/visitors/:id/check-out", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 200, await hostelVisitorsService.checkOut(contextOf(req), req.params.id));
}));

hostelOperationsRouter.post("/hostel/visitors/:id/status", requirePermission("manage_visitors"), route(async (req, res) => {
  const status = req.body?.status;
  if (!["Approved", "Rejected", "Cancelled"].includes(status)) throw new HostelError(400, "Status must be Approved, Rejected or Cancelled.");
  send(res, 200, await hostelVisitorsService.setStatus(contextOf(req), req.params.id, status, reason(req)));
}));

hostelOperationsRouter.get("/hostel/visitor-documents/:id", requirePermission("manage_visitors"), route(async (req, res) => {
  send(res, 200, await hostelVisitorsService.document(contextOf(req), req.params.id));
}));

// ---- Fees ---------------------------------------------------------------

hostelOperationsRouter.get("/hostel/fees", requirePermission("manage_fees", "manage_payments", "view_due_rent"), route(async (req, res) => {
  const institutionId = req.institutionId as string;
  const [config, overview] = await Promise.all([hostelFeesService.list(institutionId), hostelFeesService.overview(institutionId)]);
  send(res, 200, { ...config, overview });
}));

hostelOperationsRouter.post("/hostel/fees", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 201, await hostelFeesService.createType(contextOf(req), req.body));
}));

hostelOperationsRouter.put("/hostel/fees/:id", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 200, await hostelFeesService.updateType(contextOf(req), req.params.id, req.body));
}));

hostelOperationsRouter.get("/hostel/fee-groups", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 200, await hostelGroupsService.list(req.institutionId as string));
}));

hostelOperationsRouter.post("/hostel/fee-groups", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 201, await hostelGroupsService.create(contextOf(req), req.body));
}));

hostelOperationsRouter.put("/hostel/fee-groups/:id", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 200, await hostelGroupsService.update(contextOf(req), req.params.id, req.body));
}));

hostelOperationsRouter.delete("/hostel/fee-groups/:id", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 200, await hostelGroupsService.remove(contextOf(req), req.params.id));
}));

hostelOperationsRouter.post("/hostel/fee-assignments", requirePermission("manage_fees"), route(async (req, res) => {
  send(res, 201, await hostelFeesService.assign(contextOf(req), req.body));
}));

hostelOperationsRouter.post("/hostel/fee-assignments/:id/stop", requirePermission("manage_fees"), route(async (req, res) => {
  parseRequiredReason(req.body?.reason);
  send(res, 200, await hostelFeesService.setAssignmentActive(contextOf(req), req.params.id, false));
}));
