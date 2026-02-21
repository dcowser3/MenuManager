# Reviewer Learning Loop

**Status:** Implemented (Phase 1, Feb 2026)

This feature captures human reviewer corrections and feeds stable correction patterns back into the AI QA prompt automatically.

## What Is Automated

1. ClickUp webhook receives reviewer-approved corrected DOCX.
2. `clickup-integration` calls `differ` (`POST /compare`) with:
   - AI draft path
   - Reviewer final DOCX path
3. `differ` extracts replacement signals (`from -> to`) from AI-vs-final text deltas.
4. `differ` aggregates historical signals into `tmp/learning/learned_rules.json` with:
   - occurrences
   - submission count
   - dominance/conflict scoring
   - confidence
5. Dashboard basic check fetches `GET /learning/overlay` from `differ` and appends learned rules to the QA prompt before calling `ai-review`.

## New Differ Endpoints

- `GET /learning/rules`
  - Returns full learned-rules snapshot (active, weak, conflicted).
- `GET /learning/overlay`
  - Returns a prompt-ready snippet built from active rules only.
- `GET /learning/overrides`
  - Returns manual disable overrides for specific learned rules.
- `POST /learning/overrides`
  - Enables/disables a specific learned rule key (`source=>target`).

## Learning Admin Dashboard

- Route: `GET /learning` (dashboard service)
- Displays learned rules with confidence, status, and activity
- Allows manual enable/disable controls
- Disable actions are persisted as differ overrides and excluded from prompt overlay

## Guardrails

- Conservative filtering removes noisy signals:
  - numeric-heavy tokens
  - very long tokens
  - low-signal mismatches
- Rules must meet minimum occurrences (`LEARNING_MIN_OCCURRENCES`, default `2`).
- Low-dominance mappings are marked `conflicted` and excluded from prompt overlay.
- Dashboard fails open: if `differ` is unavailable, AI check still runs without overlay.

## Environment Knobs

- `LEARNING_MIN_OCCURRENCES` (default `2`)
- `LEARNING_MAX_OVERLAY_RULES` (default `25`)

## Not Yet Implemented (Future Phases)

- Automatic direct edits to `qa_prompt.txt`
- Human approval workflow for promoting weak/conflicted rules
- Supabase persistence for learning artifacts (currently local under `tmp/learning`)
- Semantic correction extraction beyond token replacements
