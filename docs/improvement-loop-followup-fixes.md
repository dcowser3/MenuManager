# Improvement-Loop Follow-up Fixes (review findings on the Fix 1–3 implementation)

> Status: Handoff specs, July 2026
> Context: [improvement-loop-fix-specs.md](improvement-loop-fix-specs.md) (original specs), [design-docs/automated-improvement-loop.md](design-docs/automated-improvement-loop.md)
> These are findings from a code review of the implemented P0 fixes. Follow-up 0 is ALREADY FIXED — do not redo it, but read it for context and add the regression test described.

---

## Follow-up 0 — [ALREADY FIXED] TDZ bug silently disabled all of Fix 2; add a regression test

### What happened

As merged, the Fix 2 replay block (`scripts/improvement-cycle.js`) iterated `submissionIds` at ~line 666, but `const submissionIds = …` was declared at ~line 718 — same function scope, later in the file. Accessing a `const` before its declaration throws a temporal-dead-zone `ReferenceError` at runtime, and the replay block's `try/catch` swallowed it as `Pre-analysis replay skipped: Cannot access 'submissionIds' before initialization`. Result: replay evidence was always empty, no `REPLAY EVIDENCE:` tags ever reached the LLM context, and `unresolved_still_missed` could never fire — Fix 2 was dead on every run while appearing implemented. `node --check` (syntax-only) and the jest suite (core lib only) could not catch it.

The declaration has been moved above the replay block (single declaration, comment explains why it must stay there). Verified with `node --check` and grep.

### Remaining task

1. Add a smoke test that actually executes the cycle script's context-assembly path far enough to catch scope errors — e.g. extract the replay-evidence assembly into a testable function (preferred; move it into `improvement-cycle-core.ts` or a new `improvement-cycle-replay.ts` lib with the Supabase/OpenAI calls injected), OR add a jest test that runs `node scripts/improvement-cycle.js --dry-run` against stubbed env and asserts the log does NOT contain `Pre-analysis replay skipped`.
2. While extracting, remove the unused `chunk` helper in `ensureTriggerCasesInDataset`.

### Acceptance criteria

- A test fails if the replay block cannot execute (scope error, missing import, etc.).
- `--dry-run` on a fixture cycle logs `Replay evidence: N corrections tagged` with N > 0.

---

## Follow-up 1 (P0) — Trigger "improved" status must survive temporal drift confirmation

### Problem

`scripts/improvement-cycle.js` (trigger-progression block, step 8) classifies each trigger as improved/regressed/unchanged from **raw composite deltas** between the baseline and candidate runs, with a flat `EPS = 0.02`. But the design doc documents temporal drift on identical temp-0 configs of up to ~6pp minutes apart. The harness already re-confirms *regressions* back-to-back (`classifyConfirmedRegression` in `services/differ/lib/eval-scoring.ts`) precisely because raw cross-run deltas are unreliable — yet trigger *improvements* get no such confirmation. Consequence: drift can produce a false `improved`, which produces a false `passed` verdict. Since `passed` now gates on trigger improvement (Fix 1), this is the same noise problem the confirmation machinery exists for, applied asymmetrically to the side that now matters most.

### Spec

1. Preferred approach: derive trigger deltas from the candidate report's `baselineComparison` per-case entries (which already incorporate the back-to-back confirmation pass via `--baseline-prompt`/`--baseline-rules`), instead of recomputing raw `cand.composite - base.composite` in the cycle script. A trigger is `improved` only if its confirmed per-case delta exceeds the noise epsilon.
2. If per-case confirmed deltas are not exposed in the report, extend `review-eval.js` to include them (the confirmation pass already computes fresh baseline/candidate pairs — surface `confirmed_delta` per re-checked case), then consume that.
3. Apply the same treatment to the supplemental trigger runs (`--case` supplement path): they pass `--baseline`/`--baseline-prompt` already, so the confirmed data should be available there too.
4. Trigger `regressed` classification should likewise use confirmed data (currently raw), for consistency — note these cases already appear in the main confirmed-regression count, so this only affects the trigger table's labeling, not the verdict.

### Acceptance criteria

