-- Menu Manager Database Schema
-- For Supabase PostgreSQL (free tier)
--
-- Copy and paste this into Supabase SQL Editor to create tables

-- Enable UUID extension (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. SUBMISSIONS
-- Stores all menu submissions (migrating from submissions.json)
-- ============================================================================
CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id VARCHAR(100),                          -- For migrating existing submissions

    -- Form fields
    project_name VARCHAR(255) NOT NULL,
    property VARCHAR(255) NOT NULL,
    width VARCHAR(50),
    height VARCHAR(50),
    crop_marks BOOLEAN DEFAULT false,
    bleed_marks BOOLEAN DEFAULT false,
    file_size_limit BOOLEAN DEFAULT false,
    file_size_limit_mb VARCHAR(20),
    file_delivery_notes TEXT,
    orientation VARCHAR(50),
    menu_type VARCHAR(50) DEFAULT 'standard',        -- 'standard' or 'prix_fixe'
    service_period VARCHAR(100) DEFAULT 'other',     -- Canonical or property-specific service/folder label used for routing
    template_type VARCHAR(50) DEFAULT 'food',        -- 'food', 'beverage', 'food_beverage', or 'non_beverage'
    date_needed DATE,

    -- Submitter info
    submitter_email VARCHAR(255) NOT NULL,
    submitter_name VARCHAR(255),
    submitter_job_title VARCHAR(255),

    -- Additional project details
    hotel_name VARCHAR(255),
    city_country VARCHAR(255),
    asset_type VARCHAR(50),  -- 'PRINT' or 'DIGITAL'

    -- Menu content (plain text for AI review)
    menu_content TEXT,
    menu_content_html TEXT,
    approvals TEXT,                                 -- JSON string from form
    critical_overrides TEXT,                        -- JSON string from form

    -- File paths
    filename VARCHAR(255),
    original_path TEXT,
    ai_draft_path TEXT,
    final_path TEXT,
    clickup_task_id VARCHAR(100),

    -- Revision / modification metadata
    submission_mode VARCHAR(50) DEFAULT 'new',      -- 'new' or 'modification'
    revision_source VARCHAR(100),                   -- 'database' or 'uploaded_baseline'
    revision_base_submission_id VARCHAR(100),
    menu_id UUID,                                   -- Menu entity this submission is a version of (Phase 1)
    revision_baseline_doc_path TEXT,
    revision_baseline_file_name VARCHAR(255),
    base_approved_menu_content TEXT,
    chef_persistent_diff TEXT,                      -- JSON summary blob

    -- Canonical approved text captured from Isabella upload
    approved_menu_content_raw TEXT,
    approved_menu_content TEXT,
    approved_menu_content_html TEXT,                -- Clean, post-approval HTML for click-to-edit
    approved_text_extracted_at TIMESTAMPTZ,

    -- Approver dispute link (Identity Stage 2): per-submission negative-confirmation token
    approver_dispute_token VARCHAR(64),
    approver_disputed_at TIMESTAMPTZ,
    approver_dispute_note VARCHAR(500),

    -- Full payload mirror for future-proofing and audits
    raw_payload JSONB,

    -- Form attempt that produced this submission; joins to basic_ai_check_audits.attempt_id
    form_attempt_id VARCHAR(100),

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'processing',
    -- Possible statuses:
    -- 'processing' - Initial state, being validated
    -- 'pending_ai_review' - Waiting for AI review
    -- 'pending_human_review' - AI done, waiting for human
    -- 'submitted_no_ai_review' - Manual-review fallback after AI is skipped/unavailable
    -- 'sent_to_marketing' - Direct handoff sent beyond Isabella review
    -- 'needs_correction' - Design approval mismatch needs correction
    -- 'approved' - Fully approved
    -- 'approved_override' - Approved with documented mismatch override
    -- 'rejected' - Rejected by reviewer
    -- 'deleted' - Operationally removed from active queues after the linked ClickUp task was deleted

    -- Flags
    changes_made BOOLEAN DEFAULT false,              -- Did human make changes to AI draft?
    source VARCHAR(50) DEFAULT 'form',               -- 'form' (only option now)

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

-- Index for faster status queries
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_created_at ON submissions(created_at DESC);
CREATE INDEX idx_submissions_clickup_task_id ON submissions(clickup_task_id);
CREATE INDEX IF NOT EXISTS idx_submissions_form_attempt ON submissions(form_attempt_id);
CREATE INDEX IF NOT EXISTS idx_submissions_menu ON submissions(menu_id);
CREATE INDEX IF NOT EXISTS idx_submissions_approver_dispute_token ON submissions(approver_dispute_token);

-- ============================================================================
-- 1a. MENUS (Phase 1 — menu-as-an-entity)
-- A menu evolves over time; each approved submission is a version of one menu.
-- current_submission_id points at the live version. No FK on current_submission_id
-- / submissions.menu_id in v1 (historical rows + JSON fallback); validated in code.
-- ============================================================================
CREATE TABLE IF NOT EXISTS menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property VARCHAR(200) NOT NULL,
    service_period VARCHAR(120) NOT NULL,
    name VARCHAR(200) NOT NULL,            -- e.g. "Lunch", "Brunch Bebidas"
    current_submission_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'active',  -- active | retired
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menus_property_service ON menus(property, service_period);
CREATE INDEX IF NOT EXISTS idx_menus_status ON menus(status);

-- ============================================================================
-- 1b. SUBMITTER PROFILES (autocomplete cache)
-- ============================================================================
CREATE TABLE submitter_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    job_title VARCHAR(255),
    last_used TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_submitter_profiles_name ON submitter_profiles(name);
CREATE INDEX idx_submitter_profiles_last_used ON submitter_profiles(last_used DESC);

-- ============================================================================
-- 1c. PROPERTIES (canonical selectable list for submissions + learning)
-- ============================================================================
CREATE TABLE IF NOT EXISTS properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    city_country VARCHAR(255),
    hotel VARCHAR(255),
    sharepoint_site_url TEXT,
    sharepoint_library_name VARCHAR(255),
    sharepoint_drive_id VARCHAR(255),
    sharepoint_base_folder_path TEXT,
    sharepoint_service_folders TEXT[] DEFAULT '{}',
    sharepoint_last_synced_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_active_name ON properties(is_active, name);

INSERT INTO properties (name, city_country, hotel) VALUES
    ('89Agave - Sedona', 'Sedona', NULL),
    ('Agent''s Only - Pasadena', 'Pasadena', NULL),
    ('Anchor & Brine - Marriott Tampa Water Street - Tampa', 'Tampa', 'Marriott Tampa Water Street'),
    ('Aqimero - Ritz-Carlton - Philadelphia', 'Philadelphia', 'Ritz-Carlton'),
    ('Bayou & Bottle - Four Seasons - Houston', 'Houston', 'Four Seasons'),
    ('Beacon - Tampa', 'Tampa', NULL),
    ('Casa Chi - InterContinental - Chicago', 'Chicago', 'InterContinental'),
    ('Cayao - Four Seasons Cabo Del Sol - Los Cabos', 'Los Cabos', 'Four Seasons Cabo Del Sol'),
    ('Ciclo - Four Seasons - Austin', 'Austin', 'Four Seasons'),
    ('Coraluz - Four Seasons Cabo Del Sol - Los Cabos', 'Los Cabos', 'Four Seasons Cabo Del Sol'),
    ('D''Taco Joint - Newark', 'Newark', NULL),
    ('dLeña - Houston', 'Houston', NULL),
    ('dLeña - Washington, D.C.', 'Washington, D.C.', NULL),
    ('Driftwood - Tampa', 'Tampa', NULL),
    ('DRINK Bar (Fareground) - Austin', 'Austin', NULL),
    ('Ellis Bar (Fareground) - Austin', 'Austin', NULL),
    ('Fareground - Austin', 'Austin', NULL),
    ('Ironwood - Fairmont Scottsdale Princess - Scottsdale', 'Scottsdale', 'Fairmont Scottsdale Princess'),
    ('La Hacienda - Fairmont Scottsdale Princess - Scottsdale', 'Scottsdale', 'Fairmont Scottsdale Princess'),
    ('Live Oak - Four Seasons - Austin', 'Austin', 'Four Seasons'),
    ('Lona - Westin - Fort Lauderdale', 'Fort Lauderdale', 'Westin'),
    ('Lona - Noelle - Nashville', 'Nashville', 'Noelle'),
    ('Lona - Marriott Tampa Water Street - Tampa', 'Tampa', 'Marriott Tampa Water Street'),
    ('Maya - Le Royal Meridien - Dubai', 'Dubai', 'Le Royal Meridien'),
    ('Maya - New York', 'New York', NULL),
    ('Raya - Ritz-Carlton Laguna Niguel - Laguna Niguel', 'Laguna Niguel', 'Ritz-Carlton Laguna Niguel'),
    ('Sidecut - Four Seasons - Whistler', 'Whistler', 'Four Seasons'),
    ('Sora - Four Seasons Cabo Del Sol - Los Cabos', 'Los Cabos', 'Four Seasons Cabo Del Sol'),
    ('Spa at JW - Tampa', 'Tampa', NULL),
    ('Stoke & Rye - Westin Riverfront - Avon', 'Avon', 'Westin Riverfront'),
    ('Taco Pegaso - Austin', 'Austin', NULL),
    ('Tamayo - Denver', 'Denver', NULL),
    ('tán - New York', 'New York', NULL),
    ('Toro - Belgrade', 'Belgrade', NULL),
    ('Toro - Dania Beach', 'Dania Beach', NULL),
    ('Toro - Fairmont Millennium Park - Chicago', 'Chicago', 'Fairmont Millennium Park'),
    ('Toro - Hotel Clio - Denver', 'Denver', 'Hotel Clio'),
    ('Toro - Six Senses Kocatas Mansions - Istanbul', 'Istanbul', 'Six Senses Kocatas Mansions'),
    ('Toro - Los Cabos', 'Los Cabos', NULL),
    ('Toro - Marrakech', 'Marrakech', NULL),
    ('Toro - St. Regis Kanai - Riviera Maya', 'Riviera Maya', 'St. Regis Kanai'),
    ('Toro - Fairmont Scottsdale Princess - Scottsdale', 'Scottsdale', 'Fairmont Scottsdale Princess'),
    ('Toro - Viceroy - Snowmass', 'Snowmass', 'Viceroy'),
    ('Toro Del Mar - Athens', 'Athens', NULL),
    ('Toro Toro - Grosvenor House - Dubai', 'Dubai', 'Grosvenor House'),
    ('Toro Toro - Worthington Renaissance - Fort Worth', 'Fort Worth', 'Worthington Renaissance'),
    ('Toro Toro - Four Seasons - Houston', 'Houston', 'Four Seasons'),
    ('Toro Toro - Malta', 'Malta', NULL),
    ('Toro Toro - InterContinental - Miami', 'Miami', 'InterContinental'),
    ('Venga Venga - Snowmass', 'Snowmass', NULL),
    ('Zengo - Kempinski - Doha', 'Doha', 'Kempinski'),
    ('Zengo - Le Royal Meridien - Dubai', 'Dubai', 'Le Royal Meridien')
ON CONFLICT (name) DO NOTHING;

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Tamayo',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Tamayo/Brand & Marketing/Media Library/Menu Files',
    sharepoint_service_folders = ARRAY[
        'Afternoon Brunch',
        'Beverage',
        'Brunch',
        'Dessert',
        'Dinner',
        'Happy Hour',
        'Holidays & Events',
        'Kids',
        'Lunch',
        'Menu Box'
    ]
WHERE name = 'Tamayo - Denver';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Denver/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Breakfast',
        'Brunch',
        'Dessert',
        'Dinner',
        'Happy Hour',
        'Holidays & Events',
        'Lunch'
    ]
