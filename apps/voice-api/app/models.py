from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum
import uuid
from datetime import datetime, timezone

class CallChannel(str, Enum):
    PHONE_SIP = "PHONE_SIP"
    TWILIO = "TWILIO"
    WEBRTC_WEB = "WEBRTC_WEB"

class CallDirection(str, Enum):
    INBOUND = "INBOUND"
    OUTBOUND = "OUTBOUND"

class CallStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TRANSFERRED = "TRANSFERRED"

class TranscriptEntry(BaseModel):
    speaker: str  # CALLER or AI_ASSISTANT
    message: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CallSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    institution_id: str
    caller_phone: Optional[str] = None
    caller_name: Optional[str] = None
    channel: CallChannel
    direction: CallDirection = CallDirection.INBOUND
    status: CallStatus = CallStatus.IN_PROGRESS
    detected_intent: Optional[str] = None
    is_objection_detected: bool = False
    objection_category: Optional[str] = None
    target_person_requested: Optional[str] = None
    transfer_status: str = "NONE"
    erp_ticket_id: Optional[str] = None
    transcript: List[TranscriptEntry] = []
    started_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    ended_at: Optional[str] = None
    duration_seconds: int = 0

class InboundWebhookPayload(BaseModel):
    institution_id: str
    caller_phone: str
    channel: CallChannel = CallChannel.TWILIO
    caller_name: Optional[str] = None

class SimulateCallRequest(BaseModel):
    institution_id: str
    caller_phone: str = "+8801712345678"
    caller_name: str = "Guardian"
    channel: CallChannel = CallChannel.TWILIO
    messages: List[str] = Field(
        ...,
        description="Sequence of caller utterances to simulate a multi-turn voice call"
    )

class CallHistoryQuery(BaseModel):
    institution_id: Optional[str] = None
    has_objection: Optional[bool] = None
    limit: int = 20
