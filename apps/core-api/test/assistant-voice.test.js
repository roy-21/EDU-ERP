// Needs PostgreSQL. Website voice calls through the Core, and the Row Level Security that keeps
// the Voice & Message Assistant Backend's own database login inside one institution.
const assert = require("node:assert");
const http = require("node:http");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { assistantEngine } = require("../dist/modules/assistant/assistant-engine.client");
const { createClient, ensureUser, live, removeInstitutions } = require("./hostel-helpers");

let server;
let baseUrl;
let voiceServer;
const clients = [];
const voice = { heard: "Change my attendance to present", language: "en", spoken: [], down: false };

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => resolve(data ? JSON.parse(data) : {}));
});

test.before(async () => {
  await postgresService.initialize();
  // A stand-in for voice-api: it stores the call row the way voice-api does and "hears" a fixed sentence.
  voiceServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (voice.down) return json(res, 503, { detail: "speech down for the test" });
    if (req.url.endsWith("/voice/web/status")) return json(res, 200, { data: { stt: true, tts: true, stt_model: "whisper-small", transcripts: true, max_seconds: 60 } });
    if (req.url.endsWith("/voice/assistant/status")) return json(res, 200, { data: { llm: false, embeddings: false } });
    if (req.url.endsWith("/voice/web/sessions")) {
      const id = randomUUID();
      await postgresService.query("INSERT INTO voice_sessions (id, institution_id, user_id, user_name) VALUES ($1, $2, $3, $4)", [id, body.institution_id, body.user_id, body.user_name]);
      return json(res, 200, { data: { session_id: id } });
    }
    if (req.url.endsWith("/listen")) return json(res, 200, { data: { text: voice.heard, language: voice.language, audio_ms: 2400 } });
    if (req.url.endsWith("/speak")) {
      voice.spoken.push(body);
      return json(res, 200, { data: { audio_base64: Buffer.from("RIFFfake").toString("base64"), mime_type: "audio/wav", audio_ms: 3000 } });
    }
    if (req.url.endsWith("/end")) {
      await postgresService.query("UPDATE voice_sessions SET status = 'ENDED', ended_at = NOW() WHERE id = $1", [req.url.split("/").slice(-2)[0]]);
      return json(res, 200, { data: { ended: true } });
    }
    return json(res, 404, {});
  });
  await new Promise((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
  process.env.VOICE_API_URL = `http://127.0.0.1:${voiceServer.address().port}/api/v1`;
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  if (postgresService.isLive()) await removeInstitutions(clients.map((client) => client.institution));
  await new Promise((resolve) => server.close(resolve));
  voiceServer.close();
  setTimeout(() => process.exit(), 200).unref();
});

const tenant = () => {
  const client = createClient(() => baseUrl);
  clients.push(client);
  return client;
};
const ok = (res, status = 200) => {
  assert.strictEqual(res.status, status, res.error);
  return res.data;
};

