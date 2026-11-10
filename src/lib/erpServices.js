






























import api from "./api";

// 1. Institutional Overview & Analytics
export const overviewService = {
  getKPIs: async () => {
    try {
      return await api.get("/overview/kpis");
    } catch {
      return {
        totalStudents: 1240,
        totalTeachers: 86,
        totalDepartments: 8,
        totalRevenue: 2450000,
        attendanceAverage: 94.6,
        currency: "BDT",
        systemName: "NextGen Institutional ERP System",
        activeModulesCount: 32
      };
    }
  }
};

// 2. Student Management & Admissions
export const studentService = {
  getAll: async () => {
    try {
      const res = await api.get("/students");
      return res.data || res;
    } catch {
      return [
        { id: "stu-001", studentIdNumber: "STD-2026-001", fullName: "Tanvir Ahmed", email: "tanvir@student.edu", department: "Computer Science", currentSemester: 4, cgpa: 3.82, status: "ACTIVE" },
        { id: "stu-002", studentIdNumber: "STD-2026-002", fullName: "Nusrat Jahan", email: "nusrat@student.edu", department: "Electrical Engineering", currentSemester: 2, cgpa: 3.65, status: "ACTIVE" }
      ];
    }
  },
  create: (data) => api.post("/admissions/enroll", data),
  getById: (id) => api.get(`/students/${id}`)
};

// 3. Teacher & Faculty Management
export const teacherService = {
  getAll: async () => {
    try {
      return await api.get("/teachers");
    } catch {
      return [
        { id: "tch-01", teacherIdNumber: "TCH-1001", fullName: "Dr. Rafiqul Islam", email: "rafiqul@faculty.edu", phone: "+8801711000001", department: "Computer Science", designation: "Professor", status: "ACTIVE" },
        { id: "tch-02", teacherIdNumber: "TCH-1002", fullName: "Farzana Yasmin", email: "farzana@faculty.edu", phone: "+8801711000002", department: "Business Administration", designation: "Associate Professor", status: "ACTIVE" }
      ];
    }
  },
  create: (data) => api.post("/teachers", data)
};

// 4. Academic & Curriculum
export const academicService = {
  getDepartments: async () => {
    try {
      return await api.get("/academic/departments");
    } catch {
      return [
        { id: "dept-1", code: "CSE", name: "Computer Science and Engineering", headOfDepartment: "Dr. Rafiqul Islam" },
        { id: "dept-2", code: "EEE", name: "Electrical and Electronic Engineering", headOfDepartment: "Dr. Kamal Hossain" }
      ];
    }
  },
  getCourses: async () => {
    try {
      return await api.get("/academic/courses");
    } catch {
      return [
        { id: "crs-1", code: "CSE-101", title: "Introduction to Computer Systems", credits: 3 },
        { id: "crs-2", code: "CSE-201", title: "Data Structures & Algorithms", credits: 4 }
      ];
    }
  }
};

// 5. Attendance Management
export const attendanceService = {
  getRecords: async () => {
    try {
      return await api.get("/attendance/records");
    } catch {
      return [
        { id: "att-1", date: "2026-11-01", courseCode: "CSE-401", department: "Computer Science", semester: 4, totalPresent: 42, totalAbsent: 3 }
      ];
    }
  },
  markAttendance: (data) => api.post("/attendance/bulk", data)
};

// 6. Examination & Grading
export const examService = {
  getSchedules: async () => {
    try {
      return await api.get("/examination/schedules");
    } catch {
      return [
        { id: "ex-1", examTitle: "Mid-Term Examination Fall 2026", courseCode: "CSE-401", date: "2026-11-15", timeSlot: "10:00 AM - 12:00 PM", roomNumber: "Room 402" }
      ];
    }
  }
};

