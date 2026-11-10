import { HostelError } from "./hostel.common";

export const ROOM_TYPES = ["STANDARD", "DELUXE"] as const;
export const TICKET_CATEGORIES = ["Electric", "Plumbing", "Furniture", "Cleaning", "Internet", "Other"];
export const TICKET_PRIORITIES = ["Low", "Medium", "High"];
export const TICKET_STATUSES = ["Open", "In Progress", "Resolved"];
export const PAYMENT_METHODS = ["Cash", "Bank", "bKash", "Nagad", "Rocket", "Card", "Other"];
export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "SMS"];

const MAX_ROOM_CAPACITY = 100;
const MAX_TEXT = 100;
const MAX_LONG_TEXT = 500;
const MAX_FACILITIES = 20;
const MAX_MONEY = 10_000_000;
const PHONE_PATTERN = /^\+?[0-9][0-9 -]{5,18}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NID_PATTERN = /^[0-9]{10,17}$/;

export interface RoomInput {
  hostelName: string;
  building: string;
  floor: string;
  roomNumber: string;
  roomType: string;
  capacity: number;
  facilities: string[];
  underMaintenance: boolean;
  notes: string;
}

export interface AllocationInput {
  studentId: string;
  studentName: string;
  department: string;
  studentPhone: string;
  studentEmail: string;
  studentNid: string;
  guardianName: string;
  guardianPhone: string;
  guardianNid: string;
  guardianRelationship: string;
  preferredHostel: string;
  notes: string;
  monthlyRent: number;
  securityDeposit: number;
  startDate: string | null;
  firstDueDate: string | null;
  billingActive: boolean;
}

export interface TicketInput {
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  blocksRoom: boolean;
  assignedTo: string;
}

const invalid = (message: string): never => {
  throw new HostelError(400, message);
};

const optionalText = (value: unknown, label: string, max = MAX_TEXT): string => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    invalid(`${label} must be text.`);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) invalid(`${label} must be ${max} characters or fewer.`);
  return text;
};

const requiredText = (value: unknown, label: string): string => {
  const text = optionalText(value, label);
  if (!text) invalid(`${label} is required.`);
  return text;
};

const oneOf = (value: unknown, allowed: readonly string[], label: string): string => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    invalid(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as string;
};

const patterned = (value: unknown, label: string, pattern: RegExp, message: string): string => {
  const text = optionalText(value, label, 255);
  if (text && !pattern.test(text)) invalid(message);
  return text;
};

export const parseMoney = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_MONEY) {
    invalid(`${label} must be a number from 0 to ${MAX_MONEY}.`);
  }
  if (Math.round((value as number) * 100) / 100 !== value) {
    invalid(`${label} can have at most 2 decimal places.`);
  }
  return value as number;
};

export const parseDate = (value: unknown, label: string): string => {
  const valid =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid) invalid(`${label} must be a valid date (YYYY-MM-DD).`);
  return value as string;
};

const optionalDate = (value: unknown, label: string): string | null =>
  value === undefined || value === null || value === "" ? null : parseDate(value, label);

export const parseDueDay = (value: unknown, label = "Due day"): number => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) {
    invalid(`${label} must be a whole number from 1 to 31.`);
  }
  return value as number;
};

export const parseOptionalDueDay = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : parseDueDay(value);

export const parseRoom = (body: any): RoomInput => {
  const capacity = body?.capacity;
  const facilities = body?.facilities ?? [];

  const hostelName = requiredText(body?.hostelName, "Hostel");
  const building = requiredText(body?.building, "Building");
  const floor = requiredText(body?.floor, "Floor");
  const roomNumber = requiredText(body?.roomNumber, "Room number");

  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_ROOM_CAPACITY) {
    invalid(`Capacity must be a whole number from 1 to ${MAX_ROOM_CAPACITY}.`);
  }

  if (
    !Array.isArray(facilities) ||
    facilities.length > MAX_FACILITIES ||
    facilities.some(
      (item: unknown) =>
        typeof item !== "string" || !item.trim() || item.length > MAX_TEXT
    )
  ) {
    invalid("Facilities must be a list of short text values.");
  }

  return {
    hostelName,
    building,
    floor,
    roomNumber,
    roomType: oneOf(body?.roomType ?? "STANDARD", ROOM_TYPES, "Room type"),
    capacity,
    facilities: [...new Set<string>(facilities.map((item: string) => item.trim()))],
    underMaintenance: body?.underMaintenance === true,
    notes: optionalText(body?.notes, "Notes", MAX_LONG_TEXT),
  };
};

