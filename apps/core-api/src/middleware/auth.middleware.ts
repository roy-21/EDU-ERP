import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/environment";
import { postgresService } from "../database/postgres";
import { ALL_PERMISSION_KEYS, MODULE_IDS } from "../modules/identity/identity.catalog";
import { loadPrincipal } from "../modules/identity/identity.service";

export interface AuthenticatedUser {
  userId: string;
  institutionId: string;
  role: string;
  email: string;
  username?: string;
  fullName?: string;
  permissions: string[];
  modules: string[];
  linkedType?: string | null;
  linkedId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      institutionId?: string;
    }
  }
}

const deny = (res: Response, status: number, error: string, code?: string) => {
  res.status(status).json({ success: false, statusCode: status, error, ...(code ? { code } : {}) });
};

// Who is calling is read from the database on every request, never trusted from the
// token alone, so a disabled account, a new role or a suspended institution applies at once.
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.path === "/api/v1/health") return next();

  // Calls from the AI and voice services.
  const serviceToken = req.headers["x-service-token"];
  if (serviceToken && (serviceToken === config.serviceSecretAi || serviceToken === config.serviceSecretVoice)) {
    const instId = (req.headers["x-institution-id"] as string) || "inst-001";
    req.user = {
      userId: "service-caller",
      institutionId: instId,
      role: "SERVICE_INTERNAL",
      email: "internal@service",
      permissions: [...ALL_PERMISSION_KEYS],
      modules: [...MODULE_IDS],
    };
    req.institutionId = instId;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    deny(res, 401, "Missing or malformed Authorization header.");
    return;
  }

  let decoded: any;
  try {
    decoded = jwt.verify(authHeader.split(" ")[1], config.jwtSecret);
  } catch {
    deny(res, 401, "Invalid, expired, or untrusted access token.");
    return;
  }

  if (!postgresService.isLive()) {
    deny(res, 503, "The account database is unavailable. Try again shortly.");
    return;
  }

  try {
    const { principal, problem } = await loadPrincipal(String(decoded.userId || ""), Number(decoded.iat || 0));
    if (!principal) {
      deny(res, problem!.status, problem!.message);
      return;
    }
    req.user = {
      userId: principal.userId,
      institutionId: principal.institutionId,
      role: principal.role,
      email: principal.email,
      username: principal.username,
      fullName: principal.fullName,
      permissions: principal.permissions,
      modules: principal.modules,
      linkedType: principal.linkedType,
      linkedId: principal.linkedId,
    };
    req.institutionId = principal.institutionId;
    if (principal.mustChangePassword && req.path !== "/auth/me") {
      deny(res, 403, "Change your temporary password before continuing.", "PASSWORD_CHANGE_REQUIRED");
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      deny(res, 401, "Unauthorized");
      return;
    }
    if (req.user.role === "SUPER_ADMIN" || req.user.role === "SERVICE_INTERNAL") return next();
    if (!allowedRoles.includes(req.user.role)) {
      deny(res, 403, `Forbidden: requires one of [${allowedRoles.join(", ")}] roles.`);
      return;
    }
    next();
  };
}

export const hasPermissionKey = (req: Request, ...anyOf: string[]) => {
  const held = req.user?.permissions || [];
  return anyOf.some((key) => held.includes(key));
};

// Passes when the caller holds any one of the listed permissions.
export function requirePermissionKey(...anyOf: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      deny(res, 401, "Unauthorized");
      return;
    }
    if (hasPermissionKey(req, ...anyOf)) return next();
    deny(res, 403, `Forbidden: requires one of these permissions: ${anyOf.join(", ")}.`);
  };
}
