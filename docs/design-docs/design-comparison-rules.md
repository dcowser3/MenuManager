# Design Comparison Rules

> **Status:** Refined for real-proof pilot
> **Updated:** 2026-08-29

## Problem

The design approval DOCX-vs-PDF comparison was too strict, producing excessive false positives (100+ issues on well-aligned menus). Designers routinely make acceptable changes — casing, removing prefixes like "Choice of:", adding conjunctions, reordering items — that don't warrant critical or warning-level flags.

## Solution

A rules file (`services/dashboard/design-comparison-rules.json`) supplies the leading phrases, ignorable words, and minimum meaningful word length. The comparison engine also has built-in semantic handling for case, punctuation, line wrapping, proof reordering, managed footer copy, prices, allergen codes, PDF ligatures, and non-printing characters.

## Rules Reference

| Rule | Default | Effect |
|------|---------|--------|
| `ignoreCaseDifferences` | `true` | Documents the built-in case-insensitive matching behavior |
| `ignoreLeadingPhrases` | `["Choice of:", ...]` | Listed prefixes stripped before comparison |
| `ignoreConjunctionChanges` | `true` | Documents conjunction handling through `ignorableWords` |
| `ignorePunctuationDifferences` | `true` | Documents built-in punctuation-insensitive matching |
| `ignoreWhitespaceInPrices` | `true` | Documents built-in structured price matching across lines |
| `reorderingTolerance` | `true` | Documents built-in whole-proof layout reconciliation |
| `minWordLengthForMissing` | `3` | Missing words shorter than this are info, not critical |
| `ignorableWords` | `["of", "the", ...]` | These words missing/added are always info severity |
| `treatCaseOnlyAsInfo` | `true` | Case-only word changes classified as `formatting`/`info` |

## What remains critical

- **Price changes** — different numeric values (e.g., "16" vs "18")
- **Allergen code changes** — different codes (e.g., "GF" vs "VG")
- **Missing dish names** — substantive words (3+ chars) absent from PDF
- **Spelling and diacritical changes** remain warnings for reviewer attention

## Architecture

```
design-comparison-rules.json (loaded once at startup)
        |
        v
compareMenuTexts()
  ├── prepareLines() — Unicode cleanup + managed-copy separation
  ├── selectPdfLines() — maps one source line to proof layout fragments
  ├── compareLexicalTokens() — order-independent word matching
  ├── appendStructuredDifferences() — price + allergen comparison
  ├── downgradeLayoutOnlyDifferences() — whole-proof evidence check
  └── Returns { differences, alignments }
        |
        v
Frontend renderSplitView()
  ├── Uses alignments for inline word-level diffs
  ├── renderCharDiff() — character-level LCS highlighting
  └── Severity-based coloring (critical=red, warning=gold, info=subtle)
```

## Visual improvements

The split view now shows:
- **Inline word highlighting** — only differing words are highlighted, not entire lines
- **Character-level diffs** — specific changed characters bolded/colored on the PDF side
- **Aligned spacer lines** — missing/extra lines get empty spacers on the opposite panel
- **Severity coloring** — critical (red underline), warning (gold underline), info (dashed gray)

## Editing rules

Edit `services/dashboard/design-comparison-rules.json` for leading phrases, ignorable words, or minimum word length, then rebuild/restart the dashboard so the file is copied into `dist/`. Other semantic tolerances are code behavior and require comparator tests, including the four real-pair regression cases.
