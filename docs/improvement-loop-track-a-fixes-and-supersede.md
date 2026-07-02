# Track A Findings Fixes + Proposal Supersede Feature

> Status: Handoff, July 2026
> Context: Track A run FAILED at A2 (see `tmp/track-a-results.md`); findings F1–F4 confirmed by independent review. This doc specs the fixes, one new feature (pending-proposal supersede), and the re-run.
> Order: Part 1 (fixes) → Part 2 (supersede) → Part 3 (full Track A re-run per [improvement-loop-track-a-agent-runbook.md](improvement-loop-track-a-agent-runbook.md)). Parts 1 and 2 can be one change set; do not re-run Track A until both are in.

---

## Part 1 — Track A findings (F1–F4)

### F1 — Missing `coverage_claims` migration (P0; B2 shipped a column the DB doesn't have)

`coverage_claims` was added to `CRITICAL_SUPABASE_SCHEMA` (`services/db/index.ts:2543`) and to the proposal insert path, but **no migration file was ever created** — so production drift-alerts on a column that cannot exist and every insert takes the degraded branch.

1. New migration `supabase/migrations/20260703_add_prompt_proposal_coverage_claims.sql`: `ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS coverage_claims JSONB;`
2. Audit for the same mistake: for EVERY column named in `CRITICAL_SUPABASE_SCHEMA`, verify a migration file (or `schema.sql`) declares it. Add a jest test that enforces this permanently (parse `supabase/migrations/*.sql` + `schema.sql` for column names and assert coverage) — this class of bug (code expects column, migration forgotten) has now happened twice (June `applies_to_menu_type`, now this).
3. Tell the user which migration(s) to apply in the Supabase SQL editor before the re-run.

### F2 — Differ lib unavailable in the dashboard dev container (P0; replay dead in dev Docker)

`requireDifferLib` needs `services/differ` source (ts-node) or `dist`, but the dashboard dev container mounts neither — so the replay path works in prod images (full copy) and on the host, but silently degrades in dev Docker, which is exactly where Track A runs.

1. In `docker-compose.dev.yml`, add to the dashboard service: `- ./services/differ:/app/services/differ:ro` (plus the node_modules exclusion volume if the pattern requires it). Verify `requireDifferLib` resolves inside the container.
2. Add a loud failure mode: the replay block currently logs one `Pre-analysis replay skipped` warn line and moves on. Given replay evidence is now load-bearing (unresolved_still_missed gating), escalate: when replay is skipped for an environment/dependency reason (as opposed to per-submission missing raw input), record a warning on the proposal row (`llm_warnings`) so the reviewer SEES that replay evidence is absent, and tag affected corrections `replay_unavailable` rather than omitting tags entirely.

### F3 — `SUPABASE_SERVICE_ROLE_KEY` not accepted (P0; nightly cron risk on Lightsail)

`scripts/improvement-cycle.js:70` reads `SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY`. The actual `.env` uses `SUPABASE_SERVICE_ROLE_KEY`.

