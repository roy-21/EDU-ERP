# ARCHITECTURE DECISIONS RECORD (ADR)

## Project: AI-Powered Multi-Institution Enterprise ERP System
**Repository:** `EDU-ADMIN-main`  
**Date:** 2026-11-01

---

### ADR-001: Monorepo Structure with 4 Isolated Autonomous Applications
- **Context:** The system requires a high-performance Next.js Frontend, a reliable business Core ERP, a specialized ML/RAG AI service in Python, and an independent real-time Voice Assistant.
- **Alternatives Considered:** 
  1. Monolithic single-language application (all in Node.js or all in Python).
  2. Complete Microservices (each ERP module as a separate container/service).
  3. Polyglot Monorepo: Frontend (Next.js), Core ERP (Modular Monolith Node/NestJS), AI Service (FastAPI), Voice Service (FastAPI).
- **Decision:** Selected Option 3 (Polyglot Monorepo with 4 explicit service boundaries).
- **Justification:** Avoids premature microservice sprawl for 32 ERP modules while isolating heavy Python ML/Vector/NLP libraries and real-time audio telephony pipelines from core transaction processing.
- **Consequences:** Each application maintains its own `package.json` or `pyproject.toml`/`requirements.txt`, its own database migrations, and independent Dockerfile.

---

### ADR-002: Strict Data Ownership and Zero Cross-Database Writes
- **Context:** If the AI or Voice backends write directly into the Core ERP database, schema coupling causes cascading failures and breaks multi-institution audit trails.
- **Decision:** 
  - **Core ERP DB** owns Users, Students, Teachers, Courses, Attendance, Finance, Exams.
  - **AI Backend DB** owns Model Registry, Training Runs, Predictions, Embeddings (pgvector), Document Chunks, Recommendation logs.
  - **Voice Backend DB** owns Call Sessions, Audio Metadata, Transcripts, Intent Logs.
- **Cross-Service Communication:** Handled strictly through versioned REST APIs (`/api/v1/`) with HMAC/Bearer service-to-service authentication. No cross-database joins or writes.
- **Consequences:** Ensures clean operational boundaries; services can be upgraded, migrated, or scaled independently.

---

### ADR-003: Core ERP Architecture — Modular Monolith
- **Context:** ERP business logic spans 32 interconnected modules (e.g., student attendance directly influences exam eligibility, which impacts grade tabulation, fee clearance, and promotion).
- **Alternatives Considered:** 32 individual microservices vs Modular Monolith.
- **Decision:** Modular Monolith in Node.js/NestJS/Express with domain modules (`modules/system`, `modules/academic`, `modules/student`, `modules/attendance`, `modules/exam`, `modules/finance`, etc.).
- **Justification:** ACID transactional integrity across enrollment, grading, and billing; zero network latency between tightly-coupled domain logic; single operational deployment for ERP transactions.

---

### ADR-004: Vector Search and Document Retrieval Engine
- **Context:** Course-specific and institutional RAG assistant requires persistent, scalable vector indexing with strict tenant isolation.
- **Decision:** PostgreSQL with `pgvector` extension for the AI Backend.
- **Justification:** Simplifies infrastructure (single managed database instance for relational metadata + embeddings), supports row-level security and strict `institution_id` filtering during similarity search, preventing cross-tenant leakage.

---

### ADR-005: Voice Assistant Autonomy and Decoupled Telephony
- **Context:** Voice assistant handles inbound phone calls (SIP/Twilio/Vonage) and web-based WebRTC calls, requiring low-latency STT, NLP intent parsing, TTS, and auto-ticketing.
- **Decision:** Independent Python FastAPI application (`apps/voice-api`) with its own event loop, session manager, and API client for Core ERP ticket generation.
- **Justification:** Telephony streams (RTP/WebSockets) must never block AI batch jobs or ERP HTTP servers.

