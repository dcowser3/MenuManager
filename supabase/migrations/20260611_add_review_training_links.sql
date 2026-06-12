-- Review-training data capture: store the raw pre-deterministic menu content on
-- Basic AI Check audits and link audits to the submission they became, so every
-- approved submission yields a full training triple:
-- raw input -> AI review output -> human-approved final (+ reviewer explanations).

-- Raw client-submitted menu content BEFORE deterministic pre-AI checks ran.
-- ai_request.text already stores the post-deterministic body; eval replay needs the true input.
ALTER TABLE basic_ai_check_audits ADD COLUMN IF NOT EXISTS menu_content_raw TEXT;

-- Baseline content for changed_only revision reviews (NULL for full reviews).
ALTER TABLE basic_ai_check_audits ADD COLUMN IF NOT EXISTS baseline_menu_content_raw TEXT;

-- Back-link set at submit time (best-effort denormalized convenience; the
-- authoritative join is submissions.form_attempt_id -> basic_ai_check_audits.attempt_id).
ALTER TABLE basic_ai_check_audits ADD COLUMN IF NOT EXISTS submission_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_basic_ai_check_audits_submission ON basic_ai_check_audits(submission_id);

-- Forward link: which form attempt (and therefore which audit rows) produced this submission.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS form_attempt_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_submissions_form_attempt ON submissions(form_attempt_id);
