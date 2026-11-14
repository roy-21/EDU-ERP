import { config } from "../../config/environment";

// The Core ERP's door to the Voice & Message Assistant Backend (apps/voice-api), which runs the
// message assistant engine: answers, document reading, embeddings and answer drafts. Every user
// request reaches the Core first; the Core checks who is asking and what they may see, then sends
// only the passages it chose. The assistant backend never sees a user's token or the ERP records.

export class EngineUnavailable extends Error {}

export type Passage = { id: string; title: string; text: string };
export type EngineStatus = {
  reachable: boolean;
  llm: boolean;
  provider: string;
  model: string;
  llmProblem: string;
  embeddings: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  extract: string[];
};
export type GroundedAnswer = { answerable: boolean; answer: string; usedSourceIds: string[]; model: string };

// A model on the institution's own CPU can take a minute or more per answer.
const TIMEOUT_MS = Number((process.env.ASSISTANT_API_TIMEOUT_MS || process.env.AI_API_TIMEOUT_MS)) || 180_000;
// Speech on a CPU can wait for a model to finish loading (minutes the first time after a start).
const SPEECH_TIMEOUT_MS = Number(process.env.ASSISTANT_SPEECH_TIMEOUT_MS) || 600_000;
const base = () => (process.env.VOICE_API_URL || config.voiceApiUrl).replace(/\/$/, "");

const call = async (path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number }) => {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      method: init.method,
      headers: { "Content-Type": "application/json", "X-Service-Token": process.env.SERVICE_SECRET_VOICE || config.serviceSecretVoice },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs || TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new EngineUnavailable(`The voice & message assistant service could not be reached (${err?.cause?.code || err?.name || "network error"}).`);
  }
  const json: any = await response.json().catch(() => ({}));
  if (response.status === 503) throw new EngineUnavailable(`The voice & message assistant service is unavailable: ${json?.detail || "not configured for this"}. It will be tried again.`);
  if (!response.ok) throw new Error(`Assistant service answered HTTP ${response.status}: ${json?.detail || json?.error || "error"}`);
  return json?.data ?? json;
};

let cached: { at: number; value: EngineStatus } | null = null;

export const assistantEngine = {
  async status(fresh = false): Promise<EngineStatus> {
    // A healthy answer is kept for 30 s; "unreachable" only for 5 s, so a restarted service is found quickly.
    if (!fresh && cached && Date.now() - cached.at < (cached.value.reachable ? 30_000 : 5_000)) return cached.value;
    let value: EngineStatus;
    try {
      const data = await call("/voice/assistant/status", { method: "GET", timeoutMs: 5_000 });
      value = {
        reachable: true,
        llm: Boolean(data.llm),
        provider: data.provider || "",
        model: data.model || "",
        llmProblem: data.llm_problem || "",
        embeddings: Boolean(data.embeddings),
        embeddingProvider: data.embedding_provider || "",
        embeddingModel: data.embedding_model || "",
        extract: Array.isArray(data.extract) ? data.extract : [],
      };
    } catch {
      value = { reachable: false, llm: false, provider: "", model: "", llmProblem: "The voice & message assistant service is not reachable.", embeddings: false,
        embeddingProvider: "", embeddingModel: "", extract: [] };
    }
    cached = { at: Date.now(), value };
    return value;
  },

  resetStatus() {
    cached = null;
  },

  async extract(fileName: string, mimeType: string, content: Buffer): Promise<string> {
    const data = await call("/voice/assistant/extract", {
      method: "POST",
      body: { file_name: fileName, mime_type: mimeType, content_base64: content.toString("base64") },
      timeoutMs: 120_000,
    });
    return String(data.text || "");
  },

  // Null when no embedding provider is configured: search then runs on words alone.
  async embed(texts: string[], inputType: "document" | "query"): Promise<{ vectors: number[][]; model: string } | null> {
    if (texts.length === 0) return { vectors: [], model: "" };
    const status = await this.status();
    if (!status.embeddings) return null;
    const data = await call("/voice/assistant/embed", { method: "POST", body: { texts, input_type: inputType } });
    return { vectors: data.vectors, model: data.model };
  },

  async answer(input: { question: string; language: string; institution: string; passages: Passage[] }): Promise<GroundedAnswer> {
    const data = await call("/voice/assistant/answer", { method: "POST", body: input });
    return { answerable: Boolean(data.answerable), answer: String(data.answer || ""), usedSourceIds: data.used_source_ids || [], model: data.model || "" };
  },

  // ---- Website voice calls (speech runs in voice-api) ------------------------------------

  async voiceStatus() {
    return call("/voice/web/status", { method: "GET", timeoutMs: 5_000 });
  },

  async startCall(input: { institution_id: string; user_id: string; user_name: string }): Promise<string> {
    const data = await call("/voice/web/sessions", { method: "POST", body: { ...input, channel: "WEB" }, timeoutMs: 15_000 });
    return String(data.session_id);
  },

  async listen(sessionId: string, input: { institution_id: string; audio_base64: string; language_hint?: string }) {
    const data = await call(`/voice/web/sessions/${encodeURIComponent(sessionId)}/listen`, { method: "POST", body: input, timeoutMs: SPEECH_TIMEOUT_MS });
    return { text: String(data.text || ""), language: data.language === "bn" ? "bn" : "en", audioMs: Number(data.audio_ms) || 0 };
  },

  async speak(sessionId: string, input: { institution_id: string; text: string; language: string; question_id?: string }) {
    const data = await call(`/voice/web/sessions/${encodeURIComponent(sessionId)}/speak`, { method: "POST", body: input, timeoutMs: SPEECH_TIMEOUT_MS });
    return { audioBase64: String(data.audio_base64 || ""), mimeType: String(data.mime_type || "audio/wav"), audioMs: Number(data.audio_ms) || 0 };
  },

  async endCall(sessionId: string, institutionId: string) {
    return call(`/voice/web/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST", body: { institution_id: institutionId }, timeoutMs: 15_000 });
  },

  // A tidy draft of a person's reply for the admin to review. It is only a suggestion.
  async draft(input: { question: string; received_answer: string; language: string }): Promise<string> {
    const data = await call("/voice/assistant/draft", { method: "POST", body: input });
    return String(data.draft || "");
  },
};
