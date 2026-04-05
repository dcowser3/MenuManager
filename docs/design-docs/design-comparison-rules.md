# Design Comparison Rules

> **Status:** Complete (Apr 2026)
> **Updated:** 2026-04-03

## Problem

The design approval DOCX-vs-PDF comparison was too strict, producing excessive false positives (100+ issues on well-aligned menus). Designers routinely make acceptable changes — casing, removing prefixes like "Choice of:", adding conjunctions, reordering items — that don't warrant critical or warning-level flags.

## Solution

A configurable rules file (`services/dashboard/design-comparison-rules.json`) controls comparison tolerance. The comparison engine applies these rules during fuzzy line matching, word alignment, and diff classification.

## Rules Reference

| Rule | Default | Effect |
|------|---------|--------|
| `ignoreCaseDifferences` | `true` | Case-only diffs ("Tan Mimosa" vs "TAN MIMOSA") treated as info |
| `ignoreLeadingPhrases` | `["Choice of:", ...]` | Listed prefixes stripped before comparison |
| `ignoreConjunctionChanges` | `true` | Added/removed "or", "and", "&" treated as info |
| `ignorePunctuationDifferences` | `true` | Punctuation-only diffs (trailing comma, colon) treated as info |
| `ignoreWhitespaceInPrices` | `true` | Price on separate line in PDF treated as info |
| `reorderingTolerance` | `true` | Unmatched lines re-matched across positions (reorder detection) |
| `minWordLengthForMissing` | `3` | Missing words shorter than this are info, not critical |
| `ignorableWords` | `["of", "the", ...]` | These words missing/added are always info severity |
| `treatCaseOnlyAsInfo` | `true` | Case-only word changes classified as `formatting`/`info` |

## What remains critical

- **Price changes** — different numeric values (e.g., "16" vs "18")
- **Allergen code changes** — different codes (e.g., "GF" vs "VG")
- **Missing dish names** — substantive words (3+ chars) absent from PDF
- **Spelling changes** — actual word changes beyond case/punctuation/diacritical

## Architecture

```
design-comparison-rules.json (loaded once at startup)
        |
        v
compareMenuTexts()
  ├── linesMatchFuzzy() — uses normalizeLine() with rules
  ├── Reordering pass — re-matches docx_only ↔ pdf_only lines
  ├── compareWords() — word-level LCS with rule-aware matching
  │   └── classifyWordDiff() — severity based on rules
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

Edit `services/dashboard/design-comparison-rules.json` and restart the dashboard service. No code changes needed to adjust tolerance levels.
