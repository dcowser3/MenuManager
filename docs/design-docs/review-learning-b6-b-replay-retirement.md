# Review-learning B6-B: Standalone replay-retirement proof

This slice adds the fail-closed replay-retirement predicate as a standalone module. It does not wire retirement into proposal routing or the improvement cycle.

## Proof contract

- A backend `now_correct` observation is only an observation and remains `verification_required` without proof.
- Retirement requires a completed full original audit bound to the same attempt, the original failed response, no submitted-delivery mismatch, and deterministic reprocessing of that frozen response through the current post-AI guards with zero model calls.
- Missing, malformed, changed-only, incomplete, legacy, or contradictory evidence fails closed. Unknown post-review edits remain unattributed rather than becoming browser-fix claims.
- Compound corrections track lost delivered changes separately from the complete correction result.

The module also exposes a policy version check and a narrow supersede helper that recovers only exact unverified legacy replay IDs.

## Verification boundary

The packet-identical focused suite passes 12 tests. The minimum current B3 regression set (`review-pipeline.test.ts` and `review-envelope.test.ts`) passes alongside it for 95 tests total, including deterministic replay through the current pipeline. Dashboard TypeScript compilation/build, generated source/test output parity, and the same 95-test set in credential-free Docker with `--network none` pass.

This remains synthetic engineering evidence. The module is not imported by `improvement-cycle-core.ts` or `scripts/improvement-cycle.js`; proposal routing, progress/worker/UI, B5, B7, B8, provider, production, deployment, and paid quality work remain deferred.
