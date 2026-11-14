import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { fail, inTx, oneOf, text } from "../academics/academics.common";
import { assistantEngine, Passage } from "./assistant-engine.client";
import { createEscalation, deliverEscalation, deliveryStatus, settingsService } from "./assistant-escalation.service";
import { bestSentences, Hit, knowledgeService, searchKnowledge, SUPPORTED_EXTENSIONS } from "./assistant-knowledge.service";
import { Asker, liveDataService } from "./assistant-live.service";
import { intentOf, Language, languageOf } from "./assistant-text";

// The ask pipeline:
//   1. a request to change data is refused (the assistant has no way to change data anyway);
//   2. a question about live records is answered from the ERP, read-only, for the asker only;
//   3. anything else is answered only from the institution's approved knowledge;
//   4. if that knowledge does not answer it, the question goes to a responsible person.

const say = (lang: Language, en: string, bn: string) => (lang === "bn" ? bn : en);

const REFUSAL = (lang: Language) => say(lang,
  "I can only read information and answer questions. I cannot change attendance, results, payments, users, applications, settings or any other record. Please ask the responsible office to make that change.",
  "আমি শুধু তথ্য পড়ে প্রশ্নের উত্তর দিতে পারি। হাজিরা, ফলাফল, পেমেন্ট, ইউজার, আবেদন, সেটিংস বা অন্য কোনো রেকর্ড আমি পরিবর্তন করতে পারি না। এই পরিবর্তনের জন্য সংশ্লিষ্ট অফিসে যোগাযোগ করুন।");

const FORWARDED = (lang: Language) => say(lang,
  "I could not find a verified answer to this. Your question has been forwarded to the responsible person. You will be notified when an answer becomes available.",
  "এর যাচাই করা উত্তর আমার কাছে নেই। আপনার প্রশ্নটি সংশ্লিষ্ট দায়িত্বপ্রাপ্ত ব্যক্তির কাছে পাঠানো হয়েছে। উত্তর পাওয়া গেলে আপনাকে জানানো হবে।");

const questionFromRow = (row: any) => ({
  id: row.id,
  question: row.question,
  language: row.language,
  kind: row.kind,
  topic: row.topic,
  status: row.status,
  answer: row.answer,
  answerSource: row.answer_source,
  mode: row.mode,
  confidence: row.confidence === null ? null : Number(row.confidence),
  sources: row.sources || [],
  feedback: row.feedback,
  channel: row.channel || "TEXT",
  feedbackNote: row.feedback_note,
  askerName: row.asker_name,
  askerRole: row.asker_role,
  createdAt: toIso(row.created_at),
  answeredAt: toIso(row.answered_at),
});

// A simple per-person limit, so one account cannot run up the AI bill.
const recent = new Map<string, number[]>();
const RATE_LIMIT = Number(process.env.ASSISTANT_RATE_LIMIT_PER_MINUTE) || 20;
const checkRate = (key: string) => {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((at) => now - at < 60_000);
  if (hits.length >= RATE_LIMIT) fail(429, "Too many questions in a minute. Please wait a moment.");
  hits.push(now);
  recent.set(key, hits);
};

type Outcome = {
  status: "ANSWERED" | "ESCALATED" | "REFUSED" | "NO_DATA";
  answer: string;
  source: "DOCUMENT" | "KNOWLEDGE" | "ERP" | "REFUSAL" | "ESCALATION";
  mode: "LLM" | "EXTRACTIVE" | "RULE";
  confidence: number | null;
  sources: { kind: string; id: string; title: string; score?: number }[];
};

const sourceOf = (hit: Hit) => ({ kind: hit.kind, id: hit.sourceId, title: hit.title, score: hit.score });

