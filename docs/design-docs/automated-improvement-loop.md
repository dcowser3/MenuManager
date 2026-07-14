# Automated Review-Improvement Loop

> Status: In progress (Phase A implemented, Jun 2026)
> Builds on: [Learning Pipeline v2](learning-pipeline-v2.md), [Reviewer Learning Loop](reviewer-learning-loop.md)

Automates the manual "collect ~10 reviewer corrections, ask an AI how to improve the review process" workflow into a scheduled, gated cycle (every other day since Jul 2026): detect new annotated corrections → LLM proposes improvements with full knowledge of the current prompt and code rules → eval harness proves the proposal against historical menus (human-approved finals = ground truth) → human approves on the existing prompt-proposal page. Proposals are never auto-applied.

## Phases

| Phase | Deliverable | Status |
|-------|------------|--------|
| A | Raw pre-review input capture + submission↔audit linkage | Implemented |
| C1 | Replayable review pipeline (`qa-prompt-builder`, `review-pipeline` libs) | Implemented |
| C2 | Eval harness (`npm run review:eval`) | Implemented |
| B | Generated code-rules manifest (`npm run rules:manifest`) | Implemented |
| D | Improvement cycle (`npm run improve:cycle`) + proposal page extension | Implemented |
| E | Scheduled Lightsail cron (every other day) + runbook | Implemented |

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

1. **Lock + gate**: `tmp/improvement-cycle/.lock` (stale after 6h) plus one-proposal-per-day (`cycle_id` = `YYYY-MM-DD`). Exits quietly when unconsumed corrections < `IMPROVE_MIN_NEW_CORRECTIONS` (default 1). When a previous proposal is still pending **and there are no new unconsumed corrections**, the daily run skips new proposal generation but sends a reminder email for the pending proposal so the queue does not stall silently. When new corrections arrive while a proposal is pending (≥ `IMPROVE_MIN_NEW_CORRECTIONS`), the cycle **supersedes** the old pending proposal: it generates a fresh proposal from the current approved effective prompt using the pending proposal's source corrections plus the new ones, marks the old proposal `status: superseded`, and emails the new proposal instead of a reminder. Manual `--force` (or the dashboard on-demand button) also supersedes a pending proposal even with zero new corrections. `--skip-eval`, `--dry-run` flags.
2. **Effective prompt**: latest approved proposal from `prompt_proposals` beats `qa_prompt.txt` (the file is baked into the Docker image, so dashboard-approved prompts would be reverted on redeploy — the dashboard now also restores it at startup via `syncEffectivePromptFromDb()`).
3. **Context**: effective prompt + full rules manifest (code + accepted DB rules) + new corrections with reviewer explanations + before/after DOCX excerpts + latest eval snapshot.
4. **LLM analysis** (`IMPROVE_MODEL`, JSON mode, temp 0.2): returns `{analysis, proposed_prompt, proposed_replacement_rules[], code_recommendations[]}`. Validation drops rules with unsafe change types (only spelling/diacritic/terminology/grammar/punctuation/capitalization survive) or missing fields, with warnings stored on the proposal and written to `tmp/improvement-cycle/<cycle>/warnings.json`. Code recommendations are descriptions for a human engineer — never auto-applied.

   **Lane discipline — context-dependent terms stay in the prompt.** A text correction is only eligible to become a deterministic replacement rule if the corrected form is right in *every* context the word appears. When the correct form depends on what the dish actually is, it must be AI reasoning in the prompt, not a find-replace. The canonical case is `tartare` (a raw chopped-protein preparation) vs `tartar` (a sauce): a reviewer fixing "poblano tartare" → "poblano tartar" because it's the sauce must NOT produce a global `tartare → tartar` rule (that would corrupt legitimate raw tartare dishes) — the prompt should instead teach the model to decide from dish context. Accent-only corrections are treated differently: if the original and corrected text match after stripping diacritics and lowercasing, such as `espadin` → `espadín`, the cycle should propose a deterministic `diacritic` rule unless it can identify a realistic menu context where the unaccented form is intentionally correct. The system enforces this with the improvement-cycle system prompt plus `validateImprovementLlmOutput`, which hard-drops proposed rules whose text matches `CONTEXT_DEPENDENT_TERMS` and normalizes mislabeled accent-only replacements to `diacritic`. Approval-inserted rules are also marked consumed by their proposal cycle so they don't re-enter the gate as new corrections.

   **Prompt-shape guardrails.** If the LLM proposal echoes cycle context, returns the `UNCHANGED` sentinel, or breaks the current prompt's Markdown code-fence structure, the cycle treats the prompt as unchanged and records a warning while still preserving safe deterministic replacement rules. This prevents malformed prompt rewrites (for example, deleting the closing code fence around the required response format) from reaching eval or approval as if they were valid process changes.

   **No-op discipline for missed prompt-lane corrections.** A reviewer correction is evidence that the first-pass process missed something. If the correction is contextual and belongs in the prompt lane, the cycle must not dismiss it with "already covered" or "already handled by the prompt" just because related guidance exists. It should sharpen the prompt with explicit examples, clearer decision rules, better placement, exception language, or a code/eval recommendation when prompt text cannot reliably solve it. The validator now warns when an unchanged proposal analysis appears to justify a no-op by citing existing prompt coverage.
