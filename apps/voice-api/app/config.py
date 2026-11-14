import os
from pathlib import Path

# Local settings come from apps/voice-api/.env (never committed); real environment variables win.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:  # python-dotenv is optional where the environment is set directly
    pass


class VoiceSettings:
    PORT: int = int(os.getenv("VOICE_PORT", "8050"))
    # Same name as in the Core ERP's .env, so one value is shared; the old name still works.
    SERVICE_SECRET: str = os.getenv("SERVICE_SECRET_VOICE") or os.getenv("VOICE_SERVICE_SECRET", "voice_service_internal_secret_key_8802")
    CORE_ERP_API_BASE: str = os.getenv("CORE_ERP_API_BASE", "http://localhost:4000/api/v1")
    AI_API_BASE: str = os.getenv("AI_API_BASE", "http://localhost:8000/api/v1")
    AI_SERVICE_TOKEN: str = os.getenv("AI_SERVICE_TOKEN", "ai_service_internal_secret_key_9901")
    ENVIRONMENT: str = os.getenv("NODE_ENV", "development")


voice_settings = VoiceSettings()
# The assistant code reads settings.SERVICE_SECRET, the same as in the other services.
settings = voice_settings
