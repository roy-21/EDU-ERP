import { v4 as uuidv4 } from "uuid";

export interface Institution {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface User {
  id: string;
  institutionId: string;
  email: string;
  fullName: string;
  role: string;
  passwordHash: string;
  username?: string;
  mustChangePassword?: boolean;
  phone?: string;
}

export interface Campus {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
}

export interface DynamicForm {
  id: string;
  institutionId: string;
  title: string;
  slug: string;
  formType: string;
  schema: any;
  createdAt: string;
}

export interface DynamicTableSchema {
  id: string;
  institutionId: string;
  tableName: string;
  slug: string;
  isExportable: boolean;
  columns: any[];
  createdAt: string;
}

export interface Teacher {
  id: string;
  institutionId: string;
  teacherIdNumber: string;
  fullName: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  qualification: string;
  status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
}

export interface Student {
  id: string;
  institutionId: string;
  studentIdNumber: string;
  fullName: string;
  email: string;
  department: string;
  currentSemester: number;
  cgpa: number;
  attendanceRate: number;
  status: "ACTIVE" | "DROPOUT_RISK" | "GRADUATED";
}

export interface Department {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  headOfDepartment: string;
  totalStudents: number;
  totalFaculty: number;
}

export interface Course {
  id: string;
  institutionId: string;
  courseCode: string;
  title: string;
  department: string;
  credits: number;
  semester: number;
}

export interface AttendanceRecord {
  id: string;
  institutionId: string;
  date: string;
  courseCode: string;
  department: string;
  semester: number;
  totalPresent: number;
  totalAbsent: number;
  records: Array<{ studentId: string; studentName: string; status: "PRESENT" | "ABSENT" | "LATE" }>;
}

export interface ExamSchedule {
  id: string;
  institutionId: string;
  examName: string;
  courseCode: string;
  date: string;
  timeSlot: string;
  roomNumber: string;
  totalCandidates: number;
}

export interface FeeStructure {
  id: string;
  institutionId: string;
  feeHead: string;
  department: string;
  semester: number;
  amount: number;
  frequency: "MONTHLY" | "SEMESTER" | "ANNUAL";
  dueDate: string;
}

export interface Invoice {
  id: string;
  institutionId: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  amount: number;
  paidAmount: number;
  status: "PAID" | "PENDING" | "OVERDUE";
  dueDate: string;
}

export interface Guardian {
  id: string;
  institutionId: string;
  fullName: string;
  email: string;
  phone: string;
  relationship: string;
  wardStudentId: string;
  portalUsername: string;
  status: "ACTIVE" | "PENDING_INVITATION";
}

export interface HrStaff {
  id: string;
  institutionId: string;
  employeeCode: string;
  fullName: string;
  role: string;
  department: string;
  salary: number;
  joinDate: string;
  status: "ACTIVE" | "ON_LEAVE";
}

export interface LibraryBook {
  id: string;
  institutionId: string;
  isbn: string;
  title: string;
  author: string;
  category: string;
  availableCopies: number;
  totalCopies: number;
}

export interface TransportRoute {
  id: string;
  institutionId: string;
  routeNumber: string;
  routeName: string;
  driverName: string;
  vehicleNumber: string;
  capacity: number;
  stopsCount: number;
}

export interface Notice {
  id: string;
  institutionId: string;
  title: string;
  category: "ACADEMIC" | "ADMINISTRATIVE" | "EXAM" | "URGENT";
  content: string;
  publishDate: string;
  targetAudience: "ALL" | "STUDENTS" | "TEACHERS" | "STAFF";
}

export interface SystemSetting {
  id: string;
  institutionId: string;
  systemName: string;
  supportEmail: string;
  supportPhone: string;
  currency: string;
  timezone: string;
  maintenanceMode: boolean;
  registrationEnabled: boolean;
  theme: "light" | "dark" | "system";
}

export interface DynamicRole {
  id: string;
  institutionId: string;
  name: string;
  portalType: string;
  isSystem: boolean;
  permissions: Array<{
    moduleId: string;
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canApprove: boolean;
    canExport?: boolean;
    hostelPermissions?: string[];
  }>;
}

class ErpDatabase {
  public institutions = [
    { id: "inst-001", code: "DU", name: "Dhaka University Campus", type: "University" },
    { id: "inst-002", code: "BUET", name: "BUET Engineering Institute", type: "University" }
  ];

