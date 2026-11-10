-- =========================================================================
-- Core ERP Database Schema (PostgreSQL 16)
-- Production Multi-Tenant Institutional Management System
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants / Institutions
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'University',
    domain VARCHAR(255),
    currency VARCHAR(10) DEFAULT 'BDT',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Users & Credentials
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    must_change_password BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_user_inst_username UNIQUE (institution_id, username)
);

-- 3. Dynamic Roles & Permissions
CREATE TABLE IF NOT EXISTS dynamic_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    portal_type VARCHAR(50) DEFAULT 'STAFF',
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_role_inst_name UNIQUE (institution_id, name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES dynamic_roles(id) ON DELETE CASCADE,
    module_id VARCHAR(50) NOT NULL,
    can_create BOOLEAN DEFAULT FALSE,
    can_read BOOLEAN DEFAULT TRUE,
    can_update BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_approve BOOLEAN DEFAULT FALSE
);

-- 4. Departments & Academic Hierarchy
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    head_of_department VARCHAR(255),
    total_students INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    course_code VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    credits NUMERIC(3, 1) DEFAULT 3.0,
    semester INT DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Teachers & Academic Faculty
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    teacher_id_number VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    department VARCHAR(100) NOT NULL,
    designation VARCHAR(100) NOT NULL,
    qualification VARCHAR(255),
    status VARCHAR(30) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_teacher_id_inst UNIQUE (institution_id, teacher_id_number)
);

-- 6. Students
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    student_id_number VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    current_semester INT DEFAULT 1,
    cgpa NUMERIC(3, 2) DEFAULT 0.00,
    attendance_rate NUMERIC(5, 2) DEFAULT 100.00,
    status VARCHAR(30) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_student_id_inst UNIQUE (institution_id, student_id_number)
);

-- 7. Guardians
CREATE TABLE IF NOT EXISTS guardians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    ward_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    portal_username VARCHAR(100),
    status VARCHAR(30) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    course_code VARCHAR(30) NOT NULL,
    department VARCHAR(100) NOT NULL,
    semester INT DEFAULT 1,
    total_present INT DEFAULT 0,
    total_absent INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Exam Schedules & Gradebooks
CREATE TABLE IF NOT EXISTS exam_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    exam_name VARCHAR(255) NOT NULL,
    course_code VARCHAR(30) NOT NULL,
    exam_date DATE NOT NULL,
    time_slot VARCHAR(50) NOT NULL,
    room_number VARCHAR(50),
    total_candidates INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Fee Structures & Invoices
CREATE TABLE IF NOT EXISTS fee_structures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    fee_head VARCHAR(255) NOT NULL,
    department VARCHAR(100),
    semester INT DEFAULT 1,
    amount NUMERIC(12, 2) NOT NULL,
    frequency VARCHAR(30) DEFAULT 'SEMESTER',
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    student_name VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    paid_amount NUMERIC(12, 2) DEFAULT 0.00,
    status VARCHAR(30) DEFAULT 'PENDING',
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uk_invoice_num UNIQUE (institution_id, invoice_number)
);

-- 11. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    system_name VARCHAR(255) DEFAULT 'NextGen Institutional ERP System',
    support_email VARCHAR(255) DEFAULT 'support@institution.edu',
    support_phone VARCHAR(50) DEFAULT '+880 2 9876543',
    currency VARCHAR(10) DEFAULT 'BDT',
    timezone VARCHAR(50) DEFAULT 'Asia/Dhaka (GMT+6)',
    maintenance_mode BOOLEAN DEFAULT FALSE,
    registration_enabled BOOLEAN DEFAULT TRUE,
    theme VARCHAR(20) DEFAULT 'light',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Hostel Rooms
