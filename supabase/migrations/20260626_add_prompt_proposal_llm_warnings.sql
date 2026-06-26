-- Persist validator notes from the automated improvement-cycle LLM output.
-- These explain why a correction mentioned in analysis may not appear as a
-- proposed deterministic replacement rule.

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS llm_warnings JSONB;
