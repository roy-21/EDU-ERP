import os

class Settings:
    PORT: int = int(os.getenv("AI_PORT", "8000"))
    SERVICE_SECRET: str = os.getenv("SERVICE_SECRET_AI", "ai_service_internal_secret_key_9901")
    CORE_ERP_API_URL: str = os.getenv("CORE_ERP_API_URL", "http://localhost:4000/api/v1")
    ENVIRONMENT: str = os.getenv("NODE_ENV", "development")

settings = Settings()

