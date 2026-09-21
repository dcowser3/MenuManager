# Guarded manual-rule rewrite utility

`scripts/lib/manual-rule-rewrite.js` prepares and (when explicitly invoked by a
caller) executes the narrowly scoped rewrite for proposal `72c144aa-c33e-4873-85e8-6e48537e799e`.
It is not run by the improvement cycle and makes no provider or model calls.

The planner requires a pending proposal with exactly 30 correction members,
the three exact target IDs, no owned/derived code candidate, and one exact live
row for each target. It records the complete three-row recovery snapshot and
proposal hashes in a bounded (2 MiB maximum) private `0600` marker. The executor accepts an
adapter so live reads and writes remain explicit. Its write order is proposal
CAS first (removing all three members), idempotent insertion of one stable
pending unbound global rule, and only then deletion of the two duplicate
Salmon rows plus the old Beet row. Each
phase is persisted atomically and can be resumed; readback must reconcile 27
members before verification succeeds. Retrying the insert must be idempotent
by the stable correction ID and UUID, and existing rows are compared only on
the intended manual-rule fields (not server timestamps/defaults).

Use `node scripts/rewrite-manual-rules.js` for a read-only readiness check.
Set `MENUMANAGER_ENV_FILE` to the absolute environment file when it is not in
the checkout. Add `--apply` only for the explicitly authorized rewrite. The
CLI always uses the private marker under the proposal artifact directory;
every retry revalidates the marker and live state, and a verified retry still
performs final readback. The live proposal CAS uses PostgreSQL's compact `xmin`
row version plus pending status and proposal ID, avoiding oversized JSONB
filter URLs while still rejecting every concurrent row update.
The replacement insert retains the repository's established legacy-schema
fallback: when the live schema cache lacks nullable `source_binding`, the
unbound manual row is retried without that unsupported column (equivalent to
the intended null binding).

If the three old rows are already absent while the proposal is still the exact
unowned 30-member snapshot, the CLI enters a forward-reconciliation mode. Its
recovery artifact records the absence (it does not claim to contain deleted
row contents), CAS-reduces the proposal to the exact 27-member set, and inserts
the same stable pending rule. This mode performs no further deletes.

The prior three-item exclusion artifact is not consulted by this utility. The
new manual rule remains pending and outside the rewritten proposal for a later
bounded cycle.
