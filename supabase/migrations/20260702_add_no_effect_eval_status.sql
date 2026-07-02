-- B1 / Fix 4 remainder: admit 'no_effect' as a valid eval_status.
-- The column was introduced as VARCHAR(30) without a CHECK/enum in the prior
-- migration (20260612). This migration adds (or widens) a CHECK constraint
-- so that the allowed set is explicit and includes the new verdict.
--
-- Safe to apply even if no prior constraint existed: the DO block is a no-op
-- when the desired constraint is already present.
--
-- Allowed values after this: 'passed' | 'regressed' | 'skipped' | 'failed' | 'no_effect'

DO $$
BEGIN
  -- If a constraint with this name already exists, leave it (widening would require drop+recreate).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_proposals_eval_status_check'
      AND conrelid = 'prompt_proposals'::regclass
  ) THEN
    ALTER TABLE prompt_proposals
      ADD CONSTRAINT prompt_proposals_eval_status_check
      CHECK (eval_status IS NULL OR eval_status IN ('passed','regressed','skipped','failed','no_effect'));
  END IF;
END
$$;

-- Optional: ensure column comment reflects current set
COMMENT ON COLUMN prompt_proposals.eval_status IS
  'Eval verdict from improvement cycle: passed (triggers improved, no regressions), regressed, skipped, failed, no_effect (no regressions and no trigger improvement).';