export const parseSeat = (body: any): { monthlyFee: number; reserved?: boolean; effectiveMonth: string | null } => ({
  monthlyFee: parseMoney(body?.monthlyFee ?? 0, "Monthly fee"),
  reserved: body?.reserved === undefined ? undefined : body.reserved === true,
  effectiveMonth: body?.effectiveMonth ? parseDate(`${String(body.effectiveMonth).slice(0, 7)}-01`, "Effective month") : null,
});

const ALLOCATION_FIELDS: Record<keyof AllocationInput, (value: unknown) => unknown> = {
  studentId: (value) => requiredText(value, "Student ID"),
  studentName: (value) => requiredText(value, "Student name"),
  department: (value) => optionalText(value, "Department"),
  studentPhone: (value) =>
    patterned(value, "Student phone", PHONE_PATTERN, "Student phone is not a valid phone number."),
  studentEmail: (value) =>
    patterned(value, "Student email", EMAIL_PATTERN, "Student email is not a valid email address."),
  studentNid: (value) =>
    patterned(value, "Student NID", NID_PATTERN, "Student NID must be 10 to 17 digits."),
  guardianName: (value) => optionalText(value, "Guardian name"),
  guardianPhone: (value) =>
    patterned(value, "Guardian phone", PHONE_PATTERN, "Guardian phone is not a valid phone number."),
  guardianNid: (value) =>
    patterned(value, "Guardian NID", NID_PATTERN, "Guardian NID must be 10 to 17 digits."),
  guardianRelationship: (value) => optionalText(value, "Relationship"),
  preferredHostel: (value) => optionalText(value, "Preferred hostel"),
  notes: (value) => optionalText(value, "Notes", MAX_LONG_TEXT),
  monthlyRent: (value) => parseMoney(value ?? 0, "Monthly rent"),
  securityDeposit: (value) => parseMoney(value ?? 0, "Security deposit"),
  startDate: (value) => optionalDate(value, "Allocation start date"),
  firstDueDate: (value) => optionalDate(value, "Initial payment due date"),
  billingActive: (value) => value !== false,
};

export const parseAllocation = (body: any): AllocationInput =>
  Object.fromEntries(
    Object.entries(ALLOCATION_FIELDS).map(([key, parse]) => [key, parse(body?.[key])])
  ) as unknown as AllocationInput;

// An edit changes only the fields it sends, so nothing else can be overwritten.
export const parseAllocationChanges = (body: any): Partial<AllocationInput> =>
  Object.fromEntries(
    Object.entries(ALLOCATION_FIELDS)
      .filter(([key]) => body && key in body)
      .map(([key, parse]) => [key, parse(body[key])])
  ) as Partial<AllocationInput>;

// What a student needs before occupying a seat and being billed.
export const assertReadyToAllocate = (details: {
  studentPhone: string;
  guardianName: string;
  guardianPhone: string;
  monthlyRent: number;
  startDate: string | null;
}) => {
  if (!details.studentPhone) invalid("Student phone is required to allocate a seat.");
  if (!details.guardianName) invalid("Guardian name is required to allocate a seat.");
  if (!details.guardianPhone) invalid("Guardian phone is required to allocate a seat.");
  if (!(details.monthlyRent > 0)) invalid("Monthly rent must be more than 0 to allocate a seat.");
  if (!details.startDate) invalid("Allocation start date is required to allocate a seat.");
};

export const parseSeatId = (value: unknown): string => requiredText(value, "Seat");

export const parseOptionalSeatId = (value: unknown): string | null =>
  value ? parseSeatId(value) : null;

export const parseReason = (value: unknown): string =>
  optionalText(value, "Reason", MAX_LONG_TEXT);

export const parseRequiredReason = (value: unknown): string => {
  const reason = parseReason(value);
  if (!reason) invalid("A reason is required.");
  return reason;
};

export const parseTicket = (body: any): TicketInput => ({
  title: requiredText(body?.title, "Title"),
  description: optionalText(body?.description, "Description", MAX_LONG_TEXT),
  category: oneOf(body?.category ?? "Other", TICKET_CATEGORIES, "Category"),
  priority: oneOf(body?.priority ?? "Medium", TICKET_PRIORITIES, "Priority"),
  status: oneOf(body?.status ?? "Open", TICKET_STATUSES, "Status"),
  blocksRoom: body?.blocksRoom === true,
  assignedTo: optionalText(body?.assignedTo, "Assigned to"),
});

