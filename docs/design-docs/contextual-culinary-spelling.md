# Contextual Culinary Spelling

**Status:** Implemented (August 2026)

Menu spelling cannot be made reliable with either a growing list of exact phrases, a raw approved-dish lookup, or an unaudited model response. Menus contain brands, multiple languages, proper names, and intentionally unfamiliar culinary terms. The review therefore uses three bounded layers, with the model as contextual adjudicator and deterministic code enforcing coverage.

## Review Layers

1. **Reviewer-confirmed deterministic corrections.** Exact safe terminology rules run before and after the model. Confirmed canonical food words can also use bounded Damerau distance, so adjacent transpositions and missing letters are handled without enumerating every typo. A fuzzy auto-correction must have one unique target and retain the same first and last letters. This catches variants such as `FUGEO`/`FEUGO → FUEGO` and `tamrind`/`tamarnd → tamarind` while protecting valid nearby words such as `juego`, `pequeño`, and `tamarindo`.
2. **Approved-menu vocabulary.** The dashboard builds a cached word-frequency corpus from both active `approved_dishes` and full human-approved submission text. Every approved form protects against false positives; only repeated terms can become correction candidates. Database-only candidates must be a unique, same-boundary, six-or-more-letter near miss. They are context evidence, never blind replacements.
3. **Explicit model adjudication plus a visible fallback.** Candidate findings receive stable IDs in the review prompt. A clear contextual typo is corrected inline. An intentional brand, proper name, multilingual term, or valid culinary word is acknowledged as `valid_as_written` and removed from the chef-facing list. An uncertain candidate remains a yellow suggestion. A token the model is highly confident is malformed but cannot safely identify becomes an overrideable red `Unrecognized Term` issue. If the model silently omits a deterministic candidate, the post-AI pipeline synthesizes a yellow review item and records it as `not_adjudicated`, so database evidence alone never becomes a blocker.

Ambiguous pairs such as `tartare`/`tartar` and `rose`/`rosé` remain questions for context. They are never synthesized as automatic corrections. The always-on prompt section also asks the model to inspect the complete menu rather than limiting spelling review to database candidates, allowing it to flag a badly malformed token that has no usable fuzzy match.

## Severity Decision

An uncertain spelling or an unaudited database match is a normal/yellow review item. Merely being absent from the corpus or unfamiliar is never enough for a blocker. Reviewer-confirmed unique fixes are applied automatically. A database-only candidate asks for verification and never invents authoritative menu content.

A red spelling issue is allowed only when the model explicitly returns `unresolved_nonword` with high confidence: it believes the token is malformed after considering the dish context but cannot infer a safe replacement. The chef can edit and rerun the review or use the existing critical-error override. Medium-confidence unresolved terms remain yellow.

## Structured Dispositions

For each deterministic candidate, the post-AI pipeline records one of:

| Disposition | Chef-facing behavior |
|---|---|
| `corrected` | Corrected menu contains the replacement; no stale card remains |
| `valid_as_written` | Internal acknowledgement only; no warning card |
| `uncertain_candidate` | Normal/yellow spelling suggestion |
| `unresolved_nonword` | Red only at high confidence; otherwise yellow |
| `not_adjudicated` | Normal/yellow fallback because the model omitted the candidate |

## Calibration

The initial approved-dish-only nearest-neighbor experiment was too noisy: on 207 historical eval menus it raised 789 corpus findings, including 759 forms retained by the human final. Adding full approved menus as legitimacy evidence and applying the bounded candidate rules reduced that replay to five findings: four changes reflected in human finals and one plausible uncorrected `Jaritos → Jarritos` typo. This replay is a precision guard, not a claim that the vocabulary can replace contextual AI review.

The corpus is cached for ten minutes in production. Offline baseline/candidate eval runs disable that shared cache so one side cannot receive the other side's vocabulary or rule set. The eval harness supplies human-approved ground truths as vocabulary evidence, matching the production principle without requiring a live database.

## Operational Controls

- `CANONICAL_VOCABULARY_ENABLED=false` disables the corpus briefing and fallback suggestions without disabling deterministic reviewer-confirmed corrections or the model's always-on whole-menu contextual spelling review.
- Accepted-rule and prompt changes remain eval-gated through the automated improvement loop.
- `housemade` is intentionally not encoded here until the outstanding house-style clarification is resolved.

## Key Files

- `services/dashboard/lib/pre-ai-deterministic-rules.ts`
- `services/dashboard/lib/approved-dishes.ts`
- `services/dashboard/lib/canonical-vocabulary.ts`
- `services/dashboard/lib/canonical-vocabulary-provider.ts`
- `services/dashboard/lib/review-pipeline.ts`
- `sop-processor/qa_prompt.txt`
