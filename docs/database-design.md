# Database Design & Ownership Specification

## 1. Multi-Tenant Architecture & Data Isolation

The system uses an **institution-scoped logical multi-tenancy model** with dedicated database instances per service:
- `erp_db`: Relational core data, transactional integrity, multi-institution indexing.
- `ai_db`: Embedding vectors (`vector(1536)` or `vector(768)`), ML models, inference logs.
- `voice_db`: Audio metadata, transcripts, telephony sessions, routing events.

Every table in all databases storing tenant-specific data strictly includes an `institution_id: UUID` column with non-nullable constraints and composite B-tree indexes (`institution_id, created_at`).

---

## 2. Core ERP Database Schema (`erp_db`)

```sql
-- Core Tenants
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- University, College, School
    domain VARCHAR(255) UNIQUE,
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    lat DECIMAL(9,6),
    lng DECIMAL(9,6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, code)
);

-- Identity & Access Control
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- SUPER_ADMIN, INSTITUTION_ADMIN, TEACHER, STUDENT, GUARDIAN
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, email)
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_system BOOLEAN DEFAULT FALSE,
    permissions JSONB NOT NULL DEFAULT '{}', -- Module-level permissions matrix
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, name)
);

-- Academic Hierarchy
CREATE TABLE faculties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    campus_id UUID REFERENCES campuses(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, code)
);

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, code)
);

CREATE TABLE programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    degree_type VARCHAR(50) NOT NULL, -- BSc, MSc, Diploma
    total_credits DECIMAL(5,2) NOT NULL,
    duration_years DECIMAL(3,1) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    batch_number VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    capacity INT DEFAULT 60,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    credit_hours DECIMAL(3,1) NOT NULL,
    syllabus TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, code)
);

-- Student Profiles & Life Cycle
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id_number VARCHAR(100) NOT NULL, -- Matric / Roll
    department_id UUID NOT NULL REFERENCES departments(id),
    program_id UUID NOT NULL REFERENCES programs(id),
    batch_id UUID NOT NULL REFERENCES batches(id),
    current_semester INT DEFAULT 1,
    cgpa DECIMAL(3,2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, DROPOUT, GRADUATED, SUSPENDED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, student_id_number)
);

-- Attendance
CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL, -- PRESENT, ABSENT, LATE, EXCUSED
    method VARCHAR(30) DEFAULT 'MANUAL', -- MANUAL, QR, RFID, BIOMETRIC, GPS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, student_id, course_id, date)
);

-- Examinations & Results
CREATE TABLE exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    exam_type VARCHAR(50) NOT NULL, -- MIDTERM, FINAL, QUIZ
    total_marks DECIMAL(5,2) NOT NULL,
    exam_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exam_marks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    obtained_marks DECIMAL(5,2) NOT NULL,
    grade_letter VARCHAR(5),
    grade_point DECIMAL(3,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, exam_id, student_id)
);

-- Dynamic Form & Table Definitions
CREATE TABLE dynamic_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    form_type VARCHAR(50) DEFAULT 'temporary',
    schema JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id, slug)
);

CREATE TABLE dynamic_form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    form_id UUID NOT NULL REFERENCES dynamic_forms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Objections & Ticketing (Shared with Voice Backend)
CREATE TABLE objections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id),
    source VARCHAR(50) NOT NULL, -- WEB_PORTAL, AI_VOICE_CALL, MANUAL
    category VARCHAR(100) NOT NULL, -- GRADE_DISPUTE, ATTENDANCE_ISSUE, FEE_DISPUTE, COMPLAINT
    severity VARCHAR(30) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, URGENT
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    assigned_to_user_id UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'OPEN', -- OPEN, IN_INVESTIGATION, RESOLVED, DISMISSED
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. AI Backend Database Schema (`ai_db`)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Model Registry & Versions
CREATE TABLE ai_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_key VARCHAR(100) UNIQUE NOT NULL, -- student_risk_v1, gpa_predictor_v1
    name VARCHAR(255) NOT NULL,
    algorithm VARCHAR(100) NOT NULL, -- Random Forest, XGBoost, Linear Regression
    version VARCHAR(50) NOT NULL,
    metrics JSONB NOT NULL, -- { "accuracy": 0.89, "f1": 0.87, "rmse": 0.21 }
    artifact_path TEXT NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    trained_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Prediction Inference History
CREATE TABLE ai_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL, -- References Core ERP institution
    student_id UUID NOT NULL,     -- References Core ERP student
    model_id UUID NOT NULL REFERENCES ai_models(id),
    prediction_type VARCHAR(50) NOT NULL, -- DROPOUT_RISK, GPA_ESTIMATE, ATTENDANCE_RISK
    score DECIMAL(5,4) NOT NULL, -- Risk probability (0.0000 - 1.0000) or predicted GPA
    risk_level VARCHAR(20) NOT NULL, -- LOW, MEDIUM, HIGH, CRITICAL
    features_used JSONB NOT NULL,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RAG Knowledge Base & Embeddings
CREATE TABLE ai_course_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL,
    course_id UUID NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'PROCESSING', -- PROCESSING, INDEXED, FAILED
    total_chunks INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL,
    course_id UUID NOT NULL,
    document_id UUID NOT NULL REFERENCES ai_course_documents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- Compatible with standard embeddings (e.g., text-embedding-3-small)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ai_doc_chunks_vector_idx ON ai_document_chunks 
USING hnsw (embedding vector_cosine_ops)
WHERE institution_id IS NOT NULL;
```

---

## 4. Voice Assistant Database Schema (`voice_db`)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE voice_call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL,
    caller_phone VARCHAR(50),
    channel VARCHAR(30) NOT NULL, -- PHONE_SIP, TWILIO, WEBRTC_WEB
    call_direction VARCHAR(20) NOT NULL, -- INBOUND, OUTBOUND
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'IN_PROGRESS', -- COMPLETED, FAILED, NO_ANSWER, TRANSFERRED
    detected_intent VARCHAR(100),
    is_objection_detected BOOLEAN DEFAULT FALSE,
    target_person_requested VARCHAR(255),
    transfer_status VARCHAR(50) DEFAULT 'NONE',
    ticket_id UUID, -- If ticket auto-created in Core ERP
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE voice_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES voice_call_sessions(id) ON DELETE CASCADE,
    speaker VARCHAR(30) NOT NULL, -- CALLER, AI_ASSISTANT
    message TEXT NOT NULL,
    confidence_score DECIMAL(3,2),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

