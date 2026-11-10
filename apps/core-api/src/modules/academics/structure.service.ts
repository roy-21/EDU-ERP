import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso, toMoney } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { code, date, fail, inTx, oneOf, text, whole } from "./academics.common";

const STATUS = ["ACTIVE", "INACTIVE"] as const;
const COURSE_TYPES = ["THEORY", "LAB", "PROJECT"] as const;

// A referenced record must belong to the same institution.
const owned = async (tx: PoolClient | typeof postgresService, table: string, institutionId: string, id: unknown, label: string) => {
  if (typeof id !== "string" || !id) fail(400, `Choose a ${label}.`);
  const { rows } = await tx.query(`SELECT * FROM ${table} WHERE institution_id = $1 AND id = $2`, [institutionId, id]);
  if (!rows[0]) fail(400, `That ${label} does not exist.`);
  return rows[0];
};

const optionalOwned = async (tx: PoolClient, table: string, institutionId: string, id: unknown, label: string) =>
  id === undefined || id === null || id === "" ? null : (await owned(tx, table, institutionId, id, label)).id;

type Entity = {
  table: string;
  label: string;
  list: string;
  map: (row: any) => any;
  parse: (tx: PoolClient, institutionId: string, body: any, current?: any) => Promise<Record<string, unknown>>;
  inUse: { sql: string; message: string }[];
};