  public campuses: Campus[] = [
    { id: "camp-1", institutionId: "inst-001", code: "MC-01", name: "Main Campus", address: "123 Academic Way", lat: 23.8103, lng: 90.4125 },
    { id: "camp-2", institutionId: "inst-001", code: "CC-02", name: "City Campus", address: "456 Downtown Blvd", lat: 23.7937, lng: 90.4066 }
  ];

  public dynamicTables: DynamicTableSchema[] = [];

  public gradingConfig: any = {
    systemType: "standard_4",
    gpaScale: "4.00",
    passMarks: 40,
    cgpaFormula: "standard_weighted",
    gradeRanges: [
      { id: 1, letter: "A+", minMark: 80, maxMark: 100, gradePoint: 4.00 },
      { id: 2, letter: "A",  minMark: 75, maxMark: 79,  gradePoint: 3.75 },
      { id: 3, letter: "A-", minMark: 70, maxMark: 74,  gradePoint: 3.50 },
      { id: 4, letter: "B+", minMark: 65, maxMark: 69,  gradePoint: 3.25 },
      { id: 5, letter: "B",  minMark: 60, maxMark: 64,  gradePoint: 3.00 },
      { id: 6, letter: "B-", minMark: 55, maxMark: 59,  gradePoint: 2.75 },
      { id: 7, letter: "C+", minMark: 50, maxMark: 54,  gradePoint: 2.50 },
      { id: 8, letter: "C",  minMark: 40, maxMark: 49,  gradePoint: 2.00 },
      { id: 9, letter: "F",  minMark: 0,  maxMark: 39,  gradePoint: 0.00 }
    ],
    defaultCourseCredit: 3.00,
    minSemesterCredit: 12,
    maxSemesterCredit: 21,
    retakePolicy: {
      isAllowed: true,
      maxRetakeAllowed: 2,
      applicableIfGradeBelow: "C"
    },
    improvementPolicy: {
      isAllowed: true,
      maxImprovementAllowed: 1,
      applicableIfGradeEqualOrAbove: "B-"
    }
  };

  public teachers: Teacher[] = [
    {
      id: "t-001",
      institutionId: "inst-001",
      teacherIdNumber: "TCH-2024-001",
      fullName: "Dr. Rafiqul Islam",
      email: "rafiqul.islam@institution.edu",
      phone: "+8801712000001",
      department: "Computer Science & Engineering",
      designation: "Professor & Head",
      qualification: "Ph.D. in Artificial Intelligence",
      status: "ACTIVE"
    },
    {
      id: "t-002",
      institutionId: "inst-001",
      teacherIdNumber: "TCH-2024-002",
      fullName: "Ms. Nusrat Jahan",
      email: "nusrat.jahan@institution.edu",
      phone: "+8801712000002",
      department: "Electrical & Electronic Engineering",
      designation: "Associate Professor",
      qualification: "M.Sc. in Embedded Systems",
      status: "ACTIVE"
    },
    {
      id: "t-003",
      institutionId: "inst-001",
      teacherIdNumber: "TCH-2024-003",
      fullName: "Dr. Anisur Rahman",
      email: "anisur.rahman@institution.edu",
      phone: "+8801712000003",
      department: "Business Administration",
      designation: "Senior Lecturer",
      qualification: "Ph.D. in Finance",
      status: "ACTIVE"
    }
  ];

