# Guarded manual-rule rewrite utility

`scripts/lib/manual-rule-rewrite.js` prepares and (when explicitly invoked by a
caller) executes the narrowly scoped rewrite for proposal `72c144aa-c33e-4873-85e8-6e48537e799e`.
It is not run by the improvement cycle and makes no provider or model calls.

The planner requires a pending proposal with exactly 30 correction members,
the three exact target IDs, no owned/derived code candidate, and one exact live
row for each target. It records the complete three-row recovery snapshot and
proposal hashes in a bounded private `0600` marker. The executor accepts an
adapter so live reads and writes remain explicit. Its write order is proposal
CAS first (removing all three members), idempotent insertion of one stable
pending unbound global rule, and only then deletion of the two duplicate
Salmon rows plus the old Beet row. Each
phase is persisted atomically and can be resumed; readback must reconcile 27
members before verification succeeds. Retrying the insert must be idempotent
by the stable correction ID.

The prior three-item exclusion artifact is not consulted by this utility. The
new manual rule remains pending and outside the rewritten proposal for a later
bounded cycle.