5. **Auto-eval**: spawns the eval harness twice — baseline (current prompt + live rules) and candidate (proposed prompt + `candidate:` rules) — and stores `eval_summary` + `eval_status` (`passed`/`regressed`/`failed`/`skipped`). Regressed proposals are stored and flagged, never dropped.
6. **Store + notify**: inserts the `prompt_proposals` row (`source: improvement_cycle`), marks the corrections consumed (`prompt_cycle_id`), writes artifacts to `tmp/improvement-cycle/<cycle>/`, and emails `IMPROVE_NOTIFY_EMAIL || FORM_ATTEMPT_ALERT_EMAIL` via the Graph alert-mail transport with a public link to `/learning/prompt-proposal`. The link base is `DASHBOARD_PUBLIC_URL` when set, otherwise `DASHBOARD_URL`, otherwise local development falls back to `http://localhost:3005`.

**Dashboard** (`/learning/prompt-proposal`): the proposal page now shows the eval verdict (baseline vs candidate composites, improved/same/regressed, per-case regression table), the proposed replacement rules as a checked-by-default checkbox list, any validation notes from dropped/guarded LLM output, and the code recommendations. The top-line correction count is labeled as source corrections because it counts input evidence sent to the cycle, not the smaller set of deterministic rules that survived validation. On approve, the review route writes the prompt (as before), records `accepted_rules`, and inserts each checked rule into `correction_rules` (`status: accepted`, `source: system`, `submission_id: proposal-<id>`) so the pre-AI deterministic pass applies them immediately. The `/learning` Pending Rules table shows each pending rule's creation time and origin (`General add-rule area`, `Menu correction page` with menu name, or detected-pattern scan) and excludes source correction rows once the cycle has stamped `prompt_cycle_id` or `consumed_at`; those rows are evidence consumed by the proposal, not separate manual-review tasks. `npm run prompt:rewrite` remains as a manual fallback until the cycle has run in production.

**Code recommendations → GitHub issues:** approving a proposal also files each code recommendation as a GitHub issue (`[improvement-cycle] <title>`, label `improvement-cycle`) with the description, manifest pointers, likely implementation file, and an implementation checklist (jest coverage, manifest entry, eval comparison). Requires `GITHUB_TOKEN` (+ optional `GITHUB_REPO`); skipped with a log line when unconfigured, and a failed GitHub call never blocks the approval. Issues rather than auto-PRs by design: recommendations are specs, not implemented code — an engineer (or a coding agent pointed at the issue) implements them with tests. Wiring an agent to auto-draft PRs from these issues is a possible future step.

### Saving a correction = proposing, not applying (single gate)

A reviewer-saved correction is a **proposal**, not a live rule. `buildCorrectionRuleRecord` (`services/dashboard/lib/learning-correction-rules.ts`) stamps every human save `status: 'pending'`, so the pre-AI deterministic pass (which only reads `status: 'accepted'`) never applies it on save. The correction still feeds the cycle (the gate reads `accepted` + `pending`, unconsumed), which routes it *using the reviewer's explanation* — replacement rule vs prompt reasoning vs code change — and only the cycle's approved replacement rules (inserted directly as `source: 'system'`, `status: 'accepted'`) reach the deterministic pass. This closes the path where a context-dependent fix (e.g. a human-saved `berry → berries`) went live as a blind global find/replace the moment it was saved, skipping lane-routing, eval, and approval.

Defense in depth: `isSafeLearnedRule` (`services/dashboard/lib/pre-ai-deterministic-rules.ts`) now also runs `involvesContextDependentTerm`, so a context-dependent term can never be applied as a deterministic replacement regardless of how it reached the DB — the same guard the cycle's `validateImprovementLlmOutput` already applies to LLM-proposed rules. `CONTEXT_DEPENDENT_TERMS` covers homographs (`tartare`/`tartar`) and number-context terms (`berry`/`berries`).

