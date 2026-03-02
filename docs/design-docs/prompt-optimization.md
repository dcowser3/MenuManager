# Weekly Prompt Optimization

**Status:** Implemented (Mar 2026)

This workflow compiles corrected-menu history into a weekly prompt-improvement proposal.
It does **not** auto-update the live QA prompt.

## Command

Run from repo root:

`npm run prompt:optimize`

## What It Uses

- Historical corrected pairs from `tmp/learning/training_data.jsonl`
  - latest entry per `submission_id`
- Cleaned menu text extracted from:
  - `ai_draft_path`
  - `final_path`
- Current base prompt from:
  - `sop-processor/qa_prompt.txt`
- Reviewer location-specific annotations from:
  - `tmp/learning/location_specific_rules.json`

## What It Produces

The command writes a timestamped output folder:

`tmp/prompt-optimizer/<timestamp>/`

Files:

- `report.json` — machine-readable metrics + selected rules
- `report.md` — human-readable weekly summary
- `prompt_addendum.txt` — candidate additive guidance block
- `candidate_prompt.txt` — base prompt + addendum

## Optimization Approach

- Builds a candidate replacement-rule pool from observed corrections.
- Uses deterministic train/holdout split by `submission_id`.
- Greedily selects rules that improve replay score on train set.
- Reports:
  - exact match rate
  - average similarity
  - train/holdout/full-dataset metrics

## Intended Usage

1. Run weekly.
2. Review `report.md` and `candidate_prompt.txt`.
3. Manually decide what to merge into `qa_prompt.txt`.
4. Keep location-specific differences explicit using reviewer reasoning.

## Guardrails

- This optimizes against historical corrected menus and can overfit.
- Holdout metrics are required before accepting changes.
- Prompt updates remain manual by design.
