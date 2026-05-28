# Reviewer Learning Loop

**Status:** Implemented (Phase 1, Feb 2026)

This feature captures human reviewer corrections and feeds stable correction patterns back into the Basic AI Check through human-reviewed correction rules.

## What Is Automated

1. ClickUp webhook receives the reviewer handoff status change (`To Do` by default) after the corrected DOCX is attached.
2. `clickup-integration` calls `differ` (`POST /compare`) with:
   - AI draft path
   - Reviewer final DOCX path
   - `comparison_source: "human_review_final_approval"` and `changed_by_human: true`
3. `differ` extracts replacement signals (`from -> to`) from AI-vs-final text deltas.
4. `differ` aggregates historical signals into `tmp/learning/learned_rules.json` with:
   - occurrences
   - submission count
   - dominance/conflict scoring
   - confidence
5. Dashboard surfaces system-proposed rules for human review. Accepted correction rules are available to the Basic AI Check deterministic pre-AI pass before `ai-review` is called; they are no longer appended as an automatic prompt overlay.

The differ skips learning for quick approvals, imports/backfills, AI-only changes, missing provenance flags, and final DOCX files that are identical to the AI draft. Eligible training entries are upserted by submission/source before aggregation so repeated finalization cannot inflate occurrences.

## New Differ Endpoints

- `GET /learning/rules`
  - Returns full learned-rules snapshot (active, weak, conflicted).
- `GET /learning/overlay`
  - Deprecated in v2. The endpoint returns an empty overlay; accepted rules now flow through the `correction_rules` table and deterministic pre-AI checks.
- `GET /learning/overrides`
  - Returns manual disable overrides for specific learned rules.
- `POST /learning/overrides`
  - Enables/disables a specific learned rule key (`source=>target`).
- `POST /learning/recompute-signals`
  - Recomputes replacement signals for existing `training_data.jsonl` entries from stored AI/final DOCX paths and rebuilds `learned_rules.json`.
  - Use this after extraction logic changes to clean stale/bad learned rules without deleting all history.

## Learning Admin Dashboard

- Route: `GET /learning` (dashboard service)
- Displays learned rules with confidence, status, and activity
- Displays pending `correction_rules` for accept/reject review and accepted rules that can feed deterministic pre-AI checks
- Shows compact active pre-AI rules first, including curated code guards promoted from accepted human explanations and accepted exact replacement rules.
- Hides the full AI prompt from the learning dashboard; prompt review remains on the prompt proposal page.
- Stale pending system proposals are ignored when the current differ snapshot no longer has matching eligible human-review evidence, so old system-only patterns such as rejected/pluralization experiments do not look actionable.
- Shows recent training ingestions (submission id, timestamp, changes, change %) for auditability
- Shows a connectivity warning when dashboard cannot reach differ endpoints
- Each submission row links to `GET /learning/submission/:submissionId` for manual correction review

## Manual Correction Review + Location Rules

### Submission detail page

- Route: `GET /learning/submission/:submissionId`
- Displays all detected corrections for the selected submission
- Each correction shows:
  - full original line
  - full corrected line
  - token-level delta summary

### Reviewer annotation capture

- Reviewer can save, per correction:
  - reasoning/explanation for the change
  - restaurant name
  - global scope, or a primary location when the rule is marked location-specific
  - additional configured locations that should share the same location-specific rule
- Data is saved as reviewer correction-rule annotations. Accepted exact spelling, diacritic, terminology, grammar, and punctuation rules can be applied by the Basic AI Check deterministic pre-AI pass when the rule scope matches the submitted property.
- The learning submission page stores correction context in page-level script data and has `Save Rule` buttons reference corrections by index, so quoted dish text cannot break the button markup.

### APIs

- `GET /learning/submissions` (differ): latest learned entry per submission
- `GET /learning/submissions/:submissionId` (differ): line-level correction detail
- `GET /learning/location-rules` (differ): saved location-specific rules (optionally filtered by `submission_id`)
- `POST /learning/location-rules` (differ): save reviewer annotation for a correction

## Guardrails

- Conservative filtering removes noisy signals:
  - stopword tokens (e.g. `of`, `or`, `the`, `may`)
  - allergen-code tokens (e.g. `D`, `G`, `VG`)
  - numeric-heavy tokens
  - very short tokens
  - very long tokens
  - low-signal mismatches
- Replacement extraction uses line-diff alignment first (instead of raw same-line-index comparison) to reduce false mappings when line numbers shift.
- Rules must meet minimum occurrences (`LEARNING_MIN_OCCURRENCES`, default `2`).
- Low-dominance mappings are marked `conflicted` and are not proposed as accepted deterministic rules.
- Dashboard fails open: if accepted correction rules cannot be loaded from the DB service, Basic AI Check still runs deterministic built-in checks and AI review without learned-rule replacements.
- Deletion-only edits may be counted as document changes but may not generate replacement rules (`from -> to`) on their own.

## Startup Behavior

- On `differ` startup, learned-rules snapshot is rebuilt from `tmp/learning/training_data.jsonl`.
- This keeps `/learning/rules` counters consistent after service restarts without waiting for a new compare event.

## Environment Knobs

- `LEARNING_MIN_OCCURRENCES` (default `2`)
- `BASIC_AI_PRECHECK_DISABLED=true` disables the Basic AI Check deterministic pre-AI pass for A/B testing.
- `BASIC_AI_LEARNED_PRECHECK_DISABLED=true` keeps built-in deterministic checks enabled but disables accepted correction-rule replacements.
- `BASIC_AI_LEARNED_RULE_FETCH_TIMEOUT_MS` controls how long the dashboard waits for accepted correction rules before failing open.
- `npm run preai:ab-replay` runs an offline paired-DOCX replay of deterministic pre-AI checks against the curated `Training Menus` human/redlined targets and writes a report under `tmp/pre-ai-ab-replay/`. Use `-- --source all` to include broader sample pairs.

## Not Yet Implemented (Future Phases)

- Automatic direct edits to `qa_prompt.txt`
- Semantic correction extraction beyond token replacements
