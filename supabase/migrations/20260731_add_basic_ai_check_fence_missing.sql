-- Visible audit flag for AI responses that omitted the corrected-menu fence.
ALTER TABLE basic_ai_check_audits
    ADD COLUMN IF NOT EXISTS fence_missing BOOLEAN;
