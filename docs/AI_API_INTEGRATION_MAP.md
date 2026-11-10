# Complete AI & Voice API Integration Map

This document defines the strict communication routing across all four application tiers:

```
[Browser / Frontend (3000)]
         │
         │ (HTTP / JWT Bearer)
         ▼
[Core ERP Modular Backend (4000)]
   ├── /api/v1/ai/*    ──────────► (HTTP / X-Service-Token) ──► [AI Backend (8000)]
   └── /api/v1/voice/* ──────────► (HTTP / X-Service-Token) ──► [Voice Backend (8050)]
                                                                       │
                                  (Auto-Ticketing HTTP POST)           │
                       ◄───────────────────────────────────────────────┘
```

---

## 1. Gateway Route Mapping

| Frontend Trigger / UI Page | Core ERP Route | AI / Voice Service Endpoint | Request Payload Summary | Response Summary |
| :--- | :--- | :--- | :--- | :--- |
| **`examination/ai-prediction`** | `POST /api/v1/ai/predict/student-risk` | `POST http://localhost:8000/api/v1/ai/predict/student-risk` | `{ studentId, features: { attendanceRate, midtermAvg, ... } }` | `{ riskScore, riskLevel, primaryFactors, modelVersion, recommendations }` |
| **`examination/ai-prediction`** | `POST /api/v1/ai/predict/gpa` | `POST http://localhost:8000/api/v1/ai/predict/gpa` | `{ studentId, currentCgpa, credits, quizAvg, midterm }` | `{ predictedCgpa, confidenceInterval, projectedChange }` |
| **`classroom/ai-assistant`** | `POST /api/v1/ai/rag/query` | `POST http://localhost:8000/api/v1/ai/rag/query` | `{ courseId, query }` | `{ answer, citations: [{ documentName, pageNumber, similarity, snippet }] }` |
| **`voice-ai/logs`** | `GET /api/v1/voice/calls` | `GET http://localhost:8050/api/v1/voice/calls/history` | `Query: institutionId, limit` | `[{ sessionId, caller, channel, objectionDetected, erpTicketId, duration }]` |
| **`voice-ai/logs`** | `POST /api/v1/voice/simulate` | `POST http://localhost:8050/api/v1/voice/simulate/call` | `{ callerPhone, messages: [...] }` | Full transcript + objection detection + auto-generated ERP ticket ID |
| **Voice Backend Autonomous Trigger** | N/A (Internal Voice Event) | Calls Core ERP `POST /api/v1/objections` | `{ source: 'AI_VOICE_CALL', category, severity, title, description, callSessionId }` | `{ id: 'ticket_uuid', status: 'OPEN' }` |

---

## 2. Authentication Protocol

1. **Client to Core ERP:** `Authorization: Bearer <JWT_TOKEN>`
   - Core ERP decodes user identity and extracts `institutionId` and `role`.
2. **Core ERP to AI Backend:**
   - Header: `X-Service-Token: ai_service_internal_secret_key_9901`
   - Header: `X-Institution-Id: <institutionId>`
   - Payload is enriched with server-validated tenant IDs.
3. **Voice Backend to Core ERP:**
   - Header: `X-Service-Token: voice_service_internal_secret_key_8802`
   - Header: `X-Institution-Id: <institutionId>`