1. Accept all three, service-role first: `SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY` — here AND in `scripts/review-eval.js` and any other script/service with the same pattern (grep for `SUPABASE_SERVICE_KEY` across the repo and align).
2. Update the error message and `docs/environment.md` / `.env.example` to name the canonical variable. Check what the Lightsail `.env` actually uses and call out in the results if prod cron has been silently failing auth (check `improvement-cycle.log` history on the host during the re-run's post-deploy step).

### F4 — `scripts/` not mounted in dev compose (P1)

The ad-hoc `./scripts:/app/scripts:ro` mount added during the run must be committed to `docker-compose.dev.yml` (dashboard service) so the runbook is reproducible. Include a comment noting the improvement-cycle and review-eval scripts run inside the dashboard container.

---

## Part 2 — Pending-proposal supersede (replaces the skip-and-remind gate)

### Current behavior (to be replaced)

When a pending proposal exists, the daily cycle skips proposal generation and sends a reminder email. New corrections queue up unconsumed until the human reviews the old proposal. Result: the pending proposal goes stale, and the reviewer is nagged about a proposal that no longer reflects all available evidence.

### New behavior (user decision)

When the daily cycle runs and there are NEW unconsumed corrections (≥ `IMPROVE_MIN_NEW_CORRECTIONS`) while a pending proposal exists, the cycle **supersedes** the pending proposal: it generates a fresh proposal from the current *approved* effective prompt using the pending proposal's source corrections PLUS the new ones, marks the old proposal `superseded`, and the reviewer only ever reviews the newest proposal. If there are NO new corrections, keep today's behavior (no regeneration; reminder email).

### Spec

1. **Gate change** (`shouldRunCycle` in `improvement-cycle-core.ts`): a pending proposal no longer blocks when `unconsumedCorrectionCount >= minNewCorrections`. Return a new mode field, e.g. `{ run: true, mode: 'supersede', pendingProposal }` vs `{ run: true, mode: 'new' }` vs `{ run: false, reason }`. Jest matrix for all combinations.
2. **Evidence assembly**: in supersede mode, the corrections set = unconsumed corrections + corrections whose `prompt_cycle_id` equals the pending proposal's `cycle_id` (excluding `submission_id LIKE 'proposal-%'` rows, same rule as un-consume). Replay evidence, trigger cases, and excerpt windows are built over the combined set — no special-casing downstream.
3. **Base prompt**: ALWAYS regenerate from the current approved effective prompt (`pickEffectivePrompt`, unchanged — approved only). Never build on the pending proposal's unreviewed `proposed_prompt`; unreviewed changes must not compound.
4. **Supersede transaction order**: insert the new proposal first; only after a successful insert, (a) update the old proposal to `status: 'superseded'` (add optional `superseded_by_cycle_id` column), and (b) re-stamp ALL combined corrections with the new `cycle_id`. If the insert fails, the old proposal stays pending and nothing is re-stamped.
5. **Status handling**:
   - Migration: check whether `prompt_proposals.status` has a CHECK constraint; add/extend one admitting `superseded` (same idempotent DO-block pattern as the `eval_status` migration). Add `superseded_by_cycle_id VARCHAR` in the same migration.
   - The review route (`/api/learning/prompt-proposal/:id/review`) must reject approve/reject on a `superseded` proposal (409, with a pointer to the superseding cycle) — a stale browser tab must not be able to approve an outdated prompt.
   - Pending-proposal queries (gate, dashboard "latest pending" view) exclude `superseded`. The proposal history table shows superseded rows with their superseding cycle.
   - Rejection un-consume needs NO change: the combined corrections carry the new proposal's `cycle_id`, so rejecting the newest proposal releases everything.
6. **Email**: in supersede mode, the proposal email replaces the reminder — subject unchanged, body notes "supersedes cycle `<old>`; includes its N source corrections plus M new." Kill the reminder path only when superseding actually happened.
7. **Proposal page**: show a "Supersedes cycle `<old>`" line, and label the correction count as combined (carried-over + new) so the reviewer understands why the count grew.
8. **On-demand button / `--force`**: same supersede semantics (force with a pending proposal supersedes it, even with zero new corrections — the manual button explicitly means "regenerate now").
9. **Docs**: update the design doc's Phase D + runbook sections (the "pending proposal blocks new ones" behavior is documented in several places — update them all; grep for "pending").

### Acceptance criteria

- Day 1 proposal pending + day 2 new corrections → day 2 run produces ONE new pending proposal containing all corrections; old proposal `superseded`; approve/reject on the old one returns 409; rejecting the new one un-consumes the full combined set.
- No new corrections + pending proposal → reminder email, no new proposal (unchanged).
- Jest coverage for the gate matrix, supersede ordering (insert-then-mark), combined-evidence assembly, and the 409 guard.

---

## Part 3 — Re-run Track A

After Parts 1–2: apply the new migrations (`coverage_claims`, `superseded` status) in Supabase — tell the user first — then execute [improvement-loop-track-a-agent-runbook.md](improvement-loop-track-a-agent-runbook.md) end-to-end (A0–A7), with one addition:

- **A4b (supersede check):** after A4's rejection re-run creates a fresh pending proposal, save one more correction and run the cycle again (no `--force`). Verify: the pending proposal flips to `superseded`, the new proposal's evidence includes both correction sets, the page shows the supersede line, and the 409 guard fires when reviewing the superseded proposal.

Deliverable: updated `tmp/track-a-results.md` with per-step PASS/FAIL and verbatim key log lines, including `Replay evidence: N corrections tagged` with N > 0 from inside the dev Docker container.
