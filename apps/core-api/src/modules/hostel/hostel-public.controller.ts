import { NextFunction, Request, Response, Router } from "express";
import { postgresService } from "../../database/postgres";
import { hostelGatewayService, hostelPortalService } from "./hostel-online-payment.service";
import { renderReceiptPdf } from "./hostel-receipt.service";
import { route, send } from "./hostel.common";

// No login here: the secret in each address is what grants limited access.
export const hostelPublicRouter = Router();

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

const rateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const now = Date.now();
  if (hits.size > 10_000) {
    hits.forEach((entry, ip) => {
      if (entry.resetAt <= now) hits.delete(ip);
    });
  }
  const key = req.ip || "unknown";
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count <= RATE_LIMIT) return next();
  res.status(429).json({ success: false, statusCode: 429, error: "Too many requests. Please wait a minute." });
};

hostelPublicRouter.use("/public/hostel", rateLimit, (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (postgresService.isLive()) return next();
  res.status(503).json({ success: false, statusCode: 503, error: "This service is temporarily unavailable." });
});

const sendPdf = (res: Response, file: { fileName: string; content: Buffer }) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.send(file.content);
};

hostelPublicRouter.get(
  "/public/hostel/pay/:token",
  route(async (req, res) => {
    send(res, 200, await hostelPortalService.getPage(req.params.token));
  })
);

hostelPublicRouter.post(
  "/public/hostel/pay/:token/renew",
  route(async (req, res) => {
    await hostelPortalService.requestNewLink(req.params.token);
    send(res, 200, { message: "If an email address is on record, a new link has been sent to it." });
  })
);

hostelPublicRouter.post(
  "/public/hostel/pay/:token/bkash",
  route(async (req, res) => {
    send(
      res,
      200,
      await hostelPortalService.startCheckout(req.params.token, {
        amount: req.body?.amount,
        invoiceNumber: req.body?.invoiceNumber,
      })
    );
  })
);

hostelPublicRouter.get(
  "/public/hostel/pay/:token/receipts/:paymentId",
  route(async (req, res) => {
    const institutionId = await hostelPortalService.assertReceiptAccess(req.params.token, req.params.paymentId);
    sendPdf(res, await renderReceiptPdf(institutionId, req.params.paymentId));
  })
);

// bKash sends the browser here after checkout. Nothing is trusted until bKash confirms it.
hostelPublicRouter.get(
  "/public/hostel/bkash/callback/:secret",
  route(async (req, res) => {
    res.redirect(303, await hostelGatewayService.handleCallback(req.params.secret, req.query));
  })
);

hostelPublicRouter.get(
  "/public/hostel/payment-result/:secret",
  route(async (req, res) => {
    send(res, 200, await hostelGatewayService.getResult(req.params.secret));
  })
);

hostelPublicRouter.get(
  "/public/hostel/payment-result/:secret/receipt",
  route(async (req, res) => {
    const { institutionId, paymentId } = await hostelGatewayService.getResultReceiptPayment(req.params.secret);
    sendPdf(res, await renderReceiptPdf(institutionId, paymentId));
  })
);
