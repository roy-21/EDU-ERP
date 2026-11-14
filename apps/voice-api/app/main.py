"""
Voice Assistant Backend — Independent FastAPI Application
Port: 8050 | Database: voice_db (PostgreSQL)

This is NOT a module of the AI Backend.
It has its own entry point, API surface, database ownership, and deployment lifecycle.
"""

from fastapi import FastAPI, HTTPException, Header, Depends
from typing import Optional, List

from app.config import voice_settings
from app.models import (
    InboundWebhookPayload, SimulateCallRequest,
    CallSession, CallHistoryQuery
)
from app import session_manager
from app.assistant.routes import router as assistant_router, require_service
from app.voice.routes import router as voice_web_router

app = FastAPI(
    title="Institution ERP — Voice Assistant Backend",
    description="Independent AI-Powered Voice Call Engine with Auto-Objection Detection & ERP Ticketing",
    version="1.0.0"
)

# Only the Core ERP calls this service, server to server, so browsers get no CORS access.
app.include_router(assistant_router)
app.include_router(voice_web_router)


@app.on_event("startup")
def load_local_models():
    # Loading a local model can take a minute; do it in the background so the service starts at once.
    import os
    import threading
    from app.assistant import llm
    if os.getenv("ASSISTANT_WARM_UP", "on") != "off":
        threading.Thread(target=llm.warm_up, daemon=True).start()
    if os.getenv("VOICE_WARM_UP", "on") != "off":
        from app.voice import speech
        threading.Thread(target=speech.warm_up, daemon=True).start()


# ─────────────────────────────────────────────────────────────────────
# Health Check
# ─────────────────────────────────────────────────────────────────────
@app.get("/api/v1/health")
def health_check():
    return {
        "success": True,
        "statusCode": 200,
        "data": {
            "service": "voice-assistant-backend",
            "version": "1.0.0",
            "status": "HEALTHY",
            "core_erp_target": voice_settings.CORE_ERP_API_BASE,
            "capabilities": [
                "SIP/Twilio Inbound Calls",
                "WebRTC Browser Calls",
                "Speech-to-Text (STT)",
                "Text-to-Speech (TTS)",
                "Auto-Objection Detection",
                "Core ERP Auto-Ticketing",
                "Staff Routing & Notification"
            ]
        }
    }


# ─────────────────────────────────────────────────────────────────────
# Inbound Call Webhook (Twilio / SIP / WebRTC Gateway)
# ─────────────────────────────────────────────────────────────────────
@app.post("/api/v1/voice/webhook/inbound", dependencies=[Depends(require_service)])
def inbound_call_webhook(payload: InboundWebhookPayload):
    """
    Receives inbound call event from telephony gateway (Twilio, SIP, WebRTC).
    Creates a new voice session and returns the session ID for audio stream association.
    """
    session = session_manager.create_session(
        institution_id=payload.institution_id,
        caller_phone=payload.caller_phone,
        channel=payload.channel.value,
        caller_name=payload.caller_name
    )

    return {
        "success": True,
        "statusCode": 201,
        "data": {
            "session_id": session.id,
            "status": session.status.value,
            "greeting": (
                "Assalamu Alaikum! Welcome to the Institution Voice Assistant. "
                "How may I help you today?"
            )
        }
    }


# ─────────────────────────────────────────────────────────────────────
# Call Simulation — Full Multi-Turn Dialogue Pipeline
# ─────────────────────────────────────────────────────────────────────
@app.post("/api/v1/voice/simulate/call", dependencies=[Depends(require_service)])
def simulate_call(req: SimulateCallRequest):
    """
    Diagnostic endpoint that simulates a full inbound call:
      1. Creates session
      2. Processes each caller message through NLP
      3. Detects objections → auto-files Core ERP tickets
      4. Detects person requests → prepares routing notifications
      5. Returns complete conversation transcript & session state
    """
    session = session_manager.create_session(
        institution_id=req.institution_id,
        caller_phone=req.caller_phone,
        channel=req.channel.value,
        caller_name=req.caller_name
    )

    conversation_turns = []

    for msg in req.messages:
        updated_session, ai_response = session_manager.process_caller_utterance(
            session_id=session.id,
            caller_message=msg,
            auto_ticket=True  # Triggers real Core ERP API call
        )
        conversation_turns.append({
            "caller": msg,
            "ai_response": ai_response,
            "objection_detected": updated_session.is_objection_detected,
            "person_requested": updated_session.target_person_requested
        })

    # End session
    final_session = session_manager.end_session(session.id)

    return {
        "success": True,
        "statusCode": 200,
        "data": {
            "session_id": final_session.id,
            "institution_id": final_session.institution_id,
            "caller": f"{final_session.caller_name} ({final_session.caller_phone})",
            "channel": final_session.channel.value,
            "status": final_session.status.value,
            "duration_seconds": final_session.duration_seconds,
            "detected_intent": final_session.detected_intent,
            "objection_detected": final_session.is_objection_detected,
            "objection_category": final_session.objection_category,
            "erp_ticket_id": final_session.erp_ticket_id,
            "target_person_requested": final_session.target_person_requested,
            "transfer_status": final_session.transfer_status,
            "conversation": conversation_turns,
            "full_transcript": [
                {"speaker": t.speaker, "message": t.message, "timestamp": t.timestamp}
                for t in final_session.transcript
            ]
        }
    }


# ─────────────────────────────────────────────────────────────────────
# Call History & Transcript Retrieval
# ─────────────────────────────────────────────────────────────────────
@app.get("/api/v1/voice/calls/history", dependencies=[Depends(require_service)])
def call_history(
    institution_id: Optional[str] = None,
    has_objection: Optional[bool] = None,
    limit: int = 20
):
    sessions = session_manager.get_all_sessions(
        institution_id=institution_id,
        has_objection=has_objection,
        limit=limit
    )
    return {
        "success": True,
        "statusCode": 200,
        "data": [
            {
                "session_id": s.id,
                "institution_id": s.institution_id,
                "caller": f"{s.caller_name or 'Unknown'} ({s.caller_phone or 'N/A'})",
                "channel": s.channel.value if isinstance(s.channel, str) == False else s.channel,
                "status": s.status.value,
                "objection_detected": s.is_objection_detected,
                "objection_category": s.objection_category,
                "erp_ticket_id": s.erp_ticket_id,
                "started_at": s.started_at,
                "duration_seconds": s.duration_seconds
            }
            for s in sessions
        ],
        "meta": {"total": len(sessions)}
    }


@app.get("/api/v1/voice/calls/{session_id}", dependencies=[Depends(require_service)])
def get_call_detail(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    return {
        "success": True,
        "statusCode": 200,
        "data": session.model_dump()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=voice_settings.PORT, reload=True)

