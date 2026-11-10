import { Request } from "express";
import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { daysBetween, daysInMonth, newId, toIso, toMoney } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { amount, code, date, email, fail, inTx, oneOf, phone, text, todayBd, whole } from "../academics/academics.common";

type PersonType = "TEACHER" | "STAFF";
const PERSON_TYPES = ["TEACHER", "STAFF"] as const;
const STAFF_STATUS = ["ACTIVE", "ON_LEAVE", "INACTIVE"] as const;
const round = (value: number) => Math.round(value * 100) / 100;

// ---- Employees: teachers and staff together ----------------------------------------

const EMPLOYEES = `
  SELECT 'TEACHER' AS person_type, t.id, t.institution_id, t.employee_no, t.full_name, t.email, t.phone, COALESCE(d.name, '') AS department,
    t.designation, t.joined_on, t.status
  FROM acad_teachers t LEFT JOIN acad_departments d ON d.id = t.department_id
  UNION ALL
  SELECT 'STAFF', s.id, s.institution_id, s.employee_no, s.full_name, s.email, s.phone, s.department, s.designation, s.joined_on, s.status FROM hr_staff s`;

const SALARY_PARTS = ["basic", "house_rent", "medical", "transport", "other_allowance", "tax", "provident_fund", "other_deduction"] as const;
const SALARY_KEYS: Record<(typeof SALARY_PARTS)[number], string> = {
  basic: "basic", house_rent: "houseRent", medical: "medical", transport: "transport", other_allowance: "otherAllowance",
  tax: "tax", provident_fund: "providentFund", other_deduction: "otherDeduction",
};

const SALARY_COLS = "s.basic, s.house_rent, s.medical, s.transport, s.other_allowance, s.tax, s.provident_fund, s.other_deduction, s.bank_account";

const salaryFromRow = (row: any) => {
  if (!row || row.basic === null || row.basic === undefined) return null;
  const part = (key: string) => toMoney(row[key]);
  const allowances = part("house_rent") + part("medical") + part("transport") + part("other_allowance");
  const deductions = part("tax") + part("provident_fund") + part("other_deduction");
  return {
    ...(Object.fromEntries(SALARY_PARTS.map((key) => [SALARY_KEYS[key], part(key)])) as Record<string, number>),
    basic: part("basic"),
    bankAccount: row.bank_account || "",
    gross: round(part("basic") + allowances),
    allowances: round(allowances),
    deductions: round(deductions),
    net: round(part("basic") + allowances - deductions),
  };
};

const employeeFromRow = (row: any) => ({
  personType: row.person_type,
  id: row.id,
  employeeNo: row.employee_no,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  department: row.department,
  designation: row.designation,
  joinedOn: row.joined_on,
  status: row.status,
  salary: salaryFromRow(row),
});

const findPerson = async (db: PoolClient | typeof postgresService, institutionId: string, type: string, id: string) => {
  const { rows } = await db.query(
    `SELECT e.*, ${SALARY_COLS} FROM (${EMPLOYEES}) e
     LEFT JOIN hr_salaries s ON s.institution_id = e.institution_id AND s.person_type = e.person_type AND s.person_id = e.id
     WHERE e.institution_id = $1 AND e.person_type = $2 AND e.id = $3`,
    [institutionId, type, id]
  );
  if (!rows[0]) fail(404, "Employee not found.");
  return rows[0];
};

// The employee record behind a signed-in teacher or staff account.
export const myPerson = async (req: Request): Promise<{ type: PersonType; id: string; employeeNo: string; fullName: string } | null> => {
  const type = req.user?.linkedType;
  if ((type !== "TEACHER" && type !== "STAFF") || !req.user?.linkedId) return null;
  const { rows } = await postgresService.query(
    `SELECT id, employee_no, full_name FROM ${type === "TEACHER" ? "acad_teachers" : "hr_staff"} WHERE institution_id = $1 AND LOWER(employee_no) = LOWER($2)`,
    [req.institutionId, req.user.linkedId]
  );
  return rows[0] ? { type, id: rows[0].id, employeeNo: rows[0].employee_no, fullName: rows[0].full_name } : null;
};

