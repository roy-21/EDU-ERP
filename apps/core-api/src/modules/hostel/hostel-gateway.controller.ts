import { Router } from "express";
import { postgresService } from "../../database/postgres";
import { hostelDashboardService, hostelPaymentMethods } from "./hostel-billing.service";
import { BKASH_BASE_URLS, bkashConfig } from "./hostel-bkash.client";
import { hostelNotificationService } from "./hostel-notifications.service";
import { hostelGatewayService } from "./hostel-online-payment.service";
import { issuePaymentLink } from "./hostel-payment-links";
import { renderReceiptPdf } from "./hostel-receipt.service";
import { listJobStatus } from "./hostel.scheduler";
import { HostelError, contextOf, route, send, writeAudit } from "./hostel.common";
import { requirePermission } from "./hostel.permissions";
import { PAYMENT_METHODS } from "./hostel.validation";

export const hostelGatewayRouter = Router();

const secretField = (value: unknown, label: string): string => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 500) throw new HostelError(400, `${label} is not valid.`);
  return value.trim();
};

hostelGatewayRouter.get(
  "/hostel/gateway/config",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await bkashConfig.get(req.institutionId as string));
  })
);

hostelGatewayRouter.put(
  "/hostel/gateway/config",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    const environment = req.body?.environment;
    if (!Object.keys(BKASH_BASE_URLS).includes(environment)) {
      throw new HostelError(400, "Environment must be sandbox or production.");
    }
    send(
      res,
      200,
      await bkashConfig.save(contextOf(req), {
        environment,
        enabled: req.body?.enabled === true,
        apiBaseUrl: secretField(req.body?.apiBaseUrl, "API address"),
        username: secretField(req.body?.username, "Username"),
        password: secretField(req.body?.password, "Password"),
        appKey: secretField(req.body?.appKey, "App key"),
        appSecret: secretField(req.body?.appSecret, "App secret"),
      })
    );
  })
);

hostelGatewayRouter.post(
  "/hostel/gateway/test",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await bkashConfig.test(contextOf(req)));
  })
);

hostelGatewayRouter.get(
  "/hostel/gateway/transactions",
  requirePermission("manage_payments", "view_due_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelGatewayService.list(req.institutionId as string));
  })
);

hostelGatewayRouter.post(
  "/hostel/gateway/transactions/:id/verify",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    send(res, 200, await hostelGatewayService.verifyNow(contextOf(req), req.params.id));
  })
);

hostelGatewayRouter.get(
  "/hostel/payment-methods",
  requirePermission("manage_payments", "configure_rent"),
  route(async (req, res) => {
    send(res, 200, await hostelPaymentMethods.list(req.institutionId as string));
  })
);

hostelGatewayRouter.put(
  "/hostel/payment-methods/:method",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    if (!PAYMENT_METHODS.includes(req.params.method)) throw new HostelError(404, "Payment method not found.");
    send(res, 200, await hostelPaymentMethods.setEnabled(contextOf(req), req.params.method, req.body?.enabled === true));
  })
);

hostelGatewayRouter.post(
  "/hostel/invoices/:id/payment-link",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    const ctx = contextOf(req);
    const { rows } = await postgresService.query(
      "SELECT invoice_number FROM hostel_invoices WHERE institution_id = $1 AND id = $2",
      [ctx.institutionId, req.params.id]
    );
    if (!rows[0]) throw new HostelError(404, "Invoice not found.");

    const url = await issuePaymentLink(ctx.institutionId, req.params.id);
    await postgresService.transaction((tx) =>
      writeAudit(tx, ctx, "Payment Link", "Invoice", req.params.id, `Created a payment link for ${rows[0].invoice_number}.`)
    );
    send(res, 201, { url });
  })
);

hostelGatewayRouter.get(
  "/hostel/payments/:id/receipt-pdf",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    const file = await renderReceiptPdf(req.institutionId as string, req.params.id);
    send(res, 200, { fileName: file.fileName, contentBase64: file.content.toString("base64") });
  })
);

hostelGatewayRouter.post(
  "/hostel/payments/:id/email-receipt",
  requirePermission("manage_payments"),
  route(async (req, res) => {
    send(res, 200, await hostelNotificationService.emailReceipt(contextOf(req), req.params.id));
  })
);

hostelGatewayRouter.get(
  "/hostel/rent/dashboard",
  requirePermission("view_due_rent"),
  route(async (req, res) => {
    const text = (key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");
    send(
      res,
      200,
      await hostelDashboardService.get(req.institutionId as string, {
        buildingId: text("buildingId"),
        month: text("month"),
        method: text("method"),
        status: text("status"),
      })
    );
  })
);

hostelGatewayRouter.get(
  "/hostel/jobs",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    send(res, 200, await listJobStatus());
  })
);

hostelGatewayRouter.post(
  "/hostel/email/test",
  requirePermission("configure_rent"),
  route(async (req, res) => {
    const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    send(res, 200, await hostelNotificationService.sendTestEmail(contextOf(req), to));
  })
);
