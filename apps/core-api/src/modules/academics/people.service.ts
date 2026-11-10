import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { Actor, audit, usersService } from "../identity/identity.service";
import { code, date, email, fail, inTx, oneOf, phone, text } from "./academics.common";

const TEACHER_STATUS = ["ACTIVE", "ON_LEAVE", "INACTIVE"] as const;
const STUDENT_STATUS = ["ACTIVE", "SUSPENDED", "GRADUATED", "DROPPED"] as const;
const GENDERS = ["", "MALE", "FEMALE", "OTHER"] as const;

// ---- Teachers ----------------------------------------------------------------

const teacherFromRow = (row: any) => ({
  id: row.id,
  employeeNo: row.employee_no,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  departmentId: row.department_id,
  departmentName: row.department_name,
  designation: row.designation,
  qualification: row.qualification,
  joinedOn: row.joined_on,
  status: row.status,
  classes: Number(row.classes ?? 0),
  username: row.username || null,
  createdAt: toIso(row.created_at),
});

const TEACHER_SELECT = `
  SELECT t.*, d.name AS department_name,
    (SELECT COUNT(*) FROM acad_classes k JOIN acad_sections s ON s.id = k.section_id JOIN acad_sessions se ON se.id = s.session_id
       WHERE k.teacher_id = t.id AND se.is_current) AS classes,
    (SELECT u.username FROM erp_users u WHERE u.institution_id = t.institution_id AND u.linked_type = 'TEACHER' AND LOWER(u.linked_id) = LOWER(t.employee_no) LIMIT 1) AS username
  FROM acad_teachers t LEFT JOIN acad_departments d ON d.id = t.department_id`;

const department = async (tx: PoolClient, institutionId: string, id: unknown) => {
  if (id === undefined || id === null || id === "") return null;
  const { rows } = await tx.query("SELECT id FROM acad_departments WHERE institution_id = $1 AND id = $2", [institutionId, id]);
  if (!rows[0]) fail(400, "That department does not exist.");
  return rows[0].id as string;
};

