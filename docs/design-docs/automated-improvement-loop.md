# Automated Review-Improvement Loop

> Status: In progress (Phase A implemented, Jun 2026)
> Builds on: [Learning Pipeline v2](learning-pipeline-v2.md), [Reviewer Learning Loop](reviewer-learning-loop.md)

Automates the manual "collect ~10 reviewer corrections, ask an AI how to improve the review process" workflow into a daily, gated cycle: detect new annotated corrections → LLM proposes improvements with full knowledge of the current prompt and code rules → eval harness proves the proposal against historical menus (human-approved finals = ground truth) → human approves on the existing prompt-proposal page. Proposals are never auto-applied.

## Phases

| Phase | Deliverable | Status |
|-------|------------|--------|
| A | Raw pre-review input capture + submission↔audit linkage | Implemented |
| C1 | Replayable review pipeline (`qa-prompt-builder`, `review-pipeline` libs) | Implemented |
| C2 | Eval harness (`npm run review:eval`) | Implemented |
| B | Generated code-rules manifest (`npm run rules:manifest`) | Implemented |
| D | Improvement cycle (`npm run improve:cycle`) + proposal page extension | Implemented |
| E | Daily Lightsail cron + runbook | Implemented |

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

## Phase C1 — Replayable review pipeline (Implemented)

The Basic AI Check transformation steps were extracted verbatim from `handleBasicCheck` into reusable libs so the production route and the offline eval harness run the same code:

- `services/dashboard/lib/menu-footer.ts` — `normalizeMenuFooter`, allergen-legend parsing, raw-notice detection, `stripManagedFooterText`, `RAW_NOTICE_TEXT/PATTERN`.
- `services/dashboard/lib/qa-prompt-builder.ts` — `buildFinalPrompt(basePrompt, ctx)` (prix-fixe injection, allergen key, structure/footer/price rules, changed-only scope, embedded set-menu section) plus the `QA_PROMPT_SECTIONS` registry consumed by the rules manifest.
- `services/dashboard/lib/review-pipeline.ts` — `parseAIResponse` (severity normalization; forced-critical types exported as `FORCED_CRITICAL_EXACT_TYPES` / `FORCED_CRITICAL_NORMALIZED_TYPES`), post-AI raw-asterisk canonicalization, `enforcePrixFixeCriticalChecks`, critical-suggestion reconciliation, `runPostAiPipeline()` (the full guard chain: post-AI deterministic → title guard → structure guard → allergen guard → high-confidence auto-apply → embedded set-menu guard → price integrity guard → footer strip → reconciliation → prix-fixe enforcement), and `runFullReviewPipeline(rawText, opts, aiCaller)` for offline replay (full mode; `changed_only` stays route-level).

The handler keeps HTTP concerns (fallbacks, audits, diagnostics, logging) and destructures every guard intermediate from `runPostAiPipeline` so audit payloads are unchanged. The two raw-asterisk normalizers are intentionally different passes: pre-AI (`pre-ai-deterministic-rules.ts`) only fixes spacing on single-marker lines; post-AI (`review-pipeline.ts`) strips all markers and reinserts one at the canonical position.

## Phase C2 — Eval harness (Implemented)

`npm run review:eval` ([scripts/review-eval.js](../../scripts/review-eval.js)) replays historical menus through the full production pipeline (`runFullReviewPipeline`) and scores the output against the human-approved final.