// 8. Guardian Management & Credentials
export const guardianService = {
  getAll: async () => {
    try {
      return await api.get("/guardians");
    } catch {
      return [
        { id: "grd-01", fullName: "Abdul Karim", email: "abdul.karim@email.com", phone: "+8801819000001", relationship: "Father", portalUsername: "guardian.abdul", status: "ACTIVE" },
        { id: "grd-02", fullName: "Fatema Begum", email: "fatema.begum@email.com", phone: "+8801819000002", relationship: "Mother", portalUsername: "guardian.fatema", status: "ACTIVE" }
      ];
    }
  },
  provisionCredentials: (data) => api.post("/guardians/provision", data)
};

// 10. System Configuration & RBAC (All 32 Modules)
export const systemService = {
  getModules: async () => {
    try {
      const res = await api.get("/system/modules");
      return res.data?.modules || res.modules || [];
    } catch {
      return [];
    }
  },
  getSettingsSection: (section) => api.get(`/settings/${section}?full=1`),
  saveSettingsSection: (section, data) => api.put(`/settings/${section}`, data),
  deleteTable: (slug) => api.delete(`/system/tables/${slug}`),
  getSettings: async () => {
    try {
      return await api.get("/settings/general");
    } catch {
      return {
        systemName: "NextGen Institutional ERP System",
        supportEmail: "support@institution.edu",
        currency: "BDT",
        timezone: "Asia/Dhaka (GMT+6)",
        maintenanceMode: false
      };
    }
  },
  updateSettings: (data) => api.put("/settings/general", data),
  getRoles: async () => {
    try {
      return await api.get("/system/roles");
    } catch {
      return [];
    }
  },
  createRole: (data) => api.post("/system/roles", data),
  updateRole: (id, data) => api.put(`/system/roles/${id}`, data),

  // Dynamic Form Builder APIs
  getForms: async () => {
    try {
      const res = await api.get("/system/forms");
      return res.data || res || [];
    } catch {
      return [];
    }
  },
  saveForm: (data) => api.post("/system/forms", data),
  submitForm: (slug, payload) => api.post(`/system/forms/${slug}/submissions`, { payload }),

  // Dynamic Table Builder APIs
  getTables: async () => {
    try {
      const res = await api.get("/system/tables");
      return res.data || res || [];
    } catch {
      return [];
    }
  },
  saveTableSchema: (data) => api.post("/system/tables/schema", data),

  // Academic Grading Configuration APIs
  getGradingConfig: async () => {
    try {
      const res = await api.get("/system/grading-config");
      return res.data || res;
    } catch {
      return null;
    }
  },
  updateGradingConfig: (data) => api.put("/system/grading-config", data)
};

// 11. AI Gateway & Predictions (via Core ERP Hub)
export const aiService = {
  predictAcademicRisk: (data) => api.post("/ai/predict/risk", data),
  getStudentPrediction: (studentId) => api.get(`/ai/students/${studentId}/prediction`),
  getRecommendations: (studentId) => api.get(`/ai/students/${studentId}/recommendations`)
};

// 12. Voice & Message Assistant (via Core ERP Hub)
export const voiceService = {
  getSessions: () => api.get("/voice/sessions"),
  getTranscripts: (sessionId) => api.get(`/voice/transcripts/${sessionId}`)
};

// Hostel Management
const hostelQuery = (filters = {}) => {
  const entries = Object.entries(filters).filter(([, value]) => value);
  return entries.length > 0 ? `?${new URLSearchParams(entries)}` : "";
};

