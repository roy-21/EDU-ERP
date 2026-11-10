import { Request, Router } from "express";
import { postgresService } from "../../database/postgres";
import { generateInvoices, hostelBillingService } from "./hostel-billing.service";
import { hostelDocumentsRepository } from "./hostel-documents.repository";
import {
  SCENARIOS,
  hostelNotificationService,
  providerStatus,
} from "./hostel-notifications.service";
import { hostelRentRepository } from "./hostel-rent.repository";
import { hostelAllocationsRepository } from "./hostel-allocations.repository";
import { latestJobRun, runRentCycle } from "./hostel.scheduler";
import { HostelError, contextOf, route, send, writeAudit } from "./hostel.common";
import { hasPermission, requirePermission } from "./hostel.permissions";
import {
  parseAdjustment,
  parseOptionalDueDay,
  parsePayment,
  parseRentSettings,
  parseRequiredReason,
} from "./hostel.validation";

export const hostelRentRouter = Router();

const queryText = (req: Request, key: string): string | undefined => {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

// Rent configuration
hostelRentRouter.get(
  "/hostel/rent/config",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    const institutionId = req.institutionId as string;
    const [overview, templates, lastJob] = await Promise.all([
      hostelRentRepository.overview(institutionId),
      hostelNotificationService.listTemplates(institutionId),
      latestJobRun(),
    ]);
    send(res, 200, { ...overview, templates, providers: providerStatus(), lastJob });
  })
);

hostelRentRouter.put(
  "/hostel/rent/settings",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelRentRepository.updateSettings(contextOf(req), parseRentSettings(req.body)));
  })
);

hostelRentRouter.put(
  "/hostel/rent/buildings/:id",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelRentRepository.setBuildingDueDay(contextOf(req), req.params.id, parseOptionalDueDay(req.body?.dueDay)));
  })
);

hostelRentRouter.put(
  "/hostel/rent/seats/:id",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelRentRepository.setSeatDueDay(contextOf(req), req.params.id, parseOptionalDueDay(req.body?.dueDay)));
  })
);

hostelRentRouter.get(
  "/hostel/rent/seats/:id/effective-due-day",
  requirePermission("configure_rent", "manage_allocations"),
  route(async (req, res) => {
    send(res, 200, await hostelRentRepository.effectiveDueDay(req.institutionId as string, req.params.id));
  })
);

hostelRentRouter.put(
  "/hostel/rent/templates/:scenario",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    const scenario = req.params.scenario as (typeof SCENARIOS)[number];
    if (!SCENARIOS.includes(scenario)) throw new HostelError(404, "Template not found.");

    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!subject || subject.length > 255) throw new HostelError(400, "Subject is required, up to 255 characters.");
    if (!body || body.length > 1000) throw new HostelError(400, "Message is required, up to 1000 characters.");

    send(res, 200, await hostelNotificationService.saveTemplate(contextOf(req), scenario, subject, body));
  })
);

// Billing
hostelRentRouter.post(
  "/hostel/invoices/generate",
  requirePermission("manage_payments", "configure_rent"),
  route(async (req, res) => {
    const ctx = contextOf(req);
    send(res, 200, await generateInvoices(ctx.institutionId, { ctx }));
  })
);

hostelRentRouter.get(
  "/hostel/invoices",
  requirePermission("manage_payments", "view_due_rent"),
  route(async (req, res) => {
    send(
      res,
      200,
      await hostelBillingService.listInvoices(req.institutionId as string, {
        month: queryText(req, "month"),
        status: queryText(req, "status"),
        query: queryText(req, "q"),
        category: queryText(req, "category"),
        buildingId: queryText(req, "buildingId"),
        from: queryText(req, "from"),
        to: queryText(req, "to"),
      })
    );
  })
);

hostelRentRouter.get(
  "/hostel/invoices/:id",
  requirePermission("manage_payments", "view_due_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelBillingService.getInvoice(req.institutionId as string, req.params.id));
  })
);

hostelRentRouter.post(
  "/hostel/invoices/:id/adjustments",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    send(res, 201, await hostelBillingService.adjustInvoice(contextOf(req), req.params.id, parseAdjustment(req.body)));
  })
);

// Payments
hostelRentRouter.post(
  "/hostel/invoices/:id/payments",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    const ctx = contextOf(req);
    const { payment, isRepeat } = await hostelBillingService.recordPayment(ctx, req.params.id, parsePayment(req.body));

    // The payment is already saved, so a messaging problem must not fail this request.
    if (!isRepeat) {
      hostelNotificationService
        .sendPaymentConfirmation(ctx.institutionId, payment)
        .catch((err) => console.error("[Hostel] Payment confirmation failed:", err.message));
    }
    send(res, isRepeat ? 200 : 201, payment);
  })
);