export const teachersService = {
  async list(institutionId: string, filters: { search?: string; departmentId?: string; status?: string } = {}) {
    const { rows } = await postgresService.query(
      `${TEACHER_SELECT} WHERE t.institution_id = $1
         AND ($2 = '' OR t.full_name ILIKE '%' || $2 || '%' OR t.employee_no ILIKE '%' || $2 || '%' OR t.email ILIKE '%' || $2 || '%')
         AND ($3 = '' OR t.department_id = $3) AND ($4 = '' OR t.status = $4)
       ORDER BY t.full_name`,
      [institutionId, filters.search?.trim() || "", filters.departmentId || "", filters.status || ""]
    );
    return rows.map(teacherFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${TEACHER_SELECT} WHERE t.institution_id = $1 AND t.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Teacher not found.");
    return teacherFromRow(rows[0]);
  },

  async create(actor: Actor, body: any) {
    const id = newId();
    await inTx(async (tx) => {
      const values = {
        employee_no: code(body?.employeeNo, "Employee number", 40),
        full_name: text(body?.fullName, "Full name", 150, true),
        email: email(body?.email),
        phone: phone(body?.phone),
        department_id: await department(tx, actor.institutionId, body?.departmentId),
        designation: text(body?.designation, "Designation", 100),
        qualification: text(body?.qualification, "Qualification", 200),
        joined_on: date(body?.joinedOn, "Joining date"),
      };
      await tx.query(
        `INSERT INTO acad_teachers (id, institution_id, employee_no, full_name, email, phone, department_id, designation, qualification, joined_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, actor.institutionId, values.employee_no, values.full_name, values.email, values.phone, values.department_id, values.designation, values.qualification, values.joined_on, actor.email]
      );
      await audit(tx, actor, "Created", "Teacher", id, `Added teacher ${values.full_name} (${values.employee_no}).`);
    });
    return this.get(actor.institutionId, id);
  },

  // The employee number is fixed: the teacher's sign-in is linked to it.
  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM acad_teachers WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      const current = rows[0];
      if (!current) fail(404, "Teacher not found.");
      if (body?.employeeNo !== undefined && String(body.employeeNo).toUpperCase() !== current.employee_no) fail(409, "The employee number cannot change.");
      const pick = (key: string, fallback: unknown, parse: (value: unknown) => unknown) => (body?.[key] === undefined ? fallback : parse(body[key]));
      const status = oneOf(body?.status, "Status", TEACHER_STATUS, current.status);
      await tx.query(
        `UPDATE acad_teachers SET full_name = $3, email = $4, phone = $5, department_id = $6, designation = $7, qualification = $8,
           joined_on = $9, status = $10, updated_at = NOW() WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id,
          pick("fullName", current.full_name, (v) => text(v, "Full name", 150, true)),
          pick("email", current.email, (v) => email(v)),
          pick("phone", current.phone, (v) => phone(v)),
          body?.departmentId === undefined ? current.department_id : await department(tx, actor.institutionId, body.departmentId),
          pick("designation", current.designation, (v) => text(v, "Designation", 100)),
          pick("qualification", current.qualification, (v) => text(v, "Qualification", 200)),
          pick("joinedOn", current.joined_on, (v) => date(v, "Joining date")),
          status]
      );
      await audit(tx, actor, "Updated", "Teacher", id, `Updated teacher ${current.full_name}${status !== current.status ? `: ${current.status} to ${status}` : ""}.`);
    });
    return this.get(actor.institutionId, id);
  },

  async createAccount(actor: Actor, id: string) {
    const teacher = await this.get(actor.institutionId, id);
    if (!teacher.email) fail(400, "Add the teacher's email first. The sign-in details are sent there.");
    const result = await usersService.create(actor, {
      fullName: teacher.fullName, email: teacher.email, phone: teacher.phone || undefined, role: "TEACHER", linkedType: "TEACHER", linkedId: teacher.employeeNo,
    });
    return { username: result.user.username, credentials: result.credentials };
  },
};

// ---- Students -------------------------------------------------------------------

const studentFromRow = (row: any) => ({
  id: row.id,
  studentNo: row.student_no,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  dateOfBirth: row.date_of_birth,
  gender: row.gender,
  address: row.address,
  programId: row.program_id,
  programCode: row.program_code,
  programName: row.program_name,
  termLabel: row.term_label,
  sectionId: row.section_id,
  sectionLabel: row.section_id ? `${row.term_label} ${row.term_no} (${row.section_name}), ${row.session_name}` : null,
  termNo: row.term_no,
  sessionName: row.session_name,
  admissionDate: row.admission_date,
  status: row.status,
  statusReason: row.status_reason,
  guardian: { name: row.guardian_name, phone: row.guardian_phone, email: row.guardian_email, relationship: row.guardian_relationship },
  username: row.username || null,
  hostelStatus: row.hostel_status || null,
  createdAt: toIso(row.created_at),
});

const STUDENT_SELECT = `
  SELECT st.*, p.code AS program_code, p.name AS program_name, p.term_label, s.name AS section_name, s.term_no, se.name AS session_name,
    (SELECT u.username FROM erp_users u WHERE u.institution_id = st.institution_id AND u.linked_type = 'STUDENT' AND LOWER(u.linked_id) = LOWER(st.student_no) LIMIT 1) AS username,
    (SELECT a.status FROM hostel_allocations a WHERE a.institution_id = st.institution_id AND LOWER(a.student_id) = LOWER(st.student_no)
       ORDER BY (a.status = 'Allocated') DESC, a.created_at DESC LIMIT 1) AS hostel_status
  FROM acad_students st JOIN acad_programs p ON p.id = st.program_id
  LEFT JOIN acad_sections s ON s.id = st.section_id LEFT JOIN acad_sessions se ON se.id = s.session_id`;

