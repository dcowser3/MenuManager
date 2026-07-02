# Improvement-Loop Fix Specifications

> Status: Handoff specs, not yet implemented (July 2026)
> Context: [automated-improvement-loop.md](design-docs/automated-improvement-loop.md)
> Audience: coding agent (Cursor) + reviewer

## Background / root finding

The daily improvement cycle (`scripts/improvement-cycle.js` + `services/dashboard/lib/improvement-cycle-core.ts`) is architecturally sound: corrections → LLM proposal with lane discipline → eval gate → human approval. But **the eval gate can only prove a proposal does no harm; nothing proves it does any good.**

Concrete evidence, from `tmp/improvement-cycle/2026-06-13/`:

- The LLM analysis claimed the sunny-side-up-asterisk and veggies→vegetables corrections were "already covered … the deterministic rules already handle these cases effectively" — despite those corrections being the literal evidence the first pass got them wrong.
- The eval result was `improved: 0, regressed: 0, same: 80` with baseline and candidate composites identical to 8 decimal places — a provably zero-effect proposal — and it received `eval_status: "passed"`.

The existing mitigation (`looksLikeNoOpPromptAnalysis` regex warning in `improvement-cycle-core.ts` + "no-op discipline" wording in `IMPROVEMENT_SYSTEM_PROMPT`) is a nudge, not a mechanism: the model can phrase a no-op differently, and no code ever tests whether "already covered" is true.

Fixes 1–3 are the structural repairs (P0). Fixes 4–7 are high-value hardening (P1). Fixes 8–11 are longer-horizon (P2). Dependencies: Fix 2 shares replay infrastructure with Fix 1 — implement 1 first, then 2 on top of it. Fix 4 falls out of Fix 1's verdict changes. Everything else is independent.

Key files referenced throughout:

| File | Role |
|------|------|
| `scripts/improvement-cycle.js` | Nightly cycle: gate, context assembly, LLM call, eval, proposal insert |
| `services/dashboard/lib/improvement-cycle-core.ts` | Testable core: gating, validation, eval summarization, system prompt |
| `scripts/review-eval.js` | Eval harness (`npm run review:eval`): dataset build, replay, scoring, baseline compare |
| `services/differ/lib/eval-scoring.ts` | `scoreCorrections`, `classifyConfirmedRegression` |
| `services/dashboard/lib/review-pipeline.ts` | `runFullReviewPipeline` (offline replay of the production pipeline) |
| `services/dashboard/index.ts` | `/api/learning/prompt-proposal/:id/review` route (~line 2397) |
| `services/dashboard/views/` (prompt-proposal EJS) | Proposal review page |
| `sop-processor/qa_prompt.txt` | Base QA prompt (21.8k chars as of June 2026) |

---

## Fix 1 (P0) — Progression testing: the eval must prove the proposal fixes the triggering cases

### Problem

`runEvalHarness` in `improvement-cycle.js` (step 8) replays the historical dataset for **regressions only**. The submissions whose corrections *triggered* the cycle are never specifically checked. `evalStatusFromSummary` (`improvement-cycle-core.ts`) returns `"passed"` whenever `regressed === 0` — so a proposal that changes nothing at all passes. "Passed" currently means "did no harm," never "fixed the problem."

### Spec

1. **Ensure trigger cases exist in the dataset.** The cycle already collects `submissionIds` from the unconsumed `correction_rules` (step 2, `improvement-cycle.js` ~line 411). Production eval cases are keyed `production:<legacy_id || id>` (`buildProductionCases` in `review-eval.js` ~line 292–345). Before running the eval:
   - Check the cached dataset (`tmp/review-eval/dataset.jsonl`, loaded via `loadDataset`) for each trigger submission's case id.
   - For any missing trigger, build its case on the fly using the same logic/fallback chain as `buildProductionCases` (raw input from `basic_ai_check_audits.menu_content_raw` via `form_attempt_id`, falling back to `ai_request.text` then `submissions.menu_content`; ground truth = `submissions.approved_menu_content`) and append it to the dataset file.
   - If a trigger case cannot be built (e.g. no approved final yet), record it as `trigger_unavailable` in the summary rather than failing the run.