**Reviewer attribution is mandatory.** Both human save paths — the `/learning` General add-rule area and the `/learning/submission/:id` Menu correction page — require a Reviewer Name. `buildCorrectionRuleRecord` throws `reviewer_name is required` for any non-`system` source (both forms also validate client-side), so a human rule can never land unattributed. Only `source: 'system'` rows (cycle approvals, detected-pattern scans) are exempt. Rows created before this was enforced have `reviewer_name = null` and cannot be back-attributed — there is no per-user auth on the dashboard, so the reviewer field is the only attribution captured.

**On-demand trigger:** `POST /api/learning/run-improvement-cycle` (a "Run cycle now" button on `/learning/prompt-proposal`) spawns the same script the cron runs, detached, with `--force` so a reviewer can generate a proposal immediately after saving corrections instead of waiting for the overnight run. It respects the script's lock file (returns 409 if a run is in flight), and the script self-suffixes the `cycle_id` (`<date>-manual-<ts>`) when the day already has a proposal so the `NOT NULL UNIQUE` insert doesn't collide.

### Handling intentional policy changes (contradicting past corrections)

Reviewers can add manual rules on the learning dashboard that *contradict* past approved menus (e.g. deciding a word should now be handled differently). Two mechanisms keep the loop honest:

1. **Eval ground-truth normalization (default):** the eval harness re-bases each historical human final onto the policy under evaluation — the run's deterministic rules (built-ins + accepted + candidate rules) are applied to the ground truth before scoring. A deliberate replacement-rule change therefore stops counting as a "regression" on menus approved under the old policy, while genuine regressions still surface. `--raw-ground-truth` disables this for forensic comparisons against historical finals verbatim. Since most manual learning-page rules are exact replacements, this covers the common case mechanically.
2. **LLM conflict handling (prompt-lane changes):** the improvement-cycle system prompt instructs the model that the newest human intent wins, to update/remove conflicting older guidance rather than keeping both, and to state explicitly in its analysis which eval "regressions" are the intended policy change — so the reviewer can read a `regressed` verdict correctly. The human reviewing the proposal stays the referee.

**Required manual step:** apply `supabase/migrations/20260612_extend_prompt_proposals.sql` and `supabase/migrations/20260626_add_prompt_proposal_llm_warnings.sql` in the Supabase SQL editor (with the two earlier migrations) before the first production cycle — the proposal insert uses the new columns. If the 20260626 migration is missing, the cycle stores the proposal without validation notes and logs a migration warning instead of failing the proposal insert.

## Phase E — Scheduling on Lightsail (Implemented)

The deploy workflow ([.github/workflows/deploy-lightsail.yml](../../.github/workflows/deploy-lightsail.yml)) installs the cron idempotently on every deploy — no manual host setup:

```cron
15 9 */2 * * /usr/bin/flock -n /tmp/menumanager-improve.lock <DEPLOY_PATH>/scripts/run-improvement-cycle-cron.sh >> /tmp/menumanager-improve-cron.log 2>&1
```

[scripts/run-improvement-cycle-cron.sh](../../scripts/run-improvement-cycle-cron.sh) detects `docker` vs `sudo docker` (same logic as the deploy) and runs `node /app/scripts/improvement-cycle.js` inside the dashboard container, where the compose `.env`, built `dist/`, and the persistent `menumanager_tmp`/`menumanager_logs` volumes live. 09:15 UTC = overnight US, so proposals are waiting at the start of the day. Since Jul 2026 the cadence is **every other day** (`*/2` on day-of-month; a daily proposal was more than reviewers consumed). Month boundaries can occasionally give back-to-back runs (31st → 1st) — harmless, the correction gate makes an empty run a no-op.

Idempotency layers: host `flock` → script lock file (`tmp/improvement-cycle/.lock`, stale 6h) → one proposal per `cycle_id` (day) → pending-proposal gate.

### Runbook

