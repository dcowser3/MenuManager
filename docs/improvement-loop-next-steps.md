# Improvement-Loop — Next Steps

> Status: Handoff, July 2026
> Prior work: [improvement-loop-fix-specs.md](improvement-loop-fix-specs.md) (original 11 specs) → Fixes 1–3 implemented → [improvement-loop-followup-fixes.md](improvement-loop-followup-fixes.md) (review findings) → Follow-ups 0–3 implemented and verified (44/44 core tests, tsc clean, spawn regression guard in place).
>
> Two tracks remain: **Track A** is the live verification pass (human-executed, needs the Supabase-backed env — everything shipped so far is unverified against a real stack). **Track B** is the next implementation batch for the coding agent (Fixes 4–11 from the original spec doc, plus one new harness item).

---

## Track A — Live verification pass (blocking; do this before trusting the loop)

Nothing in the Fix 1–3 batch or the follow-ups has run against live Supabase + OpenAI. Per AGENTS.md this is required before the work is considered done. Sequence:

### A1. Migrations

In the Supabase SQL editor, confirm/apply in order (earlier ones only if the env is behind — the db service logs `supabase_schema_drift` alerts for missing load-bearing columns):

1. `20260610_add_basic_ai_check_audits.sql`
2. `20260611_add_review_training_links.sql`
3. `20260612_extend_prompt_proposals.sql`
4. `20260614_add_correction_rules_menu_scope.sql`
5. `20260626_add_prompt_proposal_llm_warnings.sql`
6. **`20260702_add_prompt_proposal_replay_evidence.sql`** (new — `replay_evidence`, `unresolved_still_missed`)

### A2. Clean start

```bash
./dev-up.sh --down && ./dev-up.sh -d
```

### A3. Cycle run with fresh evidence

1. Save at least one correction (with explanation) on a recently **approved** submission via the normal review flow.
2. Run `npm run improve:cycle -- --force` (or the "Run cycle now" button on `/learning/prompt-proposal`).
3. In the cycle log (`logs/improvement-cycle.log` or `docker compose exec dashboard tail -100 /app/logs/improvement-cycle.log`), verify these exact lines:
   - `Replay evidence: N corrections tagged` with **N > 0** — this line specifically proves the (fixed) TDZ bug is gone in the real environment. If you instead see `Pre-analysis replay skipped: …`, stop and report the message.
   - `Trigger cases ensured — built ≥1, unavailable 0` (unavailable > 0 is acceptable only for submissions without an approved final).
   - An eval verdict line ending `passed`, `no_effect`, or `regressed` (not `failed`).
4. On `/learning/prompt-proposal`, verify: the Trigger Progression table renders with per-case baseline/candidate/delta/status; replay tags visible in the dry-run artifact (`tmp/improvement-cycle/<cycle>/user_prompt.txt` — look for `REPLAY EVIDENCE:` lines); red banner present **only if** the proposal left a `still_missed` correction uncovered.

### A4. Rejection feedback channel

1. Reject the proposal **with reviewer notes** (note the confirm-dialog nudge if you leave notes empty).
2. Verify the source corrections reappear in the gate: the next `improve:cycle` run (or `--dry-run`) must count them as unconsumed again, and approval-inserted `proposal-*` rows must NOT reappear.
3. In the next run's `--dry-run` `user_prompt.txt`, verify a `## Prior Rejected Proposal <cycle>` section containing your rejection notes.

### A5. Progression happy path

1. Re-run the cycle (`--force`), approve a proposal variant that plausibly improves a trigger (or approve with a modified prompt).
2. Verify: verdict `passed` requires ≥1 trigger `improved` in the table; approving inserts checked rules as `accepted`/`source: system`; code recommendations file GitHub issues (if `GITHUB_TOKEN` configured); `qa_prompt.txt` updated; `syncEffectivePromptFromDb()` restores it after a container restart.
3. Confirm the following gated day logs a clean skip line.

Record anything that deviates and hand it back as findings.

---

## Track B — Next implementation batch (coding agent)

Full specs for Fixes 4–11 are in [improvement-loop-fix-specs.md](improvement-loop-fix-specs.md); do not re-derive them. This section only records status deltas from the Fix 1–3 work, one new item, and the recommended order. Cross-cutting requirements (tests in the core lib, docs in the same change set, degrade-gracefully migrations, Docker verification) are unchanged from that document.

### B0 (new) — Expose `confirmed_delta` per case in the eval report

Context: Follow-up 1 made trigger classification prefer `baselineComparison` entries and `freshDelta` when the back-to-back confirmation pass populated it. Formalize this:

1. In `scripts/review-eval.js`, guarantee every `baselineComparison` per-case entry carries an explicit `confirmed_delta` (the fresh back-to-back pair delta when confirmation ran; `null` when it didn't) alongside the raw `delta`, and document the field in the report markdown.
2. Update the cycle's trigger block and `classifyTriggerFromComparisonEntry` to consume `confirmed_delta` by that name (keep `freshDelta` fallback for old reports).
3. Jest: synthetic report fixtures with raw/confirmed disagreement.

Small, unblocks nothing but removes the informal field dependency. Do it first while the area is warm.

### B1 — Fix 4 remainder (no_effect surfacing audit)

Fix 1 already added the verdict to `evalStatusFromSummary`, the email subject/body, and the trigger table. Remaining from the Fix 4 spec:

- Distinct amber chip styling for `no_effect` on the proposal page (verify current rendering; it may show the raw status string without styling).
- `eval_status` visible in the proposal history/list view on `/learning` (auditability of no-effect proposals over time).
- Check for a CHECK constraint/enum on `prompt_proposals.eval_status`; add a migration admitting `no_effect` if constrained.

### B2 — Fix 5: falsifiable coverage claims (`coverage_claims` with verbatim prompt quotes)

As specced. Interaction note: replay evidence (Fix 2) outranks citations — a valid quote plus `still_missed` must still trip the unresolved banner if nothing changes; add that exact jest case.

### B3 — Fix 6: excerpt windows centered on correction sites

As specced (replace the `slice(0, 600)` head-slices; ±300-char windows per correction, dedupe, budget caps, extract the locator into the core lib for tests).

### B4 — Fix 7: reasoning-class default for `IMPROVE_MODEL`

As specced. Verify JSON-mode/temperature parameter handling for the chosen model family in `callImprovementLlm`; update `docs/environment.md`.

### B5 — Fix 10: pin dated eval-model snapshot

As specced. Pairs naturally with B0 since both touch eval trust; pin `REVIEW_EVAL_MODEL` and production `AI_REVIEW_MODEL` to the same dated snapshot and record the resolved model in `report.json`.

### B6 — Fix 9: thin-evidence badges

As specced (recompute `evidence_submission_count` from correction rows in validation — never trust LLM arithmetic; amber badge for single-submission rules; optional `IMPROVE_THIN_RULE_UNCHECKED`).

### B7 — Fix 8: prompt-bloat counterweight

As specced (`prompt_length` tracking + budget warning; `--consolidate` mode producing a normal human-gated proposal with `source: 'consolidation'`; `--ablate-sections` diagnostic). Largest item in this batch; schedule last.

### B8 — Fix 11: retrieval few-shot — design doc ONLY

Deliverable is a design doc in `docs/design-docs/` per the original spec (retrieval determinism in eval, cache-key implications, k/threshold tuning, cost). Do not implement.

### Suggested order

B0 → B1 (small, same area) → B2 + B3 (both improve LLM input/output quality; independent) → B4 + B5 (model levers) → B6 → B7 → B8. Track A can run in parallel at any time and takes priority — findings from it may reprioritize this list.