// Answers a knowledge question from approved knowledge, or reports that it cannot.
const fromKnowledge = async (institutionId: string, question: string, lang: Language, minConfidence: number): Promise<Outcome | null> => {
  const hits = await searchKnowledge(institutionId, question, 6);
  const status = await assistantEngine.status();

  // With a language model: it may only use the passages given, and says when they do not answer.
  if (status.llm) {
    // Shared words, or close meaning. With bge-m3, unrelated text scores about 0.4 and a
    // matching passage 0.6 or more, so meaning alone must reach 0.55.
    const passages = hits.filter((hit) => Math.max(hit.coverage, hit.similarity) >= 0.2 || (hit.semantic ?? 0) >= 0.55);
    if (passages.length === 0) return null;
    try {
      const institution = (await postgresService.query("SELECT name FROM erp_tenants WHERE id = $1", [institutionId])).rows[0]?.name || "";
      const result = await assistantEngine.answer({
        question,
        language: lang,
        institution,
        passages: passages.map<Passage>((hit) => ({
          id: hit.chunkId,
          title: hit.kind === "KNOWLEDGE" ? "Approved answer" : hit.title,
          text: hit.kind === "KNOWLEDGE" ? `Question: ${hit.text.split("\n")[0].replace(/^Question: /, "")}\nAnswer: ${hit.answer}${hit.explanation ? `\n${hit.explanation}` : ""}` : hit.text,
        })),
      });
      if (!result.answerable || !result.answer.trim()) return null;
      const used = passages.filter((hit) => result.usedSourceIds.includes(hit.chunkId));
      const cited = used.length ? used : passages.slice(0, 1);
      return {
        status: "ANSWERED",
        answer: result.answer.trim(),
        source: cited.some((hit) => hit.kind === "KNOWLEDGE") ? "KNOWLEDGE" : "DOCUMENT",
        mode: "LLM",
        confidence: Math.min(1, Math.max(...cited.map((hit) => Math.max(hit.score, hit.semantic ?? 0)))),
        sources: cited.map(sourceOf),
      };
    } catch (err: any) {
      console.warn("[Assistant] Language model unavailable; answering from stored text only:", err.message);
    }
  }

  // Without a language model: an approved answer to the same question, or the exact
  // sentences of a document that clearly covers it. Otherwise, no answer.
  const approved = hits.filter((hit) => hit.kind === "KNOWLEDGE").sort((a, b) => b.similarity - a.similarity)[0];
  if (approved && Math.max(approved.similarity, approved.semantic ?? 0) >= minConfidence) {
    return {
      status: "ANSWERED",
      answer: [approved.answer, approved.explanation].filter(Boolean).join("\n\n"),
      source: "KNOWLEDGE",
      mode: "EXTRACTIVE",
      confidence: Math.max(approved.similarity, approved.semantic ?? 0),
      sources: [sourceOf(approved)],
    };
  }
  const document = hits.filter((hit) => hit.kind === "DOCUMENT").sort((a, b) => b.coverage - a.coverage)[0];
  const documentBar = Math.max(0.75, minConfidence);
  if (document && Math.max(document.coverage, document.semantic ?? 0) >= documentBar) {
    return {
      status: "ANSWERED",
      answer: say(lang, `From "${document.title}": ${bestSentences(document.text, question)}`, `"${document.title}" অনুযায়ী: ${bestSentences(document.text, question)}`),
      source: "DOCUMENT",
      mode: "EXTRACTIVE",
      confidence: Math.max(document.coverage, document.semantic ?? 0),
      sources: [sourceOf(document)],
    };
  }
  return null;
};

