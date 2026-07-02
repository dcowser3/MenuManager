-- F1 / B2: coverage_claims JSONB on prompt_proposals (code shipped before migration existed).
ALTER TABLE prompt_proposals
  ADD COLUMN IF NOT EXISTS coverage_claims JSONB;

COMMENT ON COLUMN prompt_proposals.coverage_claims IS
  'Validated LLM citations of existing prompt coverage (B2); replay evidence outranks claims.';
