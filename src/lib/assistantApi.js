import api from "./api";

const qs = (params) => {
  const search = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const text = search.toString();
  return text ? `?${text}` : "";
};

// The AI knowledge assistant. The browser only ever talks to the Core ERP; the Core ERP
// talks to the AI Backend.
export const assistantApi = {
  me: () => api.get("/assistant/me"),
  ask: (question) => api.post("/assistant/ask", { question }),
  myQuestions: () => api.get("/assistant/questions/mine"),
  feedback: (id, feedback, note) => api.post(`/assistant/questions/${id}/feedback`, { feedback, note }),
  assigned: () => api.get("/assistant/assigned"),
  answerAssigned: (id, answer) => api.post(`/assistant/assigned/${id}/answer`, { answer }),

  voiceStatus: () => api.get("/assistant/voice/status"),
  startCall: () => api.post("/assistant/voice/calls", {}),
  callTurn: (id, audioBase64, language) => api.post(`/assistant/voice/calls/${id}/turn`, { audioBase64, language }),
  endCall: (id) => api.post(`/assistant/voice/calls/${id}/end`, {}),
  myCalls: () => api.get("/assistant/voice/calls/mine"),
  calls: () => api.get("/assistant/voice/calls"),
  callTranscript: (id) => api.get(`/assistant/voice/calls/${id}`),

  status: () => api.get("/assistant/status"),
  analytics: () => api.get("/assistant/analytics"),
  questions: (filters) => api.get(`/assistant/questions${qs(filters)}`),

  documents: () => api.get("/assistant/documents"),
  upload: (body) => api.post("/assistant/documents", body),
  replace: (id, body) => api.put(`/assistant/documents/${id}`, body),
  retryDocument: (id) => api.post(`/assistant/documents/${id}/retry`, {}),
  removeDocument: (id) => api.delete(`/assistant/documents/${id}`),
  preview: (id) => api.get(`/assistant/documents/${id}/preview`),

  knowledge: (status) => api.get(`/assistant/knowledge${qs({ status })}`),
  addKnowledge: (body) => api.post("/assistant/knowledge", body),
  retireKnowledge: (id) => api.post(`/assistant/knowledge/${id}/retire`, {}),

  reviews: (status) => api.get(`/assistant/reviews${qs({ status })}`),
  saveReview: (id, body) => api.put(`/assistant/reviews/${id}`, body),
  approve: (id, body) => api.post(`/assistant/reviews/${id}/approve`, body),
  reject: (id, note) => api.post(`/assistant/reviews/${id}/reject`, { note }),

  escalations: (status) => api.get(`/assistant/escalations${qs({ status })}`),
  answerEscalation: (id, body) => api.post(`/assistant/escalations/${id}/answer`, body),
  resend: (id, contactId) => api.post(`/assistant/escalations/${id}/resend`, { contactId }),
  closeEscalation: (id, note) => api.post(`/assistant/escalations/${id}/close`, { note }),

  contacts: () => api.get("/assistant/contacts"),
  createContact: (body) => api.post("/assistant/contacts", body),
  updateContact: (id, body) => api.put(`/assistant/contacts/${id}`, body),
  removeContact: (id) => api.delete(`/assistant/contacts/${id}`),
  staff: (search) => api.get(`/assistant/staff${qs({ search })}`),
  settings: () => api.get("/assistant/settings"),
  saveSettings: (body) => api.put("/assistant/settings", body),

  // The responsible person's private link. No sign-in.
  publicView: (token) => api.get(`/public/assistant/answer/${encodeURIComponent(token)}`),
  publicAnswer: (token, body) => api.post(`/public/assistant/answer/${encodeURIComponent(token)}`, body),
};

// Reads a chosen file as base64 for upload.
export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
