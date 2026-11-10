import { Request } from "express";
import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { HostelError } from "../hostel/hostel.common";

export const fail = (status: number, message: string): never => {
  throw new HostelError(status, message);
};

export const text = (value: unknown, label: string, max: number, required = false): string => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(400, `${label} must be text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) fail(400, `${label} is required.`);
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return result;
};

export const code = (value: unknown, label: string, max = 20): string => {
  const result = text(value, label, max, true).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(result)) fail(400, `${label} may use letters, numbers, dots, dashes and underscores.`);
  return result;
};

export const email = (value: unknown, label = "Email"): string | null => {
  const result = text(value, label, 255).toLowerCase();
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, `${label} must be an email address.`);
  return result || null;
};

export const phone = (value: unknown, label = "Phone"): string | null => {
  const result = text(value, label, 30);
  if (result && !/^\+?[0-9 -]{6,20}$/.test(result)) fail(400, `${label} must be a phone number.`);
  return result || null;
};

export const date = (value: unknown, label: string, required = false): string | null => {
  if (value === undefined || value === null || value === "") {
    if (required) fail(400, `${label} is required.`);
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) fail(400, `${label} must be a date.`);
  return value as string;
};

export const whole = (value: unknown, label: string, min: number, max: number): number => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) fail(400, `${label} must be a whole number from ${min} to ${max}.`);
  return result;
};

export const oneOf = <T extends string>(value: unknown, label: string, options: readonly T[], fallback?: T): T => {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (!options.includes(value as T)) fail(400, `${label} must be one of: ${options.join(", ")}.`);
  return value as T;
};

const UNIQUE_MESSAGES: Record<string, string> = {
  acad_departments_institution_id_code_key: "A department with this code already exists.",
  acad_programs_institution_id_code_key: "A program with this code already exists.",
  acad_sessions_institution_id_name_key: "A session with this name already exists.",
  acad_sessions_one_current: "Another session is already the current one.",
  acad_teachers_institution_id_employee_no_key: "A teacher with this employee number already exists.",
  acad_sections_program_id_session_id_term_no_name_key: "This section already exists for that program, session and term.",
  acad_courses_institution_id_code_key: "A course with this code already exists.",
  acad_students_unique_no: "A student with this student ID already exists.",
  acad_classes_course_id_section_id_key: "This course is already taught to that section.",
  acad_attendance_sessions_class_id_held_on_slot_key: "Attendance for this class, date and period already exists.",
  acad_exams_session_id_name_key: "An exam with this name already exists in that session.",
};

// Runs work in a transaction and turns uniqueness and reference errors into plain messages.
export const inTx = <T>(work: (tx: PoolClient) => Promise<T>): Promise<T> =>
  postgresService.transaction(work).catch((err: any) => {
    if (err.code === "23505" && UNIQUE_MESSAGES[err.constraint]) throw new HostelError(409, UNIQUE_MESSAGES[err.constraint]);
    if (err.code === "23503") throw new HostelError(409, "This record is still used elsewhere, or refers to something that does not exist.");
    throw err;
  });

export const one = async (sql: string, params: unknown[], missing: string) => {
  const { rows } = await postgresService.query(sql, params);
  if (!rows[0]) fail(404, missing);
  return rows[0];
};

export const has = (req: Request, ...keys: string[]) => keys.some((key) => (req.user?.permissions || []).includes(key));

// The teacher record of a signed-in teacher account, if any.
export const myTeacherId = async (req: Request): Promise<string | null> => {
  if (req.user?.linkedType !== "TEACHER" || !req.user.linkedId) return null;
  const { rows } = await postgresService.query(
    "SELECT id FROM acad_teachers WHERE institution_id = $1 AND LOWER(employee_no) = LOWER($2)",
    [req.institutionId, req.user.linkedId]
  );
  return rows[0]?.id || null;
};

// A taka amount with at most two decimals.
export const amount = (value: unknown, label: string, min = 0, max = 100_000_000): number => {
  const result = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(result) || result < min || result > max) fail(400, `${label} must be an amount from ${min} to ${max}.`);
  if (Math.round(result * 100) !== Number((result * 100).toFixed(6))) fail(400, `${label} may have at most two decimals.`);
  return Math.round(result * 100) / 100;
};

// Today in Bangladesh time, as YYYY-MM-DD.
export const todayBd = (): string => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

export const MORE_UNIQUE_MESSAGES: Record<string, string> = {
  fin_fee_heads_institution_id_code_key: "A fee head with this code already exists.",
  fin_invoices_one_per_title: "This student already has an invoice with this title.",
  fin_payments_unique_reference: "A confirmed payment with this reference already exists.",
  lib_books_unique_isbn: "A book with this ISBN already exists.",
  lib_loans_one_copy_each: "This borrower already has a copy of this book.",
  hr_staff_unique_no: "An employee with this number already exists.",
  hr_leave_types_institution_id_name_key: "A leave type with this name already exists.",
  hr_payroll_runs_institution_id_month_key: "A payroll for this month already exists.",
  inv_stores_unique_code: "A store with this code already exists.",
  inv_items_unique_sku: "An item with this SKU already exists.",
  inv_items_unique_barcode: "An item with this barcode already exists.",
  inv_assets_unique_tag: "An asset with this tag already exists.",
  inv_movements_reversed_once: "This entry is already reversed.",
  inv_suppliers_unique_name: "A supplier with this name already exists.",
};
Object.assign(UNIQUE_MESSAGES, MORE_UNIQUE_MESSAGES);
