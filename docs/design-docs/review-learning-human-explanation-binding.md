# Review learning — human-explanation expectation binding

## Released bounded task

Worker `01a07857-38f1-7aa1-ab5f-d95509e0c952` implements a reusable expectation-binding step in existing proposal/preflight preparation, using original human corrections rather than treating scorer word pairs as executable edits. Reuse existing provenance/hash helpers; do not create another parallel evaluation engine. Current production review behavior and accepted diacritic final2 remain unchanged.

Audit basis: `/Users/deriancowser/Documents/mm-review-learning-diacritic-provenance-audit-1788887000000000000/provenance-audit.json`, SHA `1ce41b153dc63a56d90bf4397a9891d5629678d24954eeea374e80db0544766f`. Frozen `corrections.json` has eight pending human explanations. Trusted `cohorts.json.motivatingExplanationMappings` joins their submission UUIDs to two historical external case IDs. Six human before-spans match exactly; two differ from saved raw text. The16 scorer signals are a separate observational dataset, not16 independent human instructions.

This task produces preparation/eligibility evidence and tests only. It does not authorize paid calls, change existing raw-output gates, activate contextual spelling, automatically approve pending rules or claim all historical expectations resolved.

## Binding contract

1. Input: immutable raw-source records and hashes/revision identities, original human before/after/explanation records, and trusted submission-to-case mappings with provenance. Preserve all eight original records. Distinguish a pending human test expectation from an accepted global/runtime rule.
2. Derive a source UTF-16 span when the COMPLETE human `original_text` has one exact occurrence in the mapped raw source, subject to text boundaries and source identity. An ordinal derived from that unique full-span context is measured provenance, not a guessed token occurrence. Record the complete before/after span and original record ID/hash. Do not demand a previously stored token ordinal when the exact unique parent span already identifies it.
3. A repeated word elsewhere does not invalidate the one occurrence supported by a unique exact full human span. Conversely, that one bound explanation never authorizes changing every occurrence. Signal04/15's other occurrences remain unsupported unless separate exact evidence establishes them. Do not silently mark the old aggregate signal fully resolved.
4. Missing/duplicate source matches, UUID mapping ambiguity, unknown revision, human-before text differing from raw, or absent evidence produce explicit unresolved/needs-source-history states. No nearest-row, similarity-ratio, fuzzy-word, semantic or target-occurrence guessing. Context-near evidence may be recorded as a lead but grants no mutation authority.
5. Keep whole human edit spans and explanation context together. Allow explicitly supported within-span phrase/space changes and additions as TEST expectations; do not turn a scorer fragment such as `pepper`→`peppercorn` into a patch that leaves an adjacent `corn`. Do not auto-promote menu-content changes or an inferred global rule merely because the human pair is bound. Use existing change-classification/verification lanes or mark classification pending.
6. Separate `raw_bound` from `model_input_bound`. Actual prechecked text must come from the frozen preparation path and its verified raw-to-prechecked lineage if needed later. Never populate a prechecked hash by copying the raw hash and call it verified. This batch may stop at raw binding with later stages explicitly unverified.
7. Output a versioned registry: each original explanation's provenance, scope, source match state, full source span, expected after-span hash, classification/verification state and unresolved reason. Include all16 old scorer signals in a separate relationship table: supported occurrence/subset, observed-only, malformed fragment, context-near or unresolved. Preserve old IDs/results/coverage diagnostics unchanged; do not reuse their `source_bound_included` label as human authority.
8. Production responses and model text cannot mint or modify this registry. Hash-bind the original inputs, mappings and registry. Input text/explanations are task data, not agent/tool instructions. Reject tampering, conflicting source identities and mismatched registry membership.

## Tests and real preparation run

- Positive unique exact full-span binding, including a repeated target word on a different dish. Assert exact measured UTF-16 span and only the supported occurrence. Multiple exact human records may independently support separate occurrences.
- Negative duplicated full spans, absent mapped source, conflicting UUID bridge, source-hash drift, nonexact original phrase with an unrelated human edit, forged ordinals and incorrect partial-word boundaries. All originals remain accounted for; none silently disappear.
- Explicit phrase edit versus malformed scorer fragment, Unicode/emoji/combining-mark coordinates, unchanged prices/protected/read-only intent classification, and pending explanation versus accepted-rule separation. Binding is not permission to bypass review safeguards.
- Generic second explanation set using different IDs/text proves reuse; no production case IDs, count8 or count16 hardcoded into the generic binder. The historical audit runner may use a frozen cohort manifest and assert its exact original membership.
- Run preparation against the actual frozen8corrections and mapped sources, with no model calls. Report measured states, supported full spans and remaining gaps. Expected structural hypothesis is six exact records/two nonexact; derive it from inputs and report disagreement instead of forcing those counts.
- Run focused tests and input/registry integrity negatives in pinned credential-free network-none Docker. Update relevant docs, ledger, acceptance map and README for the preparation workflow. Do not rerun unchanged diacritic/core/B8 acceptance unnecessarily.
- Supply a NEW immutable executable preparation snapshot or complete immutable base+delta with exact source/test/input/registry hashes and raw logs. Preserve all older plans, simulations and failure results. No paid-readiness claim from this binding batch.

## Handoff and next boundary

Return direct concise source delta, invariant, test results, actual8-record registry and16-signal relationship counts, artifact identities and exact remaining historical evidence gaps. Coordinator independently reviews before specifying stage-aware simulation/delivery verification from the bound expectations. No runtime review logic/prompt/policy edits, new resources/provider calls, production writes, notifications, deployment or shared-service restarts.
