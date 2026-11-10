# Voice Assistant Backend Architecture & Telephony Specification

## 1. Architectural Independence
The Voice Assistant Backend is an **autonomous micro-backend** (`apps/voice-api`) built in Python FastAPI.
- It is NOT a submodule of the AI service.
- It operates with its own database (`voice_db`), entry points, configuration, and background event loop.
- It interfaces with Core ERP via authenticated REST calls and with telephony providers (SIP / Twilio / Vonage) via standard webhooks and WebSocket audio streams.

---

## 2. Inbound & WebRTC Call Pipeline

```
 [Inbound Phone Call / WebRTC Widget]
                 │
                 ▼
 [Voice Gateway (Twilio / SIP / WebRTC)]
                 │ (Streaming Audio / Media Stream WSS)
                 ▼
 [FastAPI Audio Stream Processor]
   ├─ 1. Speech-to-Text (STT): Whisper / Vosk / Google Speech
   ├─ 2. Dialogue Manager & Finite State Machine
   ├─ 3. Intent & Objection Detection Engine
   │      ├─ If standard inquiry: Retrieve FAQ & Generate response
   │      ├─ If OBJECTION/COMPLAINT detected:
   │      │    └─ Auto-call Core ERP API: POST /api/v1/objections
   │      │    └─ Generate formal tracked ticket
   │      └─ If SPECIFIC PERSON requested:
   │           └─ Call Core ERP API: POST /api/v1/notifications/alert-staff
   │           └─ Bridge or schedule callback
   └─ 4. Text-to-Speech (TTS): Coqui / Piper / ElevenLabs / Google TTS
                 │ (Synthesized Audio Stream)
                 ▼
   [Caller Hears Response in Real-Time]
```

---

## 3. Auto-Objection Detection & Workflow Trigger

When an incoming student or guardian mentions an grievance (e.g., *"My son was marked absent despite being in class"*, *"Grade in math exam is incorrect"*, *"Bursar charged double tuition"*):
1. **NLP Pattern Matcher:** Analyzes confidence scores across `OBJECTION_CATEGORIES` (Grade Dispute, Attendance Dispute, Fee Issue, Harassment/Discipline).
2. **Ticket Generation:** Immediately issues an asynchronous request to Core ERP Backend:
   ```http
   POST http://localhost:4000/api/v1/objections
   Authorization: Bearer <VOICE_SERVICE_SECRET>
   Content-Type: application/json

   {
     "institutionId": "...",
     "source": "AI_VOICE_CALL",
     "category": "ATTENDANCE_DISPUTE",
     "severity": "HIGH",
     "title": "Voice Call Dispute: Attendance Challenge",
     "description": "Caller stated student was present on Oct 28 but marked absent. Requested teacher review.",
     "callSessionId": "..."
   }
   ```
3. **Audit Trail:** Stores full call recording metadata, speaker timestamps, and transcript lines in `voice_db`.