// A section must be in the student's program and have a free place.
const checkSection = async (tx: PoolClient, institutionId: string, programId: string, sectionId: unknown, ignoreStudents: string[] = []) => {
  if (sectionId === undefined || sectionId === null || sectionId === "") return null;
  const { rows } = await tx.query("SELECT * FROM acad_sections WHERE institution_id = $1 AND id = $2 FOR UPDATE", [institutionId, sectionId]);
  const section = rows[0];
  if (!section) fail(400, "That section does not exist.");
  if (section.program_id !== programId) fail(400, "The section belongs to another program.");
  const { rows: count } = await tx.query(
    "SELECT COUNT(*)::int AS n FROM acad_students WHERE section_id = $1 AND status = 'ACTIVE' AND NOT (id = ANY($2))",
    [section.id, ignoreStudents]
  );
  if (count[0].n + 1 > section.capacity) fail(409, `Section ${section.name} is full (${section.capacity} students).`);
  return section.id as string;
};

const nextStudentNo = async (tx: PoolClient, institutionId: string, programCode: string) => {
  const year = new Date().getUTCFullYear();
  const prefix = `${programCode}-${year}-`;
  const { rows } = await tx.query(
    `SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(SUBSTRING(student_no FROM $2::int), '[^0-9]', '', 'g'), '')::int), 0) + 1 AS next
     FROM acad_students WHERE institution_id = $1 AND student_no LIKE $3`,
    [institutionId, prefix.length + 1, `${prefix}%`]
  );
  return `${prefix}${String(rows[0].next).padStart(4, "0")}`;
};

