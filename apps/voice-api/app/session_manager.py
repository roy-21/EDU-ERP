"""
Voice Call Session Manager — Finite State Machine for Conversation Lifecycle

Responsibilities:
  - Tracks active and completed call sessions in-memory (production: voice_db)
  - Processes each caller utterance through the NLP pipeline
  - Detects objections/complaints and triggers auto-ticketing in Core ERP
  - Detects person routing requests and dispatches notifications
  - Generates contextual AI assistant responses (TTS-ready text)
"""

import re
import uuid
import requests
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.models import CallSession, TranscriptEntry, CallStatus
from app.config import voice_settings

# ─────────────────────────────────────────────────────────────────────
# In-Memory Session Store (replaced by voice_db in production)
# ─────────────────────────────────────────────────────────────────────
_sessions: Dict[str, CallSession] = {}


# ─────────────────────────────────────────────────────────────────────
# NLP Intent & Objection Patterns (local fast-path)
# For complex classification, delegates to AI Backend /api/v1/ai/nlp/classify-objection
# ─────────────────────────────────────────────────────────────────────
OBJECTION_PATTERNS = {
    "ATTENDANCE_DISPUTE": [
        r"absent", r"attendance", r"present.*but.*marked", r"biometric.*fail",
        r"rfid.*not.*work", r"হাজিরা", r"অনুপস্থিত"
    ],
    "GRADE_DISPUTE": [
        r"marks?\b", r"grade", r"exam.*wrong", r"result.*incorrect",
        r"midterm.*error", r"মার্কস", r"পরীক্ষা"
    ],
    "FEE_DISPUTE": [
        r"fee", r"tuition", r"double.*charge", r"refund", r"payment.*issue",
        r"বেতন", r"টাকা"
    ],
    "HARASSMENT_DISCIPLINE": [
        r"harass", r"ragging", r"bully", r"threat", r"র‌্যাগিং"
    ]
}

PERSON_ROUTING_PATTERNS = [
    r"(?:talk to|speak with|connect me to|transfer.*to|call)\s+(?:mr\.?|mrs\.?|dr\.?|prof\.?)?\s*([A-Za-z\s]{2,30})",
    r"কথা বলতে চাই\s+(.+)"
]


def _detect_objection(text: str) -> Tuple[bool, Optional[str], str]:
    """Returns (is_objection, category, severity)"""
    text_lower = text.lower()
    for category, patterns in OBJECTION_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                severity = "URGENT" if category == "HARASSMENT_DISCIPLINE" else "HIGH"
                return True, category, severity
    return False, None, "LOW"


def _detect_person_request(text: str) -> Optional[str]:
    """Extracts requested person name from caller utterance."""
    for pattern in PERSON_ROUTING_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def _generate_ai_response(session: CallSession, caller_message: str) -> str:
    """
    Generates contextual TTS-ready response text.
    In production, this integrates with STT output → LLM → TTS synthesis pipeline.
    """
    msg_lower = caller_message.lower()

    # Greeting detection
    if any(w in msg_lower for w in ["hello", "hi", "assalamu", "salam", "হ্যালো"]):
        return (
            f"Assalamu Alaikum! Welcome to {session.institution_id} Voice Assistant. "
            "I am your AI-powered support agent. How may I help you today? "
            "You can ask about attendance, exam results, fees, or I can connect you to a specific person."
        )

    # Objection detected
    if session.is_objection_detected:
        return (
            f"I understand your concern regarding {session.objection_category.replace('_', ' ').title()}. "
            "I have automatically registered a formal complaint ticket in our system. "
            "A responsible officer has been notified and will review your case within 24 hours. "
            f"Your ticket reference number is: {session.erp_ticket_id or 'pending'}. "
            "Is there anything else I can help with?"
        )

    # Person routing detected
    if session.target_person_requested:
        return (
            f"I will try to connect you with {session.target_person_requested}. "
            "If they are currently unavailable, I will send them an instant notification "
            "via SMS and email with your contact details and a callback request. "
            "Please hold for a moment."
        )

    # General inquiry
    return (
        "Thank you for your message. Could you please provide more details about your inquiry? "
        "For example, are you calling about attendance records, examination results, "
        "fee payments, or would you like to speak with a specific faculty member?"
    )