-- institution_id holds the tenant id from the access token.
CREATE TABLE IF NOT EXISTS hostel_rooms (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    hostel_name VARCHAR(100) NOT NULL,
    building VARCHAR(100) NOT NULL,
    floor VARCHAR(100) NOT NULL,
    room_number VARCHAR(100) NOT NULL,
    room_type VARCHAR(20) NOT NULL DEFAULT 'STANDARD' CHECK (room_type IN ('STANDARD', 'DELUXE')),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    facilities TEXT[] NOT NULL DEFAULT '{}',
    under_maintenance BOOLEAN NOT NULL DEFAULT FALSE,
    notes VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_rooms_unique_number
    ON hostel_rooms (institution_id, LOWER(hostel_name), LOWER(building), LOWER(room_number));

-- Occupied seats now come from active allocations.
ALTER TABLE hostel_rooms DROP COLUMN IF EXISTS occupied;

-- Hostel Seats: one row per seat, kept in step with the room capacity.
CREATE TABLE IF NOT EXISTS hostel_seats (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    room_id VARCHAR(64) NOT NULL REFERENCES hostel_rooms(id) ON DELETE CASCADE,
    seat_number INTEGER NOT NULL CHECK (seat_number > 0),
    monthly_fee INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
    reserved BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (room_id, seat_number)
);

CREATE INDEX IF NOT EXISTS hostel_seats_institution ON hostel_seats (institution_id);

-- Rooms created before seats existed.
INSERT INTO hostel_seats (id, institution_id, room_id, seat_number)
SELECT gen_random_uuid()::text, r.institution_id, r.id, n
FROM hostel_rooms r CROSS JOIN LATERAL generate_series(1, r.capacity) AS n
WHERE NOT EXISTS (SELECT 1 FROM hostel_seats s WHERE s.room_id = r.id);

-- Hostel Allocations. room_label and seat_number keep the history readable
-- after a room is deleted.
CREATE TABLE IF NOT EXISTS hostel_allocations (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    student_id VARCHAR(100) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL DEFAULT '',
    guardian_phone VARCHAR(20) NOT NULL DEFAULT '',
    preferred_hostel VARCHAR(100) NOT NULL DEFAULT '',
    notes VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Allocated', 'Rejected', 'Vacated')),
    room_id VARCHAR(64) REFERENCES hostel_rooms(id) ON DELETE SET NULL,
    seat_id VARCHAR(64) REFERENCES hostel_seats(id) ON DELETE SET NULL,
    room_label VARCHAR(320) NOT NULL DEFAULT '',
    seat_number INTEGER,
    reject_reason VARCHAR(500) NOT NULL DEFAULT '',
    allocated_at TIMESTAMP WITH TIME ZONE,
    vacated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_allocations_institution ON hostel_allocations (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hostel_allocations_room ON hostel_allocations (room_id);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_allocations_one_per_seat
    ON hostel_allocations (seat_id) WHERE status = 'Allocated';

CREATE UNIQUE INDEX IF NOT EXISTS hostel_allocations_one_per_student
    ON hostel_allocations (institution_id, LOWER(student_id)) WHERE status IN ('Pending', 'Allocated');

-- Hostel Maintenance Tickets
CREATE TABLE IF NOT EXISTS hostel_maintenance_tickets (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    room_id VARCHAR(64) REFERENCES hostel_rooms(id) ON DELETE SET NULL,
    room_label VARCHAR(320) NOT NULL,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    category VARCHAR(20) NOT NULL DEFAULT 'Other',
    priority VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
    status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
    blocks_room BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_to VARCHAR(100) NOT NULL DEFAULT '',
    reported_by VARCHAR(255) NOT NULL DEFAULT '',
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_tickets_institution ON hostel_maintenance_tickets (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hostel_tickets_room ON hostel_maintenance_tickets (room_id);

-- Hostel Audit Log
CREATE TABLE IF NOT EXISTS hostel_audit_log (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(100) NOT NULL,
    actor_email VARCHAR(255) NOT NULL DEFAULT '',
    action VARCHAR(20) NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    entity_id VARCHAR(64) NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_audit_institution ON hostel_audit_log (institution_id, created_at DESC);

-- An admin can close a room. It stays closed until an admin reopens it.
ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS closed BOOLEAN NOT NULL DEFAULT FALSE;

-- =========================================================================
-- Hostel rent management
-- Financial rows use ON DELETE RESTRICT, or SET NULL with a text snapshot,
-- so deleting a room never removes billing history.
-- =========================================================================

CREATE SEQUENCE IF NOT EXISTS hostel_invoice_number_seq;
CREATE SEQUENCE IF NOT EXISTS hostel_receipt_number_seq;

-- Buildings, so a due day can be set per building.
CREATE TABLE IF NOT EXISTS hostel_buildings (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    hostel_name VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_buildings_unique_name
    ON hostel_buildings (institution_id, LOWER(hostel_name), LOWER(name));

ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS building_id VARCHAR(64) REFERENCES hostel_buildings(id) ON DELETE SET NULL;
ALTER TABLE hostel_seats ADD COLUMN IF NOT EXISTS due_day INTEGER CHECK (due_day BETWEEN 1 AND 31);

INSERT INTO hostel_buildings (id, institution_id, hostel_name, name)
SELECT gen_random_uuid()::text, r.institution_id, MIN(r.hostel_name), MIN(r.building)
FROM hostel_rooms r
GROUP BY r.institution_id, LOWER(r.hostel_name), LOWER(r.building)
ON CONFLICT DO NOTHING;

UPDATE hostel_rooms r SET building_id = b.id
FROM hostel_buildings b
WHERE r.building_id IS NULL
  AND b.institution_id = r.institution_id
  AND LOWER(b.hostel_name) = LOWER(r.hostel_name)
  AND LOWER(b.name) = LOWER(r.building);

-- Global rent and reminder settings, one row per institution.
CREATE TABLE IF NOT EXISTS hostel_rent_settings (
    institution_id VARCHAR(64) PRIMARY KEY,
    default_due_day INTEGER NOT NULL DEFAULT 10 CHECK (default_due_day BETWEEN 1 AND 31),
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Dhaka',
    reminder_days_before INTEGER[] NOT NULL DEFAULT '{3,1}',
    remind_on_due_date BOOLEAN NOT NULL DEFAULT TRUE,
    overdue_first_after_days INTEGER NOT NULL DEFAULT 1,
    overdue_interval_days INTEGER NOT NULL DEFAULT 7,
    reminder_hour INTEGER NOT NULL DEFAULT 9 CHECK (reminder_hour BETWEEN 0 AND 23),
    channels TEXT[] NOT NULL DEFAULT '{IN_APP,EMAIL,SMS}',
    payment_instructions VARCHAR(500) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Student, guardian and rent details on an allocation.
ALTER TABLE hostel_allocations
    ADD COLUMN IF NOT EXISTS student_phone VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS student_email VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS student_nid VARCHAR(17) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS guardian_nid VARCHAR(17) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS guardian_relationship VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS monthly_rent NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS security_deposit NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE,
    ADD COLUMN IF NOT EXISTS first_due_date DATE,
    ADD COLUMN IF NOT EXISTS billing_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS billing_from DATE;

-- The rent that applies from each billing month onward.
CREATE TABLE IF NOT EXISTS hostel_allocation_rents (
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE CASCADE,
    effective_month DATE NOT NULL CHECK (EXTRACT(DAY FROM effective_month) = 1),
    monthly_rent NUMERIC(12,2) NOT NULL CHECK (monthly_rent >= 0),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (allocation_id, effective_month)
);

-- Uploaded student and guardian documents. Served only through the API.
CREATE TABLE IF NOT EXISTS hostel_documents (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE CASCADE,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('STUDENT_CARD', 'STUDENT_NID', 'GUARDIAN_NID')),
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    size_bytes INTEGER NOT NULL,
    content BYTEA NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (allocation_id, document_type)
);

-- One invoice per allocation per billing month. Rent, due date and location
-- are snapshots, so later changes never rewrite an issued invoice.
CREATE TABLE IF NOT EXISTS hostel_invoices (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    invoice_number VARCHAR(32) NOT NULL UNIQUE,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE RESTRICT,
    student_id VARCHAR(100) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    building_id VARCHAR(64) REFERENCES hostel_buildings(id) ON DELETE SET NULL,
    room_id VARCHAR(64) REFERENCES hostel_rooms(id) ON DELETE SET NULL,
    seat_id VARCHAR(64) REFERENCES hostel_seats(id) ON DELETE SET NULL,
    hostel_name VARCHAR(100) NOT NULL DEFAULT '',
    building_name VARCHAR(100) NOT NULL DEFAULT '',
    room_number VARCHAR(100) NOT NULL DEFAULT '',
    seat_number INTEGER,
    billing_month DATE NOT NULL CHECK (EXTRACT(DAY FROM billing_month) = 1),
    rent_amount NUMERIC(12,2) NOT NULL CHECK (rent_amount >= 0),
    previous_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_date DATE NOT NULL,
    due_source VARCHAR(10) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (allocation_id, billing_month)
);

CREATE INDEX IF NOT EXISTS hostel_invoices_due ON hostel_invoices (institution_id, due_date);
CREATE INDEX IF NOT EXISTS hostel_invoices_student ON hostel_invoices (institution_id, LOWER(student_id));

-- Payments are never deleted. A correction reverses the payment.
CREATE TABLE IF NOT EXISTS hostel_payments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    invoice_id VARCHAR(64) NOT NULL REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE RESTRICT,
    student_id VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date DATE NOT NULL,
    method VARCHAR(20) NOT NULL,
    transaction_reference VARCHAR(100) NOT NULL DEFAULT '',
    receipt_number VARCHAR(32) NOT NULL UNIQUE,
    recorded_by VARCHAR(255) NOT NULL DEFAULT '',
    notes VARCHAR(500) NOT NULL DEFAULT '',
    idempotency_key VARCHAR(64),
    status VARCHAR(10) NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed', 'Reversed')),
    reversed_at TIMESTAMP WITH TIME ZONE,
    reversed_by VARCHAR(255) NOT NULL DEFAULT '',
    reversal_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_payments_invoice ON hostel_payments (invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_payments_unique_reference
    ON hostel_payments (institution_id, LOWER(transaction_reference))
    WHERE transaction_reference <> '' AND status = 'Confirmed';

CREATE UNIQUE INDEX IF NOT EXISTS hostel_payments_unique_request
    ON hostel_payments (institution_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Authorized corrections to the amount owed on an invoice.
CREATE TABLE IF NOT EXISTS hostel_invoice_adjustments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    invoice_id VARCHAR(64) NOT NULL REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
    reason VARCHAR(500) NOT NULL,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_adjustments_invoice ON hostel_invoice_adjustments (invoice_id);

-- Balances always come from confirmed payments and adjustments.
DROP VIEW IF EXISTS hostel_invoice_balances;
CREATE VIEW hostel_invoice_balances AS
SELECT i.*,
    i.rent_amount + COALESCE(a.total, 0) AS amount_due,
    COALESCE(a.total, 0) AS adjustment_total,
    COALESCE(p.total, 0) AS paid_amount,
    i.rent_amount + COALESCE(a.total, 0) - COALESCE(p.total, 0) AS outstanding_amount
FROM hostel_invoices i
LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS total FROM hostel_invoice_adjustments GROUP BY invoice_id
) a ON a.invoice_id = i.id
LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS total FROM hostel_payments WHERE status = 'Confirmed' GROUP BY invoice_id
) p ON p.invoice_id = i.id;

-- Notification outbox and delivery log. dedupe_key stops repeat sends.
CREATE TABLE IF NOT EXISTS hostel_notifications (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    invoice_id VARCHAR(64) REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    allocation_id VARCHAR(64) REFERENCES hostel_allocations(id) ON DELETE RESTRICT,
    student_id VARCHAR(100) NOT NULL DEFAULT '',
    student_name VARCHAR(100) NOT NULL DEFAULT '',
    scenario VARCHAR(20) NOT NULL,
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS')),
    recipient VARCHAR(255) NOT NULL DEFAULT '',
    subject VARCHAR(255) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Sent', 'Delivered', 'Failed', 'Skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_error VARCHAR(500) NOT NULL DEFAULT '',
    provider_message_id VARCHAR(255) NOT NULL DEFAULT '',
    triggered_by VARCHAR(255) NOT NULL DEFAULT 'system',
    dedupe_key VARCHAR(255) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS hostel_notifications_pending ON hostel_notifications (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS hostel_notifications_list ON hostel_notifications (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hostel_notifications_invoice ON hostel_notifications (invoice_id);

CREATE TABLE IF NOT EXISTS hostel_notification_templates (
    institution_id VARCHAR(64) NOT NULL,
    scenario VARCHAR(20) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_id, scenario)
);

CREATE TABLE IF NOT EXISTS hostel_job_runs (
    id VARCHAR(64) PRIMARY KEY,
    job VARCHAR(50) NOT NULL,
    status VARCHAR(10) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_job_runs_recent ON hostel_job_runs (job, finished_at DESC);

-- Online rent payments: settings. The first upgrade moves an untouched schedule to the new default.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hostel_rent_settings' AND column_name = 'brand_name'
    ) THEN
        UPDATE hostel_rent_settings
        SET reminder_days_before = '{7,3,1}', overdue_interval_days = 3
        WHERE reminder_days_before = '{3,1}' AND overdue_interval_days = 7;
    END IF;
END $$;

ALTER TABLE hostel_rent_settings
    ADD COLUMN IF NOT EXISTS brand_name VARCHAR(100) NOT NULL DEFAULT 'Hostel Office',
    ADD COLUMN IF NOT EXISTS allow_partial_online BOOLEAN NOT NULL DEFAULT FALSE,
    ALTER COLUMN reminder_days_before SET DEFAULT '{7,3,1}',
    ALTER COLUMN overdue_interval_days SET DEFAULT 3;

ALTER TABLE hostel_notifications
    ADD COLUMN IF NOT EXISTS payment_id VARCHAR(64) REFERENCES hostel_payments(id) ON DELETE RESTRICT;

-- A row exists only once an admin has changed a method. Without one it is enabled.
CREATE TABLE IF NOT EXISTS hostel_payment_methods (
    institution_id VARCHAR(64) NOT NULL,
    method VARCHAR(20) NOT NULL,
    enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_id, method)
);

-- Credentials and tokens are encrypted by the application before they get here.
CREATE TABLE IF NOT EXISTS hostel_gateway_config (
    institution_id VARCHAR(64) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    environment VARCHAR(10) NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    api_base_url VARCHAR(255) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    credentials_encrypted TEXT NOT NULL DEFAULT '',
    token_encrypted TEXT NOT NULL DEFAULT '',
    token_expires_at TIMESTAMP WITH TIME ZONE,
    refresh_expires_at TIMESTAMP WITH TIME ZONE,
    grant_times TIMESTAMP WITH TIME ZONE[] NOT NULL DEFAULT '{}',
    last_test_at TIMESTAMP WITH TIME ZONE,
    last_test_ok BOOLEAN,
    last_test_message VARCHAR(500) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_id, provider)
);

-- Only a hash of the token is kept, so the database cannot be used to open a link.
CREATE TABLE IF NOT EXISTS hostel_payment_links (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    invoice_id VARCHAR(64) NOT NULL REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_payment_links_invoice ON hostel_payment_links (invoice_id);

CREATE TABLE IF NOT EXISTS hostel_gateway_transactions (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    environment VARCHAR(10) NOT NULL,
    invoice_id VARCHAR(64) NOT NULL REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE RESTRICT,
    callback_hash CHAR(64) NOT NULL UNIQUE,
    merchant_invoice_number VARCHAR(64) NOT NULL UNIQUE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status VARCHAR(10) NOT NULL DEFAULT 'Created'
        CHECK (status IN ('Created', 'Initiated', 'Completed', 'Failed', 'Cancelled', 'Expired', 'Review')),
    gateway_payment_id VARCHAR(100),
    trx_id VARCHAR(100),
    checkout_url TEXT NOT NULL DEFAULT '',
    payment_id VARCHAR(64) UNIQUE REFERENCES hostel_payments(id) ON DELETE RESTRICT,
    status_code VARCHAR(20) NOT NULL DEFAULT '',
    status_message VARCHAR(500) NOT NULL DEFAULT '',
    review_reason VARCHAR(500) NOT NULL DEFAULT '',
    next_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_gateway_unique_payment_id
    ON hostel_gateway_transactions (provider, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hostel_gateway_unique_trx
    ON hostel_gateway_transactions (provider, trx_id) WHERE trx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hostel_gateway_open ON hostel_gateway_transactions (status, next_check_at);
CREATE INDEX IF NOT EXISTS hostel_gateway_invoice ON hostel_gateway_transactions (invoice_id);
CREATE INDEX IF NOT EXISTS hostel_gateway_list ON hostel_gateway_transactions (institution_id, created_at DESC);

-- =========================================================================
-- Hostel phase A: rent sync, central charges, meals, visitors, fees
-- =========================================================================

-- Seat fees become money, like allocation rent, so the two can match exactly.
DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'hostel_seats' AND column_name = 'monthly_fee') = 'integer' THEN
        ALTER TABLE hostel_seats ALTER COLUMN monthly_fee TYPE NUMERIC(12,2);
    END IF;
END $$;

-- Every rent change, from the seat or from the allocation, in one history.
CREATE TABLE IF NOT EXISTS hostel_rent_changes (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    seat_id VARCHAR(64) REFERENCES hostel_seats(id) ON DELETE SET NULL,
    allocation_id VARCHAR(64) REFERENCES hostel_allocations(id) ON DELETE SET NULL,
    seat_label VARCHAR(255) NOT NULL DEFAULT '',
    student_id VARCHAR(100) NOT NULL DEFAULT '',
    old_amount NUMERIC(12,2),
    new_amount NUMERIC(12,2) NOT NULL,
    effective_month DATE,
    source VARCHAR(20) NOT NULL,
    changed_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_rent_changes_seat ON hostel_rent_changes (seat_id, created_at DESC);

ALTER TABLE hostel_rent_settings
    ADD COLUMN IF NOT EXISTS contact_info VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hostel_rules TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS meal_reminder_threshold NUMERIC(12,2) NOT NULL DEFAULT 500,
    ADD COLUMN IF NOT EXISTS meal_reminder_interval_days INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS meal_payment_days INTEGER NOT NULL DEFAULT 7;

-- Invoices carry every kind of hostel charge, each traceable to its source.
-- rent_amount holds the base charge for every category.
ALTER TABLE hostel_invoices
    ADD COLUMN IF NOT EXISTS category VARCHAR(10) NOT NULL DEFAULT 'RENT',
    ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(200);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hostel_invoices_category_check') THEN
        ALTER TABLE hostel_invoices ADD CONSTRAINT hostel_invoices_category_check
            CHECK (category IN ('RENT', 'MEAL', 'FEE', 'DEPOSIT'));
    END IF;
END $$;

ALTER TABLE hostel_invoices DROP CONSTRAINT IF EXISTS hostel_invoices_allocation_id_billing_month_key;
CREATE UNIQUE INDEX IF NOT EXISTS hostel_invoices_one_rent_per_month
    ON hostel_invoices (allocation_id, billing_month) WHERE category = 'RENT';
CREATE UNIQUE INDEX IF NOT EXISTS hostel_invoices_one_per_source
    ON hostel_invoices (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hostel_invoices_allocation ON hostel_invoices (allocation_id, category);

-- The lines that make up an invoice. Older rent invoices have none and show one rent line.
CREATE TABLE IF NOT EXISTS hostel_invoice_items (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    description VARCHAR(255) NOT NULL,
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS hostel_invoice_items_invoice ON hostel_invoice_items (invoice_id, sort_order);

-- The view was created above, before these columns existed, so it is rebuilt here.
DROP VIEW IF EXISTS hostel_invoice_balances;
CREATE VIEW hostel_invoice_balances AS
SELECT i.*,
    i.rent_amount + COALESCE(a.total, 0) AS amount_due,
    COALESCE(a.total, 0) AS adjustment_total,
    COALESCE(p.total, 0) AS paid_amount,
    i.rent_amount + COALESCE(a.total, 0) - COALESCE(p.total, 0) AS outstanding_amount
FROM hostel_invoices i
LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS total FROM hostel_invoice_adjustments GROUP BY invoice_id
) a ON a.invoice_id = i.id
LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS total FROM hostel_payments WHERE status = 'Confirmed' GROUP BY invoice_id
) p ON p.invoice_id = i.id;

-- Meals. Published meals are locked; corrections cancel and replace them.
CREATE TABLE IF NOT EXISTS hostel_meals (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    title VARCHAR(150) NOT NULL,
    meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('Breakfast', 'Lunch', 'Dinner', 'Special Meal', 'Snacks')),
    meal_date DATE NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT '',
    description VARCHAR(1000) NOT NULL DEFAULT '',
    menu_items JSONB NOT NULL DEFAULT '[]',
    price_per_meal NUMERIC(12,2) NOT NULL CHECK (price_per_meal >= 0),
    special_price NUMERIC(12,2) CHECK (special_price >= 0),
    additional_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (additional_charge >= 0),
    booking_opens_at TIMESTAMP WITH TIME ZONE NOT NULL,
    booking_closes_at TIMESTAMP WITH TIME ZONE NOT NULL,
    collect_from TIMESTAMP WITH TIME ZONE NOT NULL,
    collect_until TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published', 'Cancelled')),
    published_at TIMESTAMP WITH TIME ZONE,
    published_by VARCHAR(255) NOT NULL DEFAULT '',
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancelled_by VARCHAR(255) NOT NULL DEFAULT '',
    cancel_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CHECK (booking_closes_at > booking_opens_at),
    CHECK (collect_until > collect_from)
);

CREATE INDEX IF NOT EXISTS hostel_meals_list ON hostel_meals (institution_id, meal_date DESC);

CREATE TABLE IF NOT EXISTS hostel_meal_bookings (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    meal_id VARCHAR(64) NOT NULL REFERENCES hostel_meals(id) ON DELETE RESTRICT,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE RESTRICT,
    student_id VARCHAR(100) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL,
    invoice_id VARCHAR(64) REFERENCES hostel_invoices(id) ON DELETE RESTRICT,
    status VARCHAR(10) NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed', 'Cancelled')),
    booked_by VARCHAR(255) NOT NULL DEFAULT '',
    collected_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_meal_bookings_one_active
    ON hostel_meal_bookings (meal_id, allocation_id) WHERE status = 'Confirmed';
CREATE INDEX IF NOT EXISTS hostel_meal_bookings_allocation ON hostel_meal_bookings (allocation_id);

-- Visitors and their tickets.
CREATE TABLE IF NOT EXISTS hostel_visitors (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    ticket_number VARCHAR(20) NOT NULL UNIQUE,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE RESTRICT,
    host_student_id VARCHAR(100) NOT NULL,
    host_name VARCHAR(100) NOT NULL,
    host_location VARCHAR(255) NOT NULL DEFAULT '',
    visitor_name VARCHAR(100) NOT NULL,
    visitor_phone VARCHAR(20) NOT NULL,
    visitor_email VARCHAR(255) NOT NULL DEFAULT '',
    visitor_nid VARCHAR(17) NOT NULL DEFAULT '',
    relationship VARCHAR(100) NOT NULL,
    purpose VARCHAR(500) NOT NULL DEFAULT '',
    visit_date DATE NOT NULL,
    expected_arrival TIME NOT NULL,
    expected_departure TIME NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Approved', 'Checked In', 'Checked Out', 'Rejected', 'Cancelled')),
    status_reason VARCHAR(500) NOT NULL DEFAULT '',
    checked_in_at TIMESTAMP WITH TIME ZONE,
    checked_in_by VARCHAR(255) NOT NULL DEFAULT '',
    checked_out_at TIMESTAMP WITH TIME ZONE,
    checked_out_by VARCHAR(255) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CHECK (expected_departure > expected_arrival)
);

CREATE INDEX IF NOT EXISTS hostel_visitors_list ON hostel_visitors (institution_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS hostel_visitors_host ON hostel_visitors (allocation_id);

CREATE TABLE IF NOT EXISTS hostel_visitor_documents (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    visitor_id VARCHAR(64) NOT NULL REFERENCES hostel_visitors(id) ON DELETE CASCADE,
    document_type VARCHAR(10) NOT NULL CHECK (document_type IN ('PHOTO', 'NID', 'OTHER')),
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    size_bytes INTEGER NOT NULL,
    content BYTEA NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (visitor_id, document_type)
);

-- Configurable fees and who they apply to.
CREATE TABLE IF NOT EXISTS hostel_fee_types (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('ONE_TIME', 'MONTHLY')),
    due_days INTEGER NOT NULL DEFAULT 7 CHECK (due_days BETWEEN 0 AND 90),
    effective_date DATE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, name)
);

CREATE TABLE IF NOT EXISTS hostel_fee_assignments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    fee_type_id VARCHAR(64) NOT NULL REFERENCES hostel_fee_types(id) ON DELETE RESTRICT,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('ALL', 'BUILDING', 'ROOM', 'SEAT', 'STUDENTS')),
    target_ids TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hostel_fee_assignments_type ON hostel_fee_assignments (fee_type_id);

-- Rows shown in an email that is not about one invoice, such as an allocation or a visit ticket.
ALTER TABLE hostel_notifications ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '[]';

-- A photo for each meal, served only through the signed-in API.
ALTER TABLE hostel_meals ADD COLUMN IF NOT EXISTS image BYTEA;
ALTER TABLE hostel_meals ADD COLUMN IF NOT EXISTS image_mime VARCHAR(50);
ALTER TABLE hostel_meals ADD COLUMN IF NOT EXISTS image_name VARCHAR(200);

-- Late fees on overdue rent. Only invoices due on or after late_fee_starts_on are charged,
-- so turning the fee on never charges old debts by surprise.
ALTER TABLE hostel_rent_settings ADD COLUMN IF NOT EXISTS late_fee_type VARCHAR(10) NOT NULL DEFAULT 'NONE';
ALTER TABLE hostel_rent_settings ADD COLUMN IF NOT EXISTS late_fee_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE hostel_rent_settings ADD COLUMN IF NOT EXISTS late_fee_grace_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hostel_rent_settings ADD COLUMN IF NOT EXISTS late_fee_starts_on DATE;

-- Named groups of students, for fees that apply to some students only.
CREATE TABLE IF NOT EXISTS hostel_student_groups (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, name)
);

CREATE TABLE IF NOT EXISTS hostel_student_group_members (
    group_id VARCHAR(64) NOT NULL REFERENCES hostel_student_groups(id) ON DELETE CASCADE,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, allocation_id)
);

DO $$
BEGIN
    ALTER TABLE hostel_fee_assignments DROP CONSTRAINT IF EXISTS hostel_fee_assignments_scope_check;
    ALTER TABLE hostel_fee_assignments ADD CONSTRAINT hostel_fee_assignments_scope_check
        CHECK (scope IN ('ALL', 'BUILDING', 'ROOM', 'SEAT', 'STUDENTS', 'GROUP'));
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hostel_rent_settings_late_fee_type_check') THEN
        ALTER TABLE hostel_rent_settings ADD CONSTRAINT hostel_rent_settings_late_fee_type_check
            CHECK (late_fee_type IN ('NONE', 'FLAT', 'PERCENT'));
    END IF;
END $$;

-- =========================================================================
-- Identity: tenants, subscriptions, users, roles and permissions.
-- Ids are text so they match the institution ids used by every module.
-- (The older UUID tables "institutions", "users" and "dynamic_roles" above are unused.)
-- =========================================================================
CREATE TABLE IF NOT EXISTS erp_tenants (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'University',
    contact_name VARCHAR(150) NOT NULL DEFAULT '',
    contact_email VARCHAR(255) NOT NULL DEFAULT '',
    contact_phone VARCHAR(30) NOT NULL DEFAULT '',
    address VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
    status_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_modules (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    icon VARCHAR(16) NOT NULL DEFAULT '',
    monthly_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
    is_core BOOLEAN NOT NULL DEFAULT FALSE,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- Which modules a tenant may use, and until when.
CREATE TABLE IF NOT EXISTS erp_tenant_modules (
    tenant_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    module_id VARCHAR(50) NOT NULL REFERENCES erp_modules(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
    ends_on DATE,
    monthly_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, module_id)
);

CREATE TABLE IF NOT EXISTS erp_subscription_requests (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('REGISTRATION', 'ADD_MODULES')),
    module_ids TEXT[] NOT NULL,
    monthly_total NUMERIC(12,2) NOT NULL,
    billing_cycle VARCHAR(10) NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    note VARCHAR(1000) NOT NULL DEFAULT '',
    requested_by VARCHAR(255) NOT NULL DEFAULT '',
    decided_by VARCHAR(255) NOT NULL DEFAULT '',
    decided_at TIMESTAMP WITH TIME ZONE,
    decision_note VARCHAR(1000) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_subscription_one_pending ON erp_subscription_requests (tenant_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS erp_roles (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    portal_type VARCHAR(20) NOT NULL DEFAULT 'STAFF',
    permissions TEXT[] NOT NULL DEFAULT '{}',
    form_id VARCHAR(64),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_roles_unique_name ON erp_roles (institution_id, LOWER(name));

CREATE TABLE IF NOT EXISTS erp_users (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    full_name VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(64) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    linked_type VARCHAR(30),
    linked_id VARCHAR(64),
    profile JSONB NOT NULL DEFAULT '{}',
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- A username signs in on its own, so it is unique across every tenant.
CREATE UNIQUE INDEX IF NOT EXISTS erp_users_unique_username ON erp_users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS erp_users_unique_email ON erp_users (institution_id, LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS erp_users_unique_link ON erp_users (institution_id, linked_type, linked_id) WHERE linked_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS erp_users_by_tenant ON erp_users (institution_id, created_at DESC);

-- Per-user exceptions to their role. A DENY always wins over an ALLOW.
CREATE TABLE IF NOT EXISTS erp_user_permission_overrides (
    user_id VARCHAR(64) NOT NULL REFERENCES erp_users(id) ON DELETE CASCADE,
    permission_key VARCHAR(150) NOT NULL,
    effect VARCHAR(5) NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
    reason VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS erp_audit_log (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL DEFAULT '',
    actor_email VARCHAR(255) NOT NULL DEFAULT '',
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(64) NOT NULL DEFAULT '',
    summary VARCHAR(2000) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_audit_by_tenant ON erp_audit_log (institution_id, created_at DESC);

-- Form builder. A form has numbered versions; only the published one takes answers,
-- and each answer records the version it was made against.
CREATE TABLE IF NOT EXISTS erp_forms (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    form_type VARCHAR(20) NOT NULL DEFAULT 'permanent',
    purpose VARCHAR(20) NOT NULL DEFAULT 'GENERAL' CHECK (purpose IN ('GENERAL', 'USER_PROFILE', 'FEATURE')),
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    published_version INTEGER,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, slug)
);

CREATE TABLE IF NOT EXISTS erp_form_versions (
    form_id VARCHAR(64) NOT NULL REFERENCES erp_forms(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    fields JSONB NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    published_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (form_id, version)
);

CREATE TABLE IF NOT EXISTS erp_form_submissions (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    form_id VARCHAR(64) NOT NULL REFERENCES erp_forms(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    submitted_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_form_submissions_by_form ON erp_form_submissions (form_id, created_at DESC);

-- Feature builder. A feature is metadata: a form for its records, the columns of its
-- list, and its own permissions. Records are kept as JSON against that form.
CREATE TABLE IF NOT EXISTS erp_features (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    module_id VARCHAR(50) NOT NULL,
    key VARCHAR(60) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    icon VARCHAR(16) NOT NULL DEFAULT '',
    form_id VARCHAR(64) NOT NULL REFERENCES erp_forms(id) ON DELETE CASCADE,
    list_columns TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, module_id, key)
);

CREATE TABLE IF NOT EXISTS erp_feature_records (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    feature_id VARCHAR(64) NOT NULL REFERENCES erp_features(id) ON DELETE CASCADE,
    form_version INTEGER NOT NULL,
    data JSONB NOT NULL,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    updated_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erp_feature_records_by_feature ON erp_feature_records (feature_id, created_at DESC);

-- A custom role may build on another role (custom or built-in staff role).
ALTER TABLE erp_roles ADD COLUMN IF NOT EXISTS parent_role_id VARCHAR(64);

-- Which students a guardian account may see in the portal.
CREATE TABLE IF NOT EXISTS erp_guardian_links (
    guardian_user_id VARCHAR(64) NOT NULL REFERENCES erp_users(id) ON DELETE CASCADE,
    institution_id VARCHAR(64) NOT NULL,
    student_id VARCHAR(100) NOT NULL,
    relationship VARCHAR(100) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guardian_user_id, student_id)
);

-- Money owed back to a student, for example for a paid meal that was cancelled.
CREATE TABLE IF NOT EXISTS hostel_refunds (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    allocation_id VARCHAR(64) NOT NULL REFERENCES hostel_allocations(id) ON DELETE CASCADE,
    invoice_id VARCHAR(64) NOT NULL REFERENCES hostel_invoices(id),
    source_type VARCHAR(30) NOT NULL,
    source_id VARCHAR(64) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(10) NOT NULL DEFAULT 'DUE' CHECK (status IN ('DUE', 'PAID')),
    method VARCHAR(30) NOT NULL DEFAULT '',
    reference VARCHAR(100) NOT NULL DEFAULT '',
    paid_on DATE,
    paid_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS hostel_refunds_by_status ON hostel_refunds (institution_id, status);

-- Settings kept per institution, one row per settings page.
CREATE TABLE IF NOT EXISTS erp_settings (
    tenant_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    section VARCHAR(30) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    updated_by VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, section)
);

-- Table designs from the table builder.
CREATE TABLE IF NOT EXISTS erp_tables (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    is_exportable BOOLEAN NOT NULL DEFAULT TRUE,
    columns JSONB NOT NULL,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, slug)
);

-- What each institution owes the platform, and what it paid.
ALTER TABLE erp_tenants ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) NOT NULL DEFAULT 'MONTHLY';

CREATE TABLE IF NOT EXISTS erp_subscription_invoices (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(40) NOT NULL UNIQUE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    billing_cycle VARCHAR(10) NOT NULL,
    lines JSONB NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    due_date DATE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'VOID')),
    void_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, period_start)
);

CREATE TABLE IF NOT EXISTS erp_subscription_payments (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL REFERENCES erp_subscription_invoices(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method VARCHAR(30) NOT NULL,
    reference VARCHAR(100) NOT NULL DEFAULT '',
    paid_on DATE NOT NULL,
    recorded_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_subscription_payments_unique_reference
    ON erp_subscription_payments (method, reference) WHERE reference <> '';

-- Only institutions that signed up through registration are billed, unless the platform turns it on.
ALTER TABLE erp_tenants ADD COLUMN IF NOT EXISTS billing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE erp_subscription_invoices ALTER COLUMN invoice_number TYPE VARCHAR(100);

-- =========================================================================
-- Academics: structure, people, classes, attendance and examinations.
-- A student's student_no is the same ID the hostel and portal use.
-- =========================================================================
CREATE TABLE IF NOT EXISTS acad_departments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(150) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, code)
);

CREATE TABLE IF NOT EXISTS acad_programs (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    department_id VARCHAR(64) NOT NULL REFERENCES acad_departments(id),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(150) NOT NULL,
    term_label VARCHAR(20) NOT NULL DEFAULT 'Semester',
    term_count INTEGER NOT NULL CHECK (term_count BETWEEN 1 AND 20),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, code)
);

CREATE TABLE IF NOT EXISTS acad_sessions (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, name),
    CHECK (ends_on > starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS acad_sessions_one_current ON acad_sessions (institution_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS acad_teachers (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    employee_no VARCHAR(40) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    department_id VARCHAR(64) REFERENCES acad_departments(id),
    designation VARCHAR(100) NOT NULL DEFAULT '',
    qualification VARCHAR(200) NOT NULL DEFAULT '',
    joined_on DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'INACTIVE')),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, employee_no)
);

CREATE TABLE IF NOT EXISTS acad_sections (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    program_id VARCHAR(64) NOT NULL REFERENCES acad_programs(id),
    session_id VARCHAR(64) NOT NULL REFERENCES acad_sessions(id),
    term_no INTEGER NOT NULL CHECK (term_no >= 1),
    name VARCHAR(30) NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 60 CHECK (capacity BETWEEN 1 AND 1000),
    class_teacher_id VARCHAR(64) REFERENCES acad_teachers(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, session_id, term_no, name)
);

CREATE TABLE IF NOT EXISTS acad_courses (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    department_id VARCHAR(64) NOT NULL REFERENCES acad_departments(id),
    code VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    credits NUMERIC(4,2) NOT NULL CHECK (credits > 0 AND credits <= 20),
    course_type VARCHAR(10) NOT NULL DEFAULT 'THEORY' CHECK (course_type IN ('THEORY', 'LAB', 'PROJECT')),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, code)
);

CREATE TABLE IF NOT EXISTS acad_students (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    student_no VARCHAR(40) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    date_of_birth DATE,
    gender VARCHAR(10) NOT NULL DEFAULT '' CHECK (gender IN ('', 'MALE', 'FEMALE', 'OTHER')),
    address VARCHAR(500) NOT NULL DEFAULT '',
    program_id VARCHAR(64) NOT NULL REFERENCES acad_programs(id),
    section_id VARCHAR(64) REFERENCES acad_sections(id),
    admission_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'GRADUATED', 'DROPPED')),
    status_reason VARCHAR(500) NOT NULL DEFAULT '',
    guardian_name VARCHAR(150) NOT NULL DEFAULT '',
    guardian_phone VARCHAR(30) NOT NULL DEFAULT '',
    guardian_email VARCHAR(255) NOT NULL DEFAULT '',
    guardian_relationship VARCHAR(50) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS acad_students_unique_no ON acad_students (institution_id, LOWER(student_no));
CREATE INDEX IF NOT EXISTS acad_students_by_section ON acad_students (section_id);

-- A course taught to one section by one teacher.
CREATE TABLE IF NOT EXISTS acad_classes (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    course_id VARCHAR(64) NOT NULL REFERENCES acad_courses(id),
    section_id VARCHAR(64) NOT NULL REFERENCES acad_sections(id),
    teacher_id VARCHAR(64) REFERENCES acad_teachers(id),
    results_published_at TIMESTAMP WITH TIME ZONE,
    results_published_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, section_id)
);

CREATE TABLE IF NOT EXISTS acad_attendance_sessions (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    class_id VARCHAR(64) NOT NULL REFERENCES acad_classes(id) ON DELETE CASCADE,
    held_on DATE NOT NULL,
    slot VARCHAR(30) NOT NULL DEFAULT '1',
    topic VARCHAR(200) NOT NULL DEFAULT '',
    taken_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, held_on, slot)
);

CREATE TABLE IF NOT EXISTS acad_attendance_marks (
    session_id VARCHAR(64) NOT NULL REFERENCES acad_attendance_sessions(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES acad_students(id) ON DELETE CASCADE,
    status VARCHAR(8) NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
    note VARCHAR(200) NOT NULL DEFAULT '',
    PRIMARY KEY (session_id, student_id)
);

-- An exam belongs to a session; each class gets one assessment for it.
CREATE TABLE IF NOT EXISTS acad_exams (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    session_id VARCHAR(64) NOT NULL REFERENCES acad_sessions(id),
    name VARCHAR(100) NOT NULL,
    weight NUMERIC(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
    default_max_marks NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (default_max_marks > 0),
    starts_on DATE,
    ends_on DATE,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, name)
);

CREATE TABLE IF NOT EXISTS acad_assessments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL,
    exam_id VARCHAR(64) NOT NULL REFERENCES acad_exams(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES acad_classes(id) ON DELETE CASCADE,
    max_marks NUMERIC(6,2) NOT NULL CHECK (max_marks > 0),
    exam_date DATE,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(255) NOT NULL DEFAULT '',
    UNIQUE (exam_id, class_id)
);

CREATE TABLE IF NOT EXISTS acad_marks (
    assessment_id VARCHAR(64) NOT NULL REFERENCES acad_assessments(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES acad_students(id) ON DELETE CASCADE,
    marks NUMERIC(6,2),
    is_absent BOOLEAN NOT NULL DEFAULT FALSE,
    entered_by VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (assessment_id, student_id),
    CHECK (marks IS NULL OR marks >= 0)
);

-- ======================================================================
-- Finance: fee heads, fee structure, invoices, adjustments and payments
-- ======================================================================

CREATE SEQUENCE IF NOT EXISTS fin_invoice_number_seq;
CREATE SEQUENCE IF NOT EXISTS fin_receipt_number_seq;

CREATE TABLE IF NOT EXISTS fin_fee_heads (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'TUITION',
    frequency VARCHAR(20) NOT NULL DEFAULT 'PER_TERM',
    default_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, code)
);

-- The amount of a fee head for one program. Without a rate the default amount applies.
CREATE TABLE IF NOT EXISTS fin_fee_rates (
    fee_head_id VARCHAR(64) NOT NULL REFERENCES fin_fee_heads(id) ON DELETE CASCADE,
    program_id VARCHAR(64) NOT NULL REFERENCES acad_programs(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (fee_head_id, program_id)
);

-- Student details are snapshots, so later profile edits never rewrite an issued invoice.
CREATE TABLE IF NOT EXISTS fin_invoices (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(40) NOT NULL UNIQUE,
    student_id VARCHAR(64) NOT NULL REFERENCES acad_students(id),
    student_no VARCHAR(40) NOT NULL,
    student_name VARCHAR(150) NOT NULL,
    program_name VARCHAR(150) NOT NULL DEFAULT '',
    title VARCHAR(150) NOT NULL,
    issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(10) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'CANCELLED')),
    cancel_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- A student is billed once per title: generating "Spring 2026 Tuition" twice skips them.
CREATE UNIQUE INDEX IF NOT EXISTS fin_invoices_one_per_title ON fin_invoices (student_id, LOWER(title)) WHERE status = 'ISSUED';
CREATE INDEX IF NOT EXISTS fin_invoices_by_tenant ON fin_invoices (institution_id, due_date);

CREATE TABLE IF NOT EXISTS fin_invoice_items (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
    fee_head_id VARCHAR(64) REFERENCES fin_fee_heads(id),
    description VARCHAR(150) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0)
);

-- Waivers and discounts are negative, fines are positive.
CREATE TABLE IF NOT EXISTS fin_adjustments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    invoice_id VARCHAR(64) NOT NULL REFERENCES fin_invoices(id),
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('WAIVER', 'DISCOUNT', 'FINE')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
    reason VARCHAR(500) NOT NULL,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Payments are never deleted. A correction reverses the payment.
CREATE TABLE IF NOT EXISTS fin_payments (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    invoice_id VARCHAR(64) NOT NULL REFERENCES fin_invoices(id),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    paid_on DATE NOT NULL,
    method VARCHAR(10) NOT NULL,
    reference VARCHAR(100) NOT NULL DEFAULT '',
    receipt_number VARCHAR(40) NOT NULL UNIQUE,
    notes VARCHAR(500) NOT NULL DEFAULT '',
    idempotency_key VARCHAR(64),
    status VARCHAR(10) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'REVERSED')),
    recorded_by VARCHAR(255) NOT NULL DEFAULT '',
    reversed_at TIMESTAMP WITH TIME ZONE,
    reversed_by VARCHAR(255) NOT NULL DEFAULT '',
    reversal_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fin_payments_by_invoice ON fin_payments (invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS fin_payments_unique_reference ON fin_payments (institution_id, LOWER(reference)) WHERE reference <> '' AND status = 'CONFIRMED';
CREATE UNIQUE INDEX IF NOT EXISTS fin_payments_unique_request ON fin_payments (institution_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP VIEW IF EXISTS fin_invoice_balances;
CREATE VIEW fin_invoice_balances AS
SELECT i.*,
    COALESCE(a.total, 0) AS adjustment_total,
    i.total_amount + COALESCE(a.total, 0) AS amount_due,
    COALESCE(p.total, 0) AS paid_amount,
    i.total_amount + COALESCE(a.total, 0) - COALESCE(p.total, 0) AS outstanding_amount
FROM fin_invoices i
LEFT JOIN (SELECT invoice_id, SUM(amount) AS total FROM fin_adjustments GROUP BY invoice_id) a ON a.invoice_id = i.id
LEFT JOIN (SELECT invoice_id, SUM(amount) AS total FROM fin_payments WHERE status = 'CONFIRMED' GROUP BY invoice_id) p ON p.invoice_id = i.id;

-- ======================================================================
-- Notices
-- ======================================================================

CREATE TABLE IF NOT EXISTS notices (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
    audience VARCHAR(20) NOT NULL DEFAULT 'ALL',
    display VARCHAR(10) NOT NULL DEFAULT 'BOARD' CHECK (display IN ('BOARD', 'POPUP')),
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    publish_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    emailed_at TIMESTAMP WITH TIME ZONE,
    emailed_count INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notices_by_tenant ON notices (institution_id, status);

-- ======================================================================
-- Library
-- ======================================================================

CREATE TABLE IF NOT EXISTS lib_settings (
    institution_id VARCHAR(64) PRIMARY KEY REFERENCES erp_tenants(id) ON DELETE CASCADE,
    loan_days INTEGER NOT NULL DEFAULT 14 CHECK (loan_days BETWEEN 1 AND 365),
    fine_per_day NUMERIC(10,2) NOT NULL DEFAULT 5 CHECK (fine_per_day >= 0),
    max_loans INTEGER NOT NULL DEFAULT 3 CHECK (max_loans BETWEEN 1 AND 50),
    max_renewals INTEGER NOT NULL DEFAULT 1 CHECK (max_renewals BETWEEN 0 AND 10)
);

CREATE TABLE IF NOT EXISTS lib_books (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    isbn VARCHAR(20) NOT NULL DEFAULT '',
    title VARCHAR(250) NOT NULL,
    author VARCHAR(200) NOT NULL DEFAULT '',
    publisher VARCHAR(200) NOT NULL DEFAULT '',
    category VARCHAR(100) NOT NULL DEFAULT '',
    edition VARCHAR(50) NOT NULL DEFAULT '',
    shelf VARCHAR(50) NOT NULL DEFAULT '',
    total_copies INTEGER NOT NULL CHECK (total_copies BETWEEN 0 AND 10000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lib_books_unique_isbn ON lib_books (institution_id, isbn) WHERE isbn <> '';

-- A borrower is a student or a teacher; name and number are snapshots.
CREATE TABLE IF NOT EXISTS lib_loans (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    book_id VARCHAR(64) NOT NULL REFERENCES lib_books(id),
    borrower_type VARCHAR(10) NOT NULL CHECK (borrower_type IN ('STUDENT', 'TEACHER')),
    borrower_id VARCHAR(64) NOT NULL,
    borrower_no VARCHAR(40) NOT NULL,
    borrower_name VARCHAR(150) NOT NULL,
    issued_on DATE NOT NULL,
    due_on DATE NOT NULL,
    renewals INTEGER NOT NULL DEFAULT 0,
    returned_on DATE,
    fine_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
    fine_status VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK (fine_status IN ('NONE', 'DUE', 'PAID', 'WAIVED')),
    fine_settled_by VARCHAR(255) NOT NULL DEFAULT '',
    fine_note VARCHAR(500) NOT NULL DEFAULT '',
    issued_by VARCHAR(255) NOT NULL DEFAULT '',
    returned_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lib_loans_open ON lib_loans (institution_id, borrower_type, borrower_id) WHERE returned_on IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lib_loans_one_copy_each ON lib_loans (book_id, borrower_type, borrower_id) WHERE returned_on IS NULL;

-- ======================================================================
-- HR: staff, salaries, leave and payroll
-- ======================================================================

-- Non-teaching staff. Teachers stay in acad_teachers; HR treats both as employees.
CREATE TABLE IF NOT EXISTS hr_staff (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    employee_no VARCHAR(40) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    department VARCHAR(100) NOT NULL DEFAULT '',
    designation VARCHAR(100) NOT NULL DEFAULT '',
    joined_on DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'INACTIVE')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hr_staff_unique_no ON hr_staff (institution_id, LOWER(employee_no));

-- The current salary of one employee (teacher or staff).
CREATE TABLE IF NOT EXISTS hr_salaries (
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    person_type VARCHAR(10) NOT NULL CHECK (person_type IN ('TEACHER', 'STAFF')),
    person_id VARCHAR(64) NOT NULL,
    basic NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
    house_rent NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (house_rent >= 0),
    medical NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (medical >= 0),
    transport NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (transport >= 0),
    other_allowance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_allowance >= 0),
    tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
    provident_fund NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (provident_fund >= 0),
    other_deduction NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_deduction >= 0),
    bank_account VARCHAR(60) NOT NULL DEFAULT '',
    updated_by VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_id, person_type, person_id)
);

CREATE TABLE IF NOT EXISTS hr_leave_types (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    days_per_year INTEGER NOT NULL CHECK (days_per_year BETWEEN 0 AND 365),
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (institution_id, name)
);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    person_type VARCHAR(10) NOT NULL CHECK (person_type IN ('TEACHER', 'STAFF')),
    person_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(40) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    leave_type_id VARCHAR(64) NOT NULL REFERENCES hr_leave_types(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days INTEGER NOT NULL CHECK (days > 0),
    reason VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    decided_by VARCHAR(255) NOT NULL DEFAULT '',
    decided_at TIMESTAMP WITH TIME ZONE,
    decision_note VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS hr_leave_by_person ON hr_leave_requests (institution_id, person_type, person_id);

-- One payroll per month. A draft can be regenerated; approved and paid runs are fixed.
CREATE TABLE IF NOT EXISTS hr_payroll_runs (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PAID')),
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    approved_by VARCHAR(255) NOT NULL DEFAULT '',
    approved_at TIMESTAMP WITH TIME ZONE,
    paid_by VARCHAR(255) NOT NULL DEFAULT '',
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, month)
);

CREATE TABLE IF NOT EXISTS hr_payslips (
    id VARCHAR(64) PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
    person_type VARCHAR(10) NOT NULL,
    person_id VARCHAR(64) NOT NULL,
    employee_no VARCHAR(40) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    designation VARCHAR(100) NOT NULL DEFAULT '',
    bank_account VARCHAR(60) NOT NULL DEFAULT '',
    basic NUMERIC(12,2) NOT NULL,
    allowances NUMERIC(12,2) NOT NULL,
    deductions NUMERIC(12,2) NOT NULL,
    unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
    leave_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay NUMERIC(12,2) NOT NULL,
    UNIQUE (run_id, person_type, person_id)
);

-- Checked at commit, so deleting a whole tenant can cascade in any order.
-- The services still refuse to delete records that are in use.
ALTER TABLE fin_invoice_items ALTER CONSTRAINT fin_invoice_items_fee_head_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE fin_invoices ALTER CONSTRAINT fin_invoices_student_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE fin_adjustments ALTER CONSTRAINT fin_adjustments_invoice_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE fin_payments ALTER CONSTRAINT fin_payments_invoice_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE lib_loans ALTER CONSTRAINT lib_loans_book_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hr_leave_requests ALTER CONSTRAINT hr_leave_requests_leave_type_id_fkey DEFERRABLE INITIALLY DEFERRED;

-- =========================================================================
-- User management: the subscription owner, role registration forms,
-- delivery of sign-in details and the email log.
-- =========================================================================
-- The account that registered the institution. It keeps full access and is kept
-- apart from the operational users an admin manages.
ALTER TABLE erp_tenants ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR(64);
UPDATE erp_tenants t SET owner_user_id = (
  SELECT u.id FROM erp_users u WHERE u.institution_id = t.id AND u.role = 'ADMIN' AND u.created_by = 'registration'
  ORDER BY u.created_at LIMIT 1)
WHERE t.owner_user_id IS NULL;

-- The registration form of a built-in role. Custom roles keep theirs on erp_roles.form_id.
CREATE TABLE IF NOT EXISTS erp_role_forms (
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    role_id VARCHAR(64) NOT NULL,
    form_id VARCHAR(64) NOT NULL REFERENCES erp_forms(id) ON DELETE CASCADE,
    updated_by VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institution_id, role_id)
);

-- When the sign-in details last reached the user. NULL means they never did.
ALTER TABLE erp_users ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMP WITH TIME ZONE;
UPDATE erp_users SET credentials_sent_at = COALESCE(last_login_at, created_at)
WHERE credentials_sent_at IS NULL AND must_change_password = FALSE;

-- The registration answers a user was created from. They go when the user is deleted.
ALTER TABLE erp_form_submissions ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_form_submissions_user_fk') THEN
    ALTER TABLE erp_form_submissions ADD CONSTRAINT erp_form_submissions_user_fk
      FOREIGN KEY (user_id) REFERENCES erp_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Every account email: who, what kind, and whether it went. Never the password.
CREATE TABLE IF NOT EXISTS erp_email_log (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64),
    kind VARCHAR(40) NOT NULL,
    recipient VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(10) NOT NULL CHECK (status IN ('SENT', 'FAILED')),
    error VARCHAR(500) NOT NULL DEFAULT '',
    sent_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_email_log_by_user ON erp_email_log (institution_id, user_id, created_at DESC);

-- Activity per person, for the admin's and the platform owner's activity views.
CREATE INDEX IF NOT EXISTS erp_audit_by_actor ON erp_audit_log (institution_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hostel_audit_by_actor ON hostel_audit_log (institution_id, actor_id, created_at DESC);

-- Where each action came from: the IP address and the browser's User-Agent.
ALTER TABLE erp_audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE erp_audit_log ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE hostel_audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE hostel_audit_log ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500) NOT NULL DEFAULT '';

-- ======================================================================
-- Inventory: stores, stock items, an append-only stock ledger,
-- store-to-store transfers and the fixed asset register.
-- ======================================================================

-- A place stock is kept: the central store, a lab store, a department cupboard.
CREATE TABLE IF NOT EXISTS inv_stores (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(120) NOT NULL,
    location VARCHAR(200) NOT NULL DEFAULT '',
    manager VARCHAR(150) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inv_stores_unique_code ON inv_stores (institution_id, LOWER(code));

-- Consumable stock: paper, pens, chemicals, cleaning supplies, spare parts.
-- avg_cost is the weighted average cost of everything on hand, across all stores.
CREATE TABLE IF NOT EXISTS inv_items (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    sku VARCHAR(40) NOT NULL,
    barcode VARCHAR(64) NOT NULL DEFAULT '',
    name VARCHAR(200) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    category VARCHAR(100) NOT NULL DEFAULT '',
    brand VARCHAR(100) NOT NULL DEFAULT '',
    unit VARCHAR(30) NOT NULL DEFAULT 'Piece',
    reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    max_level NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (max_level >= 0),
    avg_cost NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inv_items_unique_sku ON inv_items (institution_id, LOWER(sku));
CREATE UNIQUE INDEX IF NOT EXISTS inv_items_unique_barcode ON inv_items (institution_id, barcode) WHERE barcode <> '';

-- What is on hand per item and store. Only changed together with a ledger row, under a row lock.
CREATE TABLE IF NOT EXISTS inv_balances (
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED,
    store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY (item_id, store_id)
);

-- Store-to-store transfers: requested, approved (stock leaves), then received (stock arrives).
CREATE TABLE IF NOT EXISTS inv_transfers (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    transfer_no VARCHAR(30) NOT NULL,
    from_store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    to_store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_TRANSIT', 'RECEIVED', 'REJECTED', 'CANCELLED')),
    note VARCHAR(500) NOT NULL DEFAULT '',
    decision_note VARCHAR(500) NOT NULL DEFAULT '',
    requested_by VARCHAR(255) NOT NULL DEFAULT '',
    approved_by VARCHAR(255) NOT NULL DEFAULT '',
    approved_at TIMESTAMP WITH TIME ZONE,
    received_by VARCHAR(255) NOT NULL DEFAULT '',
    received_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CHECK (from_store_id <> to_store_id)
);
CREATE INDEX IF NOT EXISTS inv_transfers_by_status ON inv_transfers (institution_id, status);

CREATE TABLE IF NOT EXISTS inv_transfer_lines (
    transfer_id VARCHAR(64) NOT NULL REFERENCES inv_transfers(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (transfer_id, item_id)
);

-- The stock ledger. Rows are only ever added: a mistake is corrected by a REVERSAL row,
-- never by editing history. quantity is signed: stock in is positive, stock out negative.
CREATE TABLE IF NOT EXISTS inv_movements (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    doc_no VARCHAR(30) NOT NULL,
    item_id VARCHAR(64) NOT NULL REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED,
    store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    kind VARCHAR(12) NOT NULL CONSTRAINT inv_movements_kind_check CHECK (kind IN ('OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'LOSS', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL', 'CONSUMPTION', 'WASTAGE')),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity <> 0),
    unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    balance_after NUMERIC(14,3) NOT NULL CHECK (balance_after >= 0),
    party VARCHAR(200) NOT NULL DEFAULT '',
    reference VARCHAR(100) NOT NULL DEFAULT '',
    note VARCHAR(500) NOT NULL DEFAULT '',
    transfer_id VARCHAR(64) REFERENCES inv_transfers(id) DEFERRABLE INITIALLY DEFERRED,
    reverses_id VARCHAR(64) REFERENCES inv_movements(id) DEFERRABLE INITIALLY DEFERRED,
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inv_movements_by_item ON inv_movements (institution_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inv_movements_by_time ON inv_movements (institution_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inv_movements_reversed_once ON inv_movements (reverses_id) WHERE reverses_id IS NOT NULL;

-- History cannot be rewritten, even by a bug or a hand-written UPDATE.
CREATE OR REPLACE FUNCTION inv_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The stock ledger cannot be edited. Record a reversal instead.';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inv_movements_no_update ON inv_movements;
CREATE TRIGGER inv_movements_no_update BEFORE UPDATE ON inv_movements FOR EACH ROW EXECUTE FUNCTION inv_ledger_append_only();

-- Fixed assets, tracked one by one: computers, lab equipment, furniture, projectors.
CREATE TABLE IF NOT EXISTS inv_assets (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    asset_tag VARCHAR(40) NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT '',
    brand VARCHAR(100) NOT NULL DEFAULT '',
    model VARCHAR(100) NOT NULL DEFAULT '',
    serial_no VARCHAR(100) NOT NULL DEFAULT '',
    store_id VARCHAR(64) REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    location VARCHAR(200) NOT NULL DEFAULT '',
    supplier VARCHAR(200) NOT NULL DEFAULT '',
    purchase_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
    purchased_on DATE,
    warranty_until DATE,
    condition VARCHAR(10) NOT NULL DEFAULT 'GOOD' CHECK (condition IN ('NEW', 'GOOD', 'FAIR', 'POOR')),
    status VARCHAR(12) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'DISPOSED')),
    assigned_to VARCHAR(150) NOT NULL DEFAULT '',
    department VARCHAR(100) NOT NULL DEFAULT '',
    assigned_on DATE,
    notes VARCHAR(1000) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inv_assets_unique_tag ON inv_assets (institution_id, LOWER(asset_tag));
CREATE INDEX IF NOT EXISTS inv_assets_by_status ON inv_assets (institution_id, status);

-- Everything that happened to an asset: assigned, returned, repaired, moved, disposed.
CREATE TABLE IF NOT EXISTS inv_asset_events (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    asset_id VARCHAR(64) NOT NULL REFERENCES inv_assets(id) ON DELETE CASCADE,
    action VARCHAR(12) NOT NULL,
    detail VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inv_asset_events_by_asset ON inv_asset_events (asset_id, created_at DESC);

-- Batches and expiry. An item that tracks batches keeps every unit in a batch, so the batches
-- of an item in a store always add up to its balance there.
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS track_batches BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS inv_batches (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED,
    store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    batch_no VARCHAR(60) NOT NULL,
    expires_on DATE,
    quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (item_id, store_id, batch_no)
);
CREATE INDEX IF NOT EXISTS inv_batches_by_expiry ON inv_batches (institution_id, expires_on) WHERE quantity > 0;
ALTER TABLE inv_movements ADD COLUMN IF NOT EXISTS batch_id VARCHAR(64) REFERENCES inv_batches(id) DEFERRABLE INITIALLY DEFERRED;

-- Purchasing: suppliers, purchase orders and the goods received against them.
CREATE TABLE IF NOT EXISTS inv_suppliers (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150) NOT NULL DEFAULT '',
    phone VARCHAR(30) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    address VARCHAR(300) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inv_suppliers_unique_name ON inv_suppliers (institution_id, LOWER(name));

-- DRAFT -> APPROVED -> PARTIAL -> RECEIVED. A partly received order can be CLOSED short;
-- an order with nothing received yet can be CANCELLED.
CREATE TABLE IF NOT EXISTS inv_purchase_orders (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    po_no VARCHAR(30) NOT NULL,
    supplier_id VARCHAR(64) NOT NULL REFERENCES inv_suppliers(id) DEFERRABLE INITIALLY DEFERRED,
    store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED')),
    ordered_on DATE NOT NULL,
    expected_on DATE,
    note VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255) NOT NULL DEFAULT '',
    approved_by VARCHAR(255) NOT NULL DEFAULT '',
    approved_at TIMESTAMP WITH TIME ZONE,
    closed_by VARCHAR(255) NOT NULL DEFAULT '',
    closed_at TIMESTAMP WITH TIME ZONE,
    close_note VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inv_purchase_orders_by_status ON inv_purchase_orders (institution_id, status);

CREATE TABLE IF NOT EXISTS inv_po_lines (
    po_id VARCHAR(64) NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    received NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received >= 0 AND received <= quantity),
    PRIMARY KEY (po_id, item_id)
);
ALTER TABLE inv_movements ADD COLUMN IF NOT EXISTS purchase_order_id VARCHAR(64) REFERENCES inv_purchase_orders(id) DEFERRABLE INITIALLY DEFERRED;

-- Who gets the daily inventory alert email, and how far ahead expiry is warned about.
CREATE TABLE IF NOT EXISTS inv_settings (
    institution_id VARCHAR(64) PRIMARY KEY REFERENCES erp_tenants(id) ON DELETE CASCADE,
    email_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    alert_emails VARCHAR(1000) NOT NULL DEFAULT '',
    expiry_warning_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_warning_days BETWEEN 1 AND 365),
    last_alert_on DATE
);

-- ----------------------------------------------------------------------
-- One inventory for every kind of organisation: a setup that picks the parts in use,
-- kinds of store, requisitions with approval, kitchen consumption and room assets.
-- Switching a part off only hides it; its data stays.
-- ----------------------------------------------------------------------
ALTER TABLE inv_settings ADD COLUMN IF NOT EXISTS profile VARCHAR(12) NOT NULL DEFAULT 'SCHOOL';
ALTER TABLE inv_settings ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT ARRAY['PURCHASING', 'BATCHES', 'TRANSFERS', 'ASSETS', 'REQUISITIONS'];

ALTER TABLE inv_stores ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'STORE';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inv_stores_kind_check') THEN
    ALTER TABLE inv_stores ADD CONSTRAINT inv_stores_kind_check CHECK (kind IN ('STORE', 'WAREHOUSE', 'KITCHEN', 'DEPARTMENT', 'LAB', 'OFFICE', 'OTHER'));
  END IF;
END $$;

-- Kitchen use and wastage are ledger kinds of their own, so they are never mixed up with issues.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inv_movements_kind_check' AND pg_get_constraintdef(oid) LIKE '%WASTAGE%') THEN
    ALTER TABLE inv_movements DROP CONSTRAINT IF EXISTS inv_movements_kind_check;
    ALTER TABLE inv_movements ADD CONSTRAINT inv_movements_kind_check CHECK (kind IN ('OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT',
      'DAMAGE', 'LOSS', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL', 'CONSUMPTION', 'WASTAGE'));
  END IF;
END $$;
-- What the stock was used for (Kitchen, Office supplies, Maintenance...), for the expense report.
ALTER TABLE inv_movements ADD COLUMN IF NOT EXISTS expense_category VARCHAR(60) NOT NULL DEFAULT '';
-- Which meal kitchen stock was cooked for: Breakfast, Lunch, Dinner, Snacks.
ALTER TABLE inv_movements ADD COLUMN IF NOT EXISTS meal VARCHAR(12) NOT NULL DEFAULT '';

-- A department, room or person asks for stock; an approver decides how much; the store issues it;
-- the requester confirms it arrived. SUBMITTED -> APPROVED -> PARTIAL -> ISSUED -> RECEIVED.
CREATE TABLE IF NOT EXISTS inv_requisitions (
    id VARCHAR(64) PRIMARY KEY,
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    req_no VARCHAR(30) NOT NULL,
    destination VARCHAR(200) NOT NULL,
    purpose VARCHAR(500) NOT NULL DEFAULT '',
    expense_category VARCHAR(60) NOT NULL DEFAULT '',
    needed_by DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIAL', 'ISSUED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
    store_id VARCHAR(64) REFERENCES inv_stores(id) DEFERRABLE INITIALLY DEFERRED,
    requester_id VARCHAR(64) NOT NULL DEFAULT '',
    requested_by VARCHAR(255) NOT NULL DEFAULT '',
    decided_by VARCHAR(255) NOT NULL DEFAULT '',
    decided_at TIMESTAMP WITH TIME ZONE,
    decision_note VARCHAR(500) NOT NULL DEFAULT '',
    received_by VARCHAR(255) NOT NULL DEFAULT '',
    received_at TIMESTAMP WITH TIME ZONE,
    receive_note VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inv_requisitions_by_status ON inv_requisitions (institution_id, status);
CREATE INDEX IF NOT EXISTS inv_requisitions_by_requester ON inv_requisitions (institution_id, requester_id);

CREATE TABLE IF NOT EXISTS inv_requisition_lines (
    requisition_id VARCHAR(64) NOT NULL REFERENCES inv_requisitions(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED,
    requested NUMERIC(14,3) NOT NULL CHECK (requested > 0),
    approved NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (approved >= 0 AND approved <= requested),
    issued NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (issued >= 0 AND issued <= approved),
    PRIMARY KEY (requisition_id, item_id)
);
ALTER TABLE inv_movements ADD COLUMN IF NOT EXISTS requisition_id VARCHAR(64) REFERENCES inv_requisitions(id) DEFERRABLE INITIALLY DEFERRED;

-- Assets can sit in a hostel room, and remember the stock item they were taken from.
ALTER TABLE inv_assets ADD COLUMN IF NOT EXISTS room_id VARCHAR(64) REFERENCES hostel_rooms(id) ON DELETE SET NULL;
ALTER TABLE inv_assets ADD COLUMN IF NOT EXISTS item_id VARCHAR(64) REFERENCES inv_items(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS inv_assets_by_room ON inv_assets (room_id) WHERE room_id IS NOT NULL;

-- How many meals a kitchen served, when it is counted by hand. Without a count, the hostel
-- meal bookings of that day are used, so cost per meal works either way.
CREATE TABLE IF NOT EXISTS inv_meal_counts (
    institution_id VARCHAR(64) NOT NULL REFERENCES erp_tenants(id) ON DELETE CASCADE,
    store_id VARCHAR(64) NOT NULL REFERENCES inv_stores(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    meal VARCHAR(12) NOT NULL,
    served INTEGER NOT NULL CHECK (served >= 0),
    updated_by VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, day, meal)
);