- **Cycle log:** `menumanager_logs` volume → `docker compose exec dashboard tail -50 /app/logs/improvement-cycle.log`. Cron wrapper issues land in `/tmp/menumanager-improve-cron.log` on the host.
- **Verify the cron is installed:** `crontab -l | grep improvement-cycle` on the Lightsail host (the deploy logs print "Improvement-cycle cron installed").
- **Run manually:** `docker compose exec dashboard node /app/scripts/improvement-cycle.js` (add `--dry-run` to inspect the assembled context without an LLM call, `--force` to bypass the gate, `--skip-eval` to skip the eval step).
- **Kill switch:** remove the crontab line (`crontab -e`) or set `IMPROVE_MIN_NEW_CORRECTIONS` very high in `.env` and restart.
- **Notification email:** the cycle builds the same Graph + SMTP transports the dashboard uses (`buildCycleMailDeps`). On Lightsail, Graph (HTTPS) is the only working transport — outbound port 25 is blocked, so SMTP cannot deliver there. Graph requires `GRAPH_USER_EMAIL` (or `GRAPH_MAILBOX_ADDRESS` — a real sendable mailbox, e.g. `design@richardsandoval.com`, not a distribution list) plus `GRAPH_CLIENT_ID` / `GRAPH_TENANT_ID` / `GRAPH_CLIENT_SECRET` with `Mail.Send` (or `Mail.ReadWrite` for the inbox-write fallback) admin consent. The dashboard logs its transport state on startup (`docker compose logs dashboard | grep "Alert mail"`). When the cycle cannot send or the send fails, it records a visible `improvement_cycle_email_failed` row in `system_alerts` — so a missing email is never silent. Set `DASHBOARD_URL` to the production dashboard domain; use `DASHBOARD_PUBLIC_URL` only when proposal emails need a different public base. **The proposal is always available at `/learning/prompt-proposal` regardless of email.** If the dashboard's other alert emails (form-failure alerts) also aren't arriving, it's the same Graph-config root cause. If a daily run skips because an older proposal is still pending, it sends a reminder email for that pending proposal to the same recipient instead of creating a new proposal.
- **Graph secret rotation (avoid silent expiry):** Azure client secrets expire and then fail silently, taking down all Graph features (email + SharePoint) at once. Set `GRAPH_CLIENT_SECRET_EXPIRES` (`YYYY-MM-DD`) to the secret's Azure expiry; the dashboard logs days-remaining on startup and each scheduled cycle run raises a `graph_secret_warning` system alert from 30 days out and `graph_secret_expired` after. **To rotate:** Azure portal → App registrations → (the app, client id `347b024c-…`) → Certificates & secrets → New client secret → copy the *Value* immediately (not the Secret ID) → on the Lightsail host update `GRAPH_CLIENT_SECRET` and `GRAPH_CLIENT_SECRET_EXPIRES` in `.env` → `docker compose up -d --force-recreate dashboard` → confirm with the `Alert mail:` / `Graph secret:` startup log lines. `AADSTS7000215` / `invalid_client` means Azure rejected the configured secret value, so rotate and repaste the Value.
- **First production run checklist:** (1) apply the Supabase migrations (`20260610`, `20260611`, `20260612`, and `20260626` — see Phase A/D notes); (2) run once manually with `--dry-run`, then for real; (3) review and approve/reject the proposal at `/learning/prompt-proposal`; (4) confirm the next gated day logs a skip line and nothing else.
- **Eval dataset in production:** the python venv is not in the production image, so curated DOCX pairs are skipped with warnings there — production cases (Supabase) still work. Build the full dataset locally with `npm run review:eval -- --build-dataset --source all --dataset-only`; it persists on the `menumanager_tmp` volume. Use `IMPROVE_EVAL_LIMIT` to cap eval cost initially.

## July 2026 — TPM-cap failure, model move to gpt-5.1, alignment fixes

On Jul 14 2026 the daily run silently died: the assembled context (~31k tokens, 8 corrections) exceeded the org's o3 rate tier of 30k tokens **per minute**, and a single request larger than the TPM cap can never succeed — but the 429 handler treated it as transient and burned all 6 retries (16s waits) before failing, leaving no proposal, no email, and no alert. Only the Lightsail cron log knew. Fixes shipped:

- **Model:** `IMPROVE_MODEL=gpt-5.1` in production (500k TPM, stronger than o3). `isReasoningModel` (`improvement-cycle-core.ts`) now routes the gpt-5 family down the reasoning payload path (no `temperature`, `max_completion_tokens`) — previously the `/o[0-9]|reasoning/` check missed gpt-5 and would have sent `temperature: 0.2`, which gpt-5 reasoning models reject. An earlier stopgap on o4-mini worked but broke prompt code-fence discipline on its first run (guard caught it; proposal shipped rules-only), reinforcing that this call wants a strong model.
- **Fail fast:** `isRequestTooLarge429` detects the "Request too large … (TPM)" body and the script aborts immediately instead of retrying.
- **Never silent:** any cycle crash now inserts an `improvement_cycle_failed` row into `system_alerts` (`recordCycleFailureAlert` in the script) — previously only email-step failures were recorded.
- **Cadence:** cron moved from daily to every other day (see Phase E).