export const parsePayment = (body: any) => {
  const amount = parseMoney(body?.amount, "Payment amount");
  if (amount <= 0) invalid("Payment amount must be more than 0.");

  return {
    amount,
    paymentDate: parseDate(body?.paymentDate, "Payment date"),
    method: oneOf(body?.method, PAYMENT_METHODS, "Payment method"),
    transactionReference: optionalText(body?.transactionReference, "Transaction reference"),
    notes: optionalText(body?.notes, "Notes", MAX_LONG_TEXT),
    idempotencyKey: optionalText(body?.idempotencyKey, "Request key", 64) || null,
  };
};

export const parseAdjustment = (body: any) => {
  const amount = body?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_MONEY) {
    invalid("Adjustment amount must be a number other than 0.");
  }
  if (Math.round(amount * 100) / 100 !== amount) {
    invalid("Adjustment amount can have at most 2 decimal places.");
  }
  return { amount: amount as number, reason: parseRequiredReason(body?.reason) };
};

const LATE_FEE_TYPES = ["NONE", "FLAT", "PERCENT"];

const parseLateFee = (body: any, wholeNumber: (value: unknown, label: string, min: number, max: number) => number) => {
  const lateFeeType = body?.lateFeeType ?? "NONE";
  if (!LATE_FEE_TYPES.includes(lateFeeType)) invalid("Late fee must be none, a fixed amount or a percentage.");
  if (lateFeeType === "NONE") return { lateFeeType, lateFeeValue: 0, lateFeeGraceDays: 0 };
  const lateFeeValue = parseMoney(body?.lateFeeValue, "Late fee");
  if (lateFeeValue <= 0) invalid("Late fee must be more than 0.");
  if (lateFeeType === "PERCENT" && lateFeeValue > 100) invalid("A late fee percentage must be 100 or less.");
  return {
    lateFeeType,
    lateFeeValue,
    lateFeeGraceDays: wholeNumber(body?.lateFeeGraceDays ?? 0, "Late fee grace days", 0, 60),
  };
};

export const parseRentSettings = (body: any) => {
  const days = body?.reminderDaysBefore;
  if (
    !Array.isArray(days) ||
    days.length > 10 ||
    days.some((day) => !Number.isInteger(day) || day < 1 || day > 28)
  ) {
    invalid("Reminder days must be a list of whole numbers from 1 to 28.");
  }

  const wholeNumber = (value: unknown, label: string, min: number, max: number): number => {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      invalid(`${label} must be a whole number from ${min} to ${max}.`);
    }
    return value as number;
  };

  const channels = body?.channels;
  if (!Array.isArray(channels) || channels.some((item) => !NOTIFICATION_CHANNELS.includes(item))) {
    invalid(`Channels must be from: ${NOTIFICATION_CHANNELS.join(", ")}.`);
  }

  return {
    defaultDueDay: parseDueDay(body?.defaultDueDay, "Default due day"),
    timezone: requiredText(body?.timezone, "Time zone"),
    reminderDaysBefore: [...new Set<number>(days)].sort((a, b) => b - a),
    remindOnDueDate: body?.remindOnDueDate === true,
    overdueFirstAfterDays: wholeNumber(body?.overdueFirstAfterDays, "First overdue reminder", 1, 60),
    overdueIntervalDays: wholeNumber(body?.overdueIntervalDays, "Overdue reminder interval", 1, 60),
    reminderHour: wholeNumber(body?.reminderHour, "Reminder hour", 0, 23),
    channels: [...new Set<string>(channels)],
    paymentInstructions: optionalText(body?.paymentInstructions, "Payment instructions", MAX_LONG_TEXT),
    brandName: optionalText(body?.brandName, "Hostel or institution name") || "Hostel Office",
    allowPartialOnline: body?.allowPartialOnline === true,
    contactInfo: optionalText(body?.contactInfo, "Hostel contact", MAX_LONG_TEXT),
    hostelRules: optionalText(body?.hostelRules, "Hostel rules", 5000),
    mealReminderThreshold: parseMoney(body?.mealReminderThreshold ?? 500, "Meal reminder amount"),
    mealReminderIntervalDays: wholeNumber(body?.mealReminderIntervalDays ?? 3, "Meal reminder interval", 1, 60),
    mealPaymentDays: wholeNumber(body?.mealPaymentDays ?? 7, "Meal payment days", 0, 60),
    ...parseLateFee(body, wholeNumber),
  };
};
