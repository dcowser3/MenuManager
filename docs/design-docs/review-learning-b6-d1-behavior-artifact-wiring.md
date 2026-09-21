# Review-learning B6-D1: Behavior-artifact cycle wiring

This slice wires the accepted B6-A behavior-artifact core into the existing
improvement cycle without changing proposal drafting, evaluation, approval,
replay retirement, worker progress, or the UI.

## Boundary

- The cycle retains already-fetched human explanation rows, including
  menu-content updates. Eligibility still excludes `menu_update_only` and
  `menu_content_update` from proposal input.
- A duplicate explanation id is deterministic: the first explanation fetched
  in the cycle wins; an accepted explanation overrides a duplicate baseline
  policy when freezing policy families.
- `behavior-tests.json` is frozen after the current accepted-policy snapshot is
  available and before any proposal-model call. It is written owner-only
  (`0600`) and contains the B6-A hash and immutable records/tests.
- Artifact identity is recomputed with the B6-A canonical hash (recursive
  object-key ordering, array order preserved) during verifier and proof
  readback, allowing JSONB persistence to reorder object keys without
  weakening tamper detection.
- Four-stage provenance remains unknown when this slice has no stage evidence.
  Menu updates remain records with `excluded_from_policy_learning` and create
  no deterministic policy tests. Consolidation writes a valid empty artifact.
- The artifact is evidence only. Candidate output cannot author or mutate its
  expectations, and no artifact fields are persisted to `prompt_proposals`.

The small source-only helper at `scripts/lib/behavior-artifact.js` owns the
deduplication, policy precedence, and owner-only write. It has no database,
model, or network dependency; later replay-retirement and worker/UI slices may
consume the artifact under their own contracts.

## Verification boundary

The focused tests cover learning-intent eligibility, deterministic duplicate
precedence, menu-update exclusion, unknown stages, immutable SHA validation,
the owner-only artifact write, and the pre-model boundary with zero external
calls. Dashboard TypeScript build and emitted parity are required. B6-B,
B6-C worker/progress/UI wiring, B5, B7, B8, provider, paid, production,
deployment, and activation work remain out of scope.
