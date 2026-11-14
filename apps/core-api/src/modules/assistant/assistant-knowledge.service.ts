import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { newId, toIso } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { fail, inTx, text } from "../academics/academics.common";
import { EngineUnavailable, assistantEngine } from "./assistant-engine.client";
import { chunkText, cleanText, termsOf, wordsOf } from "./assistant-text";

// The assistant's trusted knowledge: documents an admin uploaded, and answers an admin
// approved. Nothing else is ever searched. Every query is limited to one institution.

const MAX_BYTES = 7 * 1024 * 1024;
const MAX_ATTEMPTS = 6;

// What can be uploaded, and who reads it: plain text here, PDF and Word in the AI Backend.
const TYPES: Record<string, { mime: string; reader: "CORE" | "AI" }> = {
  pdf: { mime: "application/pdf", reader: "AI" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", reader: "AI" },
  txt: { mime: "text/plain", reader: "CORE" },
  md: { mime: "text/markdown", reader: "CORE" },
  csv: { mime: "text/csv", reader: "CORE" },
  html: { mime: "text/html", reader: "CORE" },
  htm: { mime: "text/html", reader: "CORE" },
};
export const SUPPORTED_EXTENSIONS = Object.keys(TYPES);

const extensionOf = (fileName: string) => (fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "");

const documentFromRow = (row: any) => ({
  id: row.id,
  title: row.title,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  status: row.status,
  error: row.error,
  attempts: Number(row.attempts),
  nextAttemptAt: toIso(row.next_attempt_at),
  chunkCount: Number(row.chunk_count),
  charCount: Number(row.char_count),
  embeddedChunks: Number(row.embedded_chunks),
  uploadedBy: row.uploaded_by,
  createdAt: toIso(row.created_at),
  processedAt: toIso(row.processed_at),
});

const knowledgeFromRow = (row: any) => ({
  id: row.id,
  question: row.question,
  answer: row.answer,
  explanation: row.explanation,
  sourceQuestionId: row.source_question_id,
  status: row.status,
  approvedBy: row.approved_by,
  approvedAt: toIso(row.approved_at),
  retiredBy: row.retired_by,
  retiredAt: toIso(row.retired_at),
  embedded: Boolean(row.embedded),
});

const DOC_COLUMNS = `id, institution_id, title, file_name, mime_type, size_bytes, status, error, attempts, next_attempt_at, chunk_count,
  char_count, embedded_chunks, uploaded_by, created_at, processed_at`;

// The file an admin uploads, checked before it is stored.
const fileOf = (body: any) => {
  const fileName = text(body?.fileName, "File name", 255, true);
  const extension = extensionOf(fileName);
  if (extension === "doc") fail(400, "Old .doc files cannot be read. Save it as .docx or PDF and upload that.");
  const type = TYPES[extension];
  if (!type) fail(400, `This file type cannot be read. Upload one of: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  if (typeof body?.contentBase64 !== "string" || !body.contentBase64) fail(400, "The file is empty.");
  const content = Buffer.from(body.contentBase64, "base64");
  if (content.length === 0) fail(400, "The file is empty.");
  if (content.length > MAX_BYTES) fail(413, "The file is larger than 7 MB. Split it into smaller files.");
  if (extension === "pdf" && content.subarray(0, 5).toString("latin1") !== "%PDF-") fail(400, "This is not a valid PDF file.");
  if (extension === "docx" && content.subarray(0, 2).toString("latin1") !== "PK") fail(400, "This is not a valid .docx file.");
  return { fileName, extension, mime: type.mime, content };
};

const stripHtml = (value: string) =>
  value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");

const readText = async (row: any): Promise<string> => {
  const extension = extensionOf(row.file_name);
  const content: Buffer = row.content;
  if (TYPES[extension]?.reader === "CORE") {
    const raw = content.toString("utf8").replace(/^﻿/, "");
    return extension === "html" || extension === "htm" ? stripHtml(raw) : raw;
  }
  return assistantEngine.extract(row.file_name, row.mime_type, content);
};

// Embeddings for a batch of chunk texts, or nulls when no provider is configured or it fails.
const embedAll = async (texts: string[], inputType: "document" | "query") => {
  try {
    const result = await assistantEngine.embed(texts, inputType);
    if (!result || result.vectors.length !== texts.length) return { vectors: texts.map(() => null as number[] | null), model: "" };
    return { vectors: result.vectors as (number[] | null)[], model: result.model };
  } catch (err: any) {
    console.warn("[Assistant] Embedding failed; search will use words only:", err.message);
    return { vectors: texts.map(() => null as number[] | null), model: "" };
  }
};

const insertChunks = async (tx: PoolClient, institutionId: string, owner: { documentId?: string; knowledgeId?: string }, chunks: string[], vectors: (number[] | null)[], model: string) => {
  for (let index = 0; index < chunks.length; index += 1) {
    await tx.query(
      `INSERT INTO ai_chunks (id, institution_id, document_id, knowledge_id, position, content, terms, embedding, embedding_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId(), institutionId, owner.documentId || null, owner.knowledgeId || null, index, chunks[index], termsOf(chunks[index]), vectors[index], vectors[index] ? model : ""]
    );
  }
};