## Operational note: Supabase schema drift (correction rules)

The dashboard saves reviewer correction rules through the db service, which writes to Supabase and falls back to a local JSON file (`tmp/db/correction_rules.json` on the `menumanager_tmp` volume) when the Supabase insert fails. The improvement cycle reads Supabase **directly**, so any rule that only reached the local fallback is invisible to it.

In June 2026 this bit us: production `correction_rules` was missing the `applies_to_menu_type` column (migration never applied), so *every* reviewer correction since the column became required failed its Supabase insert and silently accumulated in the local fallback — the cycle saw nothing and emitted no proposals.

Fix + recovery (in order):

1. Apply `supabase/migrations/20260614_add_correction_rules_menu_scope.sql` in the Supabase SQL editor. New saves land in Supabase again.
2. Run `npm run reconcile:correction-rules` **inside a container that mounts the volume** (`docker compose exec -T dashboard node /app/scripts/reconcile-correction-rules.js` — dry run; add `--apply`) to upsert the stranded local rules into Supabase. Idempotent (dedupe by submission_id + correction_id).

**July 2026 — it bit us again, differently.** The `applies_to_menu_type` fix (`20260614`) was applied, but the earlier `20260607` migration — which *also* drops the `NOT NULL` constraints on `original_text` / `corrected_text` — never was. So *freeform* correction rules (a pure instruction with no before/after text, e.g. the `/learning` General add-rule area entries: "LAURENT-PERRIER is a proper noun…") kept failing their Supabase insert on the stale `NOT NULL` and accumulating in the local fallback. The cron ran every night and correctly logged `Gate: skipping — only 0 unconsumed correction(s)` because the cycle reads Supabase, where the rules never landed. Recovery: apply `supabase/migrations/20260710_drop_correction_rule_text_not_null.sql` (idempotent `DROP NOT NULL`), then `reconcile-correction-rules.js --apply`, then trigger the cycle.

Prevention (three layers, `services/db/index.ts`):

1. `verifyCriticalSupabaseSchema()` on startup logs a `supabase_schema_drift` system alert when a load-bearing **column is missing** from `correction_rules`, `submissions`, `basic_ai_check_audits`, or `prompt_proposals` (`CRITICAL_SUPABASE_SCHEMA` — update it when a migration adds load-bearing columns).
2. The same check now also detects a **stale `NOT NULL` constraint** on columns that must be nullable (`NULLABLE_SUPABASE_COLUMNS`; currently `correction_rules.original_text` / `corrected_text`). A plain `SELECT` can't see this, so it reads PostgREST's OpenAPI spec (read-only) — NOT-NULL-without-default columns appear in each table's `required` array (`detectNotNullDrift` in `services/db/lib/schema-drift.ts`). Degrades to a no-op if the spec is unavailable.
3. The `POST /correction-rules` handler raises a `correction_rule_mirror_failed` alert whenever a Supabase insert falls back to local JSON — a runtime catch-all that surfaces *any* insert-blocking drift (missing column, stale `NOT NULL`, CHECK, RLS) the moment the first rule bounces, instead of weeks later. This is the guard that would have caught both incidents on day one.

## Eval dataset contract

A production eval case is assembled as:

- `raw_input`: `basic_ai_check_audits.menu_content_raw` for the submission's `form_attempt_id` (latest `completed` audit). Pre-Phase-A rows fall back to `ai_request.text` and are marked `degraded`.
- `ground_truth`: `submissions.approved_menu_content` (human-approved final text).
- `context`: property, template type, menu type, service period, allergens — needed to rebuild the exact prompt and rule scoping.
- Reviewer explanations come from `correction_rules` rows for the submission.

## July 2026 Hardening (Fixes 1–3)

The daily improvement cycle now includes structural guards so that "passed" means the proposal demonstrated forward progress on the exact cases that triggered it:

- **Fix 1 (progression testing):** Trigger submissions are ensured in the eval dataset (on-the-fly build if the cached `tmp/review-eval/dataset.jsonl` is stale). After baseline/candidate, `eval_summary` grows a `triggers[]` block with per-case baseline/candidate/delta/status using the same 0.02 noise epsilon as the regression compare. `evalStatusFromSummary` returns:
  - `regressed` if any confirmed regression exists
  - `passed` only if no regressions AND at least one trigger improved
  - `no_effect` (new) when no regressions and no trigger improved (covers byte-identical candidates and "already covered" claims that change nothing measurable).
  The proposal page renders a Trigger Progression table above the regression table; the notification email subject carries the verdict (e.g. `[no_effect]`).