test("a website voice call is answered by the same safe pipeline and kept to its caller", live(async () => {
  assistantEngine.resetStatus();
  const ctx = tenant();
  await ensureUser("STUDENT", ctx.institution);

  const status = ok(await ctx.call("GET", "/assistant/voice/status", undefined, "STUDENT"));
  assert.strictEqual(status.stt, true);

  const { id } = ok(await ctx.call("POST", "/assistant/voice/calls", {}, "STUDENT"), 201);
  assert.strictEqual((await ctx.call("POST", `/assistant/voice/calls/${id}/turn`, {}, "STUDENT")).status, 400, "a recording is required");

  // Whatever is heard goes through the same rules as typing: a change request is refused.
  const turn = ok(await ctx.call("POST", `/assistant/voice/calls/${id}/turn`, { audioBase64: Buffer.from("audio").toString("base64") }, "STUDENT"));
  assert.strictEqual(turn.heard, "Change my attendance to present");
  assert.strictEqual(turn.answer.status, "REFUSED");
  assert.strictEqual(turn.answer.channel, "VOICE");
  assert.strictEqual(turn.audio.mimeType, "audio/wav");
  assert.strictEqual(voice.spoken.at(-1).question_id, turn.answer.id, "the spoken answer is linked to the question");
  assert.strictEqual(voice.spoken.at(-1).institution_id, ctx.institution);

  // Somebody else in the same institution cannot use or read this call.
  assert.strictEqual((await ctx.call("POST", `/assistant/voice/calls/${id}/turn`, { audioBase64: "YQ==" }, "TEACHER")).status, 404);
  assert.strictEqual((await ctx.call("GET", `/assistant/voice/calls/mine/${id}`, undefined, "TEACHER")).status, 404);
  assert.strictEqual((await ctx.call("GET", "/assistant/voice/calls", undefined, "STUDENT")).status, 403, "only analytics staff see every call");
  assert.ok(ok(await ctx.call("GET", "/assistant/voice/calls")).some((call) => call.id === id));

  // If speaking fails, the written answer still comes back.
  voice.down = false;
  const original = assistantEngine.speak;
  assistantEngine.speak = async () => { throw new (require("../dist/modules/assistant/assistant-engine.client").EngineUnavailable)("speech down"); };
  const quiet = ok(await ctx.call("POST", `/assistant/voice/calls/${id}/turn`, { audioBase64: "YQ==" }, "STUDENT"));
  assistantEngine.speak = original;
  assert.strictEqual(quiet.audio, null);
  assert.match(quiet.speechError, /speech down/);

  ok(await ctx.call("POST", `/assistant/voice/calls/${id}/end`, {}, "STUDENT"));
  assert.strictEqual((await ctx.call("POST", `/assistant/voice/calls/${id}/turn`, { audioBase64: "YQ==" }, "STUDENT")).status, 409, "an ended call takes no more turns");
}));

test("the voice service's database login only sees its own institution's calls", live(async (t) => {
  const password = process.env.VOICE_DB_PASSWORD;
  if (!password) return t.skip("VOICE_DB_PASSWORD is not set, so the voice_service role is not created");
  const a = tenant();
  const b = tenant();
  await ensureUser("ADMIN", a.institution);
  await ensureUser("ADMIN", b.institution);
  const callA = randomUUID();
  const callB = randomUUID();
  await postgresService.query("INSERT INTO voice_sessions (id, institution_id, user_id) VALUES ($1, $2, 'u1'), ($3, $4, 'u2')", [callA, a.institution, callB, b.institution]);

  const url = new URL(process.env.ERP_DATABASE_URL || process.env.DATABASE_URL);
  url.username = "voice_service";
  url.password = password;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const asTenant = async (institutionId, sql, params = []) => {
      await db.query("BEGIN");
      try {
        await db.query("SELECT set_config('app.institution_id', $1, true)", [institutionId]);
        const result = await db.query(sql, params);
        await db.query("COMMIT");
        return result;
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    };
    const seen = (await asTenant(a.institution, "SELECT id FROM voice_sessions WHERE id = ANY($1)", [[callA, callB]])).rows.map((row) => row.id);
    assert.deepStrictEqual(seen, [callA], "only its own institution's call is visible");
    assert.strictEqual((await db.query("SELECT COUNT(*)::int AS n FROM voice_sessions WHERE id = ANY($1)", [[callA, callB]])).rows[0].n, 0, "nothing without an institution");
    await assert.rejects(asTenant(a.institution, "INSERT INTO voice_turns (id, institution_id, session_id, speaker, text) VALUES ($1, $2, $3, 'CALLER', 'x')",
      [randomUUID(), b.institution, callB]), /row-level security/, "it cannot write another institution's transcript");
    const updated = await asTenant(a.institution, "UPDATE voice_sessions SET turns = 99 WHERE id = $1", [callB]);
    assert.strictEqual(updated.rowCount, 0, "it cannot change another institution's call");
    await assert.rejects(db.query("SELECT 1 FROM ai_questions LIMIT 1"), /permission denied/, "it cannot read other tables");
    await assert.rejects(db.query("SELECT 1 FROM erp_users LIMIT 1"), /permission denied/);
  } finally {
    await db.end();
  }
}));
