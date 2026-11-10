import { currentRequest } from "../../middleware/request-context";
import { NextFunction, Request, Response } from "express";
import { PoolClient, types } from "pg";
import { v4 as uuidv4 } from "uuid";

// Keeps DATE columns as YYYY-MM-DD text. The default parser turns them into
// local-time Date objects, which can shift a due date by a day.
const POSTGRES_DATE_TYPE = 1082;
types.setTypeParser(POSTGRES_DATE_TYPE, (value) => value);

export class HostelError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface HostelContext {
  institutionId: string;
  actorId: string;
  actorEmail: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  hostel_rooms_unique_number: "This room number already exists in this hostel building.",
  hostel_allocations_one_per_seat: "This seat was just given to another student. Choose a different seat.",
  hostel_allocations_one_per_student: "This student already has a pending or active hostel allocation.",
  hostel_payments_unique_reference: "A confirmed payment with this transaction reference already exists.",
  hostel_fee_types_institution_id_name_key: "A fee with this name already exists.",
  hostel_meal_bookings_one_active: "This student already ordered this meal. Change the quantity instead.",
  hostel_student_groups_institution_id_name_key: "A group with this name already exists.",
};

const POSTGRES_UNIQUE_VIOLATION = "23505";

// Turns a database uniqueness failure into the message a user can act on.
export const toHostelError = (err: any): unknown => {
  if (err.code === POSTGRES_UNIQUE_VIOLATION && CONSTRAINT_MESSAGES[err.constraint]) {
    return new HostelError(409, CONSTRAINT_MESSAGES[err.constraint]);
  }
  return err;
};

export const newId = (): string => uuidv4();

export const toIso = (value: Date | string | null): string | null =>
  value ? new Date(value).toISOString() : null;

export const toMoney = (value: unknown): number => Number(value ?? 0);

export const contextOf = (req: Request): HostelContext => ({
  institutionId: req.institutionId as string,
  actorId: req.user?.userId || "unknown",
  actorEmail: req.user?.email || "",
});

export const send = (res: Response, statusCode: number, data: unknown): void => {
  res.status(statusCode).json({ success: true, statusCode, data });
};

export const route =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch((err) => {
      const known = toHostelError(err);
      if (known instanceof HostelError) {
        res.status(known.statusCode).json({
          success: false,
          statusCode: known.statusCode,
          error: known.message,
          ...((known as any).details ? { details: (known as any).details } : {}),
        });
        return;
      }
      next(err);
    });
  };

export const writeAudit = (
  tx: PoolClient,
  ctx: HostelContext,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
) =>
  tx.query(
    `INSERT INTO hostel_audit_log
       (id, institution_id, actor_id, actor_email, action, entity_type, entity_id, summary, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [newId(), ctx.institutionId, ctx.actorId, ctx.actorEmail, action, entityType, entityId, summary, currentRequest()?.ip || "", currentRequest()?.userAgent || ""]
  );

// Date helpers work on YYYY-MM-DD text, so server time zones cannot shift them.
const toParts = (date: string) => date.split("-").map(Number) as [number, number, number];
const pad = (value: number) => String(value).padStart(2, "0");

export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`;

export const addMonths = (month: string, count: number): string => {
  const [year, monthNumber] = toParts(month);
  const total = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
};

export const daysInMonth = (month: string): number => {
  const [year, monthNumber] = toParts(month);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
};

// A due day of 31 becomes the last day of a shorter month.
export const dueDateFor = (month: string, dueDay: number): string =>
  `${month.slice(0, 7)}-${pad(Math.min(dueDay, daysInMonth(month)))}`;

export const daysBetween = (from: string, to: string): number => {
  const toUtc = (date: string) => {
    const [year, monthNumber, day] = toParts(date);
    return Date.UTC(year, monthNumber - 1, day);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
};

export const monthLabel = (month: string): string =>
  new Date(`${month.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export const taka = (amount: number): string =>
  `BDT ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