// ---- Documents ----------------------------------------------------------------------

export const documentsService = {
  async list(institutionId: string) {
    const { rows } = await postgresService.query(`SELECT ${DOC_COLUMNS} FROM ai_documents WHERE institution_id = $1 ORDER BY created_at DESC`, [institutionId]);
    return rows.map(documentFromRow);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`SELECT ${DOC_COLUMNS} FROM ai_documents WHERE institution_id = $1 AND id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Document not found.");
    return documentFromRow(rows[0]);
  },

  // The first chunks of a processed document, so an admin can check what was read.
  async preview(institutionId: string, id: string) {
    await this.get(institutionId, id);
    const { rows } = await postgresService.query(
      "SELECT position, content, embedding IS NOT NULL AS embedded FROM ai_chunks WHERE institution_id = $1 AND document_id = $2 ORDER BY position LIMIT 5",
      [institutionId, id]
    );
    return rows.map((row: any) => ({ position: row.position, content: row.content, embedded: row.embedded }));
  },

  async upload(actor: Actor, body: any) {
    const file = fileOf(body);
    const title = text(body?.title, "Title", 200) || file.fileName.replace(/\.[^.]+$/, "");
    const id = newId();
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO ai_documents (id, institution_id, title, file_name, mime_type, size_bytes, content, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, actor.institutionId, title, file.fileName, file.mime, file.content.length, file.content, actor.email]
      );
      await audit(tx, actor, "assistant.document.upload", "ai_document", id, `Uploaded "${title}" (${file.fileName}, ${file.content.length} bytes) for the assistant.`);
    });
    triggerIngestion();
    return this.get(actor.institutionId, id);
  },

  // A new version of a document. Its old chunks keep answering until the new file is read.
  async replace(actor: Actor, id: string, body: any) {
    const file = fileOf(body);
    await inTx(async (tx) => {
      const current = (await tx.query("SELECT title FROM ai_documents WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Document not found.");
      const title = text(body?.title, "Title", 200) || current.title;
      await tx.query(
        `UPDATE ai_documents SET title = $3, file_name = $4, mime_type = $5, size_bytes = $6, content = $7, status = 'QUEUED', error = '',
           attempts = 0, next_attempt_at = NOW(), uploaded_by = $8 WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, title, file.fileName, file.mime, file.content.length, file.content, actor.email]
      );
      await audit(tx, actor, "assistant.document.replace", "ai_document", id, `Replaced "${title}" with ${file.fileName}.`);
    });
    triggerIngestion();
    return this.get(actor.institutionId, id);
  },

  async retry(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const current = (await tx.query("SELECT title, status FROM ai_documents WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Document not found.");
      if (current.status !== "FAILED") fail(409, "Only a document that failed can be tried again.");
      await tx.query("UPDATE ai_documents SET status = 'QUEUED', attempts = 0, error = '', next_attempt_at = NOW() WHERE id = $1", [id]);
      await audit(tx, actor, "assistant.document.retry", "ai_document", id, `Tried reading "${current.title}" again.`);
    });
    triggerIngestion();
    return this.get(actor.institutionId, id);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const current = (await tx.query("SELECT title FROM ai_documents WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Document not found.");
      await tx.query("DELETE FROM ai_documents WHERE id = $1", [id]);
      await audit(tx, actor, "assistant.document.delete", "ai_document", id, `Removed "${current.title}" from the assistant's knowledge.`);
      return { id };
    });
  },
};