const ENTITIES: Record<string, Entity> = {
  departments: {
    table: "acad_departments",
    label: "department",
    list: `SELECT d.*,
      (SELECT COUNT(*) FROM acad_programs p WHERE p.department_id = d.id) AS programs,
      (SELECT COUNT(*) FROM acad_teachers t WHERE t.department_id = d.id AND t.status <> 'INACTIVE') AS teachers,
      (SELECT COUNT(*) FROM acad_students s JOIN acad_programs p ON p.id = s.program_id WHERE p.department_id = d.id AND s.status = 'ACTIVE') AS students
      FROM acad_departments d WHERE d.institution_id = $1 ORDER BY d.code`,
    map: (row) => ({ id: row.id, code: row.code, name: row.name, status: row.status, programs: Number(row.programs ?? 0), teachers: Number(row.teachers ?? 0), students: Number(row.students ?? 0) }),
    parse: async (_tx, _inst, body, current) => ({
      code: body?.code === undefined && current ? current.code : code(body?.code, "Department code"),
      name: body?.name === undefined && current ? current.name : text(body?.name, "Department name", 150, true),
      status: oneOf(body?.status, "Status", STATUS, current?.status || "ACTIVE"),
    }),
    inUse: [
      { sql: "SELECT 1 FROM acad_programs WHERE department_id = $1 LIMIT 1", message: "Programs belong to this department." },
      { sql: "SELECT 1 FROM acad_courses WHERE department_id = $1 LIMIT 1", message: "Courses belong to this department." },
    ],
  },
  programs: {
    table: "acad_programs",
    label: "program",
    list: `SELECT p.*, d.code AS department_code, d.name AS department_name,
      (SELECT COUNT(*) FROM acad_students s WHERE s.program_id = p.id AND s.status = 'ACTIVE') AS students
      FROM acad_programs p JOIN acad_departments d ON d.id = p.department_id WHERE p.institution_id = $1 ORDER BY p.code`,
    map: (row) => ({ id: row.id, code: row.code, name: row.name, departmentId: row.department_id, departmentName: row.department_name, termLabel: row.term_label, termCount: row.term_count, status: row.status, students: Number(row.students ?? 0) }),
    parse: async (tx, inst, body, current) => ({
      code: body?.code === undefined && current ? current.code : code(body?.code, "Program code"),
      name: body?.name === undefined && current ? current.name : text(body?.name, "Program name", 150, true),
      department_id: body?.departmentId === undefined && current ? current.department_id : (await owned(tx, "acad_departments", inst, body?.departmentId, "department")).id,
      term_label: body?.termLabel === undefined && current ? current.term_label : text(body?.termLabel, "Term name", 20) || "Semester",
      term_count: body?.termCount === undefined && current ? current.term_count : whole(body?.termCount, "Number of terms", 1, 20),
      status: oneOf(body?.status, "Status", STATUS, current?.status || "ACTIVE"),
    }),
    inUse: [
      { sql: "SELECT 1 FROM acad_sections WHERE program_id = $1 LIMIT 1", message: "Sections belong to this program." },
      { sql: "SELECT 1 FROM acad_students WHERE program_id = $1 LIMIT 1", message: "Students are enrolled in this program." },
    ],
  },
  sessions: {
    table: "acad_sessions",
    label: "session",
    list: "SELECT * FROM acad_sessions WHERE institution_id = $1 ORDER BY starts_on DESC",
    map: (row) => ({ id: row.id, name: row.name, startsOn: row.starts_on, endsOn: row.ends_on, isCurrent: row.is_current }),
    parse: async (tx, inst, body, current) => {
      const startsOn = body?.startsOn === undefined && current ? current.starts_on : date(body?.startsOn, "Start date", true);
      const endsOn = body?.endsOn === undefined && current ? current.ends_on : date(body?.endsOn, "End date", true);
      if (endsOn <= startsOn) fail(400, "The session must end after it starts.");
      const isCurrent = body?.isCurrent === undefined ? Boolean(current?.is_current) : body.isCurrent === true;
      // Only one session is current; choosing a new one moves the mark.
      if (isCurrent) await tx.query("UPDATE acad_sessions SET is_current = FALSE WHERE institution_id = $1 AND is_current AND id <> $2", [inst, current?.id || ""]);
      return {
        name: body?.name === undefined && current ? current.name : text(body?.name, "Session name", 50, true),
        starts_on: startsOn,
        ends_on: endsOn,
        is_current: isCurrent,
      };
    },
    inUse: [
      { sql: "SELECT 1 FROM acad_sections WHERE session_id = $1 LIMIT 1", message: "Sections use this session." },
      { sql: "SELECT 1 FROM acad_exams WHERE session_id = $1 LIMIT 1", message: "Exams use this session." },
    ],
  },
  sections: {
    table: "acad_sections",
    label: "section",
    list: `SELECT s.*, p.code AS program_code, p.name AS program_name, p.term_label, se.name AS session_name, t.full_name AS class_teacher_name,
      (SELECT COUNT(*) FROM acad_students st WHERE st.section_id = s.id AND st.status = 'ACTIVE') AS students
      FROM acad_sections s JOIN acad_programs p ON p.id = s.program_id JOIN acad_sessions se ON se.id = s.session_id
      LEFT JOIN acad_teachers t ON t.id = s.class_teacher_id
      WHERE s.institution_id = $1 ORDER BY se.starts_on DESC, p.code, s.term_no, s.name`,
    map: (row) => ({
      id: row.id, programId: row.program_id, programCode: row.program_code, programName: row.program_name, sessionId: row.session_id,
      sessionName: row.session_name, termNo: row.term_no, termLabel: row.term_label, name: row.name, capacity: row.capacity,
      classTeacherId: row.class_teacher_id, classTeacherName: row.class_teacher_name, students: Number(row.students ?? 0),
      label: `${row.program_code} ${row.term_label} ${row.term_no} (${row.name}), ${row.session_name}`,
    }),
    parse: async (tx, inst, body, current) => {
      const program = body?.programId === undefined && current
        ? await owned(tx, "acad_programs", inst, current.program_id, "program")
        : await owned(tx, "acad_programs", inst, body?.programId, "program");
      const termNo = body?.termNo === undefined && current ? current.term_no : whole(body?.termNo, `${program.term_label} number`, 1, program.term_count);
      if (termNo > program.term_count) fail(400, `${program.name} has only ${program.term_count} ${program.term_label.toLowerCase()}s.`);
      const capacity = body?.capacity === undefined ? current?.capacity ?? 60 : whole(body.capacity, "Capacity", 1, 1000);
      if (current) {
        const { rows } = await tx.query("SELECT COUNT(*)::int AS n FROM acad_students WHERE section_id = $1 AND status = 'ACTIVE'", [current.id]);
        if (rows[0].n > capacity) fail(409, `${rows[0].n} students are already in this section.`);
      }
      return {
        program_id: program.id,
        session_id: body?.sessionId === undefined && current ? current.session_id : (await owned(tx, "acad_sessions", inst, body?.sessionId, "session")).id,
        term_no: termNo,
        name: body?.name === undefined && current ? current.name : text(body?.name, "Section name", 30, true),
        capacity,
        class_teacher_id: body?.classTeacherId === undefined && current ? current.class_teacher_id : await optionalOwned(tx, "acad_teachers", inst, body?.classTeacherId, "teacher"),
      };
    },
    inUse: [
      { sql: "SELECT 1 FROM acad_students WHERE section_id = $1 LIMIT 1", message: "Students are in this section. Move them first." },
      { sql: "SELECT 1 FROM acad_classes WHERE section_id = $1 LIMIT 1", message: "Classes are taught to this section." },
    ],
  },
  courses: {
    table: "acad_courses",
    label: "course",
    list: `SELECT c.*, d.code AS department_code FROM acad_courses c JOIN acad_departments d ON d.id = c.department_id
      WHERE c.institution_id = $1 ORDER BY c.code`,
    map: (row) => ({ id: row.id, code: row.code, title: row.title, departmentId: row.department_id, departmentCode: row.department_code, credits: toMoney(row.credits), courseType: row.course_type, status: row.status }),
    parse: async (tx, inst, body, current) => {
      const credits = body?.credits === undefined && current ? toMoney(current.credits) : Number(body?.credits);
      if (!Number.isFinite(credits) || credits <= 0 || credits > 20 || Math.round(credits * 100) / 100 !== credits) fail(400, "Credits must be more than 0 and at most 20.");
      return {
        code: body?.code === undefined && current ? current.code : code(body?.code, "Course code"),
        title: body?.title === undefined && current ? current.title : text(body?.title, "Course title", 200, true),
        department_id: body?.departmentId === undefined && current ? current.department_id : (await owned(tx, "acad_departments", inst, body?.departmentId, "department")).id,
        credits,
        course_type: oneOf(body?.courseType, "Course type", COURSE_TYPES, current?.course_type || "THEORY"),
        status: oneOf(body?.status, "Status", STATUS, current?.status || "ACTIVE"),
      };
    },
    inUse: [{ sql: "SELECT 1 FROM acad_classes WHERE course_id = $1 LIMIT 1", message: "This course is taught in a class." }],
  },
  classes: {
    table: "acad_classes",
    label: "class",
    list: `SELECT k.*, c.code AS course_code, c.title AS course_title, c.credits, t.full_name AS teacher_name,
      s.name AS section_name, s.term_no, s.session_id, p.code AS program_code, p.term_label, se.name AS session_name,
      (SELECT COUNT(*) FROM acad_students st WHERE st.section_id = k.section_id AND st.status = 'ACTIVE') AS students
      FROM acad_classes k JOIN acad_courses c ON c.id = k.course_id JOIN acad_sections s ON s.id = k.section_id
      JOIN acad_programs p ON p.id = s.program_id JOIN acad_sessions se ON se.id = s.session_id
      LEFT JOIN acad_teachers t ON t.id = k.teacher_id
      WHERE k.institution_id = $1 ORDER BY se.starts_on DESC, p.code, s.term_no, s.name, c.code`,
    map: (row) => ({
      id: row.id, courseId: row.course_id, courseCode: row.course_code, courseTitle: row.course_title, credits: toMoney(row.credits),
      sectionId: row.section_id, sectionLabel: `${row.program_code} ${row.term_label} ${row.term_no} (${row.section_name})`, sessionId: row.session_id,
      sessionName: row.session_name, teacherId: row.teacher_id, teacherName: row.teacher_name, students: Number(row.students ?? 0),
      resultsPublishedAt: toIso(row.results_published_at),
    }),
    parse: async (tx, inst, body, current) => {
      // Attendance and marks hang off the class, so its course and section stay fixed.
      if (current && ((body?.courseId && body.courseId !== current.course_id) || (body?.sectionId && body.sectionId !== current.section_id))) {
        fail(409, "A class keeps its course and section. Create a new class instead; only the teacher can change.");
      }
      return {
      course_id: body?.courseId === undefined && current ? current.course_id : (await owned(tx, "acad_courses", inst, body?.courseId, "course")).id,
      section_id: body?.sectionId === undefined && current ? current.section_id : (await owned(tx, "acad_sections", inst, body?.sectionId, "section")).id,
      teacher_id: body?.teacherId === undefined && current ? current.teacher_id : await optionalOwned(tx, "acad_teachers", inst, body?.teacherId, "teacher"),
      };
    },
    inUse: [
      { sql: "SELECT 1 FROM acad_attendance_sessions WHERE class_id = $1 LIMIT 1", message: "Attendance was taken in this class." },
      { sql: "SELECT 1 FROM acad_marks m JOIN acad_assessments a ON a.id = m.assessment_id WHERE a.class_id = $1 LIMIT 1", message: "Marks were entered in this class." },
    ],
  },
};

