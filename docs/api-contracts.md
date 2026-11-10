# API Contracts & Inter-Service Specifications

All APIs adhere to REST conventions, are versioned (`/api/v1/`), and enforce standardized JSON responses.

## Standard Response Envelope

```json
{
  "success": true,
  "statusCode": 200,
  "data": {},
  "error": null,
  "meta": {
    "timestamp": "2026-11-01T02:00:00Z",
    "correlationId": "req_8f192b1a-29fe-4435"
  }
}
```

---

## 1. Core ERP Backend APIs (`http://localhost:4000/api/v1`)

### Authentication & Users
- `POST /auth/login`: `{ email, password, institutionCode }` -> `{ token, refreshToken, user }`
- `POST /auth/refresh`: `{ refreshToken }` -> `{ token }`
- `GET /auth/me`: Headers: `Authorization: Bearer <token>` -> User profile & permissions
- `GET /users`: Query: `institutionId, role, search, page, limit`

### Academic Structure
- `GET /institutions/:id`: Get institution profile & settings
- `GET /campuses`: Query: `institutionId`
- `POST /campuses`: Create new campus
- `GET /faculties`: List faculties
- `GET /departments`: List departments
- `GET /programs`: List academic programs
- `GET /courses`: List courses

### Student & Teacher Lifecycle
- `GET /students`: Query: `institutionId, departmentId, batchId, status`
- `GET /students/:id`: Get full student profile, transcript & attendance summary
- `POST /students`: Enroll new student
- `GET /teachers`: List faculty members & workload

### Dynamic Forms & Dynamic Tables
- `GET /system/forms`: List all configured dynamic forms
- `POST /system/forms`: Create or update dynamic form schema
- `GET /system/forms/:slug`: Get form definition by slug
- `POST /system/forms/:slug/submissions`: Save end-user form response
- `POST /system/tables/schema`: Save custom table schema definition

### Objections & Notices (Invoked by Web & Voice Backend)
- `POST /objections`:
  ```json
  {
    "institutionId": "uuid",
    "studentId": "uuid",
    "source": "AI_VOICE_CALL",
    "category": "GRADE_DISPUTE",
    "severity": "HIGH",
    "title": "Exam Grade Challenge from Inbound Call",
    "description": "Caller disputing Math 101 Midterm grade."
  }
  ```
- `GET /objections`: List tracked institutional tickets & resolution status
- `PATCH /objections/:id/status`: Update status (`IN_INVESTIGATION`, `RESOLVED`)

---

## 2. AI Backend APIs (`http://localhost:8000/api/v1`)

Headers required: `X-Service-Token: <AI_SERVICE_SECRET>`, `X-Institution-Id: <UUID>`

### Predictive Analytics
- `POST /ai/predict/student-risk`:
  ```json
  {
    "institutionId": "uuid",
    "studentId": "uuid",
    "features": {
      "attendanceRate": 0.62,
      "midtermAvg": 48.5,
      "assignmentSubmissionRate": 0.50,
      "previousCgpa": 2.45,
      "feeDefaultDays": 15
    }
  }
  ```
  **Response:**
  ```json
  {
    "studentId": "uuid",
    "riskScore": 0.784,
    "riskLevel": "HIGH",
    "primaryFactors": ["Low attendance (<65%)", "Declining midterm marks"],
    "modelVersion": "student_risk_v1"
  }
  ```
- `POST /ai/predict/gpa`: Predict end-of-semester GPA with confidence interval.

### RAG Course Learning Assistant
- `POST /ai/rag/documents/upload`: Multipart upload with `courseId`, `institutionId`. Triggers chunking & vector embedding.
- `POST /ai/rag/query`:
  ```json
  {
    "institutionId": "uuid",
    "courseId": "uuid",
    "query": "What is the difference between Dijkstra and Bellman-Ford algorithm?"
  }
  ```
  **Response:**
  ```json
  {
    "answer": "Dijkstra is a greedy algorithm with O((V+E)logV) complexity that fails with negative edge weights. Bellman-Ford handles negative weights...",
    "citations": [
      {
        "documentName": "Algorithm_Lecture_07.pdf",
        "pageNumber": 14,
        "similarity": 0.89
      }
    ]
  }
  ```

---

## 3. Voice Assistant Backend APIs (`http://localhost:8050/api/v1`)

- `POST /voice/webhook/inbound`: Receives webhook from SIP gateway or Twilio.
- `WSS /voice/ws/call-stream`: Real-time bi-directional audio stream for WebRTC & SIP.
- `POST /voice/simulate/call`: Diagnostic test endpoint to simulate an inbound parent or student call, perform NLP objection classification, and test Core ERP auto-ticketing.
- `GET /voice/calls/history`: Query call logs and transcript records.

