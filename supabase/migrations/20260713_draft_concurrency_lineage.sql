-- Keep historical rows for recovery. Valid states: active, submitted, expired, discarded.
ALTER TABLE draft_sessions
ADD COLUMN IF NOT EXISTS last_edited_by VARCHAR(160);

-- Phase 1 created duplicate active rows before the single-draft invariant.
-- This cleanup runs before index creation; the companion script handles JSON fallback.
WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY base_submission_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rank
    FROM draft_sessions
    WHERE status = 'active'
)
UPDATE draft_sessions
SET status = 'discarded', updated_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_sessions_one_active_per_base
ON draft_sessions(base_submission_id)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_submissions_revision_base
ON submissions(revision_base_submission_id);
