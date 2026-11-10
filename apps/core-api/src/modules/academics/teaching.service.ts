import { Request } from "express";
import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { db } from "../../database/db";
import { newId, toIso, toMoney } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { date, fail, has, inTx, myTeacherId, text } from "./academics.common";

const ATTENDANCE_STATUS = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const EDIT_WINDOW_DAYS = 7;
const round2 = (value: number) => Math.round(value * 100) / 100;
const todayUtc = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

const CLASS_SELECT = `
  SELECT k.*, c.code AS course_code, c.title AS course_title, c.credits, s.program_id, s.term_no, s.name AS section_name, s.session_id,
    p.code AS program_code, p.term_label, se.name AS session_name, se.starts_on, se.ends_on, se.is_current, t.full_name AS teacher_name,
    (SELECT COUNT(*) FROM acad_students st WHERE st.section_id = k.section_id AND st.status = 'ACTIVE') AS students,
    (SELECT COUNT(*) FROM acad_attendance_sessions a WHERE a.class_id = k.id) AS attendance_sessions
  FROM acad_classes k JOIN acad_courses c ON c.id = k.course_id JOIN acad_sections s ON s.id = k.section_id
  JOIN acad_programs p ON p.id = s.program_id JOIN acad_sessions se ON se.id = s.session_id
  LEFT JOIN acad_teachers t ON t.id = k.teacher_id`;

const classFromRow = (row: any) => ({
  id: row.id,
  courseCode: row.course_code,
  courseTitle: row.course_title,
  credits: toMoney(row.credits),
  sectionId: row.section_id,
  sectionLabel: `${row.program_code} ${row.term_label} ${row.term_no} (${row.section_name})`,
  sessionId: row.session_id,
  sessionName: row.session_name,
  isCurrentSession: row.is_current,
  teacherId: row.teacher_id,
  teacherName: row.teacher_name,
  students: Number(row.students ?? 0),
  attendanceSessions: Number(row.attendance_sessions ?? 0),
  resultsPublishedAt: toIso(row.results_published_at),
});

// Staff with the module's approve permission act on every class; a teacher only on their own.
const loadClass = async (req: Request, classId: string, fullAccess: string) => {
  const { rows } = await postgresService.query(`${CLASS_SELECT} WHERE k.institution_id = $1 AND k.id = $2`, [req.institutionId, classId]);
  const row = rows[0];
  if (!row) fail(404, "Class not found.");
  if (!has(req, fullAccess) && req.user?.role !== "ADMIN" && req.user?.role !== "SUPER_ADMIN") {
    const mine = await myTeacherId(req);
    if (!mine || mine !== row.teacher_id) fail(403, "Only this class's teacher can do this.");
  }
  return row;
};

const roster = async (db_: PoolClient | typeof postgresService, sectionId: string) =>
  (await db_.query("SELECT id, student_no, full_name FROM acad_students WHERE section_id = $1 AND status = 'ACTIVE' ORDER BY student_no", [sectionId])).rows;

const actorOf = (req: Request): Actor => ({
  institutionId: req.institutionId as string, userId: req.user?.userId || "", email: req.user?.email || "", role: req.user?.role || "", permissions: req.user?.permissions || [],
});

export const classesService = {
  // Classes this person may teach or manage, current session first.
  async mine(req: Request, fullAccess: string) {
    const everything = has(req, fullAccess) || ["ADMIN", "SUPER_ADMIN"].includes(req.user?.role || "");
    const teacherId = everything ? null : await myTeacherId(req);
    if (!everything && !teacherId) return [];
    const { rows } = await postgresService.query(
      `${CLASS_SELECT} WHERE k.institution_id = $1 AND ($2::text IS NULL OR k.teacher_id = $2) ORDER BY se.is_current DESC, se.starts_on DESC, c.code`,
      [req.institutionId, teacherId]
    );
    return rows.map(classFromRow);
  },
};

// ---- Attendance -------------------------------------------------------------------

