# AI Integration Fix Plan & Remediation Roadmap

Based on the forensic findings of the integration audit, the following prioritized fixes must be applied to establish true end-to-end functionality.

---

## Priority 0 (P0) — Security & Architectural Integrity
- [x] Ensure Frontend never exposes service secrets or calls the AI backend directly.
- [x] Enforce `institution_id` extraction from verified JWT claims in Core ERP before forwarding requests to the AI Backend.
- [x] Protect inter-service communication with mutual service secrets (`X-Service-Token`).

---

## Priority 1 (P1) — Core ERP AI & Voice Gateway Implementation
- [ ] **P1.1:** Create `apps/core-api/src/modules/ai/ai.controller.ts` with endpoints:
  - `POST /api/v1/ai/predict/student-risk`
  - `POST /api/v1/ai/predict/gpa`
  - `POST /api/v1/ai/rag/query`
- [ ] **P1.2:** Create `apps/core-api/src/modules/voice/voice.controller.ts` with endpoints:
  - `GET /api/v1/voice/calls`
  - `POST /api/v1/voice/simulate`
- [ ] **P1.3:** Register AI and Voice routers in `apps/core-api/src/app.ts`.
- [ ] **P1.4:** Rebuild and verify Core ERP TypeScript compilation and automated tests.

---

## Priority 2 (P2) — Frontend Real API Wiring
- [ ] **P2.1:** Wire `src/app/admin/classroom/ai-assistant/page.jsx` to execute live `POST http://localhost:4000/api/v1/ai/rag/query` through Core ERP, replacing simulated `setTimeout` text with genuine RAG responses and verified citations.
- [ ] **P2.2:** Wire `src/app/admin/examination/ai-prediction/page.jsx` to call `POST http://localhost:4000/api/v1/ai/predict/student-risk` and `POST http://localhost:4000/api/v1/ai/predict/gpa`, rendering live ML predictions.
- [ ] **P2.3:** Create the missing Voice AI Console page: `src/app/admin/voice-ai/logs/page.jsx` with live call session history and interactive call simulation.

---

## Priority 3 (P3) — Full End-to-End Test Execution & Documentation
- [ ] **P3.1:** Write and execute automated test suite `test_e2e_full_chain.py` verifying the full 5-step flow:
  `Client/UI → Core ERP (4000) → AI/Voice Backend (8000/8050) → Core ERP → Response`.
- [ ] **P3.2:** Update `docs/AI_INTEGRATION_TEST_RESULTS.md` and `docs/AI_INTEGRATION_STATUS.md`.