export const askService = {
  async ask(asker: Asker, body: any, channel: "TEXT" | "VOICE" = "TEXT") {
    const question = text(body?.question, "Question", 1000, true).replace(/\s+/g, " ");
    if (question.length < 2) fail(400, "Ask a question.");
    checkRate(`${asker.institutionId}:${asker.userId}`);
    const lang = languageOf(question);
    const intent = intentOf(question);
    const settings = await settingsService.get(asker.institutionId);

    let outcome: Outcome;
    let topic = "";
    if (intent.kind === "ACTION") {
      outcome = { status: "REFUSED", answer: REFUSAL(lang), source: "REFUSAL", mode: "RULE", confidence: null, sources: [] };
    } else if (intent.kind === "LIVE_DATA") {
      topic = intent.topic;
      const live = await liveDataService.answer(asker, intent.topic, question, lang, settings.timezone);
      outcome = { status: live.status, answer: live.answer, source: "ERP", mode: "RULE", confidence: null, sources: [{ kind: "ERP", id: intent.topic, title: intent.topic }] };
    } else {
      const found = await fromKnowledge(asker.institutionId, question, lang, settings.minConfidence);
      outcome = found || { status: "ESCALATED", answer: FORWARDED(lang), source: "ESCALATION", mode: "RULE", confidence: null, sources: [] };
    }

    const id = newId();
    let escalationId: string | null = null;
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO ai_questions (id, institution_id, asked_by, asker_name, asker_role, question, language, kind, topic, status, answer, answer_source,
           mode, confidence, sources, answered_at, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [id, asker.institutionId, asker.userId, asker.fullName, asker.role, question, lang, intent.kind, topic, outcome.status, outcome.answer, outcome.source,
          outcome.mode, outcome.confidence === null ? null : Math.round(outcome.confidence * 1000) / 1000, JSON.stringify(outcome.sources),
          outcome.status === "ESCALATED" ? null : new Date(), channel]
      );
      if (outcome.status === "ESCALATED") escalationId = (await createEscalation(tx, asker.institutionId, id, question)).id;
      if (outcome.status === "REFUSED") {
        await audit(tx, { institutionId: asker.institutionId, userId: asker.userId, email: asker.fullName }, "assistant.action.refused", "ai_question", id,
          `Refused a request to change data: "${question.slice(0, 300)}"`);
      }
    });
    if (escalationId) await deliverEscalation(escalationId).catch((err) => console.error("[Assistant] Forwarding failed:", err.message));
    return this.mine(asker, id);
  },

  async mine(asker: Asker, id: string) {
    const { rows } = await postgresService.query("SELECT * FROM ai_questions WHERE institution_id = $1 AND asked_by = $2 AND id = $3", [asker.institutionId, asker.userId, id]);
    if (!rows[0]) fail(404, "Question not found.");
    return questionFromRow(rows[0]);
  },

  async history(asker: Asker) {
    const { rows } = await postgresService.query(
      "SELECT * FROM ai_questions WHERE institution_id = $1 AND asked_by = $2 ORDER BY created_at DESC LIMIT 50",
      [asker.institutionId, asker.userId]
    );
    return rows.map(questionFromRow);
  },

  async feedback(asker: Asker, id: string, body: any) {
    const value = oneOf(body?.feedback, "Feedback", ["HELPFUL", "NOT_HELPFUL"] as const);
    const note = text(body?.note, "Note", 500);
    const { rowCount } = await postgresService.query(
      `UPDATE ai_questions SET feedback = $4, feedback_note = $5 WHERE institution_id = $1 AND asked_by = $2 AND id = $3
         AND status IN ('ANSWERED', 'ANSWERED_LATER', 'NO_DATA')`,
      [asker.institutionId, asker.userId, id, value, note]
    );
    if (!rowCount) fail(404, "Only your own answered questions can be rated.");
    return this.mine(asker, id);
  },

  async all(institutionId: string, filters: { status?: string; kind?: string; search?: string }) {
    const { rows } = await postgresService.query(
      `SELECT * FROM ai_questions WHERE institution_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR kind = $3)
         AND ($4::text IS NULL OR question ILIKE '%' || $4 || '%') ORDER BY created_at DESC LIMIT 300`,
      [institutionId, filters.status || null, filters.kind || null, filters.search || null]
    );
    return rows.map(questionFromRow);
  },
};

// ---- Review of answers before the assistant learns them -------------------------------

const reviewFromRow = (row: any) => ({
  id: row.id,
  questionId: row.question_id,
  escalationId: row.escalation_id,
  question: row.question,
  receivedAnswer: row.received_answer,
  answeredBy: row.answered_by,
  answeredVia: row.answered_via || "",
  contactName: row.contact_name || "",
  askerName: row.asker_name || "",
  askedAt: toIso(row.asked_at || null),
  aiDraft: row.ai_draft,
  finalAnswer: row.final_answer,
  explanation: row.explanation,
  status: row.status,
  reviewedBy: row.reviewed_by,
  reviewedAt: toIso(row.reviewed_at),
  reviewNote: row.review_note,
  knowledgeId: row.knowledge_id,
  createdAt: toIso(row.created_at),
});

const REVIEW_SELECT = `SELECT r.*, e.answered_via, e.contact_name, q.asker_name, q.created_at AS asked_at
  FROM ai_reviews r JOIN ai_questions q ON q.id = r.question_id LEFT JOIN ai_escalations e ON e.id = r.escalation_id`;