// ---- Background reading of documents ---------------------------------------------------

// Takes the next due document, reads it, splits it into chunks and indexes them. A document
// that fails because the AI Backend is down is tried again later with a growing wait.
export const processNextDocument = async (): Promise<boolean> => {
  const claimed = (await postgresService.query(
    `UPDATE ai_documents SET status = 'PROCESSING', attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL '10 minutes'
     WHERE id = (SELECT id FROM ai_documents WHERE status IN ('QUEUED', 'PROCESSING') AND next_attempt_at <= NOW()
                 ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, institution_id, title, file_name, mime_type, content, attempts`
  )).rows[0];
  if (!claimed) return false;
  const system = { institutionId: claimed.institution_id, userId: "assistant", email: "assistant@system" };
  try {
    const raw = await readText(claimed);
    const textContent = cleanText(raw);
    if (!textContent) throw new Error("No text was found in this file. A scanned PDF needs OCR before it can be used.");
    const chunks = chunkText(textContent);
    if (chunks.length === 0) throw new Error("The file has no readable words.");
    const { vectors, model } = await embedAll(chunks, "document");
    await inTx(async (tx) => {
      const still = (await tx.query("SELECT 1 FROM ai_documents WHERE id = $1 AND status = 'PROCESSING' FOR UPDATE", [claimed.id])).rows[0];
      if (!still) return; // deleted or replaced while it was being read
      await tx.query("DELETE FROM ai_chunks WHERE document_id = $1", [claimed.id]);
      await insertChunks(tx, claimed.institution_id, { documentId: claimed.id }, chunks, vectors, model);
      await tx.query(
        `UPDATE ai_documents SET status = 'READY', error = '', chunk_count = $2, char_count = $3, embedded_chunks = $4, processed_at = NOW(),
           next_attempt_at = NOW() WHERE id = $1`,
        [claimed.id, chunks.length, textContent.length, vectors.filter(Boolean).length]
      );
      await audit(tx, system, "assistant.document.indexed", "ai_document", claimed.id,
        `Read "${claimed.title}": ${chunks.length} chunks, ${vectors.filter(Boolean).length} with embeddings.`);
    });
  } catch (err: any) {
    const retryable = err instanceof EngineUnavailable && claimed.attempts < MAX_ATTEMPTS;
    const waitMinutes = 2 ** Math.min(claimed.attempts, 5);
    await postgresService.query(
      `UPDATE ai_documents SET status = $2, error = $3, next_attempt_at = NOW() + ($4 || ' minutes')::interval WHERE id = $1 AND status = 'PROCESSING'`,
      [claimed.id, retryable ? "QUEUED" : "FAILED", String(err.message || err).slice(0, 1000), String(waitMinutes)]
    );
  }
  return true;
};

let running = false;
// Starts reading queued documents now instead of waiting for the next scheduler tick.
export const triggerIngestion = () => {
  if (running || process.env.ASSISTANT_INGEST_INLINE === "off") return;
  running = true;
  setImmediate(async () => {
    try {
      for (let index = 0; index < 20 && (await processNextDocument()); index += 1);
    } catch (err: any) {
      console.error("[Assistant] Reading documents failed:", err.message);
    } finally {
      running = false;
    }
  });
};

// Adds embeddings to passages read before an embedding model was available, or made with an
// older model. Runs a batch at a time from the scheduler.
export const backfillEmbeddings = async (limit = 32): Promise<number> => {
  const status = await assistantEngine.status();
  if (!status.embeddings || !status.embeddingModel) return 0;
  const { rows } = await postgresService.query(
    "SELECT id, document_id, content FROM ai_chunks WHERE embedding IS NULL OR embedding_model <> $1 ORDER BY created_at LIMIT $2",
    [status.embeddingModel, limit]
  );
  if (rows.length === 0) return 0;
  const result = await assistantEngine.embed(rows.map((row: any) => row.content), "document").catch((err) => {
    console.warn("[Assistant] Adding embeddings failed; will try again:", err.message);
    return null;
  });
  if (!result || result.vectors.length !== rows.length) return 0;
  for (let index = 0; index < rows.length; index += 1) {
    await postgresService.query("UPDATE ai_chunks SET embedding = $2, embedding_model = $3 WHERE id = $1", [rows[index].id, result.vectors[index], result.model]);
  }
  const documents = [...new Set(rows.map((row: any) => row.document_id).filter(Boolean))];
  await postgresService.query(
    `UPDATE ai_documents d SET embedded_chunks = (SELECT COUNT(*) FROM ai_chunks c WHERE c.document_id = d.id AND c.embedding_model = $2)
     WHERE d.id = ANY($1)`,
    [documents, result.model]
  );
  return rows.length;
};

