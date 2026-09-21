# Replay-retirement policy refresh

`scripts/replay-policy-refresh.js` performs a bounded, zero-model refresh for a
single pending proposal whose replay-retirement policy identity is missing. It
reads the exact evidence/routing membership, binds original review audits to
the submission attempt, and evaluates each member with the existing
`assessReplayRetirement` predicate. Missing provenance remains unresolved;
delivery differences are held as `delivery_mismatch` with unknown attribution.
Correction application and progress use the same replay-signal analysis as the
improvement cycle, including additive and partial corrections.

The command defaults to a dry run. A live run requires `--execute` and uses an
xmin-guarded update constrained to the same pending proposal. Before/after
JSON, input hash, plan, and a resumable marker are written under
`tmp/replay-policy-refresh` with owner-only permissions. The proposal identity
uses a bounded stable hash, and a saved plan/after pair lets a rerun recognize
that a CAS succeeded before a process crash. Final readback compares the full
planned proposal (excluding `xmin`) and rechecks pending/no-owner,
`eval_status=regressed`, and `disposition=rules_only`. The command never
invokes a model, creates a code candidate, changes evaluation disposition, or
starts approval/deployment.