- **Fix 2 (pre-analysis replay):** Before the improvement LLM call, each distinct trigger submission is replayed through `runFullReviewPipeline` (current effective prompt + live accepted rules) using the eval harness cache so repeated runs are free. Each correction is tagged `still_missed` / `now_correct` / `replay_unavailable` by testing whether `extractReplacementSignals(raw, replayOutput)` contains the human's (original→corrected) pair. The tags are rendered in the cycle's user prompt as `REPLAY EVIDENCE:` lines and stored as `replay_evidence` (JSONB) on the proposal. `validateImprovementLlmOutput` now accepts `replayEvidence`; when `promptUnchanged` and any `still_missed` correction lacks a covering proposed rule or code recommendation, it sets `unresolved_still_missed: true` (stored on the row) and emits a hard warning. The proposal page shows a red banner for such cases. The system prompt was updated to require concrete action for `still_missed`.

- **Fix 3 (rejection does not burn evidence):** On `status: 'rejected'`, the review route now calls a new db endpoint `/correction-rules/unconsume-for-cycle` which resets `prompt_cycle_id`/`consumed_at` to null for rows stamped by that cycle, *except* the synthetic `proposal-%` rows that are outputs of prior approvals. The next cycle that re-collects those corrections includes a `## Prior Rejected Proposal ...` section with the previous `reviewer_notes` and truncated `llm_analysis` so rejections create a feedback loop instead of a dead end. The UI labels reviewer notes as "strongly encouraged for rejections" and shows a confirm nudge when empty on reject.

A supporting migration (`20260702_add_prompt_proposal_replay_evidence.sql`) adds the `replay_evidence` and `unresolved_still_missed` columns; both the cycle and dashboard degrade gracefully if the migration has not been applied.

## Follow-up hardening (post-implementation review)

