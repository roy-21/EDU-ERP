# AI Backend Architecture & Engineering Specification

## 1. Scope & Principles
The AI Backend is an **autonomous, independently deployable Python FastAPI application** (`apps/ai-api`). It owns its database (`ai_db`), manages its own model registry, and never performs direct SQL writes to the Core ERP database.

---

## 2. Functional Domains

```
                       FastAPI Application (/api/v1)
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
[Predictive Engine]          [RAG Assistant]             [NLP Classifier]
 • Scikit-learn / XGBoost     • pgvector + LangChain      • Text & Objection NLP
 • Student Risk Model         • PDF/Text Chunking         • Multi-lingual (EN + BN)
 • GPA Regressor              • Cosine Distance Index     • Auto-tagging & routing
 • Attendance Forecaster      • Grounded Citations        • Sentiment Analysis
```

---

## 3. Machine Learning Pipelines

### 3.1 Student At-Risk & Dropout Prediction
- **Problem Formulation:** Binary classification ($y \in \{0, 1\}$, where $1$ denotes High Academic Failure or Dropout Risk).
- **Features ($X$):**
  1. `attendance_pct` (Continuous, 0.0 - 100.0)
  2. `midterm_avg` (Continuous, 0.0 - 100.0)
  3. `assignment_completion_rate` (Continuous, 0.0 - 1.0)
  4. `previous_cgpa` (Continuous, 0.0 - 4.0)
  5. `fee_payment_delay_days` (Discrete, integer)
- **Algorithm:** Tuned Random Forest Classifier / XGBoost with balanced class weights.
- **Validation:** 5-fold Stratified Cross-Validation on held-out temporal data. Train/Validation/Test splits strictly separated by academic term to prevent data leakage.
- **Model Registry:** Model artifact pickled in `/artifacts/models/` and registered with metadata in `ai_models` table.

### 3.2 RAG AI Learning Assistant
- **Document Ingestion:** Multi-part file upload -> PyPDF text extraction -> Semantic Chunking (chunk size: 800 tokens, overlap: 100 tokens).
- **Vector Storage:** Embeddings generated via OpenAI `text-embedding-3-small` or HuggingFace SentenceTransformer -> Stored in PostgreSQL with `pgvector` HNSW index.
- **Query Pipeline:**
  1. Receive `{ query, institutionId, courseId }`.
  2. Query `ai_document_chunks` using cosine distance with strict `WHERE institution_id = :inst AND course_id = :course`.
  3. Formulate Prompt containing top-4 retrieved context blocks.
  4. Instruct LLM: "Answer strictly based on provided context. If not found in context, clearly state that the syllabus material does not contain the answer."
  5. Return synthesized answer alongside verifiable source citations (document name, page number, snippet).