WHERE name = 'Toro - Hotel Clio - Denver';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Bloody Bar',
        'Breakfast',
        'Brunch',
        'Dessert',
        'Dinner',
        'Happy Hour',
        'Holidays & Events',
        'Lunch'
    ]
WHERE name = 'Toro - Fairmont Millennium Park - Chicago';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Dania Beach/Menus',
    sharepoint_service_folders = ARRAY[
        'Dinner',
        'Happy Hour',
        'Holidays & Events'
    ]
WHERE name = 'Toro - Dania Beach';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Snowmass/Menus',
    sharepoint_service_folders = ARRAY[
        'Large party_Pre-Fixe menu',
        'Winter Breakfast menu',
        'Winter Dessert Menu',
        'Winter Dinner Menu',
        'Winter Kids Breakfast menu',
        'Winter Kids Dinner Menu',
        'Winter Wine List'
    ]
WHERE name = 'Toro - Viceroy - Snowmass';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/ToroToro',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro Toro by Chef Richard Sandoval/Marketing - Locations/Fort Worth/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Brunch',
        'Dinner',
        'Holidays & Events',
        'Lounge Bar',
        'Lunch'
    ]
WHERE name = 'Toro Toro - Worthington Renaissance - Fort Worth';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/ToroToro',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro Toro by Chef Richard Sandoval/Marketing - Locations/Miami/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Dessert',
        'Dinner',
        'Lunch'
    ]