export const reviewsService = {
  async list(institutionId: string, status = "PENDING") {
    const { rows } = await postgresService.query(
      `${REVIEW_SELECT} WHERE r.institution_id = $1 AND ($2 = 'ALL' OR r.status = $2) ORDER BY r.created_at DESC LIMIT 300`,
      [institutionId, status]
    );
    return rows.map(reviewFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${REVIEW_SELECT} WHERE r.institution_id = $1 AND r.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Review not found.");
    return reviewFromRow(rows[0]);
  },

  // Saves the admin's edits without approving yet.
  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const review = (await tx.query("SELECT status FROM ai_reviews WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!review) fail(404, "Review not found.");
      if (review.status !== "PENDING") fail(409, "This review is already decided.");
      await tx.query("UPDATE ai_reviews SET final_answer = $2, explanation = $3 WHERE id = $1",
        [id, text(body?.finalAnswer, "Answer", 5000, true), text(body?.explanation, "Explanation", 5000)]);
    });
    return this.get(actor.institutionId, id);
  },

  // Only here does an answer become knowledge: the admin's final wording is stored, indexed,
  // and given to the person who asked.
  async approve(actor: Actor, id: string, body: any) {
    const finalAnswer = text(body?.finalAnswer, "Answer", 5000, true);
    const explanation = text(body?.explanation, "Explanation", 5000);
    await inTx(async (tx) => {
      const review = (await tx.query("SELECT * FROM ai_reviews WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!review) fail(404, "Review not found.");
      if (review.status !== "PENDING") fail(409, "This review is already decided.");
      const question = text(body?.question, "Question", 1000) || review.question;
      const knowledgeId = await knowledgeService.addApproved(tx, actor, { question, answer: finalAnswer, explanation, sourceQuestionId: review.question_id });
      await tx.query(
        `UPDATE ai_reviews SET status = 'APPROVED', final_answer = $2, explanation = $3, reviewed_by = $4, reviewed_at = NOW(), knowledge_id = $5,
           review_note = $6 WHERE id = $1`,
        [id, finalAnswer, explanation, actor.email, knowledgeId, text(body?.note, "Note", 500)]
      );
      await tx.query(
        "UPDATE ai_questions SET status = 'ANSWERED_LATER', answer = $2, answer_source = 'HUMAN', mode = 'REVIEWED', answered_at = NOW() WHERE id = $1",
        [review.question_id, [finalAnswer, explanation].filter(Boolean).join("\n\n")]
      );
      await audit(tx, actor, "assistant.review.approve", "ai_review", id, `Approved an answer to "${question.slice(0, 200)}". The assistant can now use it.`);
    });
    return this.get(actor.institutionId, id);
  },

  async reject(actor: Actor, id: string, body: any) {
    const note = text(body?.note, "Reason", 500, true);
    await inTx(async (tx) => {
      const review = (await tx.query("SELECT status, question FROM ai_reviews WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!review) fail(404, "Review not found.");
      if (review.status !== "PENDING") fail(409, "This review is already decided.");
      await tx.query("UPDATE ai_reviews SET status = 'REJECTED', reviewed_by = $2, reviewed_at = NOW(), review_note = $3 WHERE id = $1", [id, actor.email, note]);
      await audit(tx, actor, "assistant.review.reject", "ai_review", id, `Rejected an answer to "${review.question.slice(0, 200)}". ${note}`);
    });
    return this.get(actor.institutionId, id);
  },

  // An admin may also write an answer directly; writing it is the approval.
  async addDirect(actor: Actor, body: any) {
    const question = text(body?.question, "Question", 1000, true);
    const answer = text(body?.answer, "Answer", 5000, true);
    const explanation = text(body?.explanation, "Explanation", 5000);
    let knowledgeId = "";
    await inTx(async (tx) => {
      knowledgeId = await knowledgeService.addApproved(tx, actor, { question, answer, explanation, sourceQuestionId: null });
      await audit(tx, actor, "assistant.knowledge.add", "ai_knowledge", knowledgeId, `Added an approved answer to "${question.slice(0, 200)}".`);
    });
    return (await knowledgeService.list(actor.institutionId, "ALL")).find((item: { id: string }) => item.id === knowledgeId);
  },
};

// ---- Analytics -------------------------------------------------------------------------

export const analyticsService = {
  async summary(institutionId: string) {
    const [questions, escalations, reviews, knowledge, documents, daily, topSources] = await Promise.all([
      postgresService.query(
        `SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'ANSWERED' AND answer_source IN ('DOCUMENT', 'KNOWLEDGE'))::int AS from_knowledge,
           COUNT(*) FILTER (WHERE status = 'ANSWERED' AND answer_source = 'ERP')::int AS from_erp,
           COUNT(*) FILTER (WHERE status = 'NO_DATA')::int AS no_data,
           COUNT(*) FILTER (WHERE status = 'ESCALATED')::int AS unresolved,
           COUNT(*) FILTER (WHERE status = 'ANSWERED_LATER')::int AS answered_later,
           COUNT(*) FILTER (WHERE status = 'REFUSED')::int AS refused,
           COUNT(*) FILTER (WHERE feedback = 'HELPFUL')::int AS helpful,
           COUNT(*) FILTER (WHERE feedback = 'NOT_HELPFUL')::int AS not_helpful,
           COUNT(*) FILTER (WHERE mode = 'LLM')::int AS by_llm,
           COUNT(*) FILTER (WHERE mode = 'EXTRACTIVE')::int AS by_extract
         FROM ai_questions WHERE institution_id = $1`, [institutionId]),
      postgresService.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('SENDING', 'SENT', 'FAILED'))::int AS pending,
           COUNT(*) FILTER (WHERE status = 'WAITING_ADMIN')::int AS waiting_admin, COUNT(*) FILTER (WHERE status = 'ANSWERED')::int AS answered,
           COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed, COUNT(*) FILTER (WHERE sms_status = 'SENT')::int AS sms_sent,
           COUNT(*) FILTER (WHERE email_status = 'SENT')::int AS email_sent, COUNT(*) FILTER (WHERE call_status = 'SENT')::int AS calls,
           COUNT(*) FILTER (WHERE 'FAILED' IN (sms_status, email_status, call_status))::int AS delivery_failed
         FROM ai_escalations WHERE institution_id = $1`, [institutionId]),
      postgresService.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending, COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
           COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected FROM ai_reviews WHERE institution_id = $1`, [institutionId]),
      postgresService.query("SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active, COUNT(*)::int AS total FROM ai_knowledge WHERE institution_id = $1", [institutionId]),
      postgresService.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'READY')::int AS ready, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
           COUNT(*) FILTER (WHERE status IN ('QUEUED', 'PROCESSING'))::int AS processing, COALESCE(SUM(chunk_count), 0)::int AS chunks,
           COALESCE(SUM(embedded_chunks), 0)::int AS embedded FROM ai_documents WHERE institution_id = $1`, [institutionId]),
      postgresService.query(
        `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM-DD') AS day, COUNT(*)::int AS asked,
           COUNT(*) FILTER (WHERE status = 'ANSWERED')::int AS answered, COUNT(*) FILTER (WHERE status IN ('ESCALATED', 'ANSWERED_LATER'))::int AS forwarded
         FROM ai_questions WHERE institution_id = $1 AND created_at >= NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY 1`, [institutionId]),
      postgresService.query(
        `SELECT s->>'kind' AS kind, s->>'id' AS id, s->>'title' AS title, COUNT(*)::int AS uses
         FROM ai_questions q, jsonb_array_elements(q.sources) s WHERE q.institution_id = $1 AND q.status = 'ANSWERED' AND s->>'kind' IN ('DOCUMENT', 'KNOWLEDGE')
         GROUP BY 1, 2, 3 ORDER BY uses DESC LIMIT 10`, [institutionId]),
    ]);
    const q = questions.rows[0];
    const rated = q.helpful + q.not_helpful;
    return {
      questions: {
        total: q.total, answeredFromKnowledge: q.from_knowledge, answeredFromErp: q.from_erp, noData: q.no_data, unresolved: q.unresolved,
        answeredLater: q.answered_later, refused: q.refused, byLanguageModel: q.by_llm, byStoredText: q.by_extract,
        automaticRate: q.total ? Math.round(((q.from_knowledge + q.from_erp) / q.total) * 1000) / 10 : null,
      },
      feedback: { helpful: q.helpful, notHelpful: q.not_helpful, accuracy: rated ? Math.round((q.helpful / rated) * 1000) / 10 : null },
      escalations: escalations.rows[0],
      reviews: reviews.rows[0],
      knowledge: knowledge.rows[0],
      documents: documents.rows[0],
      daily: daily.rows,
      topSources: topSources.rows,
    };
  },

  async status() {
    const ai = await assistantEngine.status(true);
    return { ai, delivery: deliveryStatus(), supportedFiles: SUPPORTED_EXTENSIONS };
  },
};
