"""Website voice call endpoints, with the speech engine and the database replaced by fakes.
The real Row Level Security is tested from the Core ERP's test suite against PostgreSQL."""

import base64

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.voice import numbers, routes, speech, store

client = TestClient(app, headers={"X-Service-Token": settings.SERVICE_SECRET})


class FakeStore:
    def __init__(self):
        self.sessions = {}
        self.turns = []

    def is_configured(self):
        return True

    def create_session(self, institution_id, user_id, user_name, channel):
        session_id = f"s{len(self.sessions) + 1}"
        self.sessions[session_id] = {"institution": institution_id, "status": "ACTIVE"}
        return session_id

    def session_status(self, institution_id, session_id):
        session = self.sessions.get(session_id)
        # Like Row Level Security: another institution's call is invisible.
        return session["status"] if session and session["institution"] == institution_id else None

    def add_turn(self, institution_id, session_id, speaker, text, language, question_id=None, audio_ms=0, processing_ms=0):
        self.turns.append((institution_id, session_id, speaker, text, language, question_id))
        return f"t{len(self.turns)}"

    def end_session(self, institution_id, session_id):
        if self.session_status(institution_id, session_id) != "ACTIVE":
            return False
        self.sessions[session_id]["status"] = "ENDED"
        return True


@pytest.fixture
def fakes(monkeypatch):
    fake = FakeStore()
    for name in ("create_session", "session_status", "add_turn", "end_session", "is_configured"):
        monkeypatch.setattr(store, name, getattr(fake, name))
    monkeypatch.setattr(speech, "transcribe", lambda audio, hint=None: ("হোস্টেলের গেট কখন বন্ধ হয়?", "bn", 2100))
    monkeypatch.setattr(speech, "synthesize", lambda text, language: (b"RIFF....WAVE", 1800))
    return fake


def test_voice_endpoints_need_the_service_token():
    assert TestClient(app).get("/api/v1/voice/web/status").status_code == 401


def test_a_call_turn_is_heard_spoken_and_saved(fakes):
    session = client.post("/api/v1/voice/web/sessions", json={"institution_id": "inst-a", "user_id": "u1", "user_name": "Rahim"}).json()["data"]["session_id"]
    audio = base64.b64encode(b"fake recording").decode()
    heard = client.post(f"/api/v1/voice/web/sessions/{session}/listen", json={"institution_id": "inst-a", "audio_base64": audio}).json()["data"]
    assert heard["text"] == "হোস্টেলের গেট কখন বন্ধ হয়?" and heard["language"] == "bn"
    spoken = client.post(f"/api/v1/voice/web/sessions/{session}/speak",
                         json={"institution_id": "inst-a", "text": "গেট রাত ১০টায় বন্ধ হয়।", "language": "bn", "question_id": "q1"}).json()["data"]
    assert base64.b64decode(spoken["audio_base64"]).startswith(b"RIFF") and spoken["mime_type"] == "audio/wav"
    assert [turn[2] for turn in fakes.turns] == ["CALLER", "ASSISTANT"]
    assert fakes.turns[1][5] == "q1"


def test_another_institution_cannot_use_the_call(fakes):
    session = client.post("/api/v1/voice/web/sessions", json={"institution_id": "inst-a", "user_id": "u1"}).json()["data"]["session_id"]
    res = client.post(f"/api/v1/voice/web/sessions/{session}/listen", json={"institution_id": "inst-b", "audio_base64": "YQ=="})
    assert res.status_code == 404
    assert fakes.turns == []


def test_an_ended_call_takes_no_more_turns(fakes):
    session = client.post("/api/v1/voice/web/sessions", json={"institution_id": "inst-a", "user_id": "u1"}).json()["data"]["session_id"]
    assert client.post(f"/api/v1/voice/web/sessions/{session}/end", json={"institution_id": "inst-a"}).json()["data"]["ended"] is True
    assert client.post(f"/api/v1/voice/web/sessions/{session}/speak", json={"institution_id": "inst-a", "text": "x", "language": "en"}).status_code == 409


def test_bad_recordings_are_explained(fakes, monkeypatch):
    session = client.post("/api/v1/voice/web/sessions", json={"institution_id": "inst-a", "user_id": "u1"}).json()["data"]["session_id"]
    assert client.post(f"/api/v1/voice/web/sessions/{session}/listen", json={"institution_id": "inst-a", "audio_base64": "@@"}).status_code == 400

    def too_short(audio, hint=None):
        raise ValueError("The recording is too short. Hold the button while you speak.")

    monkeypatch.setattr(speech, "transcribe", too_short)
    res = client.post(f"/api/v1/voice/web/sessions/{session}/listen", json={"institution_id": "inst-a", "audio_base64": "YQ=="})
    assert res.status_code == 422 and "too short" in res.json()["detail"]


def test_without_a_database_calls_are_refused_clearly(monkeypatch):
    monkeypatch.delenv("VOICE_DATABASE_URL", raising=False)
    res = client.post("/api/v1/voice/web/sessions", json={"institution_id": "inst-a", "user_id": "u1"})
    assert res.status_code == 503 and "VOICE_DATABASE_URL" in res.json()["detail"]


@pytest.mark.parametrize("text, language, spoken", [
    ("The hostel gate closes at 10:30 pm.", "en", "The hostel gate closes at ten thirty p m."),
    ("Tuition is 4,500 taka.", "en", "Tuition is four thousand five hundred taka."),
    ("You need 75% attendance.", "en", "You need seventy five percent attendance."),
    ("রাতের খাবার রাত ৮টা থেকে ১০টা, দাম ৬০ টাকা।", "bn", "রাতের খাবার রাত আটটা থেকে দশটা, দাম ষাট টাকা।"),
    ("ভর্তি ফি ১,৫০,০০০ টাকা।", "bn", "ভর্তি ফি এক লাখ পঞ্চাশ হাজার টাকা।"),
])
def test_numbers_are_read_as_words(text, language, spoken):
    assert numbers.speakable(text, language) == spoken
