# Current AI Features Integration Status Matrix

**Verification Standard:** Verified via live HTTP execution across all tiers.  
**Last Updated:** 2026-11-01

---

## Verified Integration Tier Matrix

| Feature | Frontend | Core ERP Gateway | AI / Voice Service | Model Execution Engine | Database Persistence | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Student Risk Prediction** | `ai-prediction/page.jsx` | `POST /api/v1/ai/predict/student-risk` | `POST /api/v1/ai/predict/student-risk` | `student_risk_rf_v1.2.0` (Random Forest) | `ai_predictions` | **FULLY INTEGRATED** |
| **GPA Trajectory Regressor** | `ai-prediction/page.jsx` | `POST /api/v1/ai/predict/gpa` | `POST /api/v1/ai/predict/gpa` | `gpa_ridge_regressor_v1.0.0` (Ridge) | Real-time inference | **FULLY INTEGRATED** |
| **Course RAG Tutor with Citations** | `ai-assistant/page.jsx` | `POST /api/v1/ai/rag/query` | `POST /api/v1/ai/rag/query` | `CourseRagEngine` (Keyword + Vector) | Scoped chunks with page metadata | **FULLY INTEGRATED** |
| **Multilingual Objection NLP** | Voice Console & Inbound | `POST /api/v1/objections` | `POST /api/v1/ai/nlp/classify-objection` | `NlpObjectionClassifier` (Regex/NLP) | Core ERP DB `objections` | **FULLY INTEGRATED** |
| **Inbound Voice Call Engine** | `voice-ai/logs/page.jsx` | `POST /api/v1/voice/simulate` | `apps/voice-api` (:8050) | Finite State Machine & STT/TTS | `voice_call_sessions` | **FULLY INTEGRATED** |
| **Autonomous Voice Auto-Ticketing**| `voice-ai/logs/page.jsx` | `POST /api/v1/objections` | Voice Backend Service | Dispute Pattern Matcher | Core ERP `objections` table | **FULLY INTEGRATED** |
| **Call Logs & Transcripts Console** | `voice-ai/logs/page.jsx` | `GET /api/v1/voice/calls` | `GET /api/v1/voice/calls/history` | Structured Transcript Aggregator | Synced across services | **FULLY INTEGRATED** |
| **Weak Topic Identification** | `ai-assistant/page.jsx` | Part of RAG / Risk Response | Rule-based factor decomposition | Scikit-learn factor extractor | Session state | **PARTIALLY INTEGRATED** |
| **Personalized Study Recommendations** | `ai-assistant/page.jsx` | Part of Risk Response | Advisor recommendation list | Heuristic advisor rules | In-memory | **PARTIALLY INTEGRATED** |
| **AI Quiz Generator** | `lms/ai-quiz/page.jsx` | Not yet exposed | Planned in `ai-api` | Simulated | None | **MOCK / PLACEHOLDER** |
| **Plagiarism Detection Engine** | `lms/plagiarism/page.jsx` | Not yet exposed | Planned in `ai-api` | Simulated | None | **MOCK / PLACEHOLDER** |
| **Physical Telephony SIP Trunk** | External hardware | N/A | Twilio / SIP Webhook adapter | Telephony Gateway | Webhook metadata | **BLOCKED (Hardware/SIP Credentials)** |