- A trigger whose raw cross-run delta is +3pp but whose back-to-back confirmed delta is ~0 is classified `unchanged`, not `improved`, and cannot produce a `passed` verdict on its own.
- Jest coverage for the classification function using synthetic report data (raw delta vs confirmed delta disagreement).
- Design doc updated: trigger progression section notes that improvement claims are drift-confirmed.

---

## Follow-up 2 (P1) — Freeform corrections must not tag `still_missed`

### Problem

In the replay tagging loop (`scripts/improvement-cycle.js`), a correction row with no `original_text`/`corrected_text` pair (freeform reviewer guidance) can never match a replacement signal from `extractReplacementSignals`, so it always tags `still_missed`. Downstream, the `validateImprovementLlmOutput` coverage check returns false for empty strings (`if (!o && !c) return false`), so a freeform correction plus an `UNCHANGED` prompt always sets `unresolved_still_missed` and fires the red proposal-page banner — even when the LLM's analysis addressed the guidance properly. False alarms train the reviewer to ignore the banner, which defeats Fix 2.

### Spec

1. In the tagging loop: if a correction has no meaningful `original_text` AND no meaningful `corrected_text` (after trim), tag it `not_verifiable` (new status) instead of running signal matching. Do the same when `original_text` exists but is freeform prose rather than menu text if there's an existing signal for that distinction — otherwise just the empty-pair check.
2. Add `not_verifiable` to the `ReplayEvidenceEntry['status']` union in `improvement-cycle-core.ts`, to the `unresolved_still_missed` logic (a `not_verifiable` correction never contributes to the flag), and to the system-prompt tag documentation (`not_verifiable: this correction is freeform guidance that cannot be mechanically replayed; use judgment`).
3. Render the tag neutrally on the user-prompt line (`REPLAY EVIDENCE: not_verifiable — freeform guidance, not mechanically checkable.`).

### Acceptance criteria

- A freeform correction row + `UNCHANGED` prompt does NOT set `unresolved_still_missed` (jest test).
- An exact-text correction that replay still misses DOES (existing behavior preserved, jest test).

---

## Follow-up 3 (P2) — Minor cleanups

1. **Dead parameter:** `evalStatusFromSummary(summary, opts)` in `improvement-cycle-core.ts` accepts `opts.promptUnchanged` but never reads it, and the caller doesn't pass it. Either implement the original spec semantics (`no_effect` requires `promptUnchanged || avgDelta ≈ 0`, so a proposal that improves non-trigger cases broadly isn't labeled "no effect") or remove the parameter. Pick one; don't leave the dead signature.
2. **Prior-rejection matching is coarser than spec:** the Fix 3 feedback-channel query matches rejected proposals by date-range overlap, with `return true` when ranges are missing — unrelated rejections can leak into the LLM context (bounded by the 3-item cap). Spec asked for submission-id matching. Improvement: fetch each rejected proposal's consumed correction submission ids (or store `submission_ids` on the proposal row at insert time — trivial since `submissionIds` is in scope) and require intersection with the current cycle's submission ids; fall back to date overlap only when ids are unavailable on older rows.
3. **Degrade-regex nit:** the graceful-degrade insert retry matches `/replay_evidence/i` on the error message; if only the `unresolved_still_missed` column were missing (partial migration), the retry wouldn't trigger. Match either column name.

### Acceptance criteria

- No unused parameters; jest coverage for whichever `no_effect` semantics is chosen.
- A rejected proposal with non-overlapping submissions does not appear in the next cycle's context (test with fixtures).

---

## Live verification (still outstanding from the original P0 batch — unchanged)

Per AGENTS.md this batch still needs the full live pass, which no session has done yet:

1. Apply `supabase/migrations/20260702_add_prompt_proposal_replay_evidence.sql` (and any earlier unapplied migrations) in the Supabase SQL editor.
2. `./dev-up.sh --down && ./dev-up.sh -d`.
3. Save ≥1 correction on a recently approved submission → run the cycle with `--force` → verify in the cycle log: `Replay evidence: N corrections tagged` (N > 0 — this specific line proves Follow-up 0's bug is gone), `Trigger cases ensured — built ≥1`, and a verdict of `passed`/`no_effect` with the trigger table rendered on `/learning/prompt-proposal`.
4. Reject the proposal → confirm the source corrections reappear in the next cycle's gate count and the rejection notes appear in the next `--dry-run` context.
5. Approve a variant that improves a trigger → confirm `passed`.
