"""
Voice Assistant Backend — Unit Tests (No Core ERP dependency)
Tests session management, NLP objection detection, and person routing locally.
"""

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_voice_health():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["data"]["service"] == "voice-assistant-backend"
    assert data["data"]["status"] == "HEALTHY"
    assert "Auto-Objection Detection" in data["data"]["capabilities"]


def test_inbound_webhook_creates_session():
    payload = {
        "institution_id": "inst-001",
        "caller_phone": "+8801711223344",
        "channel": "TWILIO",
        "caller_name": "Mrs. Fatima Begum"
    }
    res = client.post("/api/v1/voice/webhook/inbound", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "session_id" in data["data"]
    assert data["data"]["status"] == "IN_PROGRESS"


def test_simulate_call_detects_attendance_objection():
    """
    Simulates a guardian calling about attendance dispute.
    Verifies NLP objection detection fires correctly.
    Note: auto_ticket=True attempts Core ERP call, which may fail
    in isolated test; we verify the session state regardless.
    """
    payload = {
        "institution_id": "inst-001",
        "caller_phone": "+8801799887766",
        "caller_name": "Mr. Karim Hossain",
        "channel": "TWILIO",
        "messages": [
            "Hello, I am calling about my son's attendance.",
            "He was marked absent on October 28 but he attended the class. The biometric system failed."
        ]
    }
    res = client.post("/api/v1/voice/simulate/call", json=payload)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["objection_detected"] is True
    assert data["objection_category"] == "ATTENDANCE_DISPUTE"
    assert data["status"] == "COMPLETED"
    assert len(data["conversation"]) == 2
    assert len(data["full_transcript"]) == 4  # 2 caller + 2 AI responses


def test_simulate_call_detects_person_routing():
    """Simulates a caller requesting to speak with a specific faculty member."""
    payload = {
        "institution_id": "inst-001",
        "caller_phone": "+8801888999000",
        "caller_name": "Student Imran",
        "channel": "WEBRTC_WEB",
        "messages": [
            "Hi, I want to talk to Dr. Rafiqul Islam about my project."
        ]
    }
    res = client.post("/api/v1/voice/simulate/call", json=payload)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["target_person_requested"] is not None
    assert "Rafiqul Islam" in data["target_person_requested"]
    assert data["transfer_status"] == "NOTIFICATION_SENT"


def test_simulate_call_grade_dispute():
    """Simulates a grade dispute call with Bangla keywords."""
    payload = {
        "institution_id": "inst-001",
        "caller_phone": "+8801555666777",
        "caller_name": "Guardian Rina",
        "channel": "PHONE_SIP",
        "messages": [
            "My daughter's exam marks are wrong. Please check the midterm result."
        ]
    }
    res = client.post("/api/v1/voice/simulate/call", json=payload)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["objection_detected"] is True
    assert data["objection_category"] == "GRADE_DISPUTE"


def test_call_history_returns_sessions():
    res = client.get("/api/v1/voice/calls/history?institution_id=inst-001")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert len(data["data"]) >= 1  # At least sessions from above tests