def _auto_create_erp_ticket(session: CallSession, caller_message: str) -> Optional[str]:
    """
    Calls Core ERP Backend POST /api/v1/objections to auto-file a tracked ticket.
    Returns the ticket ID on success, None on failure.
    """
    try:
        payload = {
            "institutionId": session.institution_id,
            "source": "AI_VOICE_CALL",
            "category": session.objection_category or "GENERAL_COMPLAINT",
            "severity": "HIGH",
            "title": f"Voice Call Objection: {(session.objection_category or 'Unknown').replace('_', ' ').title()}",
            "description": (
                f"Auto-generated from Voice AI call session {session.id}.\n"
                f"Caller: {session.caller_name or 'Unknown'} ({session.caller_phone or 'N/A'})\n"
                f"Channel: {session.channel.value}\n"
                f"Caller statement: \"{caller_message[:300]}\""
            ),
            "callSessionId": session.id
        }

        resp = requests.post(
            f"{voice_settings.CORE_ERP_API_BASE}/objections",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "X-Service-Token": voice_settings.SERVICE_SECRET,
                "X-Institution-Id": session.institution_id
            },
            timeout=5
        )

        if resp.status_code in (200, 201):
            data = resp.json()
            return data.get("data", {}).get("id")

    except Exception as e:
        print(f"[VOICE] ERP ticket creation failed: {e}")

    return None


# ─────────────────────────────────────────────────────────────────────
# Public Session API
# ─────────────────────────────────────────────────────────────────────

def create_session(institution_id: str, caller_phone: str, channel: str,
                   caller_name: Optional[str] = None) -> CallSession:
    session = CallSession(
        institution_id=institution_id,
        caller_phone=caller_phone,
        caller_name=caller_name,
        channel=channel
    )
    _sessions[session.id] = session
    return session


def process_caller_utterance(session_id: str, caller_message: str,
                              auto_ticket: bool = True) -> Tuple[CallSession, str]:
    """
    Core conversation turn processor:
      1. Log caller transcript
      2. Detect objection / person routing
      3. If objection → auto-create Core ERP ticket
      4. Generate AI response
      5. Log AI response transcript
      6. Return updated session + response text
    """
    session = _sessions.get(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    # 1. Log caller message
    session.transcript.append(TranscriptEntry(speaker="CALLER", message=caller_message))

    # 2. Detect objection
    is_obj, category, severity = _detect_objection(caller_message)
    if is_obj and not session.is_objection_detected:
        session.is_objection_detected = True
        session.objection_category = category
        session.detected_intent = f"OBJECTION:{category}"

        # 3. Auto-create ticket in Core ERP
        if auto_ticket:
            ticket_id = _auto_create_erp_ticket(session, caller_message)
            session.erp_ticket_id = ticket_id

    # 2b. Detect person routing request
    person = _detect_person_request(caller_message)
    if person and not session.target_person_requested:
        session.target_person_requested = person
        session.detected_intent = f"ROUTE_TO:{person}"
        session.transfer_status = "NOTIFICATION_SENT"

    # 4. Generate response
    ai_response = _generate_ai_response(session, caller_message)

    # 5. Log AI response
    session.transcript.append(TranscriptEntry(speaker="AI_ASSISTANT", message=ai_response))

    return session, ai_response


def end_session(session_id: str) -> Optional[CallSession]:
    session = _sessions.get(session_id)
    if session:
        session.status = CallStatus.COMPLETED
        session.ended_at = datetime.now(timezone.utc).isoformat()
        turns = len(session.transcript)
        session.duration_seconds = turns * 8  # ~8 seconds per conversational turn estimate
    return session


def get_session(session_id: str) -> Optional[CallSession]:
    return _sessions.get(session_id)


def get_all_sessions(institution_id: Optional[str] = None,
                     has_objection: Optional[bool] = None,
                     limit: int = 20) -> List[CallSession]:
    results = list(_sessions.values())
    if institution_id:
        results = [s for s in results if s.institution_id == institution_id]
    if has_objection is not None:
        results = [s for s in results if s.is_objection_detected == has_objection]
    results.sort(key=lambda s: s.started_at, reverse=True)
    return results[:limit]
