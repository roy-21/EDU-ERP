import os

class VoiceSettings:
    PORT: int = int(os.getenv("VOICE_PORT", "8050"))
    SERVICE_SECRET: str = os.getenv("VOICE_SERVICE_SECRET", "voice_service_internal_secret_key_8802")
    CORE_ERP_API_BASE: str = os.getenv("CORE_ERP_API_BASE", "http://localhost:4000/api/v1")
    AI_API_BASE: str = os.getenv("AI_API_BASE", "http://localhost:8000/api/v1")
    AI_SERVICE_TOKEN: str = os.getenv("AI_SERVICE_TOKEN", "ai_service_internal_secret_key_9901")
    ENVIRONMENT: str = os.getenv("NODE_ENV", "development")

voice_settings = VoiceSettings()

