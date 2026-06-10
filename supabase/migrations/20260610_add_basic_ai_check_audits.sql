-- Durable Basic AI Check request/response audit trail.
-- This intentionally lives outside compact form_attempt_logs because it stores
-- full bounded request/response text for incident reconstruction.
CREATE TABLE IF NOT EXISTS basic_ai_check_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id VARCHAR(100),
    check_id VARCHAR(100),
    event_type VARCHAR(80) NOT NULL,
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
    ai_request JSONB,
    ai_response JSONB,
    parsed_response JSONB,
    final_result JSONB,
    guard_diagnostics JSONB,
    deterministic_diagnostics JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_attempt ON basic_ai_check_audits(attempt_id);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_check ON basic_ai_check_audits(check_id);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_created ON basic_ai_check_audits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_project ON basic_ai_check_audits(property, project_name);
CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_event ON basic_ai_check_audits(event_type);
