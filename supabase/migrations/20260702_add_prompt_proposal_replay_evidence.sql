-- Fix 2 (P0 improvement-loop): persist pre-analysis replay evidence and the
-- unresolved_still_missed flag so the proposal page can surface hard warnings
-- when a no-op proposal leaves still_missed corrections unaddressed.
--
-- The improvement cycle and dashboard INSERT/UPDATE paths degrade gracefully
-- (they retry without the columns and log a migration hint).

ALTER TABLE prompt_proposals
  ADD COLUMN IF NOT EXISTS replay_evidence JSONB,
  ADD COLUMN IF NOT EXISTS unresolved_still_missed BOOLEAN DEFAULT false;

-- Optional helpful index if querying by cycle for rejected proposals becomes hot:
-- CREATE INDEX IF NOT EXISTS prompt_proposals_rejected_cycle ON prompt_proposals (status, cycle_id) WHERE status = 'rejected';
