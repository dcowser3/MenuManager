CREATE TABLE IF NOT EXISTS draft_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(120) UNIQUE NOT NULL,
    base_submission_id VARCHAR(100) NOT NULL,
    menu_content_html TEXT,
    form_state JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    submitted_submission_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_draft_sessions_token ON draft_sessions(token);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_base_submission ON draft_sessions(base_submission_id);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_status_updated ON draft_sessions(status, updated_at DESC);

ALTER TABLE form_attempt_logs
ADD COLUMN IF NOT EXISTS draft_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_form_attempt_logs_draft_session
ON form_attempt_logs(draft_session_id);
