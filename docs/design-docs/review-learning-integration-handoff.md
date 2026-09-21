# Review-learning controlled integration handoff

This branch is a narrow accepted safety integration—not the entire final17
workflow or the whole review-learning project. It integrates only the accepted
source-bound allergen and canonical raw-notice behavior onto current
`origin/main` at `1c1bf4afdd1047a9a7099bb726dd05ca763ad55a`, preserving the
newer editor behavior already present there.
The immutable source packet is
`mm-review-learning-r4-allergen-raw-successor-1789166000026-final17`.

## Delta audit

All 463 packet `base-delta.json` paths were compared byte-for-byte with clean
main before editing:

- 348 were already present and identical; they were not copied.
- 39 were true divergent overlaps; the accepted raw-notice/allergen hunks were
  reconciled manually in `menu-footer`, `review-pipeline`, `pre-ai-deterministic-rules`,
  `dashboard/index`, tenant config, prompt, README, and the rule manifest.
- 76 were clean-main additions from the packet snapshot. Packet-only runners,
  paid-run/evidence tooling, private captures, generated caches, training files,
  unrelated source-anchored spelling work, and broader candidate fixtures were
  excluded. No unresolved overlap remains.

## Included behavior

The branch includes source-bound submitted-allergen preservation, candidate-only
allergen stripping, fail-closed row attribution, exact supported price-suffix
preservation, delivered allergen-claim reconciliation, and canonical managed
raw-notice suppression. It includes focused tests, generated dashboard/tenant
artifacts, prompt guidance, configuration, the code-rules manifest, and the
user-facing documentation. The broader packet lifecycle/paid-run validators are
evidence artifacts and are intentionally not shipped as product runtime code.

The prepared review coordinator carries one immutable execution snapshot for
the raw-input/reviewed-body pair, precheck provenance, prompt/context,
near-miss and embedded-menu analysis, footer state, and delivery-affecting
options. Anchored spans are validated against the prechecked-body coordinate
basis; ambiguous zero-width edits, duplicate spans, out-of-range spans, and
true overlaps fail closed. If an anchored merge is rejected, final decision
fields are recomputed from delivered source bytes while the rejected candidate
remains separately named diagnostics.

## Verification

- Docker network-none focused suites: 6 suites, 137 tests, all passed, including
  the actual changed-only Basic route, no-provider full-pipeline parity, and the
  generated rule-manifest contract. The regression suite covers the exact late
  high-confidence suggestion that removes `marinade S` after model delivery;
  final guarded bytes restore S while a later explicit chef removal remains removed.
  It also verifies that the full pipeline defaults canonical raw-notice provenance
  from the submitted footer when the caller omits an explicit flag.
- Dashboard build: passed.
- Tenant-config build: passed.
- Dashboard source/dist parity: all 40 compiled files; packaged and fresh closure
  hash `fa980f16a94173dd6a474984e6153aa77042df62700d1ff7d3602685e223d4c1`.
- Generated rule metadata served by source and compiled manifest passed its
  seven-test contract suite.
- The changed-only route merge uses the final guarded `correctedMenuSanitized`
  output; a negative-control mutation back to `correctedAfterHighConfidence`
  fails the realistic trailing-code regression.
- Destination reconciliation started from `origin/main` and cherry-picked the
  accepted source branch (`f4f2f1897f6cd46effd5b0f0635dd8da5cb91756`) as a
  controlled five-commit range. Git reported no conflicts; no newer origin/main
  behavior was overwritten. `npm run dev:doctor` is not defined in this repo, so
  that requested read-only check was unavailable.
- No provider calls, paid runs, shared-stack changes, deployment, activation, or
  production writes were performed.
- The review-envelope parity suite covers mocked Basic HTTP and offline
  execution with identical model output, including footer removal,
  length-changing prechecks, later anchored edits, and rejected-merge parity.

The pending approximately 30 explanation groups remain unprocessed. This code
keeps them processable by the existing review-learning workflow; it does not
constitute Stage2/data authority or claim that those groups were processed.
Reusable-learning coordinators, source-anchored spelling lanes, paid-run
orchestrators, and broader candidate workflow behavior remain explicitly
unintegrated and tracked separately from this narrow safety commit.
