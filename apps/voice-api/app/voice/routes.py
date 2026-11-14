"""Website voice calls. The Core ERP drives each turn:

  1. POST /sessions                start a call (after the Core checked who is calling)
  2. POST /sessions/{id}/listen    caller's recording -> text      (saved as a CALLER turn)
  3. the Core answers the text with the message assistant pipeline (read-only ERP, knowledge)
  4. POST /sessions/{id}/speak     answer text -> spoken audio     (saved as an ASSISTANT turn)
  5. POST /sessions/{id}/end

Only the Core calls these, with the service token. Transcripts go to the shared database under
Row Level Security for the institution named in each request.
"""

import base64
import binascii
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.assistant.routes import ok, require_service
from app.voice import speech, store

router = APIRouter(prefix="/api/v1/voice/web", dependencies=[Depends(require_service)])

MAX_AUDIO_BYTES = 4 * 1024 * 1024


class StartRequest(BaseModel):
    institution_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    user_name: str = Field(default="", max_length=150)
    channel: str = Field(default="WEB", pattern="^(WEB|PHONE)$")


class ListenRequest(BaseModel):
    institution_id: str = Field(min_length=1, max_length=64)
    audio_base64: str
    language_hint: Optional[str] = Field(default=None, pattern="^(bn|en)$")


class SpeakRequest(BaseModel):
    institution_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=5000)
    language: str = Field(pattern="^(bn|en)$")
    question_id: Optional[str] = Field(default=None, max_length=64)


class EndRequest(BaseModel):
    institution_id: str = Field(min_length=1, max_length=64)


def _store_errors(err: Exception):
    if isinstance(err, store.StoreUnavailable):
        raise HTTPException(status_code=503, detail=str(err))
    raise err


def _active(institution_id: str, session_id: str):
    try:
        found = store.session_status(institution_id, session_id)
    except Exception as err:
        _store_errors(err)
    # Row Level Security hides other institutions' calls, so they look the same as missing ones.
    if found is None:
        raise HTTPException(status_code=404, detail="Call not found.")
    if found != "ACTIVE":
        raise HTTPException(status_code=409, detail="This call has ended.")


@router.get("/status")
def voice_status():
    return ok({**speech.status(), "transcripts": store.is_configured()})


@router.post("/sessions")
def start(req: StartRequest):
    try:
        session_id = store.create_session(req.institution_id, req.user_id, req.user_name, req.channel)
    except Exception as err:
        _store_errors(err)
    return ok({"session_id": session_id})


@router.post("/sessions/{session_id}/listen")
def listen(session_id: str, req: ListenRequest):
    _active(req.institution_id, session_id)
    try:
        audio = base64.b64decode(req.audio_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The recording is not valid base64.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too large.")
    try:
        (text, language, audio_ms), took = speech.timed(speech.transcribe, audio, req.language_hint)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except speech.SpeechUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err))
    if not text:
        raise HTTPException(status_code=422, detail="No speech was heard. Speak closer to the microphone and try again.")
    try:
        turn_id = store.add_turn(req.institution_id, session_id, "CALLER", text, language, audio_ms=audio_ms, processing_ms=took)
    except Exception as err:
        _store_errors(err)
    return ok({"text": text, "language": language, "audio_ms": audio_ms, "processing_ms": took, "turn_id": turn_id})


@router.post("/sessions/{session_id}/speak")
def speak(session_id: str, req: SpeakRequest):
    _active(req.institution_id, session_id)
    try:
        (wav, audio_ms), took = speech.timed(speech.synthesize, req.text, req.language)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except speech.SpeechUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err))
    try:
        turn_id = store.add_turn(req.institution_id, session_id, "ASSISTANT", req.text, req.language, req.question_id, audio_ms, took)
    except Exception as err:
        _store_errors(err)
    return ok({"audio_base64": base64.b64encode(wav).decode(), "mime_type": "audio/wav", "audio_ms": audio_ms, "processing_ms": took, "turn_id": turn_id})


@router.post("/sessions/{session_id}/end")
def end(session_id: str, req: EndRequest):
    try:
        ended = store.end_session(req.institution_id, session_id)
    except Exception as err:
        _store_errors(err)
    return ok({"ended": ended})
