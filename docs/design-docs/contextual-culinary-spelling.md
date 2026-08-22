# Contextual Culinary Spelling

**Status:** Implemented (August 2026)

Menu spelling cannot be made reliable with either a growing list of exact phrases or a blind nearest-word dictionary. Menus contain brands, multiple languages, proper names, and intentionally unfamiliar culinary terms. The review therefore uses three bounded layers.

## Review Layers

1. **Reviewer-confirmed deterministic corrections.** Exact safe terminology rules run before and after the model. Confirmed canonical food words can also use bounded Damerau distance, so adjacent transpositions and missing letters are handled without enumerating every typo. A fuzzy auto-correction must have one unique target and retain the same first and last letters. This catches variants such as `FUGEO`/`FEUGO → FUEGO` and `tamrind`/`tamarnd → tamarind` while protecting valid nearby words such as `juego`, `pequeño`, and `tamarindo`.
2. **Approved-menu vocabulary.** The dashboard builds a cached word-frequency corpus from both active `approved_dishes` and full human-approved submission text. Every approved form protects against false positives; only repeated terms can become correction candidates. Database-only candidates must be a unique, same-boundary, six-or-more-letter near miss. They are context evidence, never blind replacements.
3. **Model adjudication plus a visible fallback.** Candidate findings are included in the review prompt with the surrounding menu. The model can correct a clear typo or return a spelling suggestion. If a unique non-ambiguous finding remains unchanged and unmentioned, the post-AI pipeline adds a medium-confidence, normal-severity suggestion so it cannot silently disappear.

Ambiguous pairs such as `tartare`/`tartar` and `rose`/`rosé` remain questions for context. They are never synthesized as automatic corrections.

## Severity Decision

An uncertain spelling is a normal/yellow review item, not a critical/red blocker. Missing prices and incomplete dish names can be objectively blocking; an unfamiliar word cannot, because it may be a valid chef term, trademark, person, wine, or non-English word. Reviewer-confirmed unique fixes are applied automatically. A database-only candidate asks for verification and never invents authoritative menu content.

## Calibration

The initial approved-dish-only nearest-neighbor experiment was too noisy: on 207 historical eval menus it raised 789 corpus findings, including 759 forms retained by the human final. Adding full approved menus as legitimacy evidence and applying the bounded candidate rules reduced that replay to five findings: four changes reflected in human finals and one plausible uncorrected `Jaritos → Jarritos` typo. This replay is a precision guard, not a claim that the vocabulary can replace contextual AI review.

The corpus is cached for ten minutes in production. Offline baseline/candidate eval runs disable that shared cache so one side cannot receive the other side's vocabulary or rule set. The eval harness supplies human-approved ground truths as vocabulary evidence, matching the production principle without requiring a live database.

## Operational Controls

- `CANONICAL_VOCABULARY_ENABLED=false` disables the corpus briefing and fallback suggestions without disabling deterministic reviewer-confirmed corrections.
- Accepted-rule and prompt changes remain eval-gated through the automated improvement loop.
- `housemade` is intentionally not encoded here until the outstanding house-style clarification is resolved.

## Key Files

- `services/dashboard/lib/pre-ai-deterministic-rules.ts`
- `services/dashboard/lib/approved-dishes.ts`
- `services/dashboard/lib/canonical-vocabulary.ts`
- `services/dashboard/lib/canonical-vocabulary-provider.ts`
- `services/dashboard/lib/review-pipeline.ts`
- `sop-processor/qa_prompt.txt`
