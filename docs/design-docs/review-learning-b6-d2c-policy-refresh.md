# Review-learning B6-D2c: Replay-retirement policy refresh

This slice makes the replay-retirement policy version part of the existing
proposal lifecycle. It does not execute a real cycle or mutate a pending
proposal in place.

## Contract

- Every newly stored proposal stamps
  `eval_summary.replay_retirement_policy_version` with the current
  `REPLAY_RETIREMENT_POLICY_VERSION`, including skipped, failed, normal,
  supersede, rules-only-fallback, and consolidation paths.
- The pending-proposal read includes the existing `eval_summary`,
  `replay_evidence`, and `correction_routing` JSON. A pending proposal is stale
  when its version is missing/wrong or when
  `unverifiedReplayResolutionIds(...)` finds a legacy/status-only
  `now_correct`; routing-only success is never trusted as proof.
- Staleness enters the existing cycle gate as a safe supersede. It bypasses
  cadence even with zero new corrections and carries the exact human rows via
  the existing `prompt_cycle_id` mechanism.
- The old proposal is marked superseded only after the replacement insert
  succeeds. Insert failure therefore leaves the pending row untouched.

## Verification boundary

Core and source-level tests cover current clean proposals, missing/wrong
versions, legacy evidence, routing-only legacy success, verified current
retirement, zero-correction supersede gating, version stamping, required JSON
query fields, and insert-before-supersede ordering. No live DB, provider,
model, network, schema, worker, UI, or production write is used.

The remaining B6-D gap is the broader proposal-refresh/worker operational
integration: this change refreshes only when the existing improvement-cycle
entrypoint runs and does not add a scheduler, UI action, or in-place rewrite.