export const studentsService = {
  async list(institutionId: string, filters: { search?: string; programId?: string; sectionId?: string; status?: string } = {}) {
    const { rows } = await postgresService.query(
      `${STUDENT_SELECT} WHERE st.institution_id = $1
         AND ($2 = '' OR st.full_name ILIKE '%' || $2 || '%' OR st.student_no ILIKE '%' || $2 || '%' OR st.email ILIKE '%' || $2 || '%' OR st.phone ILIKE '%' || $2 || '%')
         AND ($3 = '' OR st.program_id = $3) AND ($4 = '' OR st.section_id = $4) AND ($5 = '' OR st.status = $5)
       ORDER BY st.student_no LIMIT 1000`,
      [institutionId, filters.search?.trim() || "", filters.programId || "", filters.sectionId || "", filters.status || ""]
    );
    return rows.map(studentFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${STUDENT_SELECT} WHERE st.institution_id = $1 AND (st.id = $2 OR LOWER(st.student_no) = LOWER($2))`, [institutionId, id]);
    if (!rows[0]) fail(404, "Student not found.");
    return studentFromRow(rows[0]);
  },

  async create(actor: Actor, body: any) {
    const id = newId();
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM acad_programs WHERE institution_id = $1 AND id = $2", [actor.institutionId, body?.programId || ""]);
      const program = rows[0];
      if (!program) fail(400, "Choose a program.");
      if (program.status !== "ACTIVE") fail(409, "This program is not taking students.");
      const studentNo = body?.studentNo ? code(body.studentNo, "Student ID", 40) : await nextStudentNo(tx, actor.institutionId, program.code);
      const values = [
        id, actor.institutionId, studentNo, text(body?.fullName, "Full name", 150, true), email(body?.email), phone(body?.phone),
        date(body?.dateOfBirth, "Date of birth"), oneOf(body?.gender ?? "", "Gender", GENDERS), text(body?.address, "Address", 500),
        program.id, await checkSection(tx, actor.institutionId, program.id, body?.sectionId), date(body?.admissionDate, "Admission date") || new Date().toISOString().slice(0, 10),
        text(body?.guardian?.name, "Guardian name", 150), phone(body?.guardian?.phone, "Guardian phone") || "", email(body?.guardian?.email, "Guardian email") || "",
        text(body?.guardian?.relationship, "Relationship", 50), actor.email,
      ];
      await tx.query(
        `INSERT INTO acad_students (id, institution_id, student_no, full_name, email, phone, date_of_birth, gender, address, program_id, section_id,
           admission_date, guardian_name, guardian_phone, guardian_email, guardian_relationship, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        values
      );
      await audit(tx, actor, "Created", "Student", id, `Admitted ${values[3]} (${studentNo}) to ${program.code}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // The student ID is fixed: hostel, portal and results all use it.
  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM acad_students WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      const current = rows[0];
      if (!current) fail(404, "Student not found.");
      if (body?.studentNo !== undefined && String(body.studentNo).toUpperCase() !== current.student_no.toUpperCase()) fail(409, "The student ID cannot change.");
      let programId = current.program_id;
      if (body?.programId !== undefined && body.programId !== current.program_id) {
        const { rows: found } = await tx.query("SELECT id FROM acad_programs WHERE institution_id = $1 AND id = $2", [actor.institutionId, body.programId]);
        if (!found[0]) fail(400, "That program does not exist.");
        programId = found[0].id;
      }
      const sectionChanged = body?.sectionId !== undefined && (body.sectionId || null) !== current.section_id;
      const sectionId = sectionChanged || programId !== current.program_id
        ? await checkSection(tx, actor.institutionId, programId, body?.sectionId === undefined ? current.section_id : body.sectionId, [id])
        : current.section_id;
      const pick = (key: string, fallback: unknown, parse: (value: unknown) => unknown) => (body?.[key] === undefined ? fallback : parse(body[key]));
      const g = body?.guardian || {};
      await tx.query(
        `UPDATE acad_students SET full_name = $3, email = $4, phone = $5, date_of_birth = $6, gender = $7, address = $8, program_id = $9, section_id = $10,
           guardian_name = $11, guardian_phone = $12, guardian_email = $13, guardian_relationship = $14, updated_at = NOW()
         WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id,
          pick("fullName", current.full_name, (v) => text(v, "Full name", 150, true)),
          pick("email", current.email, (v) => email(v)),
          pick("phone", current.phone, (v) => phone(v)),
          pick("dateOfBirth", current.date_of_birth, (v) => date(v, "Date of birth")),
          pick("gender", current.gender, (v) => oneOf(v ?? "", "Gender", GENDERS)),
          pick("address", current.address, (v) => text(v, "Address", 500)),
          programId, sectionId,
          g.name === undefined ? current.guardian_name : text(g.name, "Guardian name", 150),
          g.phone === undefined ? current.guardian_phone : phone(g.phone, "Guardian phone") || "",
          g.email === undefined ? current.guardian_email : email(g.email, "Guardian email") || "",
          g.relationship === undefined ? current.guardian_relationship : text(g.relationship, "Relationship", 50)]
      );
      await audit(tx, actor, "Updated", "Student", id, `Updated ${current.full_name} (${current.student_no})${sectionId !== current.section_id ? ", moved section" : ""}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // Leaving, finishing or a suspension also switches the student's sign-in off; coming back switches it on.
  async setStatus(actor: Actor, id: string, body: any) {
    const status = oneOf(body?.status, "Status", STUDENT_STATUS);
    const reason = text(body?.reason, "Reason", 500);
    if (status !== "ACTIVE" && !reason) fail(400, "Give a reason.");
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM acad_students WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      const current = rows[0];
      if (!current) fail(404, "Student not found.");
      if (status === "ACTIVE" && current.section_id) await checkSection(tx, actor.institutionId, current.program_id, current.section_id, [id]);
      await tx.query("UPDATE acad_students SET status = $3, status_reason = $4, updated_at = NOW() WHERE institution_id = $1 AND id = $2", [actor.institutionId, id, status, reason]);
      await tx.query(
        "UPDATE erp_users SET status = $3, updated_at = NOW() WHERE institution_id = $1 AND linked_type = 'STUDENT' AND LOWER(linked_id) = LOWER($2)",
        [actor.institutionId, current.student_no, status === "ACTIVE" || status === "GRADUATED" ? "ACTIVE" : "INACTIVE"]
      );
      await audit(tx, actor, "Status", "Student", id, `${current.full_name} (${current.student_no}): ${current.status} to ${status}. ${reason}`);
    });
    return this.get(actor.institutionId, id);
  },

  // Moves chosen students to another section of the same program, for example the next term.
  async move(actor: Actor, body: any) {
    const ids = body?.studentIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) fail(400, "Choose the students to move.");
    let moved = 0;
    await inTx(async (tx) => {
      const { rows: target } = await tx.query("SELECT * FROM acad_sections WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, body?.toSectionId || ""]);
      if (!target[0]) fail(400, "Choose the section to move them to.");
      const { rows: students } = await tx.query("SELECT * FROM acad_students WHERE institution_id = $1 AND id = ANY($2) FOR UPDATE", [actor.institutionId, ids]);
      if (students.length !== new Set(ids).size) fail(400, "One or more students were not found.");
      if (students.some((row: any) => row.program_id !== target[0].program_id)) fail(400, "All students must be in the section's program.");
      const { rows: count } = await tx.query("SELECT COUNT(*)::int AS n FROM acad_students WHERE section_id = $1 AND status = 'ACTIVE' AND NOT (id = ANY($2))", [target[0].id, ids]);
      const incoming = students.filter((row: any) => row.status === "ACTIVE").length;
      if (count[0].n + incoming > target[0].capacity) fail(409, `Section ${target[0].name} has room for ${target[0].capacity - count[0].n} more.`);
      await tx.query("UPDATE acad_students SET section_id = $2, updated_at = NOW() WHERE id = ANY($1)", [ids, target[0].id]);
      moved = students.length;
      await audit(tx, actor, "Moved", "Student", target[0].id, `Moved ${moved} student(s) to section ${target[0].name}.`);
    });
    return { moved };
  },

  async createAccount(actor: Actor, id: string) {
    const student = await this.get(actor.institutionId, id);
    if (!student.email) fail(400, "Add the student's email first. The sign-in details are sent there.");
    const result = await usersService.create(actor, {
      fullName: student.fullName, email: student.email, phone: student.phone || undefined, role: "STUDENT", linkedType: "STUDENT", linkedId: student.studentNo,
    });
    return { username: result.user.username, credentials: result.credentials };
  },

  // Uses the guardian's existing account when the email already has one, and links this student to it.
  async createGuardianAccount(actor: Actor, id: string) {
    const student = await this.get(actor.institutionId, id);
    const guardian = student.guardian;
    if (!guardian.name || !guardian.email) fail(400, "Add the guardian's name and email first.");
    const [existing] = await usersService.lookup(actor.institutionId, { email: guardian.email });
    let account: { id: string; username: string };
    let credentials = null;
    if (existing) {
      if (existing.role !== "GUARDIAN") fail(409, `${guardian.email} already belongs to a ${existing.roleName} account.`);
      account = existing;
    } else {
      const made = await usersService.create(actor, { fullName: guardian.name, email: guardian.email, phone: guardian.phone || undefined, role: "GUARDIAN" });
      account = made.user;
      credentials = made.credentials;
    }
    const wards = await usersService.wards(actor.institutionId, account.id);
    if (!wards.some((item: any) => item.studentId.toLowerCase() === student.studentNo.toLowerCase())) {
      await usersService.setWards(actor, account.id, {
        wards: [...wards.map((item: any) => ({ studentId: item.studentId, relationship: item.relationship })), { studentId: student.studentNo, relationship: guardian.relationship }],
      });
    }
    return { username: account.username, existing: Boolean(existing), credentials };
  },

  async guardianAccounts(institutionId: string, studentNo: string) {
    const { rows } = await postgresService.query(
      `SELECT u.id, u.username, u.full_name, u.status FROM erp_guardian_links l JOIN erp_users u ON u.id = l.guardian_user_id
       WHERE l.institution_id = $1 AND LOWER(l.student_id) = LOWER($2)`,
      [institutionId, studentNo]
    );
    return rows.map((row: any) => ({ id: row.id, username: row.username, fullName: row.full_name, status: row.status }));
  },
};