  public students: Student[] = [
    {
      id: "stu-101",
      institutionId: "inst-001",
      studentIdNumber: "STU-2026-001",
      fullName: "Imran Ahmed",
      email: "imran@student.institution.edu",
      department: "Computer Science",
      currentSemester: 4,
      cgpa: 3.65,
      attendanceRate: 92.5,
      status: "ACTIVE"
    },
    {
      id: "stu-102",
      institutionId: "inst-001",
      studentIdNumber: "STU-2026-002",
      fullName: "Rahim Uddin",
      email: "rahim@student.institution.edu",
      department: "Electrical Engineering",
      currentSemester: 3,
      cgpa: 2.15,
      attendanceRate: 61.0,
      status: "DROPOUT_RISK"
    },
    {
      id: "stu-103",
      institutionId: "inst-001",
      studentIdNumber: "STU-2026-003",
      fullName: "Sadia Sultana",
      email: "sadia@student.institution.edu",
      department: "Business Administration",
      currentSemester: 2,
      cgpa: 3.88,
      attendanceRate: 98.0,
      status: "ACTIVE"
    }
  ];

  public departments: Department[] = [
    { id: "dept-cse", institutionId: "inst-001", code: "CSE", name: "Computer Science & Engineering", headOfDepartment: "Dr. Rafiqul Islam", totalStudents: 420, totalFaculty: 24 },
    { id: "dept-eee", institutionId: "inst-001", code: "EEE", name: "Electrical & Electronic Engineering", headOfDepartment: "Ms. Nusrat Jahan", totalStudents: 310, totalFaculty: 18 },
    { id: "dept-bba", institutionId: "inst-001", code: "BBA", name: "Business Administration", headOfDepartment: "Dr. Anisur Rahman", totalStudents: 280, totalFaculty: 15 }
  ];

  public courses: Course[] = [
    { id: "c-101", institutionId: "inst-001", courseCode: "CSE-401", title: "Artificial Intelligence & Expert Systems", department: "Computer Science", credits: 3.0, semester: 4 },
    { id: "c-102", institutionId: "inst-001", courseCode: "CSE-402", title: "Distributed Database Systems", department: "Computer Science", credits: 3.0, semester: 4 },
    { id: "c-103", institutionId: "inst-001", courseCode: "EEE-301", title: "Microprocessors & Interfacing", department: "Electrical Engineering", credits: 3.5, semester: 3 },
    { id: "c-104", institutionId: "inst-001", courseCode: "BBA-201", title: "Corporate Financial Management", department: "Business Administration", credits: 3.0, semester: 2 }
  ];

  public attendanceRecords: AttendanceRecord[] = [
    {
      id: "att-001",
      institutionId: "inst-001",
      date: new Date().toISOString().split("T")[0],
      courseCode: "CSE-401",
      department: "Computer Science",
      semester: 4,
      totalPresent: 45,
      totalAbsent: 3,
      records: [
        { studentId: "stu-101", studentName: "Imran Ahmed", status: "PRESENT" },
        { studentId: "stu-102", studentName: "Rahim Uddin", status: "ABSENT" }
      ]
    }
  ];

  public examSchedules: ExamSchedule[] = [
    { id: "ex-01", institutionId: "inst-001", examName: "Spring 2026 Midterm", courseCode: "CSE-401", date: "2026-11-20", timeSlot: "10:00 AM - 12:00 PM", roomNumber: "Lab 402", totalCandidates: 48 },
    { id: "ex-02", institutionId: "inst-001", examName: "Spring 2026 Midterm", courseCode: "EEE-301", date: "2026-11-22", timeSlot: "02:00 PM - 04:00 PM", roomNumber: "Room 305", totalCandidates: 42 }
  ];

  public feeStructures: FeeStructure[] = [
    { id: "fee-01", institutionId: "inst-001", feeHead: "Semester Tuition Fee", department: "Computer Science", semester: 4, amount: 45000, frequency: "SEMESTER", dueDate: "2026-11-30" },
    { id: "fee-02", institutionId: "inst-001", feeHead: "Lab Development & Cloud Access", department: "Computer Science", semester: 4, amount: 7500, frequency: "SEMESTER", dueDate: "2026-11-30" },
    { id: "fee-03", institutionId: "inst-001", feeHead: "Library & Digital Journal Subscription", department: "General", semester: 0, amount: 2000, frequency: "ANNUAL", dueDate: "2026-12-15" }
  ];