export const hostelService = {
  getSummary: () => api.get("/hostel/summary"),

  getRooms: () => api.get("/hostel/rooms"),
  getRoomDetail: (id) => api.get(`/hostel/rooms/${id}`),
  createRoom: (room) => api.post("/hostel/rooms", room),
  bulkCreateRooms: (rooms) => api.post("/hostel/rooms/bulk", { rooms }),
  updateRoom: (id, room) => api.put(`/hostel/rooms/${id}`, room),
  setRoomStatus: (id, status) => api.post(`/hostel/rooms/${id}/status`, { status }),
  deleteRoom: (id) => api.delete(`/hostel/rooms/${id}`),

  getSeats: () => api.get("/hostel/seats"),
  getSeatRent: (id) => api.get(`/hostel/seats/${id}/rent`),
  setSeatRent: (id, rent) => api.put(`/hostel/seats/${id}/rent`, rent),
  resendAllocationEmail: (id) => api.post(`/hostel/allocations/${id}/confirmation`, {}),
  updateSeat: (id, seat) => api.put(`/hostel/seats/${id}`, seat),

  getAllocations: () => api.get("/hostel/allocations"),
  createAllocation: (allocation) => api.post("/hostel/allocations", allocation),
  updateAllocation: (id, allocation) => api.put(`/hostel/allocations/${id}`, allocation),
  assignSeat: (id, details) => api.post(`/hostel/allocations/${id}/assign`, details),
  rejectAllocation: (id, reason) => api.post(`/hostel/allocations/${id}/reject`, { reason }),
  vacateAllocation: (id, endDate) => api.post(`/hostel/allocations/${id}/vacate`, { endDate }),
  deleteAllocation: (id) => api.delete(`/hostel/allocations/${id}`),

  getTickets: () => api.get("/hostel/tickets"),
  createTicket: (ticket) => api.post("/hostel/tickets", ticket),
  updateTicket: (id, ticket) => api.put(`/hostel/tickets/${id}`, ticket),
  deleteTicket: (id) => api.delete(`/hostel/tickets/${id}`),

  getAudit: (limit) => api.get(`/hostel/audit?limit=${limit}`),

  getMyPermissions: () => api.get("/hostel/me/permissions"),

  getAllocation: (id) => api.get(`/hostel/allocations/${id}`),
  getDocuments: (allocationId) => api.get(`/hostel/allocations/${allocationId}/documents`),
  uploadDocument: (allocationId, file) => api.post(`/hostel/allocations/${allocationId}/documents`, file),
  getDocument: (id) => api.get(`/hostel/documents/${id}`),

  getRentConfig: () => api.get("/hostel/rent/config"),
  updateRentSettings: (settings) => api.put("/hostel/rent/settings", settings),
  setBuildingDueDay: (id, dueDay) => api.put(`/hostel/rent/buildings/${id}`, { dueDay }),
  setSeatDueDay: (id, dueDay) => api.put(`/hostel/rent/seats/${id}`, { dueDay }),
  saveTemplate: (scenario, template) => api.put(`/hostel/rent/templates/${scenario}`, template),
  runRentCycle: () => api.post("/hostel/jobs/run", {}),

  getInvoices: (filters) => api.get(`/hostel/invoices${hostelQuery(filters || {})}`),
  getInvoice: (id) => api.get(`/hostel/invoices/${id}`),
  getInvoicePdf: (id) => api.get(`/hostel/invoices/${id}/pdf`),
  emailInvoice: (id) => api.post(`/hostel/invoices/${id}/email`, {}),

  getMeals: () => api.get("/hostel/meals"),
  getMeal: (id) => api.get(`/hostel/meals/${id}`),
  getMealImage: (id) => api.get(`/hostel/meals/${id}/image`),
  getRefunds: (status) => api.get(`/hostel/refunds${status ? `?status=${status}` : ""}`),
  payRefund: (id, details) => api.post(`/hostel/refunds/${id}/pay`, details),
  getPortalAccount: (allocationId) => api.get(`/hostel/allocations/${allocationId}/account`),
  createPortalAccount: (allocationId) => api.post(`/hostel/allocations/${allocationId}/account`, {}),
  createMeal: (meal) => api.post("/hostel/meals", meal),
  updateMeal: (id, meal) => api.put(`/hostel/meals/${id}`, meal),
  publishMeal: (id) => api.post(`/hostel/meals/${id}/publish`, {}),
  cancelMeal: (id, reason) => api.post(`/hostel/meals/${id}/cancel`, { reason }),
  bookMeal: (id, booking) => api.post(`/hostel/meals/${id}/bookings`, booking),
  changeMealBooking: (id, quantity) => api.put(`/hostel/meal-bookings/${id}`, { quantity }),
  cancelMealBooking: (id) => api.post(`/hostel/meal-bookings/${id}/cancel`, {}),
  markMealCollected: (id) => api.post(`/hostel/meal-bookings/${id}/collected`, {}),
  getMemberMeals: (allocationId) => api.get(`/hostel/meals/members/${allocationId}`),
  getMealDues: () => api.get("/hostel/meals/dues"),
  remindMealDues: (allocationIds) => api.post("/hostel/meals/dues/remind", { allocationIds }),

  getVisitors: () => api.get("/hostel/visitors"),
  getVisitor: (id) => api.get(`/hostel/visitors/${id}`),
  findVisitorTicket: (ticket) => api.get(`/hostel/visitors/ticket/${encodeURIComponent(ticket)}`),
  createVisitor: (visitor) => api.post("/hostel/visitors", visitor),
  checkInVisitor: (id) => api.post(`/hostel/visitors/${id}/check-in`, {}),
  checkOutVisitor: (id) => api.post(`/hostel/visitors/${id}/check-out`, {}),
  setVisitorStatus: (id, status, reason) => api.post(`/hostel/visitors/${id}/status`, { status, reason }),
  getVisitorDocument: (id) => api.get(`/hostel/visitor-documents/${id}`),

  getFees: () => api.get("/hostel/fees"),
  createFee: (fee) => api.post("/hostel/fees", fee),
  updateFee: (id, fee) => api.put(`/hostel/fees/${id}`, fee),
  assignFee: (assignment) => api.post("/hostel/fee-assignments", assignment),
  stopFeeAssignment: (id, reason) => api.post(`/hostel/fee-assignments/${id}/stop`, { reason }),
  getFeeGroups: () => api.get("/hostel/fee-groups"),
  createFeeGroup: (group) => api.post("/hostel/fee-groups", group),
  updateFeeGroup: (id, group) => api.put(`/hostel/fee-groups/${id}`, group),
  deleteFeeGroup: (id) => api.delete(`/hostel/fee-groups/${id}`),
  generateInvoices: () => api.post("/hostel/invoices/generate", {}),
  adjustInvoice: (id, adjustment) => api.post(`/hostel/invoices/${id}/adjustments`, adjustment),
  recordPayment: (invoiceId, payment) => api.post(`/hostel/invoices/${invoiceId}/payments`, payment),
  reversePayment: (id, reason) => api.post(`/hostel/payments/${id}/reverse`, { reason }),

  getLedger: (allocationId) => api.get(`/hostel/ledger/${allocationId}`),
  getDueRentCount: () => api.get("/hostel/due-rent/count"),
  getDueRent: (filters) => api.get(`/hostel/due-rent${hostelQuery(filters)}`),
  exportDueRent: (filters) => api.get(`/hostel/due-rent/export${hostelQuery(filters)}`),

  sendReminder: (allocationId) => api.post(`/hostel/notifications/remind/${allocationId}`, {}),
  getNotifications: () => api.get("/hostel/notifications"),
  retryNotification: (id) => api.post(`/hostel/notifications/${id}/retry`, {}),

  getGatewayConfig: () => api.get("/hostel/gateway/config"),
  saveGatewayConfig: (config) => api.put("/hostel/gateway/config", config),
  testGateway: () => api.post("/hostel/gateway/test", {}),
  getGatewayTransactions: () => api.get("/hostel/gateway/transactions"),
  verifyGatewayTransaction: (id) => api.post(`/hostel/gateway/transactions/${id}/verify`, {}),
  getPaymentMethods: () => api.get("/hostel/payment-methods"),
  setPaymentMethod: (method, enabled) => api.put(`/hostel/payment-methods/${method}`, { enabled }),
  createPaymentLink: (invoiceId) => api.post(`/hostel/invoices/${invoiceId}/payment-link`, {}),
  getReceiptPdf: (paymentId) => api.get(`/hostel/payments/${paymentId}/receipt-pdf`),
  emailReceipt: (paymentId) => api.post(`/hostel/payments/${paymentId}/email-receipt`, {}),
  getRentDashboard: (filters) => api.get(`/hostel/rent/dashboard${hostelQuery(filters)}`),
  getJobs: () => api.get("/hostel/jobs"),
  sendTestEmail: (to) => api.post("/hostel/email/test", { to })
};
