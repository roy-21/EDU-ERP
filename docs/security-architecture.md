# Security Architecture & Data Protection

## 1. Threat Model & Security Posture
The platform handles sensitive student records, personal identifying information (PII), academic transcripts, financial balances, and voice recordings. Security is treated as an active layer throughout development.

---

## 2. Authentication & Credential Security
- **Passwords:** Hashed using **Argon2id** or **bcrypt** (cost factor 12).
- **Session Tokens:** Stateless **JWT** with short expiration (15 minutes for access tokens, 7 days for rotatable refresh tokens).
- **Service-to-Service Authentication:** Core ERP, AI Backend, and Voice Backend communicate using mutual HMAC-SHA256 signatures or pre-shared high-entropy Bearer secrets passed via `X-Service-Token`. Service secrets are strictly decoupled from user JWTs.

---

## 3. Multi-Tenant Isolation & Zero Trust
- Every query to Core ERP, AI Backend, or Voice Backend must include and validate an `institution_id`.
- Tenant context is extracted directly from the verified cryptographic JWT claims, never from client-controlled request bodies or unverified query parameters.
- **Cross-Tenant Attack Prevention:** If a user authenticated for Institution A requests an asset with `institution_id` belonging to Institution B, the security interceptor halts execution and logs a high-severity security alert.

---

## 4. AI & Voice Privacy Safeguards
- **Prompt Injection Defense:** User queries directed to the RAG learning assistant are sanitized and passed through strict system prompt guardrails.
- **PII Scrubbing in LLM Context:** Student phone numbers, national IDs, and guardian financial balances are stripped before sending context to external LLM providers.
- **Audio Privacy:** Audio streams are encrypted in transit via TLS / SRTP. Transcripts are retained according to the institution's retention policy.

