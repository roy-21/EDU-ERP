import { requestContext } from "./middleware/request-context";
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth.middleware";
import { healthRouter } from "./modules/health/health.controller";
import { authRouter } from "./modules/auth/auth.controller";
import { settingsRouter } from "./modules/settings/settings.controller";
import { institutionRouter } from "./modules/institution/institution.controller";
import { academicsRouter } from "./modules/academics/academics.controller";
import { objectionRouter } from "./modules/objection/objection.controller";
import { aiGatewayRouter } from "./modules/ai/ai.controller";
import { voiceGatewayRouter } from "./modules/voice/voice.controller";
import { hostelRouter } from "./modules/hostel/hostel.controller";
import { hostelRentRouter } from "./modules/hostel/hostel-rent.controller";
import { hostelGatewayRouter } from "./modules/hostel/hostel-gateway.controller";
import { hostelOperationsRouter } from "./modules/hostel/hostel-operations.controller";
import { hostelPublicRouter } from "./modules/hostel/hostel-public.controller";
import { erpRouter } from "./modules/erp/erp.controller";
import { identityRouter, publicIdentityRouter } from "./modules/identity/identity.controller";
import { portalRouter } from "./modules/portal/portal.controller";
import { financeRouter } from "./modules/finance/finance.controller";
import { noticeRouter } from "./modules/notice/notice.controller";
import { libraryRouter } from "./modules/library/library.controller";
import { hrRouter } from "./modules/hr/hr.controller";
import { inventoryRouter } from "./modules/inventory/inventory.controller";
import { assistantPublicRouter, assistantRouter } from "./modules/assistant/assistant.controller";

export function createApp(): Application {
  const app = express();

  // Behind a reverse proxy, TRUST_PROXY (for example "1" or "loopback") lets Express read the client's
  // real IP from X-Forwarded-For. Off by default, because anyone can send that header.
  if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.use(requestContext);

  // Middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  // Global Correlation ID and Access Logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = req.headers["x-correlation-id"] || `req_${Date.now()}`;
    res.setHeader("X-Correlation-Id", correlationId as string);
    next();
  });

  // Base API v1 Routes
  const apiRouter = express.Router();

  // Public / Health Routes
  apiRouter.use(healthRouter);
  apiRouter.use(authRouter);
  apiRouter.use(hostelPublicRouter);
  apiRouter.use(publicIdentityRouter);
  apiRouter.use(assistantPublicRouter);

  // Protected Routes
  apiRouter.use(authMiddleware);
  apiRouter.use(identityRouter);
  apiRouter.use(portalRouter);
  apiRouter.use(settingsRouter);
  apiRouter.use(institutionRouter);
  apiRouter.use(academicsRouter);
  apiRouter.use(financeRouter);
  apiRouter.use(noticeRouter);
  apiRouter.use(libraryRouter);
  apiRouter.use(hrRouter);
  apiRouter.use(inventoryRouter);
  apiRouter.use(assistantRouter);
  apiRouter.use(objectionRouter);
  apiRouter.use(aiGatewayRouter);
  apiRouter.use(voiceGatewayRouter);
  apiRouter.use(hostelRouter);
  apiRouter.use(hostelRentRouter);
  apiRouter.use(hostelGatewayRouter);
  apiRouter.use(hostelOperationsRouter);
  apiRouter.use(erpRouter);

  app.use("/api/v1", apiRouter);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      statusCode: 404,
      error: `Cannot ${req.method} ${req.url}`
    });
  });

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled ERP Server Error:", err);
    res.status(500).json({
      success: false,
      statusCode: 500,
      error: err.message || "Internal Server Error"
    });
  });

  return app;
}

