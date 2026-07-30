# Diacritics Policy

**Status:** Implemented
**Decided:** 2026-07-30

Two questions the review pipeline used to answer differently on different menus:

1. Does a menu set in ALL CAPS still take accents?
2. When a brand name has a contested spelling, which one wins?

## Decision

**1. ALL CAPS is not a diacritic exemption.** A word takes the same accents in caps that it
takes in title case. `matchCase` already upper-cases the accented target, so every rule in
`BUILT_IN_REPLACEMENTS` and every accepted learned rule applies unchanged to an all-caps menu.
There is no case-based carve-out and no plan for one.

**2. Brand orthography is pinned per brand, in whichever direction the trademark runs.** A
brand's spelling is a fact about the trademark, not something derivable from the surrounding
menu text, so it cannot be left to the model or to reviewer muscle memory. Pins live in
`BUILT_IN_REPLACEMENTS` (`services/dashboard/lib/pre-ai-deterministic-rules.ts`) and run both
before and after the AI call, so the model can neither omit a pinned accent nor invent one.

Currently pinned:

| Menu text | Corrected to | Direction |
|---|---|---|
| `patron` | `Patrón` | add the accent |
| `josé cuervo` | `Jose Cuervo` | remove the accent |

## Evidence

Measured over the 251 human-approved finals in `tmp/review-eval/dataset.jsonl`, counting
tokens for terms the corpus accents somewhere:

- **268 accented all-caps tokens against 51 unaccented** — `ROSÉ` ×44, `CHÂTEAU` ×39,
  `AÑEJO` ×19, `PATRÓN` ×8, `TEQUILEÑO` ×4. Reviewers accent in caps, by a wide margin.
- **Patrón**: 44 brand occurrences, accented 8:2 in caps and 36:17 in mixed case. The
  trademark carries the accent. The English word *patron* (a customer) appears **zero** times
  in 251 approved menus, and the plural *patrons* is excluded by the rule's word boundaries.
- **Jose Cuervo**: unaccented in 7 of 8 approved occurrences, including twice on tán's own
  Dinner Beverage Menu. The label spelling has no accent.

## What prompted it

The 2026-07-30 review-model switch to `gpt-5.6-luna` (`bab5d76`) regressed eval case
`production:clickup-86b4q079a` — "RSH - tán - Dessert Menu" — from composite 1.0 to 0.598
on two corrections and nothing else: `JOSE -> JOSÉ` and `PATRON -> PATRÓN`.

Neither was a model failure. The approved final for that menu contains **both**
`PATRÓN Extra Añejo` and `PATRON EL ALTO`, so the ground truth contradicted itself, and the
QA prompt only told the model to "be careful with patron/Patrón" — an instruction that
guarantees a per-menu coin flip. The model was right about Patrón and wrong about Jose
Cuervo; there was no encoded policy for it to be right or wrong against.

With both forms pinned, the case returns **composite 1.0, exact match, P/R/F1 100%**.

## Adding a brand

Add a `BUILT_IN_REPLACEMENTS` entry in whichever direction the trademark runs, add a case to
`services/dashboard/__tests__/pre-ai-deterministic-rules.test.ts`, and run
`npm run rules:manifest`. Check the corpus first — the counting one-liner is in the Evidence
section's terms — and prefer a multi-word pin (`josé cuervo`, not `josé`) when the bare word
has an ordinary non-brand meaning.

Genuinely context-dependent terms — where both spellings are correct and only the dish
decides, like `rose`/`rosé` — do **not** belong here. Those go in `CONTEXT_DEPENDENT_TERMS`
(`services/dashboard/lib/improvement-cycle-core.ts`) and stay in the model's lane, surfaced
as a question by the canonical-vocabulary near-miss briefing.
