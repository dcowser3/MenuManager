# Replay-retirement policy refresh

`scripts/replay-policy-refresh.js` performs a bounded, zero-model refresh for a
single pending proposal whose replay-retirement policy identity is missing. It
reads the exact evidence/routing membership, binds original review audits to
the submission attempt, and evaluates each member with the existing
`assessReplayRetirement` predicate. Missing provenance remains unresolved;
delivery differences are held as `delivery_mismatch` with unknown attribution.

The command defaults to a dry run. A live run requires `--execute` and uses an
xmin-guarded update constrained to the same pending proposal. Before/after
JSON, input hash, plan, and a resumable marker are written under
`tmp/replay-policy-refresh` with owner-only permissions. The command never
invokes a model, creates a code candidate, changes evaluation disposition, or
starts approval/deployment.
