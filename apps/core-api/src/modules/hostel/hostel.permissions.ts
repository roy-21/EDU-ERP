import { NextFunction, Request, Response } from "express";

export const HOSTEL_PERMISSIONS = [
  "view_rooms",
  "manage_rooms",
  "manage_allocations",
  "manage_students",
  "configure_rent",
  "manage_payments",
  "view_due_rent",
  "send_reminders",
  "export_reports",
  "manage_meals",
  "manage_visitors",
  "manage_fees",
] as const;

export type HostelPermission = (typeof HOSTEL_PERMISSIONS)[number];

// Worked out per request from the user's role, overrides and the institution's
// subscription (see the auth middleware), so a change applies immediately.
export const permissionsOf = (req: Request): HostelPermission[] => {
  const held = new Set(req.user?.permissions || []);
  return HOSTEL_PERMISSIONS.filter((item) => held.has(`hostel.${item}`));
};

export const hasPermission = (req: Request, ...anyOf: HostelPermission[]): boolean => {
  const granted = permissionsOf(req);
  return anyOf.some((item) => granted.includes(item));
};

export const requirePermission =
  (...anyOf: HostelPermission[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (hasPermission(req, ...anyOf)) return next();

    res.status(403).json({
      success: false,
      statusCode: 403,
      error: `Forbidden: requires one of these hostel permissions: ${anyOf.join(", ")}.`,
    });
  };
