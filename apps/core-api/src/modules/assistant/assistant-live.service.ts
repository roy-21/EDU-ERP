import { postgresService } from "../../database/postgres";
import { attendanceService, examsService } from "../academics/teaching.service";
import { financeReports } from "../finance/finance.service";
import { hostelBillingService } from "../hostel/hostel-billing.service";
import { Language, LiveTopic } from "./assistant-text";

// Live ERP answers. Everything here runs inside postgresService.readOnly, so the database
// itself refuses any write made on this path, whatever service code it calls. Whose data is
// read comes only from the signed-in account (a student's own record, a guardian's linked
// children), never from the question text, so one person cannot ask for another's data.

export type Asker = {
  institutionId: string;
  userId: string;
  role: string;
  fullName: string;
  linkedType: string | null;
  linkedId: string | null;
  modules: string[];
};

export type LiveAnswer = { status: "ANSWERED" | "NO_DATA"; answer: string; facts: Record<string, unknown> };

const say = (lang: Language, en: string, bn: string) => (lang === "bn" ? bn : en);
const noData = (answer: string, facts: Record<string, unknown> = {}): LiveAnswer => ({ status: "NO_DATA", answer, facts });
const answered = (answer: string, facts: Record<string, unknown>): LiveAnswer => ({ status: "ANSWERED", answer, facts });