2. **Score triggers explicitly.** After the baseline and candidate runs, extract each trigger case's per-case composite from both reports (`caseReports` keyed by `case_id`) and build a `triggers` block on `eval_summary`:
   ```json
   {
     "triggers": [
       { "case_id": "production:123", "submission_id": "…",
         "baseline_composite": 0.71, "candidate_composite": 0.94,
         "delta": 0.23, "status": "improved" }
     ],
     "triggers_improved": 1, "triggers_unchanged": 0, "triggers_regressed": 0, "triggers_unavailable": 0
   }
   ```
   Classify with the same noise epsilon the baseline compare uses (default 0.02): `improved` if delta > epsilon, `regressed` if delta < −epsilon, else `unchanged`. Types go in `ProposalEvalSummary` (`improvement-cycle-core.ts`).
3. **Redefine the verdict.** Update `evalStatusFromSummary`:
   - `regressed` — confirmed regressions exist (unchanged behavior).
   - `passed` — no confirmed regressions AND at least one trigger improved.
   - `no_effect` (new) — no confirmed regressions, no trigger improved, and (`promptUnchanged` or `avgDelta ≈ 0`). See Fix 4 for surfacing.
   - `failed` / `skipped` — unchanged.
   A proposal whose analysis claims fixes but whose trigger deltas are all ~0 must not be labeled `passed`.
4. **Surface it.** Proposal page: render the `triggers` table (case, baseline, candidate, delta, status) above the regression table. Notification email subject should carry the verdict (e.g. `[no_effect]`).

### Notes

- Trigger submissions are recently approved, so most will resolve via the standard dataset contract; the on-the-fly path covers dataset-cache staleness.
- Do not exclude trigger cases from the regression set — they serve both roles.
- `ProposalEvalSummary.error` handling and `--skip-eval` behavior are unchanged; with eval skipped, verdict stays `skipped`.

### Acceptance criteria

- A cycle run whose candidate output is byte-identical to baseline yields `eval_status: "no_effect"`, never `"passed"`.
- Every proposal's `eval_summary.triggers` lists one entry per distinct trigger submission (or `trigger_unavailable`).
- The proposal page shows the trigger table; jest coverage for the new `evalStatusFromSummary` matrix and trigger classification in `improvement-cycle-core` tests.

---

## Fix 2 (P0) — Pre-analysis replay: distinguish "rule missing from prompt" vs "rule present but ignored"

### Problem

When a reviewer correction exists, there are two very different diagnoses: (a) the prompt/rules never covered it, or (b) coverage exists but the review model didn't follow it (likely in a 21.8k-char prompt on `gpt-4o-mini`). The improvement LLM currently cannot tell them apart — which is exactly how "it's already in the prompt, no change needed" happens for a case the pipeline demonstrably got wrong. The fixes differ: (a) wants prompt/rule additions; (b) wants restructuring, few-shot examples, a code guard, or an escalation recommendation — more prompt text is the *wrong* medicine for (b).

### Spec

