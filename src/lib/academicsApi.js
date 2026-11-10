import api from "./api";

const qs = (params) => {
  const search = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const text = search.toString();
  return text ? `?${text}` : "";
};

// Departments, programs, sessions, sections, courses and classes share one shape.
export const structureApi = {
  list: (kind) => api.get(`/academics/${kind}`),
  create: (kind, body) => api.post(`/academics/${kind}`, body),
  update: (kind, id, body) => api.put(`/academics/${kind}/${id}`, body),
  remove: (kind, id) => api.delete(`/academics/${kind}/${id}`),
};

export const teachersApi = {
  list: (filters) => api.get(`/teachers${qs(filters)}`),
  create: (body) => api.post("/teachers", body),
  update: (id, body) => api.put(`/teachers/${id}`, body),
  createAccount: (id) => api.post(`/teachers/${id}/account`, {}),
};

export const studentsApi = {
  list: (filters) => api.get(`/students${qs(filters)}`),
  get: (id) => api.get(`/students/${encodeURIComponent(id)}`),
  create: (body) => api.post("/students", body),
  update: (id, body) => api.put(`/students/${id}`, body),
  setStatus: (id, status, reason) => api.post(`/students/${id}/status`, { status, reason }),
  move: (studentIds, toSectionId) => api.post("/students/move", { studentIds, toSectionId }),
  createAccount: (id) => api.post(`/students/${id}/account`, {}),
  createGuardianAccount: (id) => api.post(`/students/${id}/guardian-account`, {}),
};

export const teachingApi = {
  classes: (purpose) => api.get(`/teaching/classes${qs({ for: purpose })}`),
  attendanceSheet: (classId, date, slot) => api.get(`/attendance/classes/${classId}/sheet${qs({ date, slot })}`),
  saveAttendance: (classId, body) => api.post(`/attendance/classes/${classId}`, body),
  attendanceReport: (classId) => api.get(`/attendance/classes/${classId}/report`),
  exams: (sessionId) => api.get(`/exams${qs({ sessionId })}`),
  createExam: (body) => api.post("/exams", body),
  updateExam: (id, body) => api.put(`/exams/${id}`, body),
  deleteExam: (id) => api.delete(`/exams/${id}`),
  assessments: (classId) => api.get(`/exams/classes/${classId}/assessments`),
  marksSheet: (assessmentId) => api.get(`/exams/assessments/${assessmentId}`),
  saveMarks: (assessmentId, body) => api.put(`/exams/assessments/${assessmentId}/marks`, body),
  lock: (assessmentId) => api.post(`/exams/assessments/${assessmentId}/lock`, {}),
  unlock: (assessmentId) => api.post(`/exams/assessments/${assessmentId}/unlock`, {}),
  results: (classId) => api.get(`/exams/classes/${classId}/results`),
  publish: (classId) => api.post(`/exams/classes/${classId}/publish`, {}),
  withdraw: (classId) => api.post(`/exams/classes/${classId}/withdraw`, {}),
};