hostelRentRouter.get(
  "/hostel/payments",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    send(res, 200, await hostelBillingService.listPayments(req.institutionId as string));
  })
);

hostelRentRouter.get(
  "/hostel/payments/:id/receipt",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    send(res, 200, await hostelBillingService.getPayment(req.institutionId as string, req.params.id));
  })
);

hostelRentRouter.post(
  "/hostel/payments/:id/reverse",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    send(res, 200, await hostelBillingService.reversePayment(contextOf(req), req.params.id, parseRequiredReason(req.body?.reason)));
  })
);

// Due rent
hostelRentRouter.get(
  "/hostel/due-rent/count",
  requirePermission("view_due_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelBillingService.dueRentCount(req.institutionId as string));
  })
);

const dueRentFilters = (req: Request) => ({
  buildingId: queryText(req, "buildingId"),
  room: queryText(req, "room"),
  month: queryText(req, "month"),
  dueOn: queryText(req, "dueOn"),
  paymentState: queryText(req, "paymentState"),
  query: queryText(req, "q"),
});

hostelRentRouter.get(
  "/hostel/due-rent",
  requirePermission("view_due_rent"),
  route(async (req, res) => {
    const institutionId = req.institutionId as string;
    const [list, count] = await Promise.all([
      hostelBillingService.listDueRent(institutionId, dueRentFilters(req)),
      hostelBillingService.dueRentCount(institutionId),
    ]);
    send(res, 200, { ...list, count });
  })
);

hostelRentRouter.get(
  "/hostel/due-rent/export",
  requirePermission("export_reports"),
  route(async (req, res) => {
    const ctx = contextOf(req);
    const { rows } = await hostelBillingService.listDueRent(ctx.institutionId, dueRentFilters(req));
    await postgresService.transaction((tx) =>
      writeAudit(tx, ctx, "Exported", "Due Rent", "", `Exported ${rows.length} due rent record(s).`)
    );
    send(res, 200, rows);
  })
);

// One student's full rent record.
hostelRentRouter.get(
  "/hostel/ledger/:allocationId",
  requirePermission("view_due_rent", "manage_payments"),
  route(async (req, res) => {
    const institutionId = req.institutionId as string;
    const { allocationId } = req.params;
    const canSeeDocuments = hasPermission(req, "manage_students");

    const allocation = await hostelAllocationsRepository.get(institutionId, allocationId, canSeeDocuments);
    const [ledger, notifications, documents] = await Promise.all([
      hostelBillingService.getLedger(institutionId, allocationId),
      hostelNotificationService.list(institutionId, { allocationId, limit: 100 }),
      canSeeDocuments ? hostelDocumentsRepository.list(institutionId, allocationId) : [],
    ]);
    send(res, 200, { allocation, ...ledger, notifications, documents });
  })
);

// Notifications
hostelRentRouter.post(
  "/hostel/notifications/remind/:allocationId",
  requirePermission("send_reminders"),
  route(async (req, res) => {
    send(res, 200, await hostelNotificationService.sendManualReminder(contextOf(req), req.params.allocationId));
  })
);

hostelRentRouter.get(
  "/hostel/notifications",
  requirePermission("send_reminders", "view_due_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelNotificationService.list(req.institutionId as string));
  })
);

hostelRentRouter.post(
  "/hostel/notifications/:id/retry",
  requirePermission("send_reminders"),
  route(async (req, res) => {
    send(res, 200, await hostelNotificationService.retry(contextOf(req), req.params.id));
  })
);

hostelRentRouter.post(
  "/hostel/jobs/run",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await runRentCycle());
  })
);

// Documents
hostelRentRouter.get(
  "/hostel/allocations/:id/documents",
  requirePermission("manage_students"),
  route(async (req, res) => {
    send(res, 200, await hostelDocumentsRepository.list(req.institutionId as string, req.params.id));
  })
);

hostelRentRouter.post(
  "/hostel/allocations/:id/documents",
  requirePermission("manage_students"),
  route(async (req, res) => {
    send(res, 201, await hostelDocumentsRepository.upload(contextOf(req), req.params.id, req.body));
  })
);

hostelRentRouter.get(
  "/hostel/documents/:id",
  requirePermission("manage_students"),
  route(async (req, res) => {
    send(res, 200, await hostelDocumentsRepository.download(contextOf(req), req.params.id));
  })
);
