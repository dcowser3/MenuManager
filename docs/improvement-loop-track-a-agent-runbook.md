# Track A — Agent-Executed Live Verification Runbook

> Status: Handoff, July 2026 — to be executed by the coding agent (Cursor) on the developer's machine.
> Context: [improvement-loop-next-steps.md](improvement-loop-next-steps.md) Track A. **Before re-run:** apply the two July 2026 migrations in Supabase SQL editor if not already present: `20260703_add_prompt_proposal_coverage_claims.sql` and `20260703_add_prompt_proposal_superseded.sql`. Earlier migrations (including the three `20260702_*` ones) should already be applied — verify with the schema-drift startup log.
> Purpose: everything from Fixes 1–3, Follow-ups 0–3, Track B, and the Track B findings fixes has ONLY been verified by unit tests and script smokes. This runbook is the first execution against real Supabase + OpenAI. It is blocking: the user will not push to Lightsail (which auto-deploys) until this passes.

## Ground rules

1. **Docker-first per AGENTS.md.** Use `./dev-up.sh` / `docker-compose.dev.yml`. Do not start native services.
2. **You are pointed at PRODUCTION Supabase.** The local `.env` uses the production database. Proposals, un-consume operations, and any approved rules are real. Follow the safety constraints in each step exactly — especially A5.
3. **Stop-and-report discipline:** any step whose expected output does not appear → stop, capture the full log excerpt, and report it as a finding. Do not improvise fixes mid-run; the point is to observe the shipped behavior.
4. Record every command + relevant log line in a results file: `tmp/track-a-results.md` (create it as you go; it is the deliverable).

## A0 — Pre-flight

1. Confirm required env in `.env`: `OPENAI_API_KEY`, `SUPABASE_URL` + key, `INTERNAL_API_TOKEN`. Graph mail vars are optional locally — a failed proposal email is non-fatal and logs a `system_alerts` row; note it, don't chase it.
2. Port hygiene: `for p in 3001 3002 3003 3004 3005 3006 3007; do lsof -ti:$p 2>/dev/null | xargs kill -9 2>/dev/null || true; done`
3. `./dev-up.sh --down && ./dev-up.sh -d`
4. Watch db-service startup logs for `supabase_schema_drift` alerts. Expected: none (migrations applied). Any drift alert → stop and report which column is missing.

## A1 — Establish unconsumed corrections

