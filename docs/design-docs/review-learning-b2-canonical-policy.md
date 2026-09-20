# Review-learning B2: scoped canonical policy

B2 makes accepted correction rules one shared, scoped policy for deterministic
pre-checks, canonical vocabulary, and QA prompt guidance. A rule is eligible
only when it is accepted and passes the existing deterministic safety checks.

## Resolution rules

- Property-specific rules win over global rules for the same normalized source
  term. Equal-authority targets are reported as a conflict and no target is
  chosen.
- `templateType` is the scope dimension (`food` or `beverage`); `menuType` is
  retained as review context and is not used to reinterpret template scope.
- Separator variants are bounded to short letter/mark terms with at most three
  segments. Letter-distance variants remain advisory vocabulary findings and
  are never deterministic replacements.
- Matching is line-bounded: canonical vocabulary grams do not cross newlines.

The same resolved policy feeds the pre-AI pass, final term canonicalization,
vocabulary construction, and the `accepted_scoped_policy` prompt section. The
vocabulary cache is keyed by tenant/property/template/menu plus policy and
vocabulary snapshot fingerprints, with bounded entries and generation-safe
invalidation so concurrent contexts cannot leak a local target.

## Live rulebook boundary

The existing live `sop-processor/qa_prompt.txt` still contains the base
`house-made` example. B2 deliberately does not rewrite that rulebook example.
Instead, the appended scoped-policy guidance overrides a conflicting term
example only when the accepted rule is applicable to the submitted
property/template context. It is not a global rewrite of the live prompt, and
it does not authorize unrelated or out-of-scope substitutions.

## Scope boundary

This document covers B2 only. The review coordinator/envelope (B3), active
document-local review units (B7), receipt reuse/evidence (B8), source-bound
spelling/quantity lanes, paid evaluation, provider calls, and database schema
changes are separate workstreams and remain unintegrated here.

## Verification

Focused policy, vocabulary-provider, canonical-vocabulary, pre-AI, and prompt
builder suites cover separator/newline boundaries, scope precedence, conflict
abstention, advisory letter variants, cache concurrency/isolation, and prompt
parity. Dashboard typecheck/build and source/dist parity remain required before
release; no provider or production write is part of B2.