// ---- Approved knowledge -----------------------------------------------------------------

export const knowledgeContent = (question: string, answer: string, explanation: string) =>
  [`Question: ${question}`, `Answer: ${answer}`, explanation ? `More: ${explanation}` : ""].filter(Boolean).join("\n");

export const knowledgeService = {
  async list(institutionId: string, status = "ACTIVE") {
    const { rows } = await postgresService.query(
      `SELECT k.*, EXISTS (SELECT 1 FROM ai_chunks c WHERE c.knowledge_id = k.id AND c.embedding IS NOT NULL) AS embedded
       FROM ai_knowledge k WHERE k.institution_id = $1 AND ($2 = 'ALL' OR k.status = $2) ORDER BY k.approved_at DESC LIMIT 500`,
      [institutionId, status]
    );
    return rows.map(knowledgeFromRow);
  },

  // Called only from an admin's approval. Saves the answer and makes it searchable at once.
  async addApproved(tx: PoolClient, actor: Actor, input: { question: string; answer: string; explanation: string; sourceQuestionId: string | null }) {
    const id = newId();
    const content = knowledgeContent(input.question, input.answer, input.explanation);
    const { vectors, model } = await embedAll([content], "document");
    await tx.query(
      `INSERT INTO ai_knowledge (id, institution_id, question, answer, explanation, source_question_id, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, actor.institutionId, input.question, input.answer, input.explanation, input.sourceQuestionId, actor.email]
    );
    await insertChunks(tx, actor.institutionId, { knowledgeId: id }, [content], vectors, model);
    return id;
  },

  // An approved answer that is no longer right stops being used, but stays on record.
  async retire(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const current = (await tx.query("SELECT question, status FROM ai_knowledge WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!current) fail(404, "Knowledge entry not found.");
      if (current.status === "RETIRED") fail(409, "This answer is already retired.");
      await tx.query("UPDATE ai_knowledge SET status = 'RETIRED', retired_by = $2, retired_at = NOW() WHERE id = $1", [id, actor.email]);
      await audit(tx, actor, "assistant.knowledge.retire", "ai_knowledge", id, `Retired the approved answer to "${current.question.slice(0, 200)}".`);
    });
    const { rows } = await postgresService.query("SELECT k.*, FALSE AS embedded FROM ai_knowledge k WHERE k.id = $1", [id]);
    return knowledgeFromRow(rows[0]);
  },
};

// ---- Search ---------------------------------------------------------------------------

export type Hit = {
  chunkId: string;
  kind: "DOCUMENT" | "KNOWLEDGE";
  sourceId: string;
  title: string;
  text: string;
  answer: string | null;
  explanation: string | null;
  // Share of the question's (weighted) words found in the passage, 0 to 1.
  coverage: number;
  // For approved answers: how alike the stored question and the asked question are, 0 to 1.
  similarity: number;
  // Cosine similarity of embeddings, when both have one.
  semantic: number | null;
  score: number;
};

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

export const searchKnowledge = async (institutionId: string, question: string, limit = 6): Promise<Hit[]> => {
  const queryTerms = termsOf(question);
  if (queryTerms.length === 0) return [];
  const live = `(c.document_id IS NOT NULL AND d.status = 'READY') OR (c.knowledge_id IS NOT NULL AND k.status = 'ACTIVE')`;
  const total = Number((await postgresService.query(
    `SELECT COUNT(*) AS n FROM ai_chunks c LEFT JOIN ai_documents d ON d.id = c.document_id LEFT JOIN ai_knowledge k ON k.id = c.knowledge_id
     WHERE c.institution_id = $1 AND (${live})`, [institutionId])).rows[0].n);
  if (total === 0) return [];
  const df = new Map<string, number>(
    (await postgresService.query(
      `SELECT t AS term, COUNT(*)::int AS n FROM ai_chunks c LEFT JOIN ai_documents d ON d.id = c.document_id LEFT JOIN ai_knowledge k ON k.id = c.knowledge_id,
         unnest(c.terms) t WHERE c.institution_id = $1 AND c.terms && $2 AND t = ANY($2) AND (${live}) GROUP BY t`,
      [institutionId, queryTerms]
    )).rows.map((row: any) => [row.term, row.n])
  );
  const idf = (term: string) => Math.log(1 + (total - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
  const weight = (terms: string[]) => terms.reduce((sum, term) => sum + idf(term), 0);
  const questionWeight = weight(queryTerms);

  const select = `SELECT c.id, c.content, c.terms, c.embedding, c.embedding_model, c.document_id, c.knowledge_id, d.title AS doc_title,
      k.question AS k_question, k.answer AS k_answer, k.explanation AS k_explanation
    FROM ai_chunks c LEFT JOIN ai_documents d ON d.id = c.document_id LEFT JOIN ai_knowledge k ON k.id = c.knowledge_id
    WHERE c.institution_id = $1 AND (${live})`;
  const lexical = (await postgresService.query(`${select} AND c.terms && $2 LIMIT 400`, [institutionId, queryTerms])).rows;

  // With an embedding provider, passages that share meaning but no words are found too.
  let queryVector: number[] | null = null;
  let semanticRows: any[] = [];
  const embedded = await embedAll([question], "query");
  if (embedded.vectors[0]) {
    queryVector = embedded.vectors[0];
    // Vectors from different models cannot be compared, so only the current model's are used.
    semanticRows = (await postgresService.query(`${select} AND c.embedding IS NOT NULL AND c.embedding_model = $2 LIMIT 3000`, [institutionId, embedded.model])).rows;
  }

  const rows = new Map<string, any>();
  for (const row of [...lexical, ...semanticRows]) rows.set(row.id, row);
  const avgLength = 150;
  const hits: Hit[] = [];
  for (const row of rows.values()) {
    const words = wordsOf(row.content);
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    const matched = queryTerms.filter((term) => counts.has(term));
    const coverage = questionWeight ? weight(matched) / questionWeight : 0;
    let bm25 = 0;
    for (const term of matched) {
      const tf = counts.get(term) as number;
      bm25 += idf(term) * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (words.length / avgLength))));
    }
    let similarity = 0;
    if (row.knowledge_id) {
      const storedTerms = termsOf(row.k_question);
      const shared = storedTerms.filter((term) => queryTerms.includes(term));
      const forward = questionWeight ? weight(shared) / questionWeight : 0;
      const backward = storedTerms.length ? weight(shared) / weight(storedTerms) : 0;
      similarity = forward + backward > 0 ? (2 * forward * backward) / (forward + backward) : 0;
    }
    const semantic = queryVector && row.embedding && row.embedding_model === embedded.model ? cosine(queryVector, row.embedding.map(Number)) : null;
    const lexicalScore = row.knowledge_id ? Math.max(similarity, coverage * 0.9) : coverage;
    const score = semantic === null ? lexicalScore + bm25 / 100 : 0.5 * lexicalScore + 0.5 * Math.max(0, semantic) + bm25 / 100;
    if (lexicalScore === 0 && (semantic === null || semantic < 0.5)) continue;
    hits.push({
      chunkId: row.id,
      kind: row.knowledge_id ? "KNOWLEDGE" : "DOCUMENT",
      sourceId: row.knowledge_id || row.document_id,
      title: row.knowledge_id ? "Approved answer" : row.doc_title,
      text: row.content,
      answer: row.knowledge_id ? row.k_answer : null,
      explanation: row.knowledge_id ? row.k_explanation : null,
      coverage: Math.round(coverage * 1000) / 1000,
      similarity: Math.round(similarity * 1000) / 1000,
      semantic: semantic === null ? null : Math.round(semantic * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};

// The sentences of a passage that carry the question's words, for an answer quoted straight
// from a document when no language model is configured.
export const bestSentences = (passage: string, question: string, max = 3): string => {
  const wanted = new Set(termsOf(question));
  const sentences = passage.split(/(?<=[.!?।])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
  const scored = sentences.map((sentence, index) => ({ sentence, index, score: termsOf(sentence).filter((term) => wanted.has(term)).length }));
  const chosen = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, max).sort((a, b) => a.index - b.index);
  return (chosen.length ? chosen.map((item) => item.sentence) : sentences.slice(0, max)).join(" ");
};