export const attendanceService = {
  async sheet(req: Request, classId: string, heldOn: string, slot: string) {
    const klass = await loadClass(req, classId, "attendance.approve");
    const day = date(heldOn, "Date", true) as string;
    const students = await roster(postgresService, klass.section_id);
    const { rows } = await postgresService.query("SELECT * FROM acad_attendance_sessions WHERE class_id = $1 AND held_on = $2 AND slot = $3", [classId, day, slot || "1"]);
    const marks = rows[0] ? (await postgresService.query("SELECT * FROM acad_attendance_marks WHERE session_id = $1", [rows[0].id])).rows : [];
    const byStudent = new Map(marks.map((row: any) => [row.student_id, row]));
    return {
      class: classFromRow(klass),
      heldOn: day,
      slot: slot || "1",
      topic: rows[0]?.topic || "",
      takenBy: rows[0]?.taken_by || null,
      savedAt: toIso(rows[0]?.updated_at || null),
      students: students.map((student: any) => ({
        studentId: student.id, studentNo: student.student_no, fullName: student.full_name,
        status: (byStudent.get(student.id) as any)?.status || null, note: (byStudent.get(student.id) as any)?.note || "",
      })),
    };
  },

  // Every student on the roster gets a mark. Old days can only be changed by someone with approve rights.
  async save(req: Request, classId: string, body: any) {
    const klass = await loadClass(req, classId, "attendance.approve");
    const heldOn = date(body?.heldOn, "Date", true) as string;
    const today = todayUtc();
    if (heldOn > today) fail(400, "Attendance cannot be taken for a future date.");
    if (heldOn < klass.starts_on || heldOn > klass.ends_on) fail(400, `The date must be within the ${klass.session_name} session.`);
    const slot = text(body?.slot, "Period", 30) || "1";
    const marks = body?.marks;
    if (!Array.isArray(marks)) fail(400, "Send a mark for every student.");
    const actor = actorOf(req);
    return inTx(async (tx) => {
      const students = await roster(tx, klass.section_id);
      const ids = new Set(students.map((row: any) => row.id));
      const given = new Map<string, any>();
      for (const item of marks) {
        if (!ids.has(item?.studentId)) fail(400, "A student in the list is not in this class.");
        if (!ATTENDANCE_STATUS.includes(item?.status)) fail(400, `Status must be one of: ${ATTENDANCE_STATUS.join(", ")}.`);
        given.set(item.studentId, item);
      }
      const missing = students.filter((row: any) => !given.has(row.id));
      if (missing.length > 0) fail(400, `Mark every student. Missing: ${missing.slice(0, 3).map((row: any) => row.full_name).join(", ")}${missing.length > 3 ? "..." : ""}.`);

      const { rows } = await tx.query("SELECT * FROM acad_attendance_sessions WHERE class_id = $1 AND held_on = $2 AND slot = $3 FOR UPDATE", [classId, heldOn, slot]);
      let sessionId = rows[0]?.id;
      const daysOld = Math.round((Date.parse(today) - Date.parse(heldOn)) / 86_400_000);
      if (sessionId && daysOld > EDIT_WINDOW_DAYS && !has(req, "attendance.approve")) {
        fail(403, `Attendance older than ${EDIT_WINDOW_DAYS} days can only be changed by someone with approve rights.`);
      }
      if (sessionId) {
        await tx.query("UPDATE acad_attendance_sessions SET topic = $2, taken_by = $3, updated_at = NOW() WHERE id = $1", [sessionId, text(body?.topic, "Topic", 200), actor.email]);
        await tx.query("DELETE FROM acad_attendance_marks WHERE session_id = $1", [sessionId]);
      } else {
        sessionId = newId();
        await tx.query(
          "INSERT INTO acad_attendance_sessions (id, institution_id, class_id, held_on, slot, topic, taken_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [sessionId, actor.institutionId, classId, heldOn, slot, text(body?.topic, "Topic", 200), actor.email]
        );
      }
      for (const item of given.values()) {
        await tx.query("INSERT INTO acad_attendance_marks (session_id, student_id, status, note) VALUES ($1, $2, $3, $4)", [sessionId, item.studentId, item.status, text(item.note, "Note", 200)]);
      }
      const absent = [...given.values()].filter((item) => item.status === "ABSENT").length;
      await audit(tx, actor, rows[0] ? "Updated" : "Taken", "Attendance", sessionId, `${klass.course_code} ${klass.section_name} on ${heldOn} (period ${slot}): ${given.size - absent} present or late, ${absent} absent.`);
      return { sessionId, heldOn, slot, marked: given.size, absent };
    });
  },

  // Late counts as attended; excused days are left out of the total.
  async classReport(req: Request, classId: string) {
    const klass = await loadClass(req, classId, "attendance.approve");
    const { rows } = await postgresService.query(
      `SELECT st.id, st.student_no, st.full_name,
         COUNT(m.status) FILTER (WHERE m.status IN ('PRESENT', 'LATE')) AS attended,
         COUNT(m.status) FILTER (WHERE m.status = 'ABSENT') AS absent,
         COUNT(m.status) FILTER (WHERE m.status = 'LATE') AS late,
         COUNT(m.status) FILTER (WHERE m.status = 'EXCUSED') AS excused
       FROM acad_students st
       LEFT JOIN acad_attendance_marks m ON m.student_id = st.id AND m.session_id IN (SELECT id FROM acad_attendance_sessions WHERE class_id = $1)
       WHERE st.section_id = $2 AND st.status = 'ACTIVE'
       GROUP BY st.id ORDER BY st.student_no`,
      [classId, klass.section_id]
    );
    const sessions = await postgresService.query("SELECT held_on, slot, topic, taken_by FROM acad_attendance_sessions WHERE class_id = $1 ORDER BY held_on DESC, slot", [classId]);
    return {
      class: classFromRow(klass),
      sessions: sessions.rows.map((row: any) => ({ heldOn: row.held_on, slot: row.slot, topic: row.topic, takenBy: row.taken_by })),
      students: rows.map((row: any) => {
        const counted = Number(row.attended) + Number(row.absent);
        return {
          studentId: row.id, studentNo: row.student_no, fullName: row.full_name, attended: Number(row.attended), absent: Number(row.absent),
          late: Number(row.late), excused: Number(row.excused), percent: counted ? round2((Number(row.attended) / counted) * 100) : null,
        };
      }),
    };
  },

  async studentSummary(institutionId: string, studentId: string) {
    const { rows } = await postgresService.query(
      `SELECT k.id AS class_id, c.code, c.title,
         COUNT(m.status) FILTER (WHERE m.status IN ('PRESENT', 'LATE')) AS attended,
         COUNT(m.status) FILTER (WHERE m.status = 'ABSENT') AS absent
       FROM acad_attendance_marks m JOIN acad_attendance_sessions a ON a.id = m.session_id
       JOIN acad_classes k ON k.id = a.class_id JOIN acad_courses c ON c.id = k.course_id
       WHERE a.institution_id = $1 AND m.student_id = $2 GROUP BY k.id, c.code, c.title ORDER BY c.code`,
      [institutionId, studentId]
    );
    type Line = { classId: string; courseCode: string; courseTitle: string; attended: number; absent: number; percent: number | null };
    const classes: Line[] = rows.map((row: any) => {
      const counted = Number(row.attended) + Number(row.absent);
      return { classId: row.class_id, courseCode: row.code, courseTitle: row.title, attended: Number(row.attended), absent: Number(row.absent), percent: counted ? round2((Number(row.attended) / counted) * 100) : null };
    });
    const attended = classes.reduce((sum, item) => sum + item.attended, 0);
    const counted = attended + classes.reduce((sum, item) => sum + item.absent, 0);
    return { overallPercent: counted ? round2((attended / counted) * 100) : null, classes };
  },
};