1. **Replay before analysis.** In `improvement-cycle.js`, after assembling corrections (step 2) and before the LLM call (step 7): for each distinct trigger submission, run the current pipeline (`runFullReviewPipeline` from `services/dashboard/lib/review-pipeline.ts`, with the effective prompt + live accepted rules — reuse the eval harness's AI caller and `tmp/review-eval/cache/` so replays are cached and cheap; the Fix 1 trigger-case builder provides the raw input).
2. **Diff the replay per correction.** For each unconsumed correction row on that submission, determine whether the replayed output already contains the human's `corrected_text` at the correction site (reuse the replacement-signal extraction from `scoreCorrections` in `services/differ/lib/eval-scoring.ts` rather than naive substring matching). Tag each correction:
   - `still_missed` — replay reproduces the original miss. Any "already covered" claim for this correction is false by evidence.
   - `now_correct` — replay produces the human's fix. The original miss was nondeterminism drift, or an already-landed rule/prompt change covers it.
   - `replay_unavailable` — no raw input.
3. **Feed the evidence to the LLM.** In the corrections section of the user prompt, annotate every correction with its replay tag, e.g. `REPLAY EVIDENCE: still_missed — the current pipeline reproduces this mistake as of this run.` Update `IMPROVEMENT_SYSTEM_PROMPT` (`improvement-cycle-core.ts`):
   - A correction tagged `still_missed` MUST result in a concrete change (prompt sharpening, replacement rule, or code recommendation). Claiming existing coverage for it is prohibited.
   - A correction tagged `now_correct` MAY be left unaddressed, but the analysis must cite the replay evidence as the reason.
   - When coverage exists but the replay still fails, the model should prefer restructuring/example-based prompt changes or a code recommendation (guard) over appending another abstract rule, and should say which it chose and why.
4. **Validate against the evidence.** Extend `validateImprovementLlmOutput` signature with `opts.replayEvidence: Array<{ correction_id: string; status: 'still_missed'|'now_correct'|'replay_unavailable' }>`. If `promptUnchanged` is true and no replacement rule or code recommendation references a `still_missed` correction, escalate from the current soft regex warning to a hard warning stored on the proposal AND set a new boolean `unresolved_still_missed: true` that the proposal page renders as a red banner. (Keep it human-gated rather than auto-rejecting — but the reviewer must see it.)
5. **Persist.** Store the replay results as `replay_evidence` (JSONB) on the proposal row and in `tmp/improvement-cycle/<cycle>/replay_evidence.json`. Requires a small migration: `ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS replay_evidence JSONB;` — follow the degrade-gracefully pattern used for `llm_warnings` (insert without the column + log a migration warning if missing).

### Acceptance criteria

- Cycle context (visible via `--dry-run` in `user_prompt.txt`) shows a replay tag on every correction.
- A synthetic test where the replay still misses and the LLM returns `UNCHANGED` with no covering rule/recommendation produces `unresolved_still_missed: true` and the banner.
- Replays hit the eval cache on repeat runs (no duplicate OpenAI spend).
- Jest coverage for tagging logic and the validator extension.

---

## Fix 3 (P0) — Rejecting a proposal must not burn the evidence

### Problem

Corrections are stamped consumed (`prompt_cycle_id`, `consumed_at`) when the proposal is **stored** (`improvement-cycle.js` ~line 613). The review route (`/api/learning/prompt-proposal/:id/review`, `services/dashboard/index.ts` ~line 2397) has **no un-consume path on rejection**. Rejecting a bad proposal (e.g. the June no-op) permanently removes its corrections from all future cycles — the loop forgets the exact evidence it most needs to retry on.

### Spec

1. **On `status: 'rejected'`**, after the proposal status update succeeds: reset `prompt_cycle_id = null, consumed_at = null` on all `correction_rules` rows where `prompt_cycle_id` equals the proposal's `cycle_id` — EXCEPT rows created *by* proposal approval (`submission_id LIKE 'proposal-%'` / `source: 'system'`), which are outputs, not evidence. Route this through the db service like the rest of the dashboard's writes (add a db-service endpoint if none exists; do not have the dashboard write Supabase directly).
2. **Carry the rejection forward.** When the next cycle picks up corrections that were previously part of a rejected proposal, include the rejected proposal's `reviewer_notes` and its analysis summary in the LLM context: `PRIOR ATTEMPT REJECTED — reviewer notes: "…"`. Implementation: query `prompt_proposals` for rejected rows whose date range overlaps the corrections being re-consumed; match on submission ids. This creates the feedback channel that currently doesn't exist — today a rejection teaches the system nothing.
3. **Encourage notes.** On the proposal page, make `reviewer_notes` strongly encouraged for rejections (UI nudge, e.g. confirm dialog when empty: "Notes are fed to the next cycle — rejecting without notes wastes the signal."). Do not hard-require.

### Acceptance criteria

- Reject a proposal → its source corrections reappear in the next cycle's gate count; approval-inserted `proposal-*` rules do not.
- Next cycle's `--dry-run` context contains the prior rejection notes.
- Jest coverage: rejection un-consume (including the `proposal-%` exclusion) and re-consume with prior-rejection context.

---

## Fix 4 (P1) — First-class `no_effect` verdict in UI, email, and history

### Problem

Even after Fix 1's verdict change, the surfaces need updating; today `passed` is rendered as a green success everywhere, which is how a zero-effect proposal looked trustworthy.

### Spec

1. `evalStatusFromSummary` returns `no_effect` per Fix 1. Update every consumer of `eval_status`:
   - Proposal page verdict chip: distinct color (amber) + text "No measurable effect — candidate output identical/near-identical to baseline on all cases including triggers."
   - Cycle notification email subject: `Review-improvement proposal (<cycle>) — NO EFFECT` variant.
   - Pending-proposal reminder email (`buildPendingProposalReminderEmail`) renders the status verbatim (already does — verify).
2. Add `eval_status` to the proposal history/list view (if the `/learning` page lists past proposals) so no-effect proposals are auditable over time.
3. Check for a DB CHECK constraint or enum on `prompt_proposals.eval_status` in migrations; if constrained, add a migration admitting `no_effect`.

### Acceptance criteria

- A no-effect proposal is visually distinct from `passed` on the page and in email subject; jest snapshot/unit coverage on the email builder and verdict mapping.

---

## Fix 5 (P1) — Coverage claims must be falsifiable: cite the exact prompt lines

### Problem

When the LLM claims existing coverage, nothing verifies the claim. `looksLikeNoOpPromptAnalysis` only pattern-matches the analysis wording.

### Spec

1. Extend the required LLM output schema (in `IMPROVEMENT_SYSTEM_PROMPT` JSON shape) with:
   ```json
   "coverage_claims": [
     { "correction_id": "…", "prompt_quote": "exact contiguous text copied from the current prompt", "explanation": "why this covers the correction" }
   ]
   ```
   Instruct: any assertion that a correction is already handled by the prompt MUST appear here with a verbatim quote; deterministic-rule coverage must instead cite the manifest rule id.
2. In `validateImprovementLlmOutput`: for each claim, verify `prompt_quote` is a substring of the current prompt after whitespace normalization (collapse runs of whitespace before comparing). Invalid quote → drop the claim + hard warning `coverage claim for <correction_id> cites text not present in the prompt`.
3. Combine with Fix 2: a validated quote does NOT legitimize a no-op for a `still_missed` correction — replay evidence outranks citation. A valid citation + `still_missed` is precisely diagnosis (b) ("present but ignored") and should push toward restructuring/code-guard changes; say so in the system prompt.
4. Render surviving claims on the proposal page under each correction ("Model cites: '…'").

### Acceptance criteria

- Fabricated quotes are dropped with a warning (jest test with a fake quote).
- Valid quotes render on the proposal page.
- A `still_missed` + valid-citation combination still triggers the Fix 2 banner if nothing changes.

---

## Fix 6 (P1) — Excerpt windows centered on the correction site, not the top of the document

### Problem

Document excerpts sent to the improvement LLM are `aiText.slice(0, 600)` / `finalText.slice(0, 600)` (`improvement-cycle.js` ~lines 445–446). If the corrected dish is on page 2, the model literally never sees the context of the miss — a plausible direct contributor to shallow "already covered" analyses.

### Spec

1. Replace the head-slices with per-correction windows: for each correction on the submission, locate `original_text` in the AI-draft text and `corrected_text` in the approved text (first case-insensitive occurrence; fall back to diacritic-stripped matching, then to the head slice with a `(correction site not found)` marker).
2. Emit a window of ±300 chars around each hit, trimmed to line boundaries, labeled with the correction id:
   ```
   **Correction 3 site — AI draft:** …Grilled Salmon* / radishes, fennel…
   **Correction 3 site — Human final:** …Grilled Salmon* / radish, fennel…
   ```
3. Deduplicate overlapping windows; cap total excerpt budget per submission (e.g. 4,000 chars) and per cycle (e.g. 40,000 chars), preferring one window per correction over multiple windows for one correction.
4. Keep a short head slice (200 chars) per document for orientation (menu title/structure).

### Acceptance criteria

- `--dry-run` context shows a window containing the corrected text for a correction located deep in a long menu (test fixture).
- Budget caps enforced; jest coverage for locate/fallback/dedupe logic (extract into `improvement-cycle-core.ts` as a pure function so it's testable).

---

## Fix 7 (P1) — Upgrade the analysis model to a reasoning-class model

### Problem

`IMPROVE_MODEL` defaults to `gpt-4o` (`improvement-cycle.js` line 128). The cycle asks it to do genuinely hard meta-reasoning — lane routing, contradiction resolution, prompt surgery over ~25k chars of context — once per day. This is the single cheapest quality lever in the system: one call/day means even the most expensive reasoning model is negligible spend.

### Spec

1. Change the default chain to a current reasoning-class OpenAI model (whatever tier the org has access to at implementation time), keeping `IMPROVE_MODEL` as the override: `IMPROVE_MODEL || PROMPT_REWRITE_MODEL || <reasoning-default>`.
2. Reasoning models constrain/ignore some parameters (`temperature`, JSON mode differs by model family) — adjust `callImprovementLlm` accordingly and keep strict-JSON parsing with the existing non-JSON error path.
3. Log model + reasoning-token usage in the cycle log; store on the proposal (`llm_model` already exists).
4. Update `docs/environment.md` and the design doc.

### Acceptance criteria

- Cycle runs end-to-end with the new default; `--dry-run` unaffected; proposal row records the model actually used.

---

## Fix 8 (P2) — Counterweight the prompt-bloat ratchet: consolidation mode + length tracking + section ablation

### Problem

The prompt only ever grows (21,810 chars and climbing). The validator warns at >1.6× growth per proposal but nothing ever shrinks or restructures it. The Fix 2/no-op-discipline changes add pressure to *always* change something. Longer prompts degrade instruction-following in the review model — the loop's own additions can cause the next generation of misses. There is no mechanism to detect dead-weight sections.

### Spec

1. **Length tracking:** store `prompt_length` on every proposal row; render a small sparkline/trend on the proposal page. Emit a cycle warning when the effective prompt exceeds a configurable budget (`IMPROVE_PROMPT_BUDGET_CHARS`, default 24,000).
2. **Consolidation mode:** `node scripts/improvement-cycle.js --consolidate` (manual/monthly, never part of the nightly cron):
   - Skips the corrections gate; sends the effective prompt + manifest with a dedicated system prompt: *rewrite for concision and structure; merge redundant rules; convert repeated abstract instructions into one rule + one example; remove nothing without an equivalent; target ≥15% reduction.*
   - Runs the full eval (baseline vs consolidated, back-to-back regression confirmation as today) and — after Fix 1 — requires zero confirmed regressions.
   - Produces a normal `prompt_proposals` row (`source: 'consolidation'`) through the same human-approval page. No new approval surface.
3. **Section ablation (diagnostic, not gating):** `npm run review:eval -- --ablate-sections` — for each entry in the `QA_PROMPT_SECTIONS` registry (`qa-prompt-builder.ts`), run the eval with that section removed and report per-section composite delta vs the full prompt. Sections with ~0 delta are consolidation candidates. Cache makes repeat runs cheap; cap with `--limit` for cost. Output an extra table in the eval report markdown.

### Acceptance criteria

- Proposal rows carry `prompt_length` (migration, degrade-gracefully pattern); trend visible.
- `--consolidate` produces a reviewable proposal with eval verdict; jest coverage for the mode's gating bypass and source labeling.
- `--ablate-sections` emits a per-section delta table.

---

## Fix 9 (P2) — Badge thin-evidence rules on the proposal page

### Problem

The gate default is `IMPROVE_MIN_NEW_CORRECTIONS = 1`, and rules get minted from single submissions (June proposal: `radishes → radish`, "seen 2x across 1 submissions"). The human gate makes this survivable, but the reviewer isn't told how thin the evidence is at decision time.

### Spec

1. When building `proposed_replacement_rules` context, the cycle already counts occurrences/submissions (the "seen Nx across M submissions" text). Make this structured: add `evidence_submission_count` and `evidence_occurrence_count` to each proposed rule (extend `ProposedReplacementRule`; have the LLM echo counts from the context, but recompute them in validation from the actual correction rows — never trust the LLM's arithmetic).
2. Proposal page: rules with `evidence_submission_count === 1` render an amber "single-submission evidence" badge; the checkbox for such rules is still checked by default (unchanged behavior), but the badge text notes: "Consider whether this generalizes beyond this one menu."
3. Optional env `IMPROVE_THIN_RULE_UNCHECKED=1` to default-uncheck thin rules.

### Acceptance criteria

- Recomputed counts stored on the proposal; badge renders for single-submission rules; jest coverage for the recomputation.

---

## Fix 10 (P2) — Pin a dated eval-model snapshot to shrink temporal drift

### Problem

The eval harness fights severe temporal drift on `gpt-4o-mini` at temp 0 (documented in the design doc: identical configs 12 minutes apart moved −6.27pp with false regressions), compensated by noise epsilons and back-to-back confirmation re-runs. Floating model aliases receive silent server-side updates; dated snapshots drift less. Less noise = fewer confirmation re-runs = cheaper, faster, more trustworthy evals.

### Spec

1. Set `REVIEW_EVAL_MODEL` guidance (docs + `.env.example` if present) to a dated snapshot (e.g. `gpt-4o-mini-2024-07-18`-style pinning, whichever snapshot matches production's `AI_REVIEW_MODEL` behavior). If production review uses a floating alias, pin BOTH to the same dated snapshot and upgrade deliberately — eval fidelity requires eval model == production review model.
2. Record the resolved model string in every eval report (`report.json`) — verify it's already there; add if not.
3. Keep all existing drift machinery (epsilon, confirmation) — this reduces the noise, it doesn't eliminate it.

### Acceptance criteria

- Eval reports show the pinned model; docs updated; a note added to the design doc's drift section.

---

## Fix 11 (P2, design exploration — not a mechanical task) — Retrieval-based few-shot corrections in the review prompt

### Problem / opportunity

Every lesson currently lands in one static, ever-growing prompt (see Fix 8). The corrections dataset is the system's most valuable asset, and it scales — the prompt doesn't. Retrieval inverts this: per incoming menu, inject only the most relevant past corrections as few-shot examples.

### Sketch (needs a design pass before implementation)

1. Embed each accepted correction (original → corrected + reviewer explanation) once at save time; store vectors in Supabase (pgvector) keyed by correction id.
2. At review time (`buildFinalPrompt` in `qa-prompt-builder.ts`), embed the incoming menu text, retrieve top-k (k≈8) corrections by similarity with a distance threshold, and inject them as a clearly delimited "Recent reviewer precedents" section — examples, not rules.
3. The eval harness must replay with the same retrieval (index snapshot per eval run) or evals stop being reproducible — this is the hard part and why this fix needs design work before code.
4. Interaction with lane discipline: retrieved precedents complement, not replace, deterministic rules; context-dependent terms (tartare/berry) benefit most since examples carry context that abstract rules can't.

### Acceptance criteria (for the design doc, not code)

- A design doc in `docs/design-docs/` covering: retrieval determinism in eval, cache-key changes (prompt hash must include retrieved set), k/threshold tuning against the eval harness, and cost.

---

## Cross-cutting requirements (apply to every fix)

Per [AGENTS.md](../AGENTS.md):

1. **Tests:** jest coverage for all new pure logic — put testable logic in `improvement-cycle-core.ts` (or a new sibling lib), not in the script. Existing pattern: `services/dashboard/__tests__/`.
2. **Docs:** update [design-docs/automated-improvement-loop.md](design-docs/automated-improvement-loop.md) in the same change set as each fix (verdict semantics, replay evidence, rejection re-queue, consolidation mode). Update `docs/environment.md` for every new/changed env var (`IMPROVE_PROMPT_BUDGET_CHARS`, `IMPROVE_THIN_RULE_UNCHECKED`, model defaults).
3. **Migrations:** new columns needed — `prompt_proposals.replay_evidence JSONB` (Fix 2), `prompt_proposals.prompt_length INT` (Fix 8); possibly an `eval_status` constraint update (Fix 4). Follow the existing degrade-gracefully insert pattern (see the `llm_warnings` handling in `improvement-cycle.js`) and add any load-bearing columns to `CRITICAL_SUPABASE_SCHEMA` in `services/db/index.ts`. Migrations must be applied manually in the Supabase SQL editor (documented pattern).
4. **Manifest:** none of these fixes add review rules/guards, so no `rules:manifest` regeneration expected — but if any fix adds a prompt section via `QA_PROMPT_SECTIONS`, regenerate.
5. **Verification:** Docker-first (`./dev-up.sh`); verify the cycle end-to-end with `docker compose exec dashboard node /app/scripts/improvement-cycle.js --dry-run` and then a real forced run against a test proposal; verify the proposal page renders the new trigger table / banners / badges with a live browser check.
6. **Cost control:** Fixes 1–2 add replay calls — they must share `tmp/review-eval/cache/` and respect `IMPROVE_EVAL_LIMIT`.

## Suggested implementation order

1. Fix 1 (progression testing) — unlocks honest verdicts; largest single payoff.
2. Fix 2 (replay evidence) — builds directly on Fix 1's trigger-case infrastructure.
3. Fix 3 (rejection un-consume) — small, independent, stops ongoing evidence loss; can be done first if preferred.
4. Fix 4 (no_effect surfacing) — trivial once Fix 1 lands.
5. Fixes 5–7 (citations, excerpt windows, model upgrade) — independent of each other.
6. Fixes 8–10 as capacity allows; Fix 11 starts as a design doc only.