  public invoices: Invoice[] = [
    { id: "inv-001", institutionId: "inst-001", invoiceNumber: "INV-2026-1001", studentId: "stu-101", studentName: "Imran Ahmed", amount: 52500, paidAmount: 52500, status: "PAID", dueDate: "2026-11-30" },
    { id: "inv-002", institutionId: "inst-001", invoiceNumber: "INV-2026-1002", studentId: "stu-102", studentName: "Rahim Uddin", amount: 52500, paidAmount: 20000, status: "PENDING", dueDate: "2026-11-30" }
  ];

  public guardians: Guardian[] = [
    { id: "grd-01", institutionId: "inst-001", fullName: "Abdul Karim", email: "abdul.karim@email.com", phone: "+8801819000001", relationship: "Father", wardStudentId: "stu-101", portalUsername: "guardian.imran", status: "ACTIVE" },
    { id: "grd-02", institutionId: "inst-001", fullName: "Fatema Begum", email: "fatema.begum@email.com", phone: "+8801819000002", relationship: "Mother", wardStudentId: "stu-102", portalUsername: "guardian.rahim", status: "ACTIVE" }
  ];

  public hrStaff: HrStaff[] = [
    { id: "hr-01", institutionId: "inst-001", employeeCode: "EMP-2024-01", fullName: "Mahmudul Hasan", role: "Accounts Officer", department: "Finance & Accounts", salary: 65000, joinDate: "2022-03-15", status: "ACTIVE" },
    { id: "hr-02", institutionId: "inst-001", employeeCode: "EMP-2024-02", fullName: "Shirina Akhter", role: "HR Executive", department: "Human Resources", salary: 55000, joinDate: "2023-06-01", status: "ACTIVE" }
  ];

  public libraryBooks: LibraryBook[] = [
    { id: "bk-01", institutionId: "inst-001", isbn: "978-0134610993", title: "Artificial Intelligence: A Modern Approach", author: "Stuart Russell & Peter Norvig", category: "Computer Science", availableCopies: 8, totalCopies: 12 },
    { id: "bk-02", institutionId: "inst-001", isbn: "978-0073529578", title: "Database System Concepts", author: "Silberschatz, Korth & Sudarshan", category: "Computer Science", availableCopies: 5, totalCopies: 10 }
  ];

  public transportRoutes: TransportRoute[] = [
    { id: "rt-01", institutionId: "inst-001", routeNumber: "Route-1A", routeName: "Uttara to Campus Express", driverName: "Kalam Mia", vehicleNumber: "DHK-METRO-BA-1122", capacity: 52, stopsCount: 8 },
    { id: "rt-02", institutionId: "inst-001", routeNumber: "Route-2B", routeName: "Dhanmondi to Campus", driverName: "Salam Molla", vehicleNumber: "DHK-METRO-BA-3344", capacity: 52, stopsCount: 6 }
  ];

  public notices: Notice[] = [
    { id: "nt-01", institutionId: "inst-001", title: "Midterm Examination Schedule Published", category: "EXAM", content: "The Spring 2026 Midterm Examination will commence from 20th November. Check portal schedules.", publishDate: "2026-11-01", targetAudience: "ALL" },
    { id: "nt-02", institutionId: "inst-001", title: "Semester Tuition Fee Payment Deadline", category: "ADMINISTRATIVE", content: "All enrolled students are requested to clear 50% tuition dues before midterm exams.", publishDate: "2026-11-02", targetAudience: "STUDENTS" }
  ];

  public settings: SystemSetting = {
    id: "sett-01",
    institutionId: "inst-001",
    systemName: "NextGen Institutional ERP System",
    supportEmail: "support@institution.edu",
    supportPhone: "+880 2 9876543",
    currency: "BDT",
    timezone: "Asia/Dhaka (GMT+6)",
    maintenanceMode: false,
    registrationEnabled: true,
    theme: "light"
  };

  public objections = [
    {
      id: "obj-1",
      institutionId: "inst-001",
      studentId: "stu-102",
      source: "AI_VOICE_CALL",
      category: "ATTENDANCE_DISPUTE",
      severity: "HIGH",
      title: "Disputed Absent Mark on 25th Oct",
      description: "Automated from Voice Call session. Caller claims RFID reader failed.",
      status: "OPEN",
      createdAt: new Date().toISOString()
    }
  ];
}

export const db = new ErpDatabase();