// ---- Exams, marks and results ----------------------------------------------------------

const grading = async (institutionId: string) => {
  const { rows } = await postgresService.query("SELECT data FROM erp_settings WHERE tenant_id = $1 AND section = 'grading'", [institutionId]);
  return rows[0]?.data || db.gradingConfig;
};

// The highest grade whose lowest mark the percentage reaches.
export const gradeFor = (config: any, percent: number) => {
  const ranges = [...config.gradeRanges].sort((a: any, b: any) => b.minMark - a.minMark);
  const range = ranges.find((item: any) => percent >= item.minMark) || ranges[ranges.length - 1];
  return { letter: range.letter as string, gradePoint: Number(range.gradePoint), passed: percent >= Number(config.passMarks) && Number(range.gradePoint) > 0 };
};

const examFromRow = (row: any) => ({
  id: row.id, sessionId: row.session_id, sessionName: row.session_name, name: row.name, weight: toMoney(row.weight),
  defaultMaxMarks: toMoney(row.default_max_marks), startsOn: row.starts_on, endsOn: row.ends_on,
  classes: Number(row.classes ?? 0), locked: Number(row.locked ?? 0), createdBy: row.created_by,
});

const EXAM_SELECT = `
  SELECT e.*, se.name AS session_name,
    (SELECT COUNT(*) FROM acad_assessments a WHERE a.exam_id = e.id) AS classes,
    (SELECT COUNT(*) FROM acad_assessments a WHERE a.exam_id = e.id AND a.locked_at IS NOT NULL) AS locked
  FROM acad_exams e JOIN acad_sessions se ON se.id = e.session_id`;