export const STRUCTURE_KINDS = Object.keys(ENTITIES);

const entity = (kind: string) => ENTITIES[kind] || fail(404, "Unknown list.");

export const structureService = {
  async list(institutionId: string, kind: string) {
    const item = entity(kind);
    const { rows } = await postgresService.query(item.list, [institutionId]);
    return rows.map(item.map);
  },

  async get(institutionId: string, kind: string, id: string) {
    const found = (await this.list(institutionId, kind)).find((row: any) => row.id === id);
    if (!found) fail(404, `That ${entity(kind).label} was not found.`);
    return found;
  },

  async create(actor: Actor, kind: string, body: any) {
    const item = entity(kind);
    const id = newId();
    await inTx(async (tx) => {
      const values = await item.parse(tx, actor.institutionId, body);
      const columns = Object.keys(values);
      await tx.query(
        `INSERT INTO ${item.table} (id, institution_id, ${columns.join(", ")}) VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(", ")})`,
        [id, actor.institutionId, ...Object.values(values)]
      );
      // A new class joins every exam its section's session already has.
      if (kind === "classes") {
        await tx.query(
          `INSERT INTO acad_assessments (id, institution_id, exam_id, class_id, max_marks)
           SELECT md5(random()::text || e.id), $1::varchar, e.id, $2::varchar, e.default_max_marks
           FROM acad_exams e JOIN acad_sections s ON s.session_id = e.session_id
           WHERE s.id = $3::varchar AND e.institution_id = $1::varchar ON CONFLICT DO NOTHING`,
          [actor.institutionId, id, values.section_id]
        );
      }
      await audit(tx, actor, "Created", item.label, id, `Created ${item.label} ${values.code || values.name || values.title || ""}.`);
    });
    return this.get(actor.institutionId, kind, id);
  },

  async update(actor: Actor, kind: string, id: string, body: any) {
    const item = entity(kind);
    await inTx(async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM ${item.table} WHERE institution_id = $1 AND id = $2 FOR UPDATE`, [actor.institutionId, id]);
      if (!rows[0]) fail(404, `That ${item.label} was not found.`);
      const values = await item.parse(tx, actor.institutionId, body, rows[0]);
      const columns = Object.keys(values);
      await tx.query(
        `UPDATE ${item.table} SET ${columns.map((column, i) => `${column} = $${i + 3}`).join(", ")} WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, ...Object.values(values)]
      );
      await audit(tx, actor, "Updated", item.label, id, `Updated ${item.label} ${values.code || values.name || values.title || ""}.`);
    });
    return this.get(actor.institutionId, kind, id);
  },

  // Only something nothing depends on can be deleted; otherwise make it inactive.
  async remove(actor: Actor, kind: string, id: string) {
    const item = entity(kind);
    await inTx(async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM ${item.table} WHERE institution_id = $1 AND id = $2 FOR UPDATE`, [actor.institutionId, id]);
      if (!rows[0]) fail(404, `That ${item.label} was not found.`);
      for (const check of item.inUse) {
        if ((await tx.query(check.sql, [id])).rows[0]) fail(409, `${check.message} It cannot be deleted.`);
      }
      await tx.query(`DELETE FROM ${item.table} WHERE id = $1`, [id]);
      await audit(tx, actor, "Deleted", item.label, id, `Deleted ${item.label} ${rows[0].code || rows[0].name || rows[0].title || ""}.`);
    });
    return { id, deleted: true };
  },
};
