// src/data/modules.js

export const sidebarModules = [
  {
    id: "platform",
    title: "Platform (Super Admin)",
    isMainModule: true,
    icon: "🌐",
    requiresRole: ["SUPER_ADMIN"],
    subMenus: [
      { title: "Institutions, Requests & Prices", href: "/admin/platform" },
    ],
  },
  {
    id: 1,
    title: "1. System Configuration",
    moduleId: "system",
    isMainModule: true, // এটি লাল রঙে দেখাবে
    icon: "⚙️",
    subMenus: [
      {
        title: "(i) Dynamic Form Builder",
        href: "/admin/system/form-builder",
        notes: ["Drag & Drop Form Builder", "Text, Number, Email, Password", "Select, Multi Select", "Radio, Checkbox", "Date Picker", "File Upload", "Signature", "Rich Text Editor", "Conditional Field", "Required Validation", "Permanent Form", "Temporary Form", "Admission Form", "Survey Form", "Feedback Form", "Certificate Request Form"]
      },
      {
        title: "(ii) Dynamic Role & Permission Management",
        href: "/admin/system/role-permission",
        notes: ["Unlimited Role Create", "Role Hierarchy", "Permission Matrix", "Module-wise Access", "Page-wise Access", "API Permission", "Field-level Permission", "Data Ownership", "Approval Permission", "Custom Dashboard Permission"]
      },
      {
        title: "Users & Accounts",
        href: "/admin/system/users",
        requires: "system.manage_users",
      },
      {
        title: "Feature Builder",
        href: "/admin/system/features",
        requires: "system.manage_features",
      },
      {
        title: "(iii) Dynamic Table Builder",
        href: "/admin/system/table-builder",
        notes: ["Create Unlimited Table", "Add Column", "Remove Column", "Column Type", "Primary Key", "Foreign Key", "Relation", "Validation", "Searchable", "Sortable", "Filterable", "Exportable", "Visible Column", "Hidden Column", "Auto CRUD Generate"]
      },
      {
        title: "(iv) Academic Grading Configuration",
        href: "/admin/system/grading-config",
        notes: ["Letter Grade", "GPA Scale", "CGPA Formula", "Marks Range", "Pass Marks", "Retake Policy", "Improvement Policy", "Credit Hour", "Semester Credit", "Custom Grading System"]
      }
    ]
  },
  {
    id: 2,
    title: "2. Institution Configuration",
    moduleId: "institution",
    isMainModule: true,
    icon: "🏛️",
    subMenus: [
      {
        title: "Academic Structure",
        href: "/admin/institution/academic",
      },
      {
        title: "(v) Campus Management",
        href: "/admin/institution/campus",
        notes: ["Multiple Campus", "Campus Admin", "Campus Code", "Campus Address", "Geo Location"]
      },
      {
        title: "(vi) Faculty Management",
        href: "/admin/institution/faculty",
        notes: ["Science", "Engineering", "Business", "Arts", "Medical", "Law", "Custom Faculty"]
      },
      {
        title: "(vii) Department Management",
        href: "/admin/institution/academic?tab=departments",
        notes: ["Department Code", "Program", "Degree", "Credit", "Duration"]
      },
      {
        title: "(viii) Batch Management",
        href: "/admin/institution/academic?tab=sections",
        notes: ["Batch Year", "Semester", "Section", "Shift", "Session"]
      },
      {
        title: "(ix) Section Management",
        href: "/admin/institution/academic?tab=sections",
        notes: ["Section Capacity", "Teacher Assign", "Routine", "Room Assign"]
      },
      {
        title: "(x) Course Management",
        href: "/admin/institution/academic?tab=courses",
        notes: ["Course Code", "Credit", "Prerequisite", "Teacher", "Syllabus", "Course Outcome"]
      }
    ]
  },
  {
    id: 3,
    title: "3. Student Management",
    moduleId: "student",
    isMainModule: true,
    icon: "🎓",
    subMenus: [
      {
        title: "Student Information",
        href: "/admin/student/information",
        notes: ["Admission", "Registration", "Profile", "Guardian", "Documents", "Medical", "Attendance", "Academic Record", "Discipline", "Transfer", "Promotion", "Graduation"]
      },
      {
        title: "Student ID Management",
        href: "/admin/student/id-management",
        notes: ["ID Card", "QR Code", "Barcode", "RFID", "NFC"]
      },
      {
        title: "Student Analytics",
        href: "/admin/student/analytics",
        notes: ["Attendance Trend", "CGPA Trend", "Risk Score", "Performance", "Learning Gap", "Prediction"]
      }
    ]
  },

   // ==========================================
  // NEW ADDED: GUARDIAN MANAGEMENT MODULE
  // ==========================================
  {
    id: "3.5", // Used 3.5 to keep it logically between Student and Teacher
    title: "3.5 Guardian Management",
    moduleId: "guardian",
    isMainModule: true, 
    icon: "👨‍👩‍👧‍👦",
    subMenus: [
      {
        title: "Guardian Profiles",
        href: "/admin/guardian/profiles",
        notes: ["Father/Mother/Guardian Info", "Contact Details", "Occupation & Income", "NID Verification", "Profile Picture"]
      },
      {
        title: "Student-Guardian Mapping",
        href: "/admin/guardian/mapping",
        notes: ["Link Multiple Students", "Primary & Emergency Contact", "Custody Status", "Pickup Permission"]
      },
      {
        title: "Guardian Portal Access",
        href: "/admin/guardian/portal-access",
        notes: ["Login Credentials", "View Academic Results", "Pay Fees Online", "Teacher Communication", "Download Documents"]
      },
      {
        title: "Guardian Communication",
        href: "/admin/guardian/communication",
        notes: ["SMS Gateway", "Email Notifications", "Meeting Scheduling", "Complaint Box"]
      }
    ]
  },
  {
    id: 4,
    title: "4. Teacher Management",
    moduleId: "teacher",
    isMainModule: true,
    icon: "👨‍🏫",
    subMenus: [
      {
        title: "Teacher Profile",
        href: "/admin/teacher/profile",
        notes: ["Department", "Designation", "Qualification", "Research", "Publication", "Office Hour", "Salary Grade", "Leave"]
      },
      {
        title: "Teacher Workload",
        href: "/admin/teacher/workload",
        notes: ["Course Load", "Class Load", "Exam Duty", "Committee", "Research Work"]
      },
      {
        title: "Teacher Evaluation",
        href: "/admin/teacher/evaluation",
        notes: ["Student Feedback", "Peer Review", "AI Evaluation", "Performance Report"]
      }
    ]
  },
  {
    id: 5,
    title: "5. Attendance Module",
    moduleId: "attendance",
    isMainModule: true,
    icon: "📋",
    subMenus: [
      {
        title: "Attendance Features",
        href: "/admin/attendance/features",
        notes: ["Manual Attendance", "QR Attendance", "RFID", "Biometric", "Face Recognition", "GPS Attendance", "Attendance Report", "Attendance Prediction"]
      }
    ]
  },
  {
    id: 6,
    title: "6. Examination Module",
    moduleId: "examination",
    isMainModule: true,
    icon: "📝",
    subMenus: [
      {
        title: "Examination Features",
        href: "/admin/examination",
        notes: ["Exam Schedule", "Seat Plan", "Marks Entry", "Result Publish", "Transcript", "Tabulation", "Improvement", "Retake", "AI Grade Prediction"]
      }
    ]
  },
  {
    id: 7,
    title: "7. Assignment & LMS",
    moduleId: "lms",
    isMainModule: true,
    icon: "📖",
    subMenus: [
      {
        title: "LMS Features",
        href: "/admin/lms",
        notes: ["Assignment", "Submission", "Rubric", "MCQ", "Coding Assignment", "Auto Grading", "AI Quiz", "Plagiarism"]
      }
    ]
  },
  {
    id: 8,
    title: "8. Digital Classroom & Learning Hub",
    moduleId: "classroom",
    isMainModule: true,
    icon: "💻",
    subMenus: [
      {
        title: "Classroom Features",
        href: "/admin/classroom",
        notes: ["🎥 Teacher Content Mgmt", "🔐 Access & Visibility", "👨‍🎓 Student Learning Access", "📊 Progress Tracking", "📝 Assignment & Quiz", "💬 Discussion & Q/A", "🤖 AI Learning Assistant", "📚 Learning Hub Analytics"]
      }
    ]
  },
  {
    id: 9,
    title: "9. Library Management",
    moduleId: "library",
    isMainModule: true,
    icon: "📚",
    subMenus: [
      {
        title: "Library Features",
        href: "/admin/library",
        notes: ["Book", "E-book", "Borrow", "Return", "Fine", "QR", "RFID", "Digital Repository"]
      }
    ]
  },
  {
    id: 10,
    title: "10. Finance & Billing",
    moduleId: "finance",
    isMainModule: true,
    icon: "💰",
    subMenus: [
      {
        title: "Finance Features",
        href: "/admin/finance",
        notes: ["Tuition Fee", "Semester Fee", "Transport", "Hostel", "Fine", "Scholarship", "Discount", "Refund", "Invoice", "Receipt", "Payment Gateway"]
      }
    ]
  },
  {
    id: 11,
    title: "11. Scholarship Management",
    moduleId: "scholarship",
    isMainModule: true,
    icon: "🏅",
    subMenus: [
      {
        title: "Scholarship Features",
        href: "/admin/scholarship",
        notes: ["Merit Scholarship", "Need Based", "Government", "NGO", "Sponsor", "Approval Workflow"]
      }
    ]
  },
  {
    id: 12,
    title: "12. Application Management",
    moduleId: "application",
    isMainModule: true,
    icon: "📄",
    subMenus: [
      {
        title: "Application Features",
        href: "/admin/application",
        notes: ["Leave", "Transcript", "Certificate", "ID Card", "Hostel", "Scholarship", "Objection", "Approval"]
      }
    ]
  },
  {
    id: 13,
    title: "13. Objection Management",
    moduleId: "objection",
    isMainModule: true,
    icon: "⚠️",
    subMenus: [
      {
        title: "Objection Features",
        href: "/admin/objection",
        notes: ["Result Challenge", "Attendance Challenge", "Payment Issue", "Complaint", "Appeal", "Resolution", "(New) Auto-generated notices from AI Voice Call"]
      }
    ]
  },
  {
    id: 14,
    title: "14. Voting Management",
    moduleId: "voting",
    isMainModule: true,
    icon: "🗳️",
    subMenus: [
      {
        title: "Voting Features",
        href: "/admin/voting",
        notes: ["Student Election", "Teacher Election", "Survey", "Referendum", "Anonymous Vote", "Result Analytics"]
      }
    ]
  },
  {
    id: 15,
    title: "15. Research Management",
    moduleId: "research",
    isMainModule: true,
    icon: "🔬",
    subMenus: [
      {
        title: "Research Features",
        href: "/admin/research",
        notes: ["Publication", "Conference", "Patent", "Research Grant", "Research Group", "Citation"]
      }
    ]
  },
  {
    id: 16,
    title: "16. HR Management",
    moduleId: "hr",
    isMainModule: true,
    icon: "🧑‍💼",
    subMenus: [
      {
        title: "HR Features",
        href: "/admin/hr",
        notes: ["Employee", "Payroll", "Leave", "Attendance", "Promotion", "Recruitment", "Performance"]
      }
    ]
  },
  {
    id: 17,
    title: "17. Hostel Management",
    moduleId: "hostel",
    isMainModule: true,
    icon: "🏨",
    subMenus: [
      {
        title: "Hostel Features",
        href: "/admin/hostel",
        notes: ["Room", "Seat", "Allocation", "Maintenance", "Meal", "Visitor", "Fee", "Reports", "Audit Log"]
      },
      {
        title: "Due Rent",
        href: "/admin/hostel/due-rent",
        permission: "view_due_rent",
        badge: "dueRent"
      },
      {
        title: "Rent Invoices",
        href: "/admin/hostel/invoices",
        permission: "manage_payments"
      },
      {
        title: "Rent Settings",
        href: "/admin/hostel/rent-settings",
        permission: "configure_rent"
      },
      {
        title: "Rent Notifications",
        href: "/admin/hostel/notifications",
        permission: "send_reminders"
      }
    ]
  },
  {
    id: 18,
    title: "18. Transport Management",
    moduleId: "transport",
    isMainModule: true,
    icon: "🚌",
    subMenus: [
      {
        title: "Transport Features",
        href: "/admin/transport",
        notes: ["Bus", "Route", "Driver", "GPS", "Tracking", "Student Pass"]
      }
    ]
  },
  {
    id: 19,
    title: "19. Inventory Management",
    moduleId: "inventory",
    isMainModule: true,
    icon: "📦",
    subMenus: [
      {
        title: "Inventory Features",
        href: "/admin/inventory",
        notes: ["Items & Stock", "Stock Ledger", "Purchases", "Batches & Expiry", "Transfers", "Assets", "Stores", "Barcode", "Reports"]
      }
    ]
  },
  {
    id: 20,
    title: "20. Notice Management",
    moduleId: "notice",
    isMainModule: true,
    icon: "📢",
    subMenus: [
      {
        title: "Notice Features",
        href: "/admin/notice",
        notes: ["Notice", "Announcement", "Popup", "SMS", "Email", "Push Notification"]
      }
    ]
  },
  {
    id: 21,
    title: "21. Certificate Management",
    moduleId: "certificate",
    isMainModule: true,
    icon: "📜",
    subMenus: [
      {
        title: "Certificate Features",
        href: "/admin/certificate",
        notes: ["Certificate Template", "Digital Signature", "QR Verification", "Online Verification"]
      }
    ]
  },
  {
    id: 22,
    title: "22. Document Management",
    moduleId: "document",
    isMainModule: true,
    icon: "📁",
    subMenus: [
      {
        title: "Document Features",
        href: "/admin/document",
        notes: ["Student Document", "Teacher Document", "Department File", "Version Control", "Digital Archive"]
      }
    ]
  },
  {
    id: 23,
    title: "23. AI Analytics Engine",
    moduleId: "ai-analytics",
    isMainModule: true,
    icon: "🧠",
    subMenus: [
      {
        title: "AI Analytics Features",
        href: "/admin/ai-analytics",
        notes: ["Grade Prediction", "Risk Score", "Dropout Prediction", "Attendance Prediction", "Learning Gap", "Teacher Analytics", "Department Analytics", "University Analytics", "Recommendation", "Natural Language Query"]
      }
    ]
  },
  {
    id: 24,
    title: "24. Reports & BI Dashboard",
    moduleId: "reports",
    isMainModule: true,
    icon: "📈",
    subMenus: [
      {
        title: "Report Features",
        href: "/admin/reports",
        notes: ["Student Report", "Teacher Report", "Department Report", "Finance Report", "Attendance Report", "Admission Report", "Custom Report Builder", "Excel", "PDF", "CSV", "Power BI Integration"]
      }
    ]
  },
  {
    id: 25,
    title: "25. Notification Center",
    moduleId: "notification",
    isMainModule: true,
    icon: "🔔",
    subMenus: [
      {
        title: "Notification Features",
        href: "/admin/notification",
        notes: ["SMS", "Email", "WhatsApp", "Push Notification", "Telegram", "Scheduled Notification", "AI Alert", "(New) Voice Call Routing Alert"]
      }
    ]
  },
  {
    id: 26,
    title: "26. API & Integration",
    moduleId: "api",
    isMainModule: true,
    icon: "🔗",
    subMenus: [
      {
        title: "API Features",
        href: "/admin/api",
        notes: ["REST API", "GraphQL", "Webhook", "ERP Integration", "Payment Gateway", "SMS Gateway", "Google Workspace", "Microsoft 365", "(New) Voice Gateway Integration (Twilio/Vonage)"]
      }
    ]
  },
  {
    id: 27,
    title: "27. Security Center",
    moduleId: "settings",
    isMainModule: true,
    icon: "🔒",
    subMenus: [
      {
        title: "Security Features",
        href: "/admin/settings/security",
        notes: ["2FA", "Login History", "Device Tracking", "Audit Log", "IP Restriction", "Encryption", "Backup", "Recovery"]
      }
    ]
  },
  {
    id: 28,
    title: "28. System Monitoring",
    moduleId: "monitoring",
    isMainModule: true,
    icon: "👇",
    subMenus: [
      {
        title: "Monitoring Features",
        href: "/admin/monitoring",
        notes: ["Server Health", "Database Health", "Queue", "Cron Job", "Storage", "Cache", "API Monitoring", "Error Log"]
      }
    ]
  },
  {
    id: 29,
    title: "29. Dynamic Workflow Engine",
    moduleId: "workflow",
    isMainModule: true,
    icon: "⚡",
    subMenus: [
      {
        title: "Workflow Features",
        href: "/admin/workflow",
        notes: ["Approval Workflow", "Admission Workflow", "Leave Workflow", "Payment Workflow", "Certificate Workflow", "Automation Rules"]
      }
    ]
  },
  {
    id: 30,
    title: "30. Data Import / Export",
    moduleId: "import-export",
    isMainModule: true,
    icon: "🔄",
    subMenus: [
      {
        title: "Import/Export Features",
        href: "/admin/import-export",
        notes: ["Excel Import", "CSV Import", "Bulk Update", "Bulk Delete", "Bulk Promotion", "Bulk Assignment"]
      }
    ]
  },
  {
    id: 31,
    title: "31. Settings",
    moduleId: "settings",
    isMainModule: true,
    icon: "🛠️",
    subMenus: [
      {
        title: "Subscription & Modules",
        href: "/admin/settings/subscription",
        requiresRole: ["ADMIN", "SUPER_ADMIN"],
      },
      {
        title: "General Settings",
        href: "/admin/settings/general",
        notes: ["Institution Profile", "Academic Calendar", "Timezone", "Language", "Theme", "Branding", "Logo", "SMTP", "SMS Gateway", "Payment Gateway", "Backup"]
      }
    ]
  },
  {
    id: 32,
    title: "32. AI Voice Call & Message Assistant",
    moduleId: "voice-ai",
    isMainModule: true,
    icon: "📞",
    subMenus: [
      {
        title: "📞 Dual-Channel Call Support",
        href: "/admin/voice-ai/channels",
        notes: ["Phone Number (SIP / Twilio / Vonage Integration)", "Website Voice Widget (WebRTC Click-to-Call Button)"]
      },
      {
        title: "🤖 AI Conversational Engine",
        href: "/admin/voice-ai/engine",
        notes: ["AI Will Talk to the Caller (Natural Voice - Text-to-Speech)", "Understand Caller's Voice (Speech-to-Text / NLP)", "Custom AI Training (Institution specific rules & FAQ)"]
      },
      {
        title: "🚨 Auto Objection & Complaint Detection",
        href: "/admin/voice-ai/objection-detect",
        notes: ["If caller raises any objection/complaint, AI will detect it automatically", "Auto-generate a formal Notice/Ticket", "Auto-send that notice to the specific Teacher, HOD, or Admin responsible"]
      },
      {
        title: "🔔 Specific Person Routing & Notification",
        href: "/admin/voice-ai/routing",
        notes: ["If the caller wants to speak to a specific person (e.g., 'I want to talk to Mr. X')", "AI will send an instant notification to Mr. X (via SMS, Email, Push, or Panel Alert)", "Option for Call Transfer (if the person is available)", "Option for Call Back Scheduling (if the person is busy)"]
      },
      {
        title: "📊 Call Logs & Admin Control",
        href: "/admin/voice-ai/logs",
        notes: ["Call Recording & Transcription (Save as text)", "Call Analytics (Total calls, objection ratio, peak hours)", "AI Voice Customization (Male/Female voice, Tone, Language)"]
      }
    ]
  }
];


