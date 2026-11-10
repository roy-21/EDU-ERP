# Implementation Roadmap — Execution Plan

## Structured Phased Execution

```
[Phase 0: Repository Audit] ───► [Phase 1: Architecture & Specs] ───► [Phase 2: Monorepo Foundation]
                                                                                │
                                                                                ▼
[Phase 5: AI Engine] ◄─── [Phase 4: AI Backend Setup] ◄─── [Phase 3: Core ERP Backend]
        │
        ▼
[Phase 6: Voice Assistant] ───► [Phase 7: End-to-End Integration] ───► [Phase 8: Quality & DevOps]
```

---

### Phase 0: Codebase Analysis (Completed)
- [x] Full scan of 69 source files in `src/`.
- [x] Review of Next.js 16 breaking changes and Turbopack conventions.
- [x] Verified working frontend on local development server.

### Phase 1: Architecture, Planning & Contracts (Completed)
- [x] `IMPLEMENTATION_STATUS.md` & `ARCHITECTURE_DECISIONS.md`.
- [x] `docs/system-architecture.md`, `database-design.md`, `erd.md`, `api-contracts.md`.
- [x] `docs/rbac-matrix.md`, `ai-architecture.md`, `voice-architecture.md`.

### Phase 2: Foundation & Independent Services Scaffolding (Current Target)
- [ ] Establish monorepo structure without breaking existing frontend.
- [ ] Create Core ERP Backend (`apps/core-api`) with Express/TypeScript, database schema & JWT auth.
- [ ] Create AI Backend (`apps/ai-api`) with FastAPI, SQLAlchemy models & health check.
- [ ] Create Voice Backend (`apps/voice-api`) with FastAPI, session state & Core ERP client.
- [ ] Configure `docker-compose.yml` for unified local execution.

### Phase 3: Core ERP Business Logic & Frontend Live Integration
- [ ] Dynamic Form Builder backend schema & submission persistence.
- [ ] Dynamic Table Builder backend CRUD generator.
- [ ] Institution, Campus, Faculty, Department, Batch, Course APIs.
- [ ] Attendance recording & summary APIs.
- [ ] Examination Marks Entry & Seat Planning APIs.
- [ ] Objections & Ticketing system.

### Phase 4 & 5: AI Backend Implementation
- [ ] Scikit-learn Student Risk & GPA inference models with serialized weights.
- [ ] PostgreSQL pgvector RAG ingestion & grounded query pipeline with citation enforcement.
- [ ] Objection NLP classifier.

### Phase 6: Autonomous Voice Assistant Backend
- [ ] Call session lifecycle state machine.
- [ ] Audio STT/TTS pipeline abstraction.
- [ ] Auto-ticketing integration connecting Voice -> Core ERP `/api/v1/objections`.

### Phase 7 & 8: End-to-End Verification & Documentation
- [ ] Automated integration test suite.
- [ ] Verifying 4 independent processes run and deploy separately.
- [ ] Final deployment guide and status update.

