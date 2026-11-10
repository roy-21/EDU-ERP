# System Architecture Document

## 1. Architectural Topology

The system uses a **Polyglot Monorepo** pattern with four autonomous runtime applications.

```
institution-erp/
├── apps/
│   ├── web/              # Next.js 16 Frontend (Turbopack, React 19, Tailwind CSS v4)
│   ├── core-api/         # Node.js/TypeScript Core ERP API (Express/NestJS, Prisma, PostgreSQL)
│   ├── ai-api/           # Python FastAPI AI Service (SQLAlchemy, pgvector, scikit-learn, PyTorch)
│   └── voice-api/        # Python FastAPI Voice Service (WebSockets, STT/TTS, Telephony, PostgreSQL)
├── packages/
│   ├── shared-types/     # Shared DTOs and TypeScript interfaces
│   ├── api-contracts/    # OpenAPI / JSON Schemas defining inter-service boundaries
│   └── shared-config/    # Shared linting, environment schema, and constants
├── infrastructure/
│   ├── docker/           # Dockerfiles for each service
│   ├── nginx/            # Reverse proxy configuration
│   └── scripts/          # Database seeding and migration automation
└── docs/                 # Architecture, ERD, Security, and Testing specifications
```

---

## 2. Service Boundaries & Responsibilities

### 2.1 Frontend Application (`apps/web`)
- **Port:** 3000
- **Runtime:** Node.js 20+
- **Framework:** Next.js 16 (App Router + Turbopack)
- **Role:** Pure client and server-side rendering for presentation logic. Communicates with Core ERP via `/api/v1/` endpoints. Direct database connections are strictly forbidden.

### 2.2 Core ERP Backend (`apps/core-api`)
- **Port:** 4000
- **Runtime:** Node.js / TypeScript
- **Framework:** Express / NestJS Modular Monolith
- **Database:** PostgreSQL 16 (Owned database: `erp_db`)
- **Role:** Central transactional authority. Manages Authentication, RBAC, Institution setup, Academic life cycle, Examinations, Dynamic Forms/Tables, and Student/Teacher records.
- **Outbound Integrations:** Calls AI Backend (`http://localhost:8000/api/v1/`) for prediction batching and RAG ingestion. Receives ticket creation webhooks from Voice Backend.

### 2.3 AI Backend (`apps/ai-api`)
- **Port:** 8000
- **Runtime:** Python 3.11+
- **Framework:** FastAPI + Pydantic v2
- **Database:** PostgreSQL 16 with `pgvector` extension (Owned database: `ai_db`)
- **Cache / Task Queue:** Redis + Background Workers
- **Role:** Independent machine learning, natural language processing, and semantic search.
  - Predicts Student Dropout Risk, Course Failure, Attendance Risk, and GPA trajectories.
  - Hosts Course-grounded RAG with strict tenant filtering and verifiable citations.
  - Classifies Student Applications and Objections.
  - Manages AI Model Registry and performance metrics.

### 2.4 Voice Assistant Backend (`apps/voice-api`)
- **Port:** 8050
- **Runtime:** Python 3.11+
- **Framework:** FastAPI + WebSockets + AsyncIO
- **Database:** PostgreSQL 16 (Owned database: `voice_db`)
- **Role:** Independent real-time telephony and web audio engine.
  - Handles dual channels: Phone calls (SIP/Twilio/Vonage) and WebRTC browser calls.
  - Real-time Speech-to-Text (STT) and Text-to-Speech (TTS).
  - Conversation state management, NLP intent detection, and objection identification.
  - Auto-files tickets in Core ERP via REST API upon complaint/objection detection.
  - Dispatches SMS/Email alerts to designated faculty/admins when specific individuals are requested.

---

## 3. Communication Matrix

| Source Service | Target Service | Protocol | Authentication | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Web Frontend** | Core ERP | HTTPS / REST | JWT Bearer Token | User transactions & dashboard queries |
| **Core ERP** | AI Backend | HTTP / REST | HMAC / Service Token | Request student predictions, batch scoring |
| **Core ERP** | Voice Backend | HTTP / REST | HMAC / Service Token | Query call history, sync faculty availability |
| **Voice Backend** | Core ERP | HTTP / REST | HMAC / Service Token | Auto-generate objection tickets & notifications |
| **Voice Backend** | AI Backend | HTTP / REST | HMAC / Service Token | Semantic FAQ & intent embedding matching |

