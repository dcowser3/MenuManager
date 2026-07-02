-- Fix 8 / B7: track prompt length on proposals for bloat monitoring and consolidation trend.
-- Degrade-gracefully insert is used in the cycle (strip the column if the migration is pending).

ALTER TABLE prompt_proposals
  ADD COLUMN IF NOT EXISTS prompt_length INTEGER;

COMMENT ON COLUMN prompt_proposals.prompt_length IS
  'Length in characters of the effective (approved or proposed) prompt at proposal time; used for bloat trend and IMPROVE_PROMPT_BUDGET_CHARS warnings.';