- **Follow-up 0**: TDZ in replay block was fixed by hoisting `submissionIds`; a regression test path now exercises the assembly (via extracted `decideReplayStatus` + source checks) and `--dry-run` fixtures must emit `Replay evidence: N corrections tagged` (N>0) rather than the swallowed skip warning. Unused `chunk` helper removed.
- **Follow-up 1 (P0)**: Trigger progression classification now derives deltas from the candidate report's `baselineComparison` entries (and supp report comparisons for targeted cases) and prefers `freshDelta` when the confirmation pass populated it. `classifyTriggerFromComparisonEntry` encapsulates this; a raw +3pp that confirms to ~0 becomes `unchanged`. Design note: improvement claims on triggers are now drift-confirmed via the same mechanism used for regressions.
- **B0 (harness formalization)**: review-eval now guarantees every per-case entry in `baselineComparison` carries an explicit `confirmed_delta` (fresh back-to-back delta when the confirmation pass ran; `null` otherwise) alongside the raw `delta`. The cycle and `classifyTriggerFromComparisonEntry` consume `confirmed_delta` by name (with `freshDelta` fallback for legacy reports). Synthetic report fixtures with raw/confirmed disagreement added to Jest. Documented in eval report markdown. Removes informal field dependency.
- **B1 (Fix 4 remainder)**: Distinct amber `.badge.no_effect` chip on the proposal detail page (instead of falling to generic 'pending'). `Eval` column added to Proposal History table in the same view for auditability over time. New migration `20260702_add_no_effect_eval_status.sql` adds an explicit CHECK constraint (idempotent) admitting 'no_effect' (and the prior set). View tests cover the amber rendering in detail + history.
- **B2 (Fix 5)**: `coverage_claims` array added to `ImprovementLlmOutput` and persisted on proposals. LLM instructed (and validated) to emit verbatim contiguous `prompt_quote` + explanation for any "already covered" claim. Validator drops fabricated quotes (after ws-normalized substring check against current prompt) with warning. Replay evidence still outranks a valid citation: a `still_missed` + valid-claim with no actual rule/code change still sets `unresolved_still_missed` and the red banner. New jest cases cover the interaction and invalid-quote path. Claims render in a "Coverage Claims (validated)" section on the proposal page with a note that citations don't override replay.
- **B3 (Fix 6)**: `buildCorrectionExcerptWindows` + `locateCorrectionSite` extracted to core lib (pure, tested). Cycle now emits per-correction ±300-char line-bounded windows (case/diacritic tolerant locate, deduped, budget-capped at ~4k per sub / 40k per cycle) in place of the previous `slice(0,600)` head slices. Short orientation heads (200 chars) are retained. Dry-run artifacts and LLM context now surface the actual correction sites even when deep in long menus. Jest covers locate, deep-window inclusion, dedupe and budget.
- **B4 (Fix 7)**: Default analysis model is now a reasoning-class model (`o3` leaf after IMPROVE_MODEL / PROMPT_REWRITE_MODEL). `callImprovementLlm` conditionally omits/adapts temperature for reasoning models while preserving response_format + strict JSON fallback path. Model and token usage already logged; proposal row records the resolved llm_model. .env.example and docs/environment.md updated.
- **B5 (Fix 10)**: Guidance and defaults documented to pin `REVIEW_EVAL_MODEL` (and `AI_REVIEW_MODEL`) to a dated snapshot for lower temporal drift. `report.json` now carries explicit top-level `model` (in addition to `config.model`); markdown report surfaces the pin recommendation. Eval harness and cycle replay paths updated with comments. Drift compensation (epsilon, confirmation) remains in place.
- **B6 (Fix 9)**: Proposed rules now carry `evidence_submission_count` / `evidence_occurrence_count` recomputed in `validateImprovementLlmOutput` from the passed `sourceCorrections` (Map by (o→c) pair using unique submission_ids). LLM-provided counts are ignored. On proposal page, `evidence_submission_count <= 1` renders an amber "single-submission evidence" badge (reuses `.no_effect` style) with tooltip guidance. Checkbox defaults to checked unless `IMPROVE_THIN_RULE_UNCHECKED` is truthy. Jest coverage for recompute + view rendering of badge + conditional default. Optional env documented in .env.example.
- **B7 (Fix 8, completed in Track B review follow-ups)**: Full `--consolidate` implemented (dedicated `CONSOLIDATION_SYSTEM_PROMPT` in core, skips corrections/replay/excerpts/prior-rejection, context = prompt+manifest only; validator relaxes short/growth checks and warns on <5% or >50% reduction and drops rules/recs; evalStatus branches to `passed` iff 0 confirmed regressions). `--ablate-sections` now drives real limited re-runs via `omitSections` plumbed through `buildFinalPrompt` / `runFullReviewPipeline` / review-eval evaluator, emits per-section delta table in report.md (near-zero = consolidation candidate). Payload shaping extracted to pure `buildImprovementLlmPayload` (tested o-series vs non). Truncation check + `IMPROVE_MAX_COMPLETION_TOKENS` docs added. All per findings.
- **B8 (Fix 11)**: Design doc only — see `docs/design-docs/retrieval-few-shot.md`. Covers embedding at save time, retrieval injection as examples (not rules), eval determinism + cache-key requirements (prompt hash must incorporate the retrieved set), k/threshold tuning, and cost. No implementation.
- **Follow-up 2 (P1)**: Freeform corrections (empty original+corrected) are tagged `not_verifiable` during replay assembly and never contribute to `unresolved_still_missed`. `decideReplayStatus` and the prompt rendering / validator were updated; system prompt documents the tag.
- **Follow-up 3 (P2)**:
  - Removed dead `opts.promptUnchanged` parameter from `evalStatusFromSummary`.
  - Prior-rejection feedback now requires submission-id intersection (by querying `correction_rules` for the rejected cycle) before including notes; falls back to date overlap only for rows with no linked corrections.
  - Degrade insert retry matches on either `replay_evidence` or `unresolved_still_missed`.

All changes include jest coverage for the new pure helpers and updated behaviors.

## July 2026 Track B batch (B0–B8)

Implemented by the coding agent per the handoff in `docs/improvement-loop-next-steps.md`:

- B0: `confirmed_delta` formalized in reports + cycle + tests.
- B1: `no_effect` amber chip + history column + CHECK migration.
- B2: `coverage_claims` (verbatim + replay outranks).
- B3: centered excerpt windows (lib + cycle).
- B4: reasoning default (`o3`) + call adaptation.
- B5: dated snapshot pinning + report `model`.
- B6: thin-evidence badges (recomputed counts).
- B7 (partial): length tracking, budget warn, consolidate gate bypass + source, ablate stub.
- B8: retrieval few-shot design doc only (`retrieval-few-shot.md`).

Docs updated in same change set; 61 core+view tests; tsc clean. Live verification (Track A) remains human-only against real Supabase+OpenAI.