const staffInput = (body: any, existing?: any) => ({
  employeeNo: body?.employeeNo !== undefined || !existing ? code(body?.employeeNo, "Employee number", 40) : existing.employee_no,
  fullName: body?.fullName !== undefined || !existing ? text(body?.fullName, "Name", 150, true) : existing.full_name,
  email: body?.email !== undefined || !existing ? email(body?.email) : existing.email,
  phone: body?.phone !== undefined || !existing ? phone(body?.phone) : existing.phone,
  department: body?.department !== undefined || !existing ? text(body?.department, "Department", 100) : existing.department,
  designation: body?.designation !== undefined || !existing ? text(body?.designation, "Designation", 100) : existing.designation,
  joinedOn: body?.joinedOn !== undefined || !existing ? date(body?.joinedOn, "Joined on") : existing.joined_on,
  status: oneOf(body?.status, "Status", STAFF_STATUS, existing?.status || "ACTIVE"),
});

export const employeesService = {
  async list(institutionId: string, filters: { search?: string; personType?: string; status?: string } = {}) {
    const { rows } = await postgresService.query(
      `SELECT e.*, ${SALARY_COLS} FROM (${EMPLOYEES}) e
       LEFT JOIN hr_salaries s ON s.institution_id = e.institution_id AND s.person_type = e.person_type AND s.person_id = e.id
       WHERE e.institution_id = $1 AND ($2 = '' OR e.full_name ILIKE '%' || $2 || '%' OR e.employee_no ILIKE '%' || $2 || '%' OR e.designation ILIKE '%' || $2 || '%')
         AND ($3 = '' OR e.person_type = $3) AND ($4 = '' OR e.status = $4)
       ORDER BY e.full_name`,
      [institutionId, filters.search?.trim() || "", filters.personType || "", filters.status || ""]
    );
    return rows.map(employeeFromRow);
  },

  async createStaff(actor: Actor, body: any) {
    const data = staffInput(body);
    const id = newId();
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO hr_staff (id, institution_id, employee_no, full_name, email, phone, department, designation, joined_on, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, actor.institutionId, data.employeeNo, data.fullName, data.email, data.phone, data.department, data.designation, data.joinedOn, data.status]
      );
      await audit(tx, actor, "hr.staff.create", "staff", id, `Added staff ${data.employeeNo} (${data.fullName}).`);
    });
    return employeeFromRow(await findPerson(postgresService, actor.institutionId, "STAFF", id));
  },

  async updateStaff(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hr_staff WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Staff member not found.");
      const data = staffInput(body, rows[0]);
      await tx.query(
        `UPDATE hr_staff SET employee_no = $3, full_name = $4, email = $5, phone = $6, department = $7, designation = $8, joined_on = $9, status = $10
         WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, data.employeeNo, data.fullName, data.email, data.phone, data.department, data.designation, data.joinedOn, data.status]
      );
      await audit(tx, actor, "hr.staff.update", "staff", id, `Edited staff ${data.employeeNo}.`);
    });
    return employeeFromRow(await findPerson(postgresService, actor.institutionId, "STAFF", id));
  },

  async removeStaff(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const { rows } = await tx.query("SELECT employee_no FROM hr_staff WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Staff member not found.");
      const used = await tx.query(
        `SELECT 1 FROM hr_payslips WHERE person_type = 'STAFF' AND person_id = $1
         UNION ALL SELECT 1 FROM hr_leave_requests WHERE person_type = 'STAFF' AND person_id = $1 LIMIT 1`,
        [id]
      );
      if (used.rows[0]) fail(409, "This person has payroll or leave history. Mark them inactive instead.");
      await tx.query("DELETE FROM hr_salaries WHERE institution_id = $1 AND person_type = 'STAFF' AND person_id = $2", [actor.institutionId, id]);
      await tx.query("DELETE FROM hr_staff WHERE id = $1", [id]);
      await audit(tx, actor, "hr.staff.delete", "staff", id, `Deleted staff ${rows[0].employee_no}.`);
      return { id };
    });
  },

  async setSalary(actor: Actor, type: string, id: string, body: any) {
    const personType = oneOf(type, "Employee type", PERSON_TYPES);
    const person = await findPerson(postgresService, actor.institutionId, personType, id);
    const values = SALARY_PARTS.map((key) => amount(body?.[SALARY_KEYS[key]] ?? 0, key.replace("_", " "), 0, 10_000_000));
    const bank = text(body?.bankAccount, "Bank account", 60);
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO hr_salaries (institution_id, person_type, person_id, ${SALARY_PARTS.join(", ")}, bank_account, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (institution_id, person_type, person_id) DO UPDATE SET
           ${SALARY_PARTS.map((key) => `${key} = EXCLUDED.${key}`).join(", ")}, bank_account = EXCLUDED.bank_account, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [actor.institutionId, personType, id, ...values, bank, actor.email]
      );
      await audit(tx, actor, "hr.salary.set", personType.toLowerCase(), id, `Set salary of ${person.employee_no}: basic ${values[0]}.`);
    });
    return employeeFromRow(await findPerson(postgresService, actor.institutionId, personType, id));
  },
};

// ---- Leave ------------------------------------------------------------------------

const leaveFromRow = (row: any) => ({
  id: row.id,
  personType: row.person_type,
  personId: row.person_id,
  employeeNo: row.employee_no,
  fullName: row.full_name,
  leaveTypeId: row.leave_type_id,
  leaveType: row.leave_type,
  isPaid: row.is_paid,
  fromDate: row.from_date,
  toDate: row.to_date,
  days: Number(row.days),
  reason: row.reason,
  status: row.status,
  decidedBy: row.decided_by,
  decidedAt: toIso(row.decided_at),
  decisionNote: row.decision_note,
  createdAt: toIso(row.created_at),
});

const LEAVE_SELECT = `SELECT r.*, t.name AS leave_type, t.is_paid FROM hr_leave_requests r JOIN hr_leave_types t ON t.id = r.leave_type_id`;

export const leaveService = {
  async types(institutionId: string) {
    const { rows } = await postgresService.query("SELECT * FROM hr_leave_types WHERE institution_id = $1 ORDER BY name", [institutionId]);
    return rows.map((row: any) => ({ id: row.id, name: row.name, daysPerYear: Number(row.days_per_year), isPaid: row.is_paid }));
  },

  async saveType(actor: Actor, id: string | null, body: any) {
    const name = text(body?.name, "Name", 60, true);
    const daysPerYear = whole(body?.daysPerYear ?? 0, "Days per year", 0, 365);
    const isPaid = body?.isPaid === undefined ? true : Boolean(body.isPaid);
    return inTx(async (tx) => {
      if (id) {
        const { rowCount } = await tx.query("UPDATE hr_leave_types SET name = $3, days_per_year = $4, is_paid = $5 WHERE institution_id = $1 AND id = $2",
          [actor.institutionId, id, name, daysPerYear, isPaid]);
        if (!rowCount) fail(404, "Leave type not found.");
      } else {
        id = newId();
        await tx.query("INSERT INTO hr_leave_types (id, institution_id, name, days_per_year, is_paid) VALUES ($1, $2, $3, $4, $5)",
          [id, actor.institutionId, name, daysPerYear, isPaid]);
      }
      await audit(tx, actor, "hr.leave_type.save", "leave_type", id as string, `${name}: ${daysPerYear} days a year, ${isPaid ? "paid" : "unpaid"}.`);
      return { id, name, daysPerYear, isPaid };
    });
  },

  async removeType(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const { rows } = await tx.query("SELECT name FROM hr_leave_types WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Leave type not found.");
      const used = await tx.query("SELECT 1 FROM hr_leave_requests WHERE leave_type_id = $1 LIMIT 1", [id]);
      if (used.rows[0]) fail(409, "Leave requests use this type, so it cannot be deleted.");
      await tx.query("DELETE FROM hr_leave_types WHERE id = $1", [id]);
      await audit(tx, actor, "hr.leave_type.delete", "leave_type", id, `Deleted leave type ${rows[0].name}.`);
      return { id };
    });
  },

  async list(institutionId: string, filters: { status?: string; personType?: string; personId?: string } = {}) {
    const { rows } = await postgresService.query(
      `${LEAVE_SELECT} WHERE r.institution_id = $1 AND ($2 = '' OR r.status = $2) AND ($3 = '' OR r.person_type = $3) AND ($4 = '' OR r.person_id = $4)
       ORDER BY (r.status = 'PENDING') DESC, r.from_date DESC LIMIT 500`,
      [institutionId, filters.status || "", filters.personType || "", filters.personId || ""]
    );
    return rows.map(leaveFromRow);
  },

  // Days used this year per leave type, counting approved and pending requests.
  async balances(institutionId: string, personType: string, personId: string, year: number) {
    const types = await this.types(institutionId);
    const { rows } = await postgresService.query(
      `SELECT leave_type_id, SUM(days) FILTER (WHERE status = 'APPROVED') AS used, SUM(days) FILTER (WHERE status = 'PENDING') AS pending
       FROM hr_leave_requests WHERE institution_id = $1 AND person_type = $2 AND person_id = $3 AND EXTRACT(YEAR FROM from_date) = $4
       GROUP BY leave_type_id`,
      [institutionId, personType, personId, year]
    );
    return types.map((type: { id: string; name: string; daysPerYear: number; isPaid: boolean }) => {
      const row = rows.find((item: any) => item.leave_type_id === type.id);
      const used = Number(row?.used || 0);
      const pending = Number(row?.pending || 0);
      return { ...type, used, pending, remaining: type.daysPerYear > 0 ? Math.max(0, type.daysPerYear - used - pending) : null };
    });
  },

  // Calendar days, both ends included. A capped type cannot go past its yearly days.
  async apply(actor: Actor, personType: string, personId: string, body: any) {
    const type = oneOf(personType, "Employee type", PERSON_TYPES);
    const fromDate = date(body?.fromDate, "From", true) as string;
    const toDate = date(body?.toDate, "To", true) as string;
    if (toDate < fromDate) fail(400, "\"To\" cannot be before \"From\".");
    if (fromDate.slice(0, 4) !== toDate.slice(0, 4)) fail(400, "Split leave that crosses a new year into two requests.");
    const days = daysBetween(fromDate, toDate) + 1;
    if (days > 180) fail(400, "One request can cover at most 180 days.");
    const reason = text(body?.reason, "Reason", 500, true);
    const id = await inTx(async (tx) => {
      const person = await findPerson(tx, actor.institutionId, type, personId);
      if (person.status === "INACTIVE") fail(409, "This employee is inactive.");
      const leaveType = (await tx.query("SELECT * FROM hr_leave_types WHERE institution_id = $1 AND id = $2", [actor.institutionId, body?.leaveTypeId])).rows[0];
      if (!leaveType) fail(400, "Choose a leave type.");
      // Serialize requests of one person so two at once cannot both pass the checks.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`leave:${actor.institutionId}:${type}:${personId}`]);
      const overlap = await tx.query(
        `SELECT 1 FROM hr_leave_requests WHERE institution_id = $1 AND person_type = $2 AND person_id = $3 AND status IN ('PENDING', 'APPROVED')
           AND from_date <= $5::date AND to_date >= $4::date LIMIT 1`,
        [actor.institutionId, type, personId, fromDate, toDate]
      );
      if (overlap.rows[0]) fail(409, "These dates overlap another leave request.");
      if (Number(leaveType.days_per_year) > 0) {
        const used = Number((await tx.query(
          `SELECT COALESCE(SUM(days), 0) AS n FROM hr_leave_requests WHERE institution_id = $1 AND person_type = $2 AND person_id = $3
             AND leave_type_id = $4 AND status IN ('PENDING', 'APPROVED') AND EXTRACT(YEAR FROM from_date) = $5`,
          [actor.institutionId, type, personId, leaveType.id, Number(fromDate.slice(0, 4))]
        )).rows[0].n);
        if (used + days > Number(leaveType.days_per_year)) fail(409, `Only ${Math.max(0, Number(leaveType.days_per_year) - used)} days of ${leaveType.name} are left this year.`);
      }
      const leaveId = newId();
      await tx.query(
        `INSERT INTO hr_leave_requests (id, institution_id, person_type, person_id, employee_no, full_name, leave_type_id, from_date, to_date, days, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [leaveId, actor.institutionId, type, personId, person.employee_no, person.full_name, leaveType.id, fromDate, toDate, days, reason, actor.email]
      );
      await audit(tx, actor, "hr.leave.apply", "leave", leaveId, `${person.employee_no} asked for ${days} days of ${leaveType.name} from ${fromDate}.`);
      return leaveId;
    });
    return this.get(actor.institutionId, id);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${LEAVE_SELECT} WHERE r.institution_id = $1 AND r.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Leave request not found.");
    return leaveFromRow(rows[0]);
  },

  async decide(actor: Actor, id: string, body: any) {
    const decision = oneOf(body?.decision, "Decision", ["APPROVED", "REJECTED"] as const);
    const note = text(body?.note, "Note", 500, decision === "REJECTED");
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hr_leave_requests WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Leave request not found.");
      if (rows[0].status !== "PENDING") fail(409, "This request is already decided.");
      await tx.query("UPDATE hr_leave_requests SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4 WHERE id = $1", [id, decision, actor.email, note]);
      await audit(tx, actor, `hr.leave.${decision.toLowerCase()}`, "leave", id, `${decision === "APPROVED" ? "Approved" : "Rejected"} ${rows[0].days} days for ${rows[0].employee_no}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // The person can withdraw a pending request; HR can also cancel approved leave that has not started.
  async cancel(actor: Actor, id: string, owner: { type: string; id: string } | null, isHr: boolean) {
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM hr_leave_requests WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      const leave = rows[0];
      if (!leave) fail(404, "Leave request not found.");
      const mine = owner && owner.type === leave.person_type && owner.id === leave.person_id;
      if (!mine && !isHr) fail(404, "Leave request not found.");
      if (leave.status === "PENDING" || (isHr && leave.status === "APPROVED" && leave.from_date > todayBd())) {
        await tx.query("UPDATE hr_leave_requests SET status = 'CANCELLED', decided_by = $2, decided_at = NOW() WHERE id = $1", [id, actor.email]);
        await audit(tx, actor, "hr.leave.cancel", "leave", id, `Cancelled leave of ${leave.employee_no} from ${leave.from_date}.`);
        return;
      }
      fail(409, "Only pending requests, or approved leave that has not started, can be cancelled.");
    });
    return this.get(actor.institutionId, id);
  },
};

// ---- Payroll ----------------------------------------------------------------------

const runFromRow = (row: any) => ({
  id: row.id,
  month: String(row.month).slice(0, 7),
  status: row.status,
  employees: Number(row.employees ?? 0),
  gross: toMoney(row.gross),
  deductions: toMoney(row.deductions),
  netPay: toMoney(row.net_pay),
  createdBy: row.created_by,
  approvedBy: row.approved_by,
  approvedAt: toIso(row.approved_at),
  paidBy: row.paid_by,
  paidAt: toIso(row.paid_at),
  createdAt: toIso(row.created_at),
});

const payslipFromRow = (row: any) => ({
  id: row.id,
  runId: row.run_id,
  month: row.month ? String(row.month).slice(0, 7) : undefined,
  runStatus: row.run_status,
  personType: row.person_type,
  personId: row.person_id,
  employeeNo: row.employee_no,
  fullName: row.full_name,
  designation: row.designation,
  bankAccount: row.bank_account,
  basic: toMoney(row.basic),
  allowances: toMoney(row.allowances),
  deductions: toMoney(row.deductions),
  unpaidLeaveDays: Number(row.unpaid_leave_days),
  leaveDeduction: toMoney(row.leave_deduction),
  netPay: toMoney(row.net_pay),
});

const RUN_SELECT = `SELECT r.*, COUNT(p.id) AS employees, COALESCE(SUM(p.basic + p.allowances), 0) AS gross,
    COALESCE(SUM(p.deductions + p.leave_deduction), 0) AS deductions, COALESCE(SUM(p.net_pay), 0) AS net_pay
  FROM hr_payroll_runs r LEFT JOIN hr_payslips p ON p.run_id = r.id`;

const monthInput = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail(400, "Month must look like 2026-11.");
  return `${value}-01`;
};

export const payrollService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(`${RUN_SELECT} WHERE r.institution_id = $1 GROUP BY r.id ORDER BY r.month DESC`, [institutionId]);
    return rows.map(runFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${RUN_SELECT} WHERE r.institution_id = $1 AND r.id = $2 GROUP BY r.id`, [institutionId, id]);
    if (!rows[0]) fail(404, "Payroll not found.");
    const slips = await postgresService.query("SELECT * FROM hr_payslips WHERE run_id = $1 ORDER BY full_name", [id]);
    return { ...runFromRow(rows[0]), payslips: slips.rows.map(payslipFromRow) };
  },

  // Builds the month's payslips from current salaries and approved unpaid leave.
  // A draft can be built again after salaries change; approved months stay as they are.
  async generate(actor: Actor, body: any) {
    const month = monthInput(body?.month);
    const monthEnd = `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const id = await inTx(async (tx) => {
      const existing = (await tx.query("SELECT * FROM hr_payroll_runs WHERE institution_id = $1 AND month = $2 FOR UPDATE", [actor.institutionId, month])).rows[0];
      if (existing && existing.status !== "DRAFT") fail(409, "This month's payroll is already approved.");
      const runId = existing?.id || newId();
      if (existing) await tx.query("DELETE FROM hr_payslips WHERE run_id = $1", [runId]);
      else await tx.query("INSERT INTO hr_payroll_runs (id, institution_id, month, created_by) VALUES ($1, $2, $3, $4)", [runId, actor.institutionId, month, actor.email]);
      const people = (await tx.query(
        `SELECT e.*, ${SALARY_COLS} FROM (${EMPLOYEES}) e
         JOIN hr_salaries s ON s.institution_id = e.institution_id AND s.person_type = e.person_type AND s.person_id = e.id
         WHERE e.institution_id = $1 AND e.status <> 'INACTIVE' AND s.basic > 0`,
        [actor.institutionId]
      )).rows;
      const unpaid = (await tx.query(
        `SELECT r.person_type, r.person_id, SUM(LEAST(r.to_date, $3::date) - GREATEST(r.from_date, $2::date) + 1) AS days
         FROM hr_leave_requests r JOIN hr_leave_types t ON t.id = r.leave_type_id
         WHERE r.institution_id = $1 AND r.status = 'APPROVED' AND NOT t.is_paid AND r.from_date <= $3::date AND r.to_date >= $2::date
         GROUP BY r.person_type, r.person_id`,
        [actor.institutionId, month, monthEnd]
      )).rows;
      const monthDays = daysInMonth(month);
      for (const person of people) {
        const salary = salaryFromRow(person)!;
        const leaveDays = Number(unpaid.find((row: any) => row.person_type === person.person_type && row.person_id === person.id)?.days || 0);
        const leaveDeduction = round((salary.basic as number) / monthDays * leaveDays);
        const net = Math.max(0, round(salary.net - leaveDeduction));
        await tx.query(
          `INSERT INTO hr_payslips (id, run_id, person_type, person_id, employee_no, full_name, designation, bank_account, basic, allowances, deductions, unpaid_leave_days, leave_deduction, net_pay)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [newId(), runId, person.person_type, person.id, person.employee_no, person.full_name, person.designation || "", salary.bankAccount,
            salary.basic, salary.allowances, salary.deductions, leaveDays, leaveDeduction, net]
        );
      }
      await audit(tx, actor, "hr.payroll.generate", "payroll", runId, `Built payroll for ${month.slice(0, 7)}: ${people.length} payslips.`);
      return runId;
    });
    return this.get(actor.institutionId, id);
  },

  async advance(actor: Actor, id: string, to: "APPROVED" | "PAID") {
    await inTx(async (tx) => {
      const run = (await tx.query("SELECT * FROM hr_payroll_runs WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!run) fail(404, "Payroll not found.");
      const from = to === "APPROVED" ? "DRAFT" : "APPROVED";
      if (run.status !== from) fail(409, to === "APPROVED" ? "Only a draft can be approved." : "Approve the payroll before marking it paid.");
      if (to === "APPROVED") {
        const slips = await tx.query("SELECT 1 FROM hr_payslips WHERE run_id = $1 LIMIT 1", [id]);
        if (!slips.rows[0]) fail(409, "This payroll has no payslips. Set salaries and build it again.");
        await tx.query("UPDATE hr_payroll_runs SET status = 'APPROVED', approved_by = $2, approved_at = NOW() WHERE id = $1", [id, actor.email]);
      } else {
        await tx.query("UPDATE hr_payroll_runs SET status = 'PAID', paid_by = $2, paid_at = NOW() WHERE id = $1", [id, actor.email]);
      }
      await audit(tx, actor, `hr.payroll.${to.toLowerCase()}`, "payroll", id, `Payroll ${String(run.month).slice(0, 7)} ${to.toLowerCase()}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async removeDraft(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const run = (await tx.query("SELECT * FROM hr_payroll_runs WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!run) fail(404, "Payroll not found.");
      if (run.status !== "DRAFT") fail(409, "Only a draft payroll can be deleted.");
      await tx.query("DELETE FROM hr_payroll_runs WHERE id = $1", [id]);
      await audit(tx, actor, "hr.payroll.delete", "payroll", id, `Deleted draft payroll ${String(run.month).slice(0, 7)}.`);
      return { id };
    });
  },

  // An employee's own payslips, once the month is approved.
  async mine(institutionId: string, type: string, personId: string) {
    const { rows } = await postgresService.query(
      `SELECT p.*, r.month, r.status AS run_status FROM hr_payslips p JOIN hr_payroll_runs r ON r.id = p.run_id
       WHERE r.institution_id = $1 AND r.status IN ('APPROVED', 'PAID') AND p.person_type = $2 AND p.person_id = $3 ORDER BY r.month DESC`,
      [institutionId, type, personId]
    );
    return rows.map(payslipFromRow);
  },
};
