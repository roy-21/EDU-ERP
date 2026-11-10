# Project Overview — AI-Powered Institution ERP System

## 1. Executive Summary
The **AI-Powered Institution ERP System** is an enterprise-grade multi-institution, multi-campus software platform engineered for colleges, universities, and polytechnic institutes. It integrates traditional institutional operations (student lifecycle, faculty management, attendance, dynamic forms, exam seat planning, grading, and finance) with intelligent automation:
1. **Predictive Analytics:** Early student dropout and academic failure risk prediction, attendance trend forecasting, GPA trajectory modeling.
2. **AI Learning Assistant:** Retrieval-Augmented Generation (RAG) providing course-grounded conversational tutoring with verified citation integrity.
3. **Autonomous Voice Assistant:** Inbound and outbound phone and WebRTC calling engine that interacts naturally, transcribes dialogues, detects student/parent objections, and automatically files tracked notices and tickets in Core ERP.

---

## 2. Core Architectural Pillars

```
+-----------------------------------------------------------------------------------+
|                                  USER INTERFACE                                    |
|              Next.js 16 (App Router) + Tailwind CSS v4 + Zustand Store             |
|                  Responsive Multi-Role Institutional Dashboard                     |
+-----------------------------------------------------------------------------------+
                                   │ (HTTPS / REST / WSS)
                                   ▼
+-----------------------------------------------------------------------------------+
|                          CORE ERP BACKEND (Node.js/NestJS)                        |
|                               Port: 4000 | PostgreSQL 16                           |
|  • Auth & RBAC               • Academic Management        • Dynamic Form/Table    |
|  • Student & Teacher Data    • Exams, Seat Plans & Grades • Ticketing & Workflow  |
+-------------------------┬───────────────────────────────┬-------------------------+
                          │ (Authenticated REST API)      │ (Authenticated REST API)
                          ▼                               ▼
+-----------------------------------+   +-------------------------------------------+
|    AI BACKEND (Python FastAPI)    |   |     VOICE ASSISTANT (Python FastAPI)      |
|     Port: 8000 | PG + pgvector    |   |           Port: 8050 | PostgreSQL 16      |
| • Student Risk / GPA Prediction   |   | • SIP / Twilio & WebRTC Call Sessions     |
| • RAG Learning Assistant          |   | • Speech-to-Text & Text-to-Speech Engine  |
| • Document Intelligence & NLP     |   | • Auto-Objection Detection & ERP Ticketing|
| • Model Registry & Evaluation     |   | • Staff Call Routing & Alert Notifications|
+-----------------------------------+   +-------------------------------------------+
```

---

## 3. Key Non-Negotiable Rules
1. **Four Independent Applications:** Frontend, Core ERP, AI Backend, and Voice Backend must be independently runnable, testable, and deployable with isolated database ownership.
2. **Zero Direct Cross-Database Writes:** The AI and Voice services communicate with Core ERP strictly through authenticated REST APIs.
3. **Multi-Institution Multi-Tenancy:** Every institutional record and query is scoped with `institution_id` and verified against user security contexts.
4. **Human in the Loop for AI Decisions:** Machine learning risk flags and auto-detected objections generate actionable alerts for human review rather than executing unmonitored punitive actions.

