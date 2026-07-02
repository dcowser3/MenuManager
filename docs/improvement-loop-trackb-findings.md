# Track B Review Findings (B0–B8)

> Status: Handoff, July 2026
> Context: [improvement-loop-next-steps.md](improvement-loop-next-steps.md) (Track B specs), [improvement-loop-fix-specs.md](improvement-loop-fix-specs.md) (original specs)
> Review result: B0, B1, B2, B3, B5, B6, B8 verified correct (61/61 tests confirmed independently, syntax clean, migrations idempotent, degrade patterns followed). Three findings below. Finding 0 is ALREADY FIXED — do not redo it, but complete the remaining sub-tasks.

---

## Finding 0 — [ALREADY FIXED] B4 default (`o3`) would have failed every API call: `max_tokens` is rejected by o-series models

### What happened

`callImprovementLlm` sent `max_tokens: 16000` unconditionally. OpenAI's o-series reasoning models reject `max_tokens` with a 400 (`Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`). With the new default `IMPROVE_MODEL || PROMPT_REWRITE_MODEL || 'o3'`, **every nightly cycle would have thrown `OpenAI API error 400` at step 7 and produced no proposal** — the exact same failure class as the Fix 2 TDZ bug: shipped "verified" because unit tests and tsc can't see an API-contract error, and it would only surface in the cron log.

Second-order issue fixed in the same edit: for reasoning models, the completion budget also pays for hidden reasoning tokens. 16k could truncate the visible JSON (which must contain a full ~22k-char rewritten prompt).

### The fix (already applied in `scripts/improvement-cycle.js`)

- Non-reasoning models: `max_tokens: 16000` + `temperature: 0.2` (unchanged behavior).
- Reasoning models: `max_completion_tokens` (default 32000, overridable via new env `IMPROVE_MAX_COMPLETION_TOKENS`), no `temperature`.
- `response_format: { type: 'json_object' }` kept for both.

### Remaining sub-tasks

1. Extract the payload-shaping into a pure function (e.g. `buildImprovementLlmPayload(model, systemPrompt, userPrompt, env)` in `improvement-cycle-core.ts`) and add jest cases: o-series → has `max_completion_tokens`, no `max_tokens`, no `temperature`; non-reasoning → the reverse. This is the second time an untestable inline block in the script hid a run-killing bug — stop leaving logic inline in the script.
2. Document `IMPROVE_MAX_COMPLETION_TOKENS` in `docs/environment.md` + `.env.example`.
3. Also check truncation explicitly: if `data.choices[0].finish_reason === 'length'`, throw a clear error (`LLM output truncated — raise IMPROVE_MAX_COMPLETION_TOKENS`) instead of letting truncated JSON fail as "non-JSON output".

### Acceptance criteria

- Jest payload tests as above; env docs updated; a truncated-response fixture produces the clear error.

---

## Finding 1 — `--consolidate` does not consolidate (stub shipped behind a real flag)

### Problem

As implemented, `--consolidate` only (a) bypasses the correction gate and (b) relabels the proposal `source: 'consolidation'`. It still sends the **normal corrections-driven system prompt** — with what will usually be an empty corrections list — so the LLM is asked to "propose improvements from these corrections" with no corrections and no instruction to shrink anything. The output will be a confused near-no-op *labeled* as a consolidation. Worse, the new budget warning actively tells the operator to run this flag ("run with --consolidate to produce a concision proposal"), pointing users at a feature that doesn't exist. A mislabeled half-feature is worse than no feature.

### Spec (finish per the original Fix 8 spec — this was the core of it)

1. Add a dedicated `CONSOLIDATION_SYSTEM_PROMPT` in `improvement-cycle-core.ts`: rewrite the prompt for concision and structure; merge redundant rules; convert repeated abstract instructions into one rule + one example; remove nothing without an equivalent; target ≥15% reduction; same JSON output shape (analysis + proposed_prompt; `proposed_replacement_rules`/`code_recommendations` expected empty and dropped with a warning if present).
2. In consolidate mode: skip corrections fetch, replay evidence, excerpt windows, and prior-rejection context entirely (none apply); context = effective prompt + rules manifest only.
3. Validator adjustments for this mode: the `<500 chars` and shrinkage warnings must not fire for legitimate reduction; instead warn if reduction is <5% (pointless run) or >50% (suspicious); the code-fence structure check stays.
4. Eval gate: full baseline-vs-candidate run as today; verdict for consolidation ignores trigger progression (there are no triggers) — `passed` = zero confirmed regressions. Extend `evalStatusFromSummary` or branch on `source`.
5. Until all of the above lands, if any part must ship separately: remove the flag and the budget-warning hint rather than leaving the stub reachable.

### Acceptance criteria

- `--consolidate` run produces a proposal whose prompt is measurably shorter, with `source: 'consolidation'`, `passed` iff zero confirmed regressions, reviewable on the normal page.
- Jest: mode-specific validator behavior and verdict branch.

---

## Finding 2 — `--ablate-sections` lists sections; it does not ablate

### Problem

The implementation prints the `QA_PROMPT_SECTIONS` registry and instructs the human to "re-run with the section removed" manually. The spec was: for each section, run the eval with that section removed and report the per-section composite delta. As shipped it's a `console.log` of metadata — harmless, but it must not be described as an ablation diagnostic.

### Spec

1. In `review-eval.js`, when `--ablate-sections` is set: first run the full-prompt baseline (or reuse `--baseline`), then loop over `QA_PROMPT_SECTIONS`, building the prompt with that section omitted (add an `omitSections: string[]` option to `buildFinalPrompt` in `qa-prompt-builder.ts` — plumb it through `runFullReviewPipeline` opts), run the eval per ablation, and emit a table: section id, avg composite delta vs full prompt, cases affected.
2. Respect `--limit` for cost; the response cache makes repeats cheap. Note in the report that near-zero delta marks a consolidation candidate (feeds Finding 1).
3. Jest for the `omitSections` prompt-builder behavior (section present/absent); the eval loop itself is covered by a `--limit 1 --no-ai` smoke.

### Acceptance criteria

- `npm run review:eval -- --ablate-sections --limit N` produces a per-section delta table in the report markdown, not a listing.

---

## Process note (for every future batch)

Two batches in a row have shipped a run-killing bug (TDZ, `max_tokens`) plus stubs summarized as complete. Two standing rules going forward:

1. **Any logic added to `scripts/*.js` must live in a jest-covered lib** (`improvement-cycle-core.ts` or a sibling) with the script as a thin caller. Inline script logic is where both P0s hid.
2. **Summaries must separate "implemented" from "stubbed/deferred" in the headline**, not in fine print. If a flag exists but the feature doesn't, the flag ships disabled or not at all.
