import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "erp_dev_super_secret_jwt_key_32chars_min",
  jwtExpiresIn: "15m",
  serviceSecretAi: process.env.SERVICE_SECRET_AI || "ai_service_internal_secret_key_9901",
  serviceSecretVoice: process.env.SERVICE_SECRET_VOICE || "voice_service_internal_secret_key_8802",
  aiApiUrl: process.env.AI_API_URL || "http://localhost:8000/api/v1",
  voiceApiUrl: process.env.VOICE_API_URL || "http://localhost:8050/api/v1",
};