## July 2026 Proposal-clarity + guard-retry batch (C1–C5)

Implemented per the handoff in `docs/improvement-loop-proposal-clarity-fixes.md`. Motivated by the consolidation run whose analysis described a "44% reduction" the fence guard had discarded, leaving a proposal whose analysis, verdict, and diff disagreed.

- **C1 — retry-with-feedback on guard discard.** The LLM call is now driven by `runImprovementProposalWithRetry` (pure, jest-tested over an injected `callLlm`). When validation ends `promptUnchanged` because of a **guard** (broken code-fence structure or echoed input context — `promptUnchangedReason` distinguishes these from the model's own `UNCHANGED` sentinel), the cycle re-calls up to `IMPROVE_MAX_RETRIES` (default 2) with a corrective addendum quoting the exact guard warning and the required fence count. Each attempt's warnings accumulate labeled `attempt N/M`. Both system prompts now state that every fenced block must be preserved byte-identical, and the exact fence count is injected into the user prompt at assembly time (`buildFencePreservationNote`). On exhaustion the prompt stays unchanged and disposition is `no_change_guard_discarded`; discarded rewrites are written to `tmp/.../discarded_prompt_attempt<N>.txt` (never the DB).
- **C2 — honest disposition.** A code-computed `disposition` (`prompt_change | rules_only | code_recs_only | rules_and_prompt | no_change_model_declined | no_change_guard_discarded`) leads the proposal page and email in plain language. The guard-discarded analysis renders collapsed under an explicit "describes a DISCARDED rewrite" label. The page shows prompt length before→after computed from the actual strings (never model-claimed sizes). When the candidate is byte-identical to baseline **and** has no replacement rules, the candidate eval is skipped entirely (`shouldSkipCandidateEval`) and the verdict is `no_effect` with note `eval skipped: candidate identical to baseline`. Migration `20260711_add_prompt_proposal_disposition_routing.sql`.
- **C3 — per-correction routing table.** The LLM must emit a `correction_routing` entry for every source correction (`correction_id` is now shown in the context). `validateCorrectionRouting` enforces completeness (missing ids → synthesized `unrouted` + warning), blocks `still_missed` corrections from `dismissed`/`already_correct` (feeds `unresolved_still_missed`), allows `already_correct` only when replay is `now_correct`, and cross-checks `replacement_rule` lanes against the rules that survived validation (dropped-rule → `unrouted`). Rendered as a "What happened to each correction" table at the top of the page and a compact table in the email. Same migration adds the `correction_routing` JSONB column.
- **C4a — freeform-guidance lane inference.** The system prompt now explicitly tells the model to synthesize a deterministic rule from freeform guidance when it implies an always-safe swap, setting `inferred_from_guidance: true`; the validator passes the flag through, applies the same safety checks, and adds a "verify the exact strings" warning. The page badges such rules "inferred from guidance".
- **C4b — example capture.** The `/learning` add-rule form has optional "Example — text as it appeared / corrected text" fields; stored on `correction_rules.example_original` / `example_corrected` (exact rules reuse their own before/after and leave these null). Replay tagging matches a freeform rule on its example pair so it becomes `still_missed`/`now_correct` instead of `not_verifiable`, and the model is told to prefer the human's example strings over its own inference. Pending-rules and routing tables show a `verifiable` / `guidance only` badge. Migration `20260711_add_correction_rule_examples.sql` (adds `example_original`, `example_corrected`, `inferred_from_guidance`).
- **C5 — consolidation fence discipline.** `CONSOLIDATION_SYSTEM_PROMPT` carries the same byte-identical fence-preservation rule, and consolidation runs through the C1 retry path — the fix for the 0-for-2 fence-guard deaths. **The live acceptance run (Docker `--consolidate` producing one shorter, eval-passing proposal) is human-only and not yet done.**

**Required manual step:** apply `supabase/migrations/20260711_add_prompt_proposal_disposition_routing.sql` and `20260711_add_correction_rule_examples.sql` in the Supabase SQL editor. Both the cycle insert and the `correction_rules` insert degrade gracefully (strip the new columns + log a migration warning) until they are applied; `CRITICAL_SUPABASE_SCHEMA` lists the new columns so startup raises a `supabase_schema_drift` alert if they are missing.

Docs updated in same change set; new C1–C4 unit + view tests (112 dashboard core/view/learning tests green); tsc clean across dashboard + db. Pre-existing `review-pipeline.test.ts` failures are unrelated.
