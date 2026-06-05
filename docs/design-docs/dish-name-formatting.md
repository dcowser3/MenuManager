# Dish Name Formatting

## Status

Implemented.

## Goal

After Basic AI Check, the reviewed menu preview should bold high-confidence dish names, and that same rich HTML should be submitted downstream. The preview is not a cosmetic-only layer; it is the source for the generated DOCX and review handoff.

## Approach

Dish-name formatting reuses the shared approved-dish extractor instead of asking the AI to add markdown or creating a separate dashboard-only parser. The shared helper builds formatting anchors from the final corrected menu text after deterministic and guardrail corrections have run.

Formatting anchors are intentionally stricter than approved-dish storage:

- the extracted dish name must be an exact prefix of one unique source line
- the same line must have a strong dish signal, such as an inline description separator, a trailing price, or trailing allergen/price cluster
- high-severity or excluded quality rows are skipped
- ambiguous duplicate source lines are skipped
- two-line name/description candidates are skipped unless the name line itself has a same-line dish signal

Simple price-only items such as `Churros 8` or `Classic Margarita 18` can be bolded even when approved-dish quality marks them for review due to missing description. Rows that are plausible for database review but risky for visible formatting, such as `Venue, Room`, remain unbolded.

## Dashboard Behavior

`/api/form/basic-check` returns a `dishNameFormatting` array alongside `correctedMenu`. The browser resolves those anchors against the displayed reviewed text, applies bold formatting through Quill, and passes the resulting rich HTML into the persistent modification preview renderer.

For modification submissions, the generated DOCX uses the persistent right-side preview HTML. The preview renderer now receives the revised rich HTML so automatic and manual dish-name bolding persist into handoff artifacts.

## Failure Behavior

Anchor generation is best-effort. If it fails or a line cannot be matched safely, Basic AI Check still succeeds and the affected dish name is left unbolded. The formatter never changes menu text, suggestions, critical blocking, or AI prompts.