const positive = (value: unknown, label: string, max: number) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0 || result > max || round2(result) !== result) fail(400, `${label} must be more than 0 and at most ${max}.`);
  return result;
};

// Weighted percentage across a class's assessments. Incomplete until every mark is in.
const computeClass = async (classId: string, institutionId: string) => {
  const config = await grading(institutionId);
  const { rows: assessments } = await postgresService.query(
    `SELECT a.*, e.name, e.weight FROM acad_assessments a JOIN acad_exams e ON e.id = a.exam_id WHERE a.class_id = $1 ORDER BY e.created_at`,
    [classId]
  );
  const { rows: klass } = await postgresService.query("SELECT section_id FROM acad_classes WHERE id = $1", [classId]);
  const students = await roster(postgresService, klass[0].section_id);
  const { rows: marks } = await postgresService.query(
    "SELECT m.* FROM acad_marks m JOIN acad_assessments a ON a.id = m.assessment_id WHERE a.class_id = $1",
    [classId]
  );
  const key = (assessment: string, student: string) => `${assessment}|${student}`;
  const byKey = new Map(marks.map((row: any) => [key(row.assessment_id, row.student_id), row]));
  const totalWeight = assessments.reduce((sum: number, row: any) => sum + toMoney(row.weight), 0);
  const results = students.map((student: any) => {
    let score = 0;
    let complete = true;
    const parts = assessments.map((assessment: any) => {
      const mark: any = byKey.get(key(assessment.id, student.id));
      if (!mark || (!mark.is_absent && mark.marks === null)) complete = false;
      const value = mark && !mark.is_absent && mark.marks !== null ? toMoney(mark.marks) : 0;
      score += (value / toMoney(assessment.max_marks)) * toMoney(assessment.weight);
      return { exam: assessment.name, marks: mark ? (mark.is_absent ? null : mark.marks === null ? null : toMoney(mark.marks)) : null, isAbsent: Boolean(mark?.is_absent), maxMarks: toMoney(assessment.max_marks) };
    });
    const percent = totalWeight ? round2((score / totalWeight) * 100) : 0;
    return { studentId: student.id, studentNo: student.student_no, fullName: student.full_name, parts, complete, percent, ...(complete ? gradeFor(config, percent) : { letter: null, gradePoint: null, passed: null }) };
  });
  return { assessments, totalWeight, results };
};

