# Automated Review-Improvement Loop

> Status: In progress (Phase A implemented, Jun 2026)
> Builds on: [Learning Pipeline v2](learning-pipeline-v2.md), [Reviewer Learning Loop](reviewer-learning-loop.md)

Automates the manual "collect ~10 reviewer corrections, ask an AI how to improve the review process" workflow into a daily, gated cycle: detect new annotated corrections → LLM proposes improvements with full knowledge of the current prompt and code rules → eval harness proves the proposal against historical menus (human-approved finals = ground truth) → human approves on the existing prompt-proposal page. Proposals are never auto-applied.

## Phases

| Phase | Deliverable | Status |
|-------|------------|--------|
| A | Raw pre-review input capture + submission↔audit linkage | Implemented |
| C1 | Replayable review pipeline (`qa-prompt-builder`, `review-pipeline` libs) | Planned |
| C2 | Eval harness (`npm run review:eval`) | Planned |
| B | Generated code-rules manifest (`npm run rules:manifest`) | Planned |
| D | Improvement cycle (`npm run improve:cycle`) + proposal page extension | Planned |
| E | Daily Lightsail cron + runbook | Planned |

## Phase A — Training-triple data capture (Implemented)

Every approved submission should yield a full training triple: **raw input → AI review output → human-approved final (+ reviewer explanations)**. Before Phase A, the raw pre-review menu content (what the chef sent to the Basic AI Check, *before* client-side corrections were applied on the form) existed only in `ai_request.text` audit JSON (post-deterministic) and transient logs, and audits could not be joined to the submission they became.

Migration `supabase/migrations/20260611_add_review_training_links.sql`:

- `basic_ai_check_audits.menu_content_raw` — raw client menu content BEFORE deterministic pre-AI checks (the true replay input; `ai_request.text` remains the post-deterministic body).
- `basic_ai_check_audits.baseline_menu_content_raw` — baseline for `changed_only` revision reviews.
- `basic_ai_check_audits.submission_id` — best-effort back-link set at submit time.
- `submissions.form_attempt_id` — authoritative forward link; joins to `basic_ai_check_audits.attempt_id`.

Code paths:

- `services/dashboard/index.ts` `buildBasicCheckAuditEvent` includes `menuContentRaw` on every audit event type (`completed`, `ai_unavailable`, `malformed_response`).
- `services/dashboard/lib/submission-workflow.ts` `submitMenu()` reads `x-menumanager-attempt-id` (the form already sends it on submit), stores `form_attempt_id` on the submission record, and fire-and-forgets `linkBasicAiCheckAuditsToSubmission()` (`services/dashboard/lib/basic-ai-check-audit.ts`), which stamps `submission_id` onto the attempt's unlinked audit rows.
- `services/db/index.ts` whitelists `form_attempt_id` in `SUPABASE_SUBMISSION_COLUMNS` (the JSON fallback stores it implicitly via payload spread).

Backfill for pre-migration rows: `npm run backfill:audit-links` (dry-run by default, `--apply` to write) fuzzy-joins on submitter email + project name (+ property) within a time window (default 6h, `--window N`), preferring the latest `completed` audit and skipping ambiguous ties.

**Required manual step (verified Jun 12, 2026):** production Supabase is missing the `basic_ai_check_audits` table entirely — the `20260610_add_basic_ai_check_audits.sql` migration was never applied, so audit capture has been silently failing since it shipped. Apply BOTH migrations in the Supabase SQL editor, in order:

1. `supabase/migrations/20260610_add_basic_ai_check_audits.sql`
2. `supabase/migrations/20260611_add_review_training_links.sql`

Until then the dashboard degrades safely (verified live): audit inserts and submission links log-and-skip without affecting the form, and `logBasicAiCheckAudit` retries without the new columns if only the 20260611 migration is missing.

### Why both link directions

`submissions.form_attempt_id` is authoritative (rides the normal submission payload; survives the db-service JSON fallback). `basic_ai_check_audits.submission_id` is a denormalized convenience so eval-dataset queries on the audits table need no join; it is best-effort (Supabase-only, fire-and-forget).

## Eval dataset contract (consumed by Phase C2)

A production eval case is assembled as:

- `raw_input`: `basic_ai_check_audits.menu_content_raw` for the submission's `form_attempt_id` (latest `completed` audit). Pre-Phase-A rows fall back to `ai_request.text` and are marked `degraded`.
- `ground_truth`: `submissions.approved_menu_content` (human-approved final text).
- `context`: property, template type, menu type, service period, allergens — needed to rebuild the exact prompt and rule scoping.
- Reviewer explanations come from `correction_rules` rows for the submission.
