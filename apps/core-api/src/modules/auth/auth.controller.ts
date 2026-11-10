import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config/environment";
import { authMiddleware, requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { SYSTEM_ROLES, isSystemRole } from "../identity/identity.catalog";
import { Principal, authenticate, changePassword, usersService } from "../identity/identity.service";
import { actorOf } from "../identity/identity.controller";

export const authRouter = Router();

const PORTAL_HOME: Record<string, string> = { STUDENT: "/portal", GUARDIAN: "/portal" };

const session = (principal: Principal) => {
  const token = jwt.sign(
    { userId: principal.userId, institutionId: principal.institutionId, role: principal.role, email: principal.email, username: principal.username },
    config.jwtSecret,
    // A temporary password only buys enough time to choose a new one.
    { expiresIn: principal.mustChangePassword ? "15m" : "8h" }
  );
  return {
    token,
    mustChangePassword: principal.mustChangePassword,
    home: PORTAL_HOME[principal.role] || "/admin",
    user: {
      id: principal.userId,
      email: principal.email,
      username: principal.username,
      fullName: principal.fullName,
      role: principal.role,
      roleName: principal.roleName,
      institutionId: principal.institutionId,
      institutionName: principal.tenantName,
      permissions: principal.permissions,
      modules: principal.modules,
    },
  };
};

authRouter.post("/auth/login", route(async (req: Request, res: Response) => {
  const { username, email, password } = req.body || {};
  const identifier = typeof username === "string" && username ? username : email;
  if (typeof identifier !== "string" || !identifier || typeof password !== "string" || !password) {
    res.status(400).json({ success: false, statusCode: 400, error: "Username/email and password are required." });
    return;
  }
  send(res, 200, session(await authenticate(identifier, password)));
}));

// Needs the current password. Every older session ends, so a fresh token is returned.
authRouter.post("/auth/change-password", route(async (req: Request, res: Response) => {
  const { username, email, currentPassword, newPassword } = req.body || {};
  const identifier = typeof username === "string" && username ? username : email;
  if (typeof identifier !== "string" || !identifier || typeof currentPassword !== "string" || !currentPassword) {
    res.status(400).json({ success: false, statusCode: 400, error: "username, currentPassword, and newPassword are required." });
    return;
  }
  const principal = await changePassword(identifier, currentPassword, newPassword);
  send(res, 200, { ...session(principal), message: "Password changed successfully." });
}));

authRouter.get("/auth/me", authMiddleware, (req: Request, res: Response): void => {
  const user = req.user!;
  send(res, 200, { ...user, roleName: SYSTEM_ROLES[user.role]?.name || user.role, home: PORTAL_HOME[user.role] || "/admin" });
});

// Kept for older screens. Same rules as creating a user from the Users page.
authRouter.post("/auth/provision-user", authMiddleware, requirePermissionKey("system.manage_users"), route(async (req: Request, res: Response) => {
  const role = String(req.body?.role || "");
  const result = await usersService.create(actorOf(req), { ...req.body, role: isSystemRole(role.toUpperCase()) ? role.toUpperCase() : role });
  send(res, 201, { user: { ...result.user, institutionId: req.institutionId }, credentials: result.credentials });
}));
