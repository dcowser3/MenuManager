-- C4b: verification ground truth for freeform manual correction rules.
-- A freeform rule (pure instruction, no before/after) has null original_text/corrected_text
-- and therefore cannot be replay-verified. Optional example columns let the human supply a
-- real instance of the mistake so the replay harness can confirm the rule actually applies,
-- and so the AI's C4a synthesis can prefer the human's exact strings over its own inference.
--
-- inferred_from_guidance marks a rule the improvement LLM synthesized from freeform guidance
-- (C4a) — the exact strings are the model's guess and should be verified before trusting them.
--
-- Code ships before this migration is applied; the correction_rules insert path degrades
-- gracefully when these columns are absent.
ALTER TABLE correction_rules
  ADD COLUMN IF NOT EXISTS example_original TEXT,
  ADD COLUMN IF NOT EXISTS example_corrected TEXT,
  ADD COLUMN IF NOT EXISTS inferred_from_guidance BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN correction_rules.example_original IS
  'C4b: an example of the text as it appeared (for verifying a freeform rule via replay).';
COMMENT ON COLUMN correction_rules.example_corrected IS
  'C4b: the corrected form of the example (replay ground truth for a freeform rule).';
COMMENT ON COLUMN correction_rules.inferred_from_guidance IS
  'C4a: true when the improvement LLM synthesized this deterministic rule from freeform guidance.';
