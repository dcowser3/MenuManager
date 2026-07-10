-- C2 + C3: honest, structured proposal outcomes.
--   disposition        — code-computed summary of what the proposal actually concluded
--                        (prompt_change | rules_only | code_recs_only | rules_and_prompt |
--                         no_change_model_declined | no_change_guard_discarded).
--   correction_routing — per-correction routing table (lane/target/note per source correction)
--                        so the reviewer sees an outcome for every input, not just the ones the
--                        model chose to mention.
-- Code ships before this migration is applied (degrade-gracefully insert in
-- scripts/improvement-cycle.js strips these columns if absent), so it is safe to apply late.
ALTER TABLE prompt_proposals
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS correction_routing JSONB;

COMMENT ON COLUMN prompt_proposals.disposition IS
  'C2: code-computed proposal outcome; never LLM-supplied. Drives the plain-language headline.';
COMMENT ON COLUMN prompt_proposals.correction_routing IS
  'C3: per-correction routing table (correction_id, lane, target, note); completeness-enforced.';
