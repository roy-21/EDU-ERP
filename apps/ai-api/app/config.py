import os
from pathlib import Path

# Local settings come from apps/ai-api/.env (never committed); real environment variables win.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:  # python-dotenv is optional where the environment is set directly
    pass


class Settings:
    PORT: int = int(os.getenv("AI_PORT", "8000"))
    SERVICE_SECRET: str = os.getenv("SERVICE_SECRET_AI", "ai_service_internal_secret_key_9901")
    CORE_ERP_API_URL: str = os.getenv("CORE_ERP_API_URL", "http://localhost:4000/api/v1")
    ENVIRONMENT: str = os.getenv("NODE_ENV", "development")

settings = Settings()