export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const timeIn = (value: Date | string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value));
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`));
const money = (value: number) => `৳${Math.round(value * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

type Subject = { studentNo: string; name: string };

// Whose records a question is about: a student's own, or every child linked to a guardian.
const subjectsOf = async (asker: Asker): Promise<Subject[]> => {
  if (asker.role === "STUDENT" && asker.linkedType === "STUDENT" && asker.linkedId) return [{ studentNo: asker.linkedId, name: asker.fullName }];
  if (asker.role !== "GUARDIAN") return [];
  const { rows } = await postgresService.query(
    `SELECT l.student_id,
       COALESCE((SELECT full_name FROM acad_students s WHERE s.institution_id = l.institution_id AND LOWER(s.student_no) = LOWER(l.student_id)),
                (SELECT full_name FROM erp_users u WHERE u.institution_id = l.institution_id AND u.linked_type = 'STUDENT' AND u.linked_id = l.student_id LIMIT 1),
                l.student_id) AS name
     FROM erp_guardian_links l WHERE l.institution_id = $1 AND l.guardian_user_id = $2 ORDER BY l.created_at`,
    [asker.institutionId, asker.userId]
  );
  return rows.map((row: any) => ({ studentNo: row.student_id, name: row.name }));
};

const academicId = async (institutionId: string, studentNo: string): Promise<string | null> =>
  (await postgresService.query("SELECT id FROM acad_students WHERE institution_id = $1 AND LOWER(student_no) = LOWER($2)", [institutionId, studentNo])).rows[0]?.id || null;

const allocationOf = async (institutionId: string, studentNo: string) =>
  (await postgresService.query(
    `SELECT id, status FROM hostel_allocations WHERE institution_id = $1 AND LOWER(student_id) = LOWER($2)
     ORDER BY (status = 'Allocated') DESC, created_at DESC LIMIT 1`,
    [institutionId, studentNo]
  )).rows[0] || null;

const todaysMeals = async (institutionId: string, day: string) =>
  (await postgresService.query(
    `SELECT title, meal_type, menu_items, description, collect_from, collect_until FROM hostel_meals
     WHERE institution_id = $1 AND meal_date = $2 AND status = 'Published' ORDER BY collect_from`,
    [institutionId, day]
  )).rows;

const menuText = (items: unknown): string => {
  const list = Array.isArray(items) ? items : [];
  return list.map((item: any) => (typeof item === "string" ? item : item?.name || item?.title || "")).filter(Boolean).join(", ");
};

const MEAL_WORDS: Record<string, RegExp> = {
  Breakfast: /breakfast|নাস্তা|সকালের/i,
  Lunch: /lunch|দুপুর|লাঞ্চ/i,
  Dinner: /dinner|supper|রাত|ডিনার/i,
  Snacks: /snack|নাস্তা/i,
};

const noPersonalRecord = (lang: Language) =>
  noData(say(lang,
    "I can only answer questions about personal records for a student account or a guardian linked to a student. Your account is not linked to a student record.",
    "ব্যক্তিগত তথ্যের প্রশ্নের উত্তর আমি শুধু ছাত্র অ্যাকাউন্ট বা ছাত্রের সাথে যুক্ত অভিভাবক অ্যাকাউন্টের জন্য দিতে পারি। আপনার অ্যাকাউন্ট কোনো ছাত্রের রেকর্ডের সাথে যুক্ত নয়।"));

const notSubscribed = (lang: Language, what: string) =>
  noData(say(lang, `Your institution does not use the ${what} module, so I have no ${what.toLowerCase()} data to read.`,
    `আপনার প্রতিষ্ঠান ${what} মডিউল ব্যবহার করে না, তাই এই তথ্য আমার কাছে নেই।`));

const prefix = (subjects: Subject[], subject: Subject) => (subjects.length > 1 ? `${subject.name} (${subject.studentNo}): ` : "");

// ---- Topics -------------------------------------------------------------------------

const mealCount = async (asker: Asker, lang: Language, timeZone: string): Promise<LiveAnswer> => {
  if (!asker.modules.includes("hostel")) return notSubscribed(lang, "Hostel");
  const subjects = await subjectsOf(asker);
  if (subjects.length === 0) return noPersonalRecord(lang);
  const day = todayIn(timeZone);
  const lines: string[] = [];
  const facts: any[] = [];
  for (const subject of subjects) {
    const allocation = await allocationOf(asker.institutionId, subject.studentNo);
    if (!allocation) {
      lines.push(prefix(subjects, subject) + say(lang, "No hostel seat is on record, so there are no meal bookings.", "হোস্টেলে কোনো সিটের রেকর্ড নেই, তাই কোনো মিল বুকিংও নেই।"));
      continue;
    }
    const row = (await postgresService.query(
      `SELECT COALESCE(SUM(b.quantity), 0)::int AS booked, COALESCE(SUM(b.quantity) FILTER (WHERE b.collected_at IS NOT NULL), 0)::int AS collected,
         COALESCE(string_agg(DISTINCT m.meal_type, ', '), '') AS meals
       FROM hostel_meal_bookings b JOIN hostel_meals m ON m.id = b.meal_id
       WHERE b.institution_id = $1 AND b.allocation_id = $2 AND b.status = 'Confirmed' AND m.meal_date = $3`,
      [asker.institutionId, allocation.id, day]
    )).rows[0];
    facts.push({ student: subject.studentNo, day, booked: row.booked, collected: row.collected, meals: row.meals });
    lines.push(prefix(subjects, subject) + (row.booked === 0
      ? say(lang, `No meals are booked for today (${dayLabel(day)}).`, `আজ (${dayLabel(day)}) কোনো মিল বুক করা নেই।`)
      : say(lang,
        `Today (${dayLabel(day)}) ${row.booked} meal${row.booked === 1 ? " is" : "s are"} booked (${row.meals}); ${row.collected} collected so far.`,
        `আজ (${dayLabel(day)}) ${row.booked}টি মিল বুক করা আছে (${row.meals}); এখন পর্যন্ত ${row.collected}টি নেওয়া হয়েছে।`)));
  }
  return answered(lines.join("\n"), { day, subjects: facts });
};

const mealMenu = async (asker: Asker, lang: Language, timeZone: string, question: string, withTimes: boolean): Promise<LiveAnswer> => {
  if (!asker.modules.includes("hostel")) return notSubscribed(lang, "Hostel");
  const day = todayIn(timeZone);
  let meals = await todaysMeals(asker.institutionId, day);
  const wanted = Object.entries(MEAL_WORDS).filter(([, pattern]) => pattern.test(question)).map(([type]) => type);
  if (wanted.length) meals = meals.filter((meal: any) => wanted.includes(meal.meal_type));
  if (meals.length === 0) {
    return noData(say(lang, `No meal ${withTimes ? "times have" : "menu has"} been published for today (${dayLabel(day)}).`,
      `আজকের (${dayLabel(day)}) জন্য কোনো মিলের ${withTimes ? "সময়" : "মেনু"} প্রকাশ করা হয়নি।`), { day });
  }
  const now = Date.now();
  const lines = meals.map((meal: any) => {
    const menu = menuText(meal.menu_items) || meal.description || meal.title;
    const window = `${timeIn(meal.collect_from, timeZone)}–${timeIn(meal.collect_until, timeZone)}`;
    const over = new Date(meal.collect_until).getTime() < now;
    if (withTimes) {
      return say(lang,
        `${meal.meal_type}: served ${window}${over ? " (already over today)" : ""}.`,
        `${meal.meal_type}: ${window} পর্যন্ত দেওয়া হয়${over ? " (আজকের সময় শেষ)" : ""}।`);
    }
    return say(lang, `${meal.meal_type}: ${menu} (served ${window}).`, `${meal.meal_type}: ${menu} (${window})।`);
  });
  const head = say(lang, `Today (${dayLabel(day)}):`, `আজ (${dayLabel(day)}):`);
  return answered(`${head}\n${lines.join("\n")}`, {
    day,
    meals: meals.map((meal: any) => ({ type: meal.meal_type, menu: menuText(meal.menu_items), from: meal.collect_from, until: meal.collect_until })),
  });
};

const attendance = async (asker: Asker, lang: Language): Promise<LiveAnswer> => {
  if (!asker.modules.includes("attendance")) return notSubscribed(lang, "Attendance");
  const subjects = await subjectsOf(asker);
  if (subjects.length === 0) return noPersonalRecord(lang);
  const lines: string[] = [];
  const facts: any[] = [];
  for (const subject of subjects) {
    const id = await academicId(asker.institutionId, subject.studentNo);
    const summary = id ? await attendanceService.studentSummary(asker.institutionId, id) : null;
    facts.push({ student: subject.studentNo, overallPercent: summary?.overallPercent ?? null, classes: summary?.classes || [] });
    if (!summary || summary.overallPercent === null) {
      lines.push(prefix(subjects, subject) + say(lang, "No attendance has been recorded yet.", "এখনো কোনো হাজিরা রেকর্ড করা হয়নি।"));
      continue;
    }
    const courses = summary.classes.filter((item) => item.percent !== null)
      .map((item) => `${item.courseCode} ${item.percent}% (${item.attended}/${item.attended + item.absent})`).join(", ");
    lines.push(prefix(subjects, subject) + say(lang,
      `Overall attendance is ${summary.overallPercent}%. By course: ${courses}.`,
      `মোট হাজিরা ${summary.overallPercent}%। কোর্স অনুযায়ী: ${courses}।`));
  }
  return answered(lines.join("\n"), { subjects: facts });
};

const result = async (asker: Asker, lang: Language): Promise<LiveAnswer> => {
  if (!asker.modules.includes("examination")) return notSubscribed(lang, "Examination");
  const subjects = await subjectsOf(asker);
  if (subjects.length === 0) return noPersonalRecord(lang);
  const lines: string[] = [];
  const facts: any[] = [];
  for (const subject of subjects) {
    const id = await academicId(asker.institutionId, subject.studentNo);
    const transcript = id ? await examsService.transcript(asker.institutionId, id) : null;
    const terms = transcript?.terms || [];
    facts.push({ student: subject.studentNo, cgpa: transcript?.cgpa ?? null, terms });
    if (!transcript || terms.length === 0) {
      lines.push(prefix(subjects, subject) + say(lang, "No results have been published yet.", "এখনো কোনো ফলাফল প্রকাশ করা হয়নি।"));
      continue;
    }
    const latest = terms[terms.length - 1];
    const courses = latest.courses.map((course: any) => `${course.courseCode} ${course.letter}`).join(", ");
    lines.push(prefix(subjects, subject) + say(lang,
      `CGPA ${transcript.cgpa} out of ${transcript.scale} over ${transcript.totalCredits} credits. Latest published term (${latest.term}, ${latest.session}): GPA ${latest.gpa} — ${courses}.`,
      `সিজিপিএ ${transcript.cgpa} (${transcript.scale} এর মধ্যে), মোট ${transcript.totalCredits} ক্রেডিট। সর্বশেষ প্রকাশিত টার্ম (${latest.term}, ${latest.session}): জিপিএ ${latest.gpa} — ${courses}।`));
  }
  return answered(lines.join("\n"), { subjects: facts });
};

const feesDue = async (asker: Asker, lang: Language): Promise<LiveAnswer> => {
  const useFinance = asker.modules.includes("finance");
  const useHostel = asker.modules.includes("hostel");
  if (!useFinance && !useHostel) return notSubscribed(lang, "Finance");
  const subjects = await subjectsOf(asker);
  if (subjects.length === 0) return noPersonalRecord(lang);
  const lines: string[] = [];
  const facts: any[] = [];
  for (const subject of subjects) {
    const tuition = useFinance ? await financeReports.statement(asker.institutionId, subject.studentNo) : null;
    const allocation = useHostel ? await allocationOf(asker.institutionId, subject.studentNo) : null;
    const hostel = allocation ? await hostelBillingService.getLedger(asker.institutionId, allocation.id) : null;
    const tuitionDue = tuition?.totalOutstanding || 0;
    const hostelDue = hostel?.totalOutstanding || 0;
    const overdue = (tuition?.totalOverdue || 0) + (hostel?.totalOverdue || 0);
    facts.push({ student: subject.studentNo, tuitionDue, hostelDue, overdue });
    const total = tuitionDue + hostelDue;
    if (total <= 0) {
      lines.push(prefix(subjects, subject) + say(lang, "Nothing is due. All billed fees are paid.", "কোনো বকেয়া নেই। সব বিল পরিশোধ করা হয়েছে।"));
      continue;
    }
    const parts = [
      tuitionDue > 0 ? say(lang, `tuition and fees ${money(tuitionDue)}`, `টিউশন ও ফি ${money(tuitionDue)}`) : "",
      hostelDue > 0 ? say(lang, `hostel ${money(hostelDue)}`, `হোস্টেল ${money(hostelDue)}`) : "",
    ].filter(Boolean).join(", ");
    lines.push(prefix(subjects, subject) + say(lang,
      `${money(total)} is due (${parts})${overdue > 0 ? `, of which ${money(overdue)} is overdue` : ""}.`,
      `মোট বকেয়া ${money(total)} (${parts})${overdue > 0 ? `, এর মধ্যে ${money(overdue)} মেয়াদোত্তীর্ণ` : ""}।`));
  }
  return answered(lines.join("\n"), { subjects: facts });
};

// No module in this ERP keeps an application status a student can read, so the assistant
// says so plainly instead of guessing.
const application = async (_asker: Asker, lang: Language): Promise<LiveAnswer> =>
  noData(say(lang,
    "The system does not keep application statuses that I can read yet, so I cannot tell you the status of an application. Please contact the office that received it.",
    "আবেদনের অবস্থা এই সিস্টেমে এমনভাবে রাখা হয় না যা আমি পড়তে পারি, তাই আবেদনের অবস্থা আমি বলতে পারছি না। যে অফিসে আবেদন জমা দিয়েছেন সেখানে যোগাযোগ করুন।"));

export const liveDataService = {
  async answer(asker: Asker, topic: LiveTopic, question: string, lang: Language, timeZone: string): Promise<LiveAnswer> {
    return postgresService.readOnly(async () => {
      switch (topic) {
        case "MEAL_COUNT": return mealCount(asker, lang, timeZone);
        case "MEAL_MENU": return mealMenu(asker, lang, timeZone, question, false);
        case "MEAL_TIME": return mealMenu(asker, lang, timeZone, question, true);
        case "ATTENDANCE": return attendance(asker, lang);
        case "RESULT": return result(asker, lang);
        case "FEES_DUE": return feesDue(asker, lang);
        case "APPLICATION": return application(asker, lang);
      }
    });
  },
};
