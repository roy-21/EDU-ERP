import { postgresService } from "../../database/postgres";
import { toIso } from "../hostel/hostel.common";
import { fail, text } from "../academics/academics.common";
import { assistantEngine, EngineUnavailable } from "./assistant-engine.client";
import { Asker } from "./assistant-live.service";
import { askService } from "./assistant.service";

// A website voice call. The Core is the hub: it checks who is calling and that the call is
// theirs, sends the recording to the Voice & Message Assistant Backend to be turned into
// text, answers that text with exactly the same pipeline as a typed question (read-only ERP
// data, approved knowledge, forwarding, refusal of changes), and has voice-api speak the answer.

const MAX_AUDIO_BASE64 = 6 * 1024 * 1024;

const sessionFromRow = (row: any) => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  channel: row.channel,
  status: row.status,
  language: row.language,
  turns: Number(row.turns),
  startedAt: toIso(row.started_at),
  endedAt: toIso(row.ended_at),
});

const turnFromRow = (row: any) => ({
  id: row.id,
  speaker: row.speaker,
  text: row.text,
  language: row.language,
  questionId: row.question_id,
  audioMs: Number(row.audio_ms),
  processingMs: Number(row.processing_ms),
  createdAt: toIso(row.created_at),
});

// The call must be the asker's own, in their institution, and still going.
const ownCall = async (asker: Asker, sessionId: string) => {
  const row = (await postgresService.query(
    "SELECT * FROM voice_sessions WHERE institution_id = $1 AND id = $2 AND user_id = $3",
    [asker.institutionId, sessionId, asker.userId]
  )).rows[0];
  if (!row) fail(404, "Call not found.");
  return row;
};

const unavailable = (err: any) => {
  if (err instanceof EngineUnavailable) fail(503, err.message);
  throw err;
};

export const voiceCallService = {
  async start(asker: Asker) {
    const id = await assistantEngine.startCall({ institution_id: asker.institutionId, user_id: asker.userId, user_name: asker.fullName }).catch(unavailable);
    return { id };
  },

  async turn(asker: Asker, sessionId: string, body: any) {
    const call = await ownCall(asker, sessionId);
    if (call.status !== "ACTIVE") fail(409, "This call has ended. Start a new call.");
    const audio = typeof body?.audioBase64 === "string" ? body.audioBase64 : "";
    if (!audio) fail(400, "No recording was sent.");
    if (audio.length > MAX_AUDIO_BASE64) fail(413, "The recording is too long. Ask a shorter question.");
    const hint = body?.language === "bn" || body?.language === "en" ? body.language : undefined;

    const heard = await assistantEngine.listen(sessionId, { institution_id: asker.institutionId, audio_base64: audio, language_hint: hint })
      .catch((err: any) => {
        if (err instanceof EngineUnavailable) fail(503, err.message);
        const match = /HTTP (4\d\d): (.*)$/.exec(String(err.message));
        if (match) fail(Number(match[1]) === 413 ? 413 : 422, match[2]);
        throw err;
      });

    // The same pipeline as typing the question: same permissions, same read-only data, same safety.
    const answer = await askService.ask(asker, { question: text(heard.text, "Question", 1000, true) }, "VOICE");

    let speech: { audioBase64: string; mimeType: string; audioMs: number } | null = null;
    let speechError = "";
    try {
      speech = await assistantEngine.speak(sessionId, { institution_id: asker.institutionId, text: answer.answer, language: heard.language, question_id: answer.id });
    } catch (err: any) {
      // The written answer is still given if speaking it fails.
      speechError = err instanceof EngineUnavailable ? err.message : "The answer could not be spoken.";
    }
    return { heard: heard.text, language: heard.language, answer, audio: speech, speechError };
  },

  async end(asker: Asker, sessionId: string) {
    await ownCall(asker, sessionId);
    await assistantEngine.endCall(sessionId, asker.institutionId).catch(unavailable);
    return { id: sessionId, ended: true };
  },

  async mine(asker: Asker) {
    const { rows } = await postgresService.query(
      "SELECT * FROM voice_sessions WHERE institution_id = $1 AND user_id = $2 ORDER BY started_at DESC LIMIT 20",
      [asker.institutionId, asker.userId]
    );
    return rows.map(sessionFromRow);
  },

  // Every call of the institution with its transcript, for people who run the assistant.
  async all(institutionId: string) {
    const { rows } = await postgresService.query("SELECT * FROM voice_sessions WHERE institution_id = $1 ORDER BY started_at DESC LIMIT 200", [institutionId]);
    return rows.map(sessionFromRow);
  },

  async transcript(institutionId: string, sessionId: string, onlyUserId?: string) {
    const session = (await postgresService.query(
      "SELECT * FROM voice_sessions WHERE institution_id = $1 AND id = $2 AND ($3::text IS NULL OR user_id = $3)",
      [institutionId, sessionId, onlyUserId || null]
    )).rows[0];
    if (!session) fail(404, "Call not found.");
    const { rows } = await postgresService.query("SELECT * FROM voice_turns WHERE session_id = $1 ORDER BY created_at", [sessionId]);
    return { ...sessionFromRow(session), transcript: rows.map(turnFromRow) };
  },

  async status() {
    try {
      const data: any = await assistantEngine.voiceStatus();
      return {
        reachable: true,
        stt: Boolean(data.stt), sttModel: data.stt_model || "", tts: Boolean(data.tts), ttsModels: data.tts_models || {},
        transcripts: Boolean(data.transcripts), maxSeconds: Number(data.max_seconds) || 60, errors: data.errors || {},
      };
    } catch {
      return { reachable: false, stt: false, sttModel: "", tts: false, ttsModels: {}, transcripts: false, maxSeconds: 60, errors: {} };
    }
  },
};