WHERE name = 'Toro Toro - InterContinental - Miami';

-- ============================================================================
-- 2. APPROVED_DISHES
-- Running list of all approved dishes extracted from approved menus
-- ============================================================================
CREATE TABLE approved_dishes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Dish info
    dish_name VARCHAR(500) NOT NULL,
    dish_name_normalized VARCHAR(500) NOT NULL,      -- Lowercase, trimmed for deduplication
    property VARCHAR(255),                           -- Which property/restaurant
    service_period VARCHAR(100),                     -- service/folder label for the approved menu source
    menu_category VARCHAR(255),                      -- e.g., "Appetizers", "Entrees", "Desserts"
    description TEXT,
    price VARCHAR(50),                               -- Keep as string to handle various formats

    -- Allergens (array of codes like 'GF', 'V', 'VG', etc.)
    allergens VARCHAR(10)[],

    -- Source tracking
    source_submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,

    -- Status
    is_active BOOLEAN DEFAULT true,                  -- For soft delete

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching dishes
CREATE INDEX idx_approved_dishes_name ON approved_dishes(dish_name_normalized);
CREATE INDEX idx_approved_dishes_property ON approved_dishes(property);
CREATE INDEX idx_approved_dishes_active ON approved_dishes(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. USERS
-- For reviewers and admins (structure for later, when Clerk auth is added)
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Auth (will link to Clerk user ID later)
    clerk_user_id VARCHAR(255) UNIQUE,

    -- Profile
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),

    -- Role: 'chef', 'reviewer', 'admin'
    role VARCHAR(50) DEFAULT 'chef',

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================================
-- 4. APPROVAL_WORKFLOW
-- Multi-level approval chain for submissions
-- ============================================================================
CREATE TABLE approval_workflow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to submission
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,

    -- Workflow step
    step_order INTEGER NOT NULL,                     -- 1, 2, 3, etc.

    -- Reviewer assignment
    reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Status: 'pending', 'in_review', 'approved', 'rejected', 'skipped'
    status VARCHAR(50) DEFAULT 'pending',

    -- Notes from reviewer
    notes TEXT,

    -- Timestamps
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_approval_workflow_submission ON approval_workflow(submission_id);
CREATE INDEX idx_approval_workflow_reviewer ON approval_workflow(reviewer_id);
CREATE INDEX idx_approval_workflow_status ON approval_workflow(status);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for submissions
CREATE TRIGGER update_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for users
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. ASSETS
-- Document / file metadata for storage abstraction and document pairing
-- ============================================================================
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id VARCHAR(100) NOT NULL,
    revision_submission_id VARCHAR(100),
    asset_type VARCHAR(50) NOT NULL,              -- 'original_docx', 'approved_docx', 'ai_draft_docx', etc.
    source VARCHAR(100),
    storage_provider VARCHAR(50) DEFAULT 'local',
    storage_path TEXT NOT NULL,
    file_name VARCHAR(255),
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_submission ON assets(submission_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

-- ============================================================================
-- 6b. DOCUMENT_PAIRS VIEW
-- Easy lookup of original → approved DOCX pairs for learning pipeline
-- ============================================================================
CREATE OR REPLACE VIEW document_pairs AS
SELECT
    o.submission_id,
    o.storage_path AS original_path,
    o.file_name AS original_filename,
    a.storage_path AS approved_path,
    a.file_name AS approved_filename,
    o.created_at AS submitted_at,
    a.created_at AS approved_at
FROM assets o
JOIN assets a ON o.submission_id = a.submission_id
WHERE o.asset_type = 'original_docx'
  AND a.asset_type = 'approved_docx';

-- ============================================================================
-- 7. CORRECTION_RULES
-- Human-annotated and system-proposed correction rules for learning pipeline v2
-- ============================================================================
CREATE TABLE IF NOT EXISTS correction_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to submission where correction was observed
    submission_id VARCHAR(100) NOT NULL,
    correction_id VARCHAR(100) NOT NULL,

    -- The correction itself
    original_text TEXT,
    corrected_text TEXT,
    change_type VARCHAR(50),              -- 'diacritic', 'spelling', 'punctuation',
                                          -- 'capitalization', 'content', 'formatting'

    -- Human annotation
    rule TEXT NOT NULL,                    -- Actionable instruction / reasoning
    applies_to_menu_type VARCHAR(50) DEFAULT 'all' NOT NULL, -- 'all', 'food', or 'beverage'
    CONSTRAINT correction_rules_applies_to_menu_type_check
        CHECK (applies_to_menu_type IN ('all', 'food', 'beverage')),
    is_location_specific BOOLEAN DEFAULT false,

    -- Context
    project_name VARCHAR(255),
    restaurant_name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,        -- Primary property
    other_applicable_locations TEXT[],      -- Other locations this rule applies to
    reviewer_name VARCHAR(255),

    -- Review status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'accepted', 'rejected', 'modified'
    source VARCHAR(50) DEFAULT 'human',    -- 'human' or 'system'

    -- System-proposed rule metadata
    occurrences INTEGER DEFAULT 1,
    confidence NUMERIC(4,3),
    submission_ids TEXT[],

    -- Weekly prompt cycle tracking
    prompt_cycle_id VARCHAR(100),
    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_rules_submission ON correction_rules(submission_id);
CREATE INDEX IF NOT EXISTS idx_correction_rules_status ON correction_rules(status);
CREATE INDEX IF NOT EXISTS idx_correction_rules_location ON correction_rules(location);
CREATE INDEX IF NOT EXISTS idx_correction_rules_menu_scope ON correction_rules(applies_to_menu_type);
CREATE INDEX IF NOT EXISTS idx_correction_rules_unconsumed ON correction_rules(prompt_cycle_id)
    WHERE prompt_cycle_id IS NULL;

CREATE TRIGGER update_correction_rules_updated_at
    BEFORE UPDATE ON correction_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 8. PROMPT_PROPOSALS
-- Weekly prompt rewrite proposals for human review
-- ============================================================================
CREATE TABLE IF NOT EXISTS prompt_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    cycle_id VARCHAR(100) NOT NULL UNIQUE,  -- e.g., '2026-W12'
    current_prompt TEXT NOT NULL,
    proposed_prompt TEXT NOT NULL,
    prompt_diff TEXT,

    -- What fed into this proposal
    correction_rule_count INTEGER,
    submission_count INTEGER,
    date_range_start DATE,
    date_range_end DATE,

    -- LLM reasoning
    llm_analysis TEXT,
    llm_model VARCHAR(100),

    -- Human review
    status VARCHAR(50) DEFAULT 'pending',   -- 'pending', 'approved', 'approved_modified', 'rejected'
    reviewer_name VARCHAR(255),
    reviewer_notes TEXT,
    final_prompt TEXT,
    reviewed_at TIMESTAMPTZ,

    -- Improvement-cycle extensions (migration 20260612)
    proposed_rules JSONB,                   -- deterministic replacement-rule candidates
    code_recommendations JSONB,             -- human-implemented code suggestions
    eval_summary JSONB,                     -- baseline/candidate eval results + regressions
    eval_status VARCHAR(30),                -- 'passed' | 'regressed' | 'skipped' | 'failed'
    accepted_rules JSONB,                   -- reviewer-selected subset recorded at approval
    source VARCHAR(30) DEFAULT 'prompt_rewrite',  -- 'prompt_rewrite' | 'improvement_cycle'

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 9. SYSTEM_ALERTS
-- Logs critical system failures for monitoring and audit
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type VARCHAR(100) NOT NULL,          -- e.g., 'clickup_task_failed', 'supabase_mirror_failed'
    severity VARCHAR(20) DEFAULT 'error',      -- 'error', 'warning', 'critical'
    service VARCHAR(100) NOT NULL,             -- 'dashboard', 'clickup-integration', 'db', etc.
    submission_id VARCHAR(100),
    message TEXT NOT NULL,
    details JSONB,                             -- Stack trace, request payload, etc.
    notified BOOLEAN DEFAULT false,            -- Whether an email was sent
    acknowledged BOOLEAN DEFAULT false,        -- Whether a human has reviewed it
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_type ON system_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_system_alerts_created ON system_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_unacknowledged ON system_alerts(acknowledged)
    WHERE acknowledged = false;

-- ============================================================================
-- 10. DRAFT_SESSIONS
-- Shared approved-menu edit drafts, addressed only by unguessable token
-- ============================================================================
CREATE TABLE IF NOT EXISTS draft_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(120) UNIQUE NOT NULL,
    base_submission_id VARCHAR(100) NOT NULL,
    menu_content_html TEXT,
    form_state JSONB DEFAULT '{}'::jsonb,
    -- Valid states: active, submitted, expired, discarded.
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    submitted_submission_id VARCHAR(100),
    last_edited_by VARCHAR(160),
    menu_id UUID,                                   -- Menu entity this draft edits (populated Phase 3)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_draft_sessions_token ON draft_sessions(token);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_menu ON draft_sessions(menu_id);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_base_submission ON draft_sessions(base_submission_id);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_status_updated ON draft_sessions(status, updated_at DESC);
-- Single-active-draft invariant re-keyed to the menu entity (Phase 3): one
-- active draft per menu. Drafts whose baseline was never backfilled keep the
-- per-base guard below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_sessions_one_active_per_menu ON draft_sessions(menu_id) WHERE status = 'active' AND menu_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_sessions_one_active_per_base_nullmenu ON draft_sessions(base_submission_id) WHERE status = 'active' AND menu_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_revision_base ON submissions(revision_base_submission_id);

-- ============================================================================
-- 11. FORM_ATTEMPT_LOGS
-- Lightweight telemetry for multi-step public form submissions
-- ============================================================================
CREATE TABLE IF NOT EXISTS form_attempt_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(80) NOT NULL,           -- basic_check_started, submit_failed, payload_too_large, etc.
    route VARCHAR(160),
    status_code INTEGER,
    submitter_email VARCHAR(255),
    submitter_name VARCHAR(255),
    project_name VARCHAR(255),
    property VARCHAR(255),
    service_period VARCHAR(100),
    template_type VARCHAR(100),
    submission_mode VARCHAR(50),
    revision_source VARCHAR(100),
    revision_baseline_file_name VARCHAR(255),
    menu_text_length INTEGER,
    menu_html_length INTEGER,
    persistent_diff_html_length INTEGER,
    base_menu_text_length INTEGER,
    corrected_menu_text_length INTEGER,
    request_body_length INTEGER,
    suggestions_count INTEGER,
    critical_suggestions_count INTEGER,
    critical_suggestions JSONB,
    error_message TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_attempt_logs_attempt ON form_attempt_logs(attempt_id);
CREATE INDEX IF NOT EXISTS idx_form_attempt_logs_created ON form_attempt_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_attempt_logs_submitter ON form_attempt_logs(submitter_email);
CREATE INDEX IF NOT EXISTS idx_form_attempt_logs_project ON form_attempt_logs(property, project_name);

ALTER TABLE form_attempt_logs
ADD COLUMN IF NOT EXISTS draft_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_form_attempt_logs_draft_session
ON form_attempt_logs(draft_session_id);

-- ============================================================================
-- 12. BASIC_AI_CHECK_AUDITS
-- Durable request/response audit trail for public-form Basic AI Check
-- ============================================================================
CREATE TABLE IF NOT EXISTS basic_ai_check_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id VARCHAR(100),
    check_id VARCHAR(100),
    event_type VARCHAR(80) NOT NULL,           -- completed, ai_unavailable, malformed_response, etc.
    route VARCHAR(160),
    status_code INTEGER,
    submitter_email VARCHAR(255),
    submitter_name VARCHAR(255),
    project_name VARCHAR(255),
    property VARCHAR(255),
    service_period VARCHAR(100),
    template_type VARCHAR(100),
    submission_mode VARCHAR(50),
    revision_source VARCHAR(100),
    revision_baseline_file_name VARCHAR(255),
    review_mode VARCHAR(64),
    changed_line_count INTEGER,
    menu_text_length INTEGER,
    pre_ai_text_length INTEGER,
    corrected_menu_text_length INTEGER,
    prompt_length INTEGER,
    response_text_length INTEGER,
    suggestions_count INTEGER,
    critical_suggestions_count INTEGER,
    ai_request JSONB,                          -- exact bounded request sent to ai-review /run-qa-check
    ai_response JSONB,                         -- raw bounded response/failure from ai-review
    parsed_response JSONB,                     -- parsed corrected-menu block and suggestions
    final_result JSONB,                        -- final corrected menu after dashboard guards
    guard_diagnostics JSONB,
    deterministic_diagnostics JSONB,
    error_message TEXT,
    menu_content_raw TEXT,                     -- raw client menu content BEFORE deterministic pre-AI checks
    baseline_menu_content_raw TEXT,            -- baseline content for changed_only revision reviews
    submission_id VARCHAR(100),                -- back-link set at submit time (best-effort)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_attempt ON basic_ai_check_audits(attempt_id);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_check ON basic_ai_check_audits(check_id);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_created ON basic_ai_check_audits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_project ON basic_ai_check_audits(property, project_name);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_event ON basic_ai_check_audits(event_type);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_submission ON basic_ai_check_audits(submission_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Enable later when auth is added
-- ============================================================================
-- ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE approved_dishes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE approval_workflow ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SAMPLE DATA (for testing - comment out in production)
-- ============================================================================
-- INSERT INTO users (email, name, role) VALUES
--     ('admin@example.com', 'Admin User', 'admin'),
--     ('reviewer@example.com', 'Reviewer User', 'reviewer');