- **Dataset** (`--build-dataset`, cached at `tmp/review-eval/dataset.jsonl`): production cases from Supabase (approved submissions; raw input from the Phase A audit columns, falling back to `ai_request.text` marked `degraded: audit_post_deterministic`, then `submissions.menu_content` marked `degraded: submitted_content`) plus curated DOCX pairs (`Training Menus/` + Zengo samples, extracted via the docx-redliner venv).
- **Config**: `--prompt <file>`, `--model` (default `REVIEW_EVAL_MODEL || AI_REVIEW_MODEL || gpt-4o-mini`), `--rules live|snapshot:<f>|candidate:<f>` (candidate = live accepted + proposed file), `--no-deterministic`, `--no-ai` (echo feedback; deterministic-only), `--limit`, `--case <id>`.
- **Determinism + cost**: temperature 0, fixed seed, responses cached at `tmp/review-eval/cache/` keyed by sha256(model|temp|seed|prompt|text) — re-running an unchanged config is free and reproduces identical scores.
- **Scoring** per case: document similarity (strict + raw-asterisk-style-normalized, via `services/dashboard/lib/text-similarity.ts` — also now consumed by `preai:ab-replay`) and correction-level precision/recall/F1 via `services/differ/lib/eval-scoring.ts` (`scoreCorrections` uses the differ's replacement-signal extractor: signals(raw→candidate) vs signals(raw→truth) → TP/FP/FN per kind, plus residual candidate→truth diffs). Composite = style similarity when no word-level signals, else `0.6*similarity + 0.4*F1`. Known scope: dish-name identity changes and whole-word swaps are excluded from token scoring by the differ's conservative guards — they surface in similarity/residual metrics instead.
- **Baseline compare**: `--baseline <report dir or json>` lists per-case composite deltas, improvements, regressions; exits non-zero when regressions exist (`process.exitCode = 2`) so the improvement cycle can gate on it.
- **Regression confirmation (nondeterminism guard):** the eval AI (gpt-4o-mini, temp 0) drifts *over time* — the SAME config re-run minutes later can swing a large menu's composite by tens of points (verified: identical config 12 min apart moved −6.27pp with 2 false regressions on 6 cases; seed variation back-to-back, by contrast, was byte-identical — so the noise is temporal, not seed-based). Comparing a stored baseline run to a later candidate run therefore conflates real config effects with that drift. Baseline compare handles it in two layers: (1) per-case deltas within a noise floor (`--noise-epsilon`, default 0.02 = 2pp) count as "same"; (2) each larger flagged regression is re-checked by re-running the **baseline and candidate configs back-to-back in the same time window** (`--baseline-prompt`/`--baseline-rules`) and kept only if the candidate is still ≥2pp below baseline on that fresh pair (`classifyConfirmedRegression` in `eval-scoring.ts`); otherwise the gap was temporal drift and the case moves back to "same". `eval_status`, the exit code, and the dashboard count reflect **confirmed** regressions only; flagged/confirmed/noise are all surfaced. `--no-confirm-regressions` disables it. This stops the verdict crying wolf — observed in production: trivial prompt changes flagged 4–11 "regressions" that were pure temporal drift on (tartare-free) beverage/kids menus. The improvement cycle passes the current prompt as `--baseline-prompt` automatically.
- Reports land in `tmp/review-eval/<timestamp>-<label>/report.{json,md}`.

## Phase B — Generated rules manifest (Implemented)

`npm run rules:manifest` ([scripts/generate-rules-manifest.js](../../scripts/generate-rules-manifest.js)) emits a single catalog of every review rule applied in code, built by [services/dashboard/lib/review-rules-manifest.ts](../../services/dashboard/lib/review-rules-manifest.ts):

- **Data-driven entries (cannot drift):** `BUILT_IN_REPLACEMENTS` (now exported), `QA_PROMPT_SECTIONS`, and `FORCED_CRITICAL_*` type lists are imported from the real implementation arrays — one manifest entry per item.
- **Hand-authored metadata:** each functional rule and guard (allergen-cluster normalizer, tres-leches V-code, raw-marker passes, all six post-AI guard modules, reconciliation, prix-fixe enforcement, footer handling) gets one entry with an `implementation: file#export` pointer.
- **Dynamic entries:** accepted `correction_rules` from the DB are appended at generation time.

Outputs: committed `docs/references/code-rules-manifest.{md,json}` (code-only, deterministic — no timestamps) and `tmp/rules-manifest/manifest-full.{json,md}` (code + live accepted rules; the Phase D LLM input).

Drift prevention (`services/dashboard/__tests__/review-rules-manifest.test.ts`): the committed markdown must byte-match a regeneration; every replacement / prompt section / critical type / known guard module must be covered; ids must be unique. Adding a new guard requires a manifest entry plus an addition to the test's known-guards list.

## Phase D — Improvement cycle (Implemented)

`npm run improve:cycle` ([scripts/improvement-cycle.js](../../scripts/improvement-cycle.js); testable core in [services/dashboard/lib/improvement-cycle-core.ts](../../services/dashboard/lib/improvement-cycle-core.ts)):

1. **Lock + gate**: `tmp/improvement-cycle/.lock` (stale after 6h) plus one-proposal-per-day (`cycle_id` = `YYYY-MM-DD`). Exits quietly when unconsumed corrections < `IMPROVE_MIN_NEW_CORRECTIONS` (default 1) or a proposal is already pending — an idle day costs one count query, $0. `--force`, `--skip-eval`, `--dry-run` flags.
2. **Effective prompt**: latest approved proposal from `prompt_proposals` beats `qa_prompt.txt` (the file is baked into the Docker image, so dashboard-approved prompts would be reverted on redeploy — the dashboard now also restores it at startup via `syncEffectivePromptFromDb()`).
3. **Context**: effective prompt + full rules manifest (code + accepted DB rules) + new corrections with reviewer explanations + before/after DOCX excerpts + latest eval snapshot.
4. **LLM analysis** (`IMPROVE_MODEL`, JSON mode, temp 0.2): returns `{analysis, proposed_prompt, proposed_replacement_rules[], code_recommendations[]}`. Validation drops rules with unsafe change types (only spelling/diacritic/terminology/grammar/punctuation/capitalization survive) or missing fields, with logged warnings. Code recommendations are descriptions for a human engineer — never auto-applied.

   **Lane discipline — context-dependent terms stay in the prompt.** A text correction is only eligible to become a deterministic replacement rule if the corrected form is right in *every* context the word appears. When the correct form depends on what the dish actually is, it must be AI reasoning in the prompt, not a find-replace. The canonical case is `tartare` (a raw chopped-protein preparation) vs `tartar` (a sauce): a reviewer fixing "poblano tartare" → "poblano tartar" because it's the sauce must NOT produce a global `tartare → tartar` rule (that would corrupt legitimate raw tartare dishes) — the prompt should instead teach the model to decide from dish context. The system enforces this two ways: the improvement-cycle system prompt instructs the LLM to route such terms to the prompt lane, and `validateImprovementLlmOutput` hard-drops any proposed replacement rule whose text matches `CONTEXT_DEPENDENT_TERMS` (in `services/dashboard/lib/improvement-cycle-core.ts`) with a warning. Approval-inserted rules are also marked consumed by their proposal cycle so they don't re-enter the gate as new corrections.

   **Prompt-shape guardrails.** If the LLM proposal echoes cycle context, returns the `UNCHANGED` sentinel, or breaks the current prompt's Markdown code-fence structure, the cycle treats the prompt as unchanged and records a warning while still preserving safe deterministic replacement rules. This prevents malformed prompt rewrites (for example, deleting the closing code fence around the required response format) from reaching eval or approval as if they were valid process changes.
5. **Auto-eval**: spawns the eval harness twice — baseline (current prompt + live rules) and candidate (proposed prompt + `candidate:` rules) — and stores `eval_summary` + `eval_status` (`passed`/`regressed`/`failed`/`skipped`). Regressed proposals are stored and flagged, never dropped.
6. **Store + notify**: inserts the `prompt_proposals` row (`source: improvement_cycle`), marks the corrections consumed (`prompt_cycle_id`), writes artifacts to `tmp/improvement-cycle/<cycle>/`, and emails `IMPROVE_NOTIFY_EMAIL || FORM_ATTEMPT_ALERT_EMAIL` via the Graph alert-mail transport with a link to `/learning/prompt-proposal`.

**Dashboard** (`/learning/prompt-proposal`): the proposal page now shows the eval verdict (baseline vs candidate composites, improved/same/regressed, per-case regression table), the proposed replacement rules as a checked-by-default checkbox list, and the code recommendations. On approve, the review route writes the prompt (as before), records `accepted_rules`, and inserts each checked rule into `correction_rules` (`status: accepted`, `source: system`, `submission_id: proposal-<id>`) so the pre-AI deterministic pass applies them immediately. `npm run prompt:rewrite` remains as a manual fallback until the cycle has run in production.

**Code recommendations → GitHub issues:** approving a proposal also files each code recommendation as a GitHub issue (`[improvement-cycle] <title>`, label `improvement-cycle`) with the description, manifest pointers, likely implementation file, and an implementation checklist (jest coverage, manifest entry, eval comparison). Requires `GITHUB_TOKEN` (+ optional `GITHUB_REPO`); skipped with a log line when unconfigured, and a failed GitHub call never blocks the approval. Issues rather than auto-PRs by design: recommendations are specs, not implemented code — an engineer (or a coding agent pointed at the issue) implements them with tests. Wiring an agent to auto-draft PRs from these issues is a possible future step.

### Handling intentional policy changes (contradicting past corrections)

Reviewers can add manual rules on the learning dashboard that *contradict* past approved menus (e.g. deciding a word should now be handled differently). Two mechanisms keep the loop honest:

1. **Eval ground-truth normalization (default):** the eval harness re-bases each historical human final onto the policy under evaluation — the run's deterministic rules (built-ins + accepted + candidate rules) are applied to the ground truth before scoring. A deliberate replacement-rule change therefore stops counting as a "regression" on menus approved under the old policy, while genuine regressions still surface. `--raw-ground-truth` disables this for forensic comparisons against historical finals verbatim. Since most manual learning-page rules are exact replacements, this covers the common case mechanically.
2. **LLM conflict handling (prompt-lane changes):** the improvement-cycle system prompt instructs the model that the newest human intent wins, to update/remove conflicting older guidance rather than keeping both, and to state explicitly in its analysis which eval "regressions" are the intended policy change — so the reviewer can read a `regressed` verdict correctly. The human reviewing the proposal stays the referee.

**Required manual step:** apply `supabase/migrations/20260612_extend_prompt_proposals.sql` in the Supabase SQL editor (with the two earlier migrations) before the first production cycle — the proposal insert uses the new columns.

## Phase E — Scheduling on Lightsail (Implemented)

The deploy workflow ([.github/workflows/deploy-lightsail.yml](../../.github/workflows/deploy-lightsail.yml)) installs the cron idempotently on every deploy — no manual host setup:

```cron
15 9 * * * /usr/bin/flock -n /tmp/menumanager-improve.lock <DEPLOY_PATH>/scripts/run-improvement-cycle-cron.sh >> /tmp/menumanager-improve-cron.log 2>&1
```

[scripts/run-improvement-cycle-cron.sh](../../scripts/run-improvement-cycle-cron.sh) detects `docker` vs `sudo docker` (same logic as the deploy) and runs `node /app/scripts/improvement-cycle.js` inside the dashboard container, where the compose `.env`, built `dist/`, and the persistent `menumanager_tmp`/`menumanager_logs` volumes live. 09:15 UTC = overnight US, so proposals are waiting at the start of the day.

Idempotency layers: host `flock` → script lock file (`tmp/improvement-cycle/.lock`, stale 6h) → one proposal per `cycle_id` (day) → pending-proposal gate.

### Runbook

- **Cycle log:** `menumanager_logs` volume → `docker compose exec dashboard tail -50 /app/logs/improvement-cycle.log`. Cron wrapper issues land in `/tmp/menumanager-improve-cron.log` on the host.
- **Verify the cron is installed:** `crontab -l | grep improvement-cycle` on the Lightsail host (the deploy logs print "Improvement-cycle cron installed").
- **Run manually:** `docker compose exec dashboard node /app/scripts/improvement-cycle.js` (add `--dry-run` to inspect the assembled context without an LLM call, `--force` to bypass the gate, `--skip-eval` to skip the eval step).
- **Kill switch:** remove the crontab line (`crontab -e`) or set `IMPROVE_MIN_NEW_CORRECTIONS` very high in `.env` and restart.
- **Notification email:** the cycle builds the same Graph + SMTP transports the dashboard uses (`buildCycleMailDeps`). On Lightsail, Graph (HTTPS) is the only working transport — outbound port 25 is blocked, so SMTP cannot deliver there. Graph requires `GRAPH_USER_EMAIL` (or `GRAPH_MAILBOX_ADDRESS` — a real sendable mailbox, e.g. `design@richardsandoval.com`, not a distribution list) plus `GRAPH_CLIENT_ID` / `GRAPH_TENANT_ID` / `GRAPH_CLIENT_SECRET` with `Mail.Send` (or `Mail.ReadWrite` for the inbox-write fallback) admin consent. The dashboard logs its transport state on startup (`docker compose logs dashboard | grep "Alert mail"`). When the cycle cannot send or the send fails, it records a visible `improvement_cycle_email_failed` row in `system_alerts` — so a missing email is never silent. **The proposal is always available at `/learning/prompt-proposal` regardless of email.** If the dashboard's other alert emails (form-failure alerts) also aren't arriving, it's the same Graph-config root cause.
- **Graph secret rotation (avoid silent expiry):** Azure client secrets expire and then fail silently, taking down all Graph features (email + SharePoint) at once. Set `GRAPH_CLIENT_SECRET_EXPIRES` (`YYYY-MM-DD`) to the secret's Azure expiry; the dashboard logs days-remaining on startup and the daily cycle raises a `graph_secret_warning` system alert from 30 days out and `graph_secret_expired` after. **To rotate:** Azure portal → App registrations → (the app, client id `347b024c-…`) → Certificates & secrets → New client secret → copy the *Value* immediately (not the Secret ID) → on the Lightsail host update `GRAPH_CLIENT_SECRET` and `GRAPH_CLIENT_SECRET_EXPIRES` in `.env` → `docker compose up -d --force-recreate dashboard` → confirm with the `Alert mail:` / `Graph secret:` startup log lines. `AADSTS7000215` / `invalid_client` means Azure rejected the configured secret value, so rotate and repaste the Value.
- **First production run checklist:** (1) apply the three Supabase migrations (`20260610`, `20260611`, `20260612` — see Phase A/D notes); (2) run once manually with `--dry-run`, then for real; (3) review and approve/reject the proposal at `/learning/prompt-proposal`; (4) confirm the next gated day logs a skip line and nothing else.
- **Eval dataset in production:** the python venv is not in the production image, so curated DOCX pairs are skipped with warnings there — production cases (Supabase) still work. Build the full dataset locally with `npm run review:eval -- --build-dataset --source all --dataset-only`; it persists on the `menumanager_tmp` volume. Use `IMPROVE_EVAL_LIMIT` to cap eval cost initially.

## Operational note: Supabase schema drift (correction rules)

The dashboard saves reviewer correction rules through the db service, which writes to Supabase and falls back to a local JSON file (`tmp/db/correction_rules.json` on the `menumanager_tmp` volume) when the Supabase insert fails. The improvement cycle reads Supabase **directly**, so any rule that only reached the local fallback is invisible to it.

In June 2026 this bit us: production `correction_rules` was missing the `applies_to_menu_type` column (migration never applied), so *every* reviewer correction since the column became required failed its Supabase insert and silently accumulated in the local fallback — the cycle saw nothing and emitted no proposals.

Fix + recovery (in order):

1. Apply `supabase/migrations/20260614_add_correction_rules_menu_scope.sql` in the Supabase SQL editor. New saves land in Supabase again.
2. Run `npm run reconcile:correction-rules` **inside a container that mounts the volume** (`docker compose exec -T dashboard node /app/scripts/reconcile-correction-rules.js` — dry run; add `--apply`) to upsert the stranded local rules into Supabase. Idempotent (dedupe by submission_id + correction_id).

Prevention: the db service runs `verifyCriticalSupabaseSchema()` on startup and logs a loud `supabase_schema_drift` system alert (via `system_alerts`) when a load-bearing column is missing from `correction_rules`, `submissions`, `basic_ai_check_audits`, or `prompt_proposals`. Update `CRITICAL_SUPABASE_SCHEMA` in `services/db/index.ts` when a migration adds load-bearing columns. This makes the next missed migration scream instead of silently dropping data.

## Eval dataset contract

A production eval case is assembled as:

- `raw_input`: `basic_ai_check_audits.menu_content_raw` for the submission's `form_attempt_id` (latest `completed` audit). Pre-Phase-A rows fall back to `ai_request.text` and are marked `degraded`.
- `ground_truth`: `submissions.approved_menu_content` (human-approved final text).
- `context`: property, template type, menu type, service period, allergens — needed to rebuild the exact prompt and rule scoping.
- Reviewer explanations come from `correction_rules` rows for the submission.