export const examsService = {
  async list(institutionId: string, sessionId = ""): Promise<ReturnType<typeof examFromRow>[]> {
    const { rows } = await postgresService.query(`${EXAM_SELECT} WHERE e.institution_id = $1 AND ($2 = '' OR e.session_id = $2) ORDER BY se.starts_on DESC, e.created_at`, [institutionId, sessionId]);
    return rows.map(examFromRow);
  },

  // Exam weights in a session add up to at most 100. Every class in the session gets the exam.
  async create(actor: Actor, body: any) {
    const id = newId();
    await inTx(async (tx) => {
      const { rows: session } = await tx.query("SELECT * FROM acad_sessions WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, body?.sessionId || ""]);
      if (!session[0]) fail(400, "Choose a session.");
      const weight = positive(body?.weight, "Weight", 100);
      const { rows: used } = await tx.query("SELECT COALESCE(SUM(weight), 0) AS total FROM acad_exams WHERE session_id = $1", [session[0].id]);
      if (toMoney(used[0].total) + weight > 100) fail(400, `Exams in ${session[0].name} already carry ${toMoney(used[0].total)}%. This one can be at most ${100 - toMoney(used[0].total)}%.`);
      const maxMarks = body?.defaultMaxMarks === undefined ? 100 : positive(body.defaultMaxMarks, "Full marks", 1000);
      const startsOn = date(body?.startsOn, "Start date");
      const endsOn = date(body?.endsOn, "End date");
      if (startsOn && endsOn && endsOn < startsOn) fail(400, "The exam must end on or after it starts.");
      const name = text(body?.name, "Exam name", 100, true);
      await tx.query(
        "INSERT INTO acad_exams (id, institution_id, session_id, name, weight, default_max_marks, starts_on, ends_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [id, actor.institutionId, session[0].id, name, weight, maxMarks, startsOn, endsOn, actor.email]
      );
      await tx.query(
        `INSERT INTO acad_assessments (id, institution_id, exam_id, class_id, max_marks)
         SELECT md5(random()::text || k.id), $1::varchar, $2::varchar, k.id, $3::numeric FROM acad_classes k JOIN acad_sections s ON s.id = k.section_id WHERE s.session_id = $4::varchar`,
        [actor.institutionId, id, maxMarks, session[0].id]
      );
      await audit(tx, actor, "Created", "Exam", id, `Created exam ${name} (${weight}%) for ${session[0].name}.`);
    });
    return (await this.list(actor.institutionId)).find((item) => item.id === id);
  },

  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM acad_exams WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      const current = rows[0];
      if (!current) fail(404, "Exam not found.");
      const weight = body?.weight === undefined ? toMoney(current.weight) : positive(body.weight, "Weight", 100);
      const { rows: used } = await tx.query("SELECT COALESCE(SUM(weight), 0) AS total FROM acad_exams WHERE session_id = $1 AND id <> $2", [current.session_id, id]);
      if (toMoney(used[0].total) + weight > 100) fail(400, `The other exams carry ${toMoney(used[0].total)}%. This one can be at most ${100 - toMoney(used[0].total)}%.`);
      const published = await tx.query(
        "SELECT 1 FROM acad_assessments a JOIN acad_classes k ON k.id = a.class_id WHERE a.exam_id = $1 AND k.results_published_at IS NOT NULL LIMIT 1",
        [id]
      );
      if (published.rows[0] && weight !== toMoney(current.weight)) fail(409, "Results using this exam are published. Its weight cannot change.");
      await tx.query("UPDATE acad_exams SET name = $3, weight = $4, starts_on = $5, ends_on = $6 WHERE institution_id = $1 AND id = $2", [
        actor.institutionId, id, body?.name === undefined ? current.name : text(body.name, "Exam name", 100, true), weight,
        body?.startsOn === undefined ? current.starts_on : date(body.startsOn, "Start date"), body?.endsOn === undefined ? current.ends_on : date(body.endsOn, "End date"),
      ]);
      await audit(tx, actor, "Updated", "Exam", id, `Updated exam ${current.name}.`);
    });
    return (await this.list(actor.institutionId)).find((item) => item.id === id);
  },

  async remove(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM acad_exams WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Exam not found.");
      const marks = await tx.query("SELECT 1 FROM acad_marks m JOIN acad_assessments a ON a.id = m.assessment_id WHERE a.exam_id = $1 LIMIT 1", [id]);
      if (marks.rows[0]) fail(409, "Marks were entered for this exam. It cannot be deleted.");
      await tx.query("DELETE FROM acad_exams WHERE id = $1", [id]);
      await audit(tx, actor, "Deleted", "Exam", id, `Deleted exam ${rows[0].name}.`);
    });
    return { id, deleted: true };
  },

  async classAssessments(req: Request, classId: string) {
    const klass = await loadClass(req, classId, "examination.approve");
    const { rows } = await postgresService.query(
      `SELECT a.*, e.name, e.weight, (SELECT COUNT(*) FROM acad_marks m WHERE m.assessment_id = a.id) AS entered
       FROM acad_assessments a JOIN acad_exams e ON e.id = a.exam_id WHERE a.class_id = $1 ORDER BY e.created_at`,
      [classId]
    );
    return {
      class: classFromRow(klass),
      assessments: rows.map((row: any) => ({
        id: row.id, examName: row.name, weight: toMoney(row.weight), maxMarks: toMoney(row.max_marks), examDate: row.exam_date,
        entered: Number(row.entered), lockedAt: toIso(row.locked_at), lockedBy: row.locked_by,
      })),
    };
  },

  async marksSheet(req: Request, assessmentId: string): Promise<{
    class: ReturnType<typeof classFromRow>;
    assessment: { id: string; examName: string; weight: number; maxMarks: number; examDate: string | null; lockedAt: string | null };
    students: { studentId: string; studentNo: string; fullName: string; marks: number | null; isAbsent: boolean }[];
  }> {
    const { rows } = await postgresService.query(
      "SELECT a.*, e.name, e.weight FROM acad_assessments a JOIN acad_exams e ON e.id = a.exam_id WHERE a.institution_id = $1 AND a.id = $2",
      [req.institutionId, assessmentId]
    );
    if (!rows[0]) fail(404, "Assessment not found.");
    const klass = await loadClass(req, rows[0].class_id, "examination.approve");
    const students = await roster(postgresService, klass.section_id);
    const marks = await postgresService.query("SELECT * FROM acad_marks WHERE assessment_id = $1", [assessmentId]);
    const byStudent = new Map(marks.rows.map((row: any) => [row.student_id, row]));
    return {
      class: classFromRow(klass),
      assessment: { id: rows[0].id, examName: rows[0].name, weight: toMoney(rows[0].weight), maxMarks: toMoney(rows[0].max_marks), examDate: rows[0].exam_date, lockedAt: toIso(rows[0].locked_at) },
      students: students.map((student: any) => {
        const mark: any = byStudent.get(student.id);
        return { studentId: student.id, studentNo: student.student_no, fullName: student.full_name, marks: mark?.marks === null || mark?.marks === undefined ? null : toMoney(mark.marks), isAbsent: Boolean(mark?.is_absent) };
      }),
    };
  },

  // Saves the marks sent; a locked sheet cannot change.
  async saveMarks(req: Request, assessmentId: string, body: any) {
    const sheet = await this.marksSheet(req, assessmentId);
    if (sheet.assessment.lockedAt) fail(409, "These marks are locked. Ask someone with approve rights to unlock them.");
    const maxMarks = body?.maxMarks === undefined ? sheet.assessment.maxMarks : positive(body.maxMarks, "Full marks", 1000);
    const list = Array.isArray(body?.marks) ? body.marks : [];
    const ids = new Set(sheet.students.map((item) => item.studentId));
    const actor = actorOf(req);
    await inTx(async (tx) => {
      const high = await tx.query("SELECT MAX(marks) AS top FROM acad_marks WHERE assessment_id = $1", [assessmentId]);
      if (high.rows[0].top !== null && toMoney(high.rows[0].top) > maxMarks) fail(400, `Some marks are above ${maxMarks}. Lower them first.`);
      await tx.query("UPDATE acad_assessments SET max_marks = $2, exam_date = $3 WHERE id = $1", [assessmentId, maxMarks, body?.examDate === undefined ? sheet.assessment.examDate : date(body.examDate, "Exam date")]);
      for (const item of list) {
        if (!ids.has(item?.studentId)) fail(400, "A student in the list is not in this class.");
        const isAbsent = item.isAbsent === true;
        const marks = isAbsent || item.marks === null || item.marks === "" || item.marks === undefined ? null : Number(item.marks);
        if (marks !== null && (!Number.isFinite(marks) || marks < 0 || marks > maxMarks || round2(marks) !== marks)) fail(400, `Marks must be from 0 to ${maxMarks}, with up to 2 decimals.`);
        await tx.query(
          `INSERT INTO acad_marks (assessment_id, student_id, marks, is_absent, entered_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (assessment_id, student_id) DO UPDATE SET marks = EXCLUDED.marks, is_absent = EXCLUDED.is_absent, entered_by = EXCLUDED.entered_by, updated_at = NOW()`,
          [assessmentId, item.studentId, marks, isAbsent, actor.email]
        );
      }
      await audit(tx, actor, "Marks", "Assessment", assessmentId, `Saved ${list.length} mark(s) for ${sheet.class.courseCode} ${sheet.assessment.examName}.`);
    });
    return this.marksSheet(req, assessmentId);
  },

  async setLocked(req: Request, assessmentId: string, locked: boolean) {
    const sheet = await this.marksSheet(req, assessmentId);
    if (!locked && !has(req, "examination.approve") && !["ADMIN", "SUPER_ADMIN"].includes(req.user?.role || "")) fail(403, "Only someone with approve rights can unlock marks.");
    if (locked) {
      const missing = sheet.students.filter((item) => item.marks === null && !item.isAbsent);
      if (missing.length > 0) fail(409, `Enter marks (or mark absent) for every student first. Missing: ${missing.length}.`);
    } else {
      const { rows } = await postgresService.query("SELECT results_published_at FROM acad_classes WHERE id = $1", [sheet.class.id]);
      if (rows[0].results_published_at) fail(409, "Results are published. Withdraw them before unlocking marks.");
    }
    const actor = actorOf(req);
    await postgresService.query("UPDATE acad_assessments SET locked_at = $2, locked_by = $3 WHERE id = $1", [assessmentId, locked ? new Date() : null, locked ? actor.email : ""]);
    await audit(postgresService, actor, locked ? "Locked" : "Unlocked", "Assessment", assessmentId, `${locked ? "Locked" : "Unlocked"} ${sheet.class.courseCode} ${sheet.assessment.examName} marks.`);
    return this.marksSheet(req, assessmentId);
  },

  async classResults(req: Request, classId: string) {
    const klass = await loadClass(req, classId, "examination.approve");
    const computed = await computeClass(classId, req.institutionId as string);
    return {
      class: classFromRow(klass),
      totalWeight: computed.totalWeight,
      allLocked: computed.assessments.length > 0 && computed.assessments.every((row: any) => row.locked_at),
      results: computed.results,
    };
  },

  // Results go out only when every exam is in and locked and the weights make 100.
  async publish(req: Request, classId: string, publish: boolean) {
    if (!has(req, "examination.approve") && !["ADMIN", "SUPER_ADMIN"].includes(req.user?.role || "")) fail(403, "Publishing results needs approve rights.");
    const results = await this.classResults(req, classId);
    if (publish) {
      if (results.totalWeight !== 100) fail(409, `The exams of this session carry ${results.totalWeight}%, not 100%.`);
      if (!results.allLocked) fail(409, "Lock the marks of every exam first.");
    }
    const actor = actorOf(req);
    await postgresService.query("UPDATE acad_classes SET results_published_at = $2, results_published_by = $3 WHERE id = $1", [classId, publish ? new Date() : null, publish ? actor.email : ""]);
    await audit(postgresService, actor, publish ? "Published" : "Withdrawn", "Results", classId, `${publish ? "Published" : "Withdrew"} results of ${results.class.courseCode} ${results.class.sectionLabel}.`);
    return this.classResults(req, classId);
  },

  // Published results only, by term, with term GPA and CGPA weighted by credits.
  async transcript(institutionId: string, studentId: string) {
    const { rows: classes } = await postgresService.query(
      `SELECT DISTINCT k.id, c.code, c.title, c.credits, se.name AS session_name, se.starts_on, s.term_no, p.term_label
       FROM acad_marks m JOIN acad_assessments a ON a.id = m.assessment_id JOIN acad_classes k ON k.id = a.class_id
       JOIN acad_courses c ON c.id = k.course_id JOIN acad_sections s ON s.id = k.section_id JOIN acad_sessions se ON se.id = s.session_id
       JOIN acad_programs p ON p.id = s.program_id
       WHERE k.institution_id = $1 AND m.student_id = $2 AND k.results_published_at IS NOT NULL
       ORDER BY se.starts_on, s.term_no, c.code`,
      [institutionId, studentId]
    );
    const config = await grading(institutionId);
    const terms = new Map<string, any>();
    let points = 0;
    let credits = 0;
    for (const row of classes) {
      const computed = await computeClass(row.id, institutionId);
      const mine = computed.results.find((item: any) => item.studentId === studentId);
      if (!mine || !mine.complete) continue;
      const key = `${row.session_name}|${row.term_no}`;
      if (!terms.has(key)) terms.set(key, { session: row.session_name, term: `${row.term_label} ${row.term_no}`, courses: [], points: 0, credits: 0 });
      const term = terms.get(key);
      const credit = toMoney(row.credits);
      term.courses.push({ courseCode: row.code, courseTitle: row.title, credits: credit, percent: mine.percent, letter: mine.letter, gradePoint: mine.gradePoint, passed: mine.passed });
      term.points += (mine.gradePoint as number) * credit;
      term.credits += credit;
      points += (mine.gradePoint as number) * credit;
      credits += credit;
    }
    return {
      scale: config.gpaScale,
      terms: [...terms.values()].map((term) => ({ session: term.session, term: term.term, courses: term.courses, credits: term.credits, gpa: term.credits ? round2(term.points / term.credits) : null })),
      totalCredits: credits,
      cgpa: credits ? round2(points / credits) : null,
    };
  },
};
