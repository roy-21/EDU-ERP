import { Router, Request, Response } from "express";
import { postgresService } from "../../database/postgres";

export const healthRouter = Router();

healthRouter.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    statusCode: 200,
    data: {
      service: "core-erp-backend",
      version: "1.0.0",
      status: "HEALTHY",
      database: {
        type: "PostgreSQL 16",
        connected: postgresService.isLive(),
        mode: postgresService.isLive() ? "POSTGRES_POOL" : "RESILIENT_STORAGE"
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
});