1. Query for unconsumed corrections (via the db service or Supabase): `correction_rules` where `prompt_cycle_id IS NULL` and `status IN ('accepted','pending')`.
2. If at least one exists on a submission that has `approved_menu_content`, use it and skip to A2.
3. Otherwise create one through the real flow (not a direct DB insert — the flow is part of what's being verified): pick a recently approved submission on the dashboard (`http://localhost:3005`), save a small plausible correction with an explanation through the menu-correction page (e.g. a diacritic fix consistent with existing rules). Record its id in the results file for cleanup.

## A2 — Dry run first

```bash
docker compose -f docker-compose.dev.yml exec dashboard node /app/scripts/improvement-cycle.js --dry-run --force
```

Verify in `tmp/improvement-cycle/<cycle>-dry-run/user_prompt.txt`:

- `REPLAY EVIDENCE:` lines present next to corrections (tags: `still_missed` / `now_correct` / `not_verifiable` — NOT `replay_unavailable` for a submission that has raw input).
- Correction-site excerpt windows (B3): the excerpt shows text around the corrected dish, not just the top of the document.
- Cycle log shows `Replay evidence: N corrections tagged` with **N > 0**. This is the single most important line in the whole runbook — it proves the twice-broken replay path finally runs live. If instead you see `Pre-analysis replay skipped: <message>` → stop, report the message verbatim.
- `Trigger cases ensured — built ≥1`.

## A3 — Real cycle run

```bash
docker compose -f docker-compose.dev.yml exec dashboard node /app/scripts/improvement-cycle.js --force
```

Verify:

1. Model line reports the reasoning default (`o3` or the configured `IMPROVE_MODEL`) and the call SUCCEEDS — no `OpenAI API error 400` (this validates the `max_completion_tokens` fix live), no truncation error. If truncation: note it and re-run with `IMPROVE_MAX_COMPLETION_TOKENS=48000`.
2. Eval runs baseline + candidate; verdict is `passed`, `no_effect`, or `regressed` — anything `failed` is a finding (capture the eval stderr from the log).
3. Proposal row lands in `prompt_proposals` with `replay_evidence` populated and `prompt_length` set (validates both degrade-column paths took the non-degraded branch).
4. On `http://localhost:3005/learning/prompt-proposal`:
   - Trigger Progression table renders with per-case baseline/candidate/delta/status.
   - Verdict chip styled (amber if `no_effect`).
   - Coverage Claims section renders if the LLM emitted any (B2).
   - Red `unresolved_still_missed` banner appears ONLY if a still_missed correction is uncovered — check consistency against `tmp/improvement-cycle/<cycle>/replay_evidence.json`.
   - Thin-evidence badge on any single-submission rule (B6).

## A4 — Rejection feedback loop

1. Reject the proposal WITH reviewer notes (e.g. "Track A verification rejection — testing the feedback loop"). Confirm the empty-notes nudge dialog does NOT appear (notes were provided).
2. Verify in `correction_rules`: the source corrections have `prompt_cycle_id = NULL` and `consumed_at = NULL` again; any `submission_id LIKE 'proposal-%'` rows were NOT reset.
3. Run `--dry-run --force` again: the gate counts the corrections as unconsumed, and `user_prompt.txt` contains `## Prior Rejected Proposal <cycle>` with the rejection notes. (This also validates the submission-id-intersection matching from Follow-up 3.)

## A4b — Pending-proposal supersede

After A4's rejection re-run creates a fresh **pending** proposal:

1. Save **one more** unconsumed correction through the real menu-correction flow (or use an existing unconsumed row if one appears after the A4 re-run).
2. Run the cycle again **without** `--force`:
   ```bash
   docker compose -f docker-compose.dev.yml exec dashboard node /app/scripts/improvement-cycle.js --dry-run
   ```
   If the gate would skip (no new corrections), stop and report — the supersede path requires ≥ `IMPROVE_MIN_NEW_CORRECTIONS` new rows while a pending proposal exists.
3. Run the real cycle (no `--force`) and verify:
   - The previous pending proposal's `status` is `superseded` with `superseded_by_cycle_id` pointing at the new cycle.
   - The new proposal's correction set includes **both** the carried-over and new corrections (`supersede_carried_correction_count` + `supersede_new_correction_count` on the row; combined count on `/learning/prompt-proposal`).
   - The proposal page shows **Supersedes cycle `<old>`** and the combined correction count label.
   - `POST /api/learning/prompt-proposal/<old-id>/review` with any status returns **409** with a pointer to the superseding cycle.
4. **Reject** the superseding proposal (with notes) so A5 starts clean — this also verifies rejection un-consumes the full combined correction set.

## A5 — Approval path (STRICT safety constraints — production side effects)

Approving makes the proposal the latest approved prompt (production dashboards restore it via `syncEffectivePromptFromDb()`) and inserts checked rules as live `accepted` correction rules. Therefore:

1. Run the cycle once more (`--force`) to get a fresh proposal.
2. Approve it as a **no-op**: use "approve with modifications" with `final_prompt` set to the CURRENT effective prompt (copy from `tmp/improvement-cycle/<cycle>/current_prompt.txt`), and **UNCHECK every proposed rule**. Result: approval mechanics are exercised end-to-end with zero behavioral change in production.
3. Verify: proposal status `approved_modified`; `qa_prompt.txt` rewritten (content-identical); NO new rows in `correction_rules` from this approval; GitHub issues filed only if `GITHUB_TOKEN` is set (note either way); restart the dashboard container and confirm the startup prompt-sync log line.
4. Do NOT approve any proposal with actual changes or checked rules during this runbook. That is the user's decision on real proposals, not part of verification.

## A6 — Consolidation + ablation smokes (operator tools, safe)

1. `docker compose -f docker-compose.dev.yml exec dashboard node /app/scripts/improvement-cycle.js --consolidate --dry-run` → context contains the consolidation prompt + manifest only (no corrections/replay/rejection sections). Then a real `--consolidate` run → proposal with `source: 'consolidation'`, measurably shorter proposed prompt, verdict `passed` iff zero confirmed regressions. **Reject it with notes** (do not approve a consolidation on this run).
2. `npm run review:eval -- --ablate-sections --limit 3 --label track-a-ablate` → report markdown contains the per-section delta TABLE (not a listing).

## A7 — Cleanup + deliverable

1. Reject any proposals created by this runbook that remain pending. If a test correction was created in A1, note whether the user wants it kept as a real correction or removed (do not silently delete a real reviewer artifact).
2. Deliver `tmp/track-a-results.md`: per-step PASS/FAIL, the key log lines verbatim (especially the `Replay evidence: N corrections tagged` line and the eval verdict), and any findings.

## After Track A passes

1. The user commits + pushes → the Lightsail deploy workflow rebuilds, deploys, and installs the daily cron automatically.
2. Post-deploy prod smoke (agent can script the commands for the user or run them if given host access): `crontab -l | grep improvement-cycle` on the host, then `docker compose exec dashboard node /app/scripts/improvement-cycle.js --dry-run` inside the prod container, and check `docker compose logs dashboard | grep "Alert mail"` for the email transport state.
3. First real overnight run: next morning, check `/tmp/menumanager-improve-cron.log` (host) and `/app/logs/improvement-cycle.log` (container) for the same key lines as A2/A3.
