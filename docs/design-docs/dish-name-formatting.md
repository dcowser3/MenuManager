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

Description-less buffet dishes with a trailing allergen code are also dishes: bold the whole name, but not the code. A following title-cased multiword dish with its own inline description must not be swallowed as the preceding dish's description. For example, `Snow Crab Claws & Crab Legs S` and `Vegan Tiradito, cucumber, avocado, serrano, aguachile VG` receive separate anchors. A raw-marker asterisk immediately following a name is excluded from its bold range.

## Dashboard Behavior

`/api/form/basic-check` returns a `dishNameFormatting` array alongside `correctedMenu`. The browser resolves those anchors against the displayed reviewed text, applies bold formatting through Quill, and passes the resulting rich HTML into the persistent modification preview renderer.

For modification submissions, the generated DOCX uses the persistent right-side preview HTML. The preview renderer now receives the revised rich HTML so automatic and manual dish-name bolding persist into handoff artifacts.

Rich-text projection borrows source formatting, never source text or line breaks. The corrected text owns every space and newline even when the diff matches a source newline with a target space. After Quill imports rich HTML, the form checks its text against the corrected text and falls back to plain-text import if they differ, then applies dish anchors. Both `/form-new` and `/form-legacy` use this guard. Leading bold is restored by a unique matching text prefix, not the old row number; inferred headings are limited to common section labels, not every short description-less row.

Submission cleanup preserves spaces between inline tags: the space in `</strong> <span>S</span>` cannot be discarded as if it were indentation between paragraphs. The persistent preview also respects whitespace-only corrections, so removing the space before a raw-marker asterisk is not undone by unannotated baseline whitespace.

## Failure Behavior

Anchor generation is best-effort. If it fails or a line cannot be matched safely, Basic AI Check still succeeds and the affected dish name is left unbolded. The formatter never changes menu text, suggestions, critical blocking, or AI prompts.

## Toro holiday regression (2026-09-04)

The saved Basic AI Check `6f49f15f-3419-4c3a-9359-d28b76e597cc` ran on 2026-09-01 at 20:56 UTC with `gpt-5.6-luna`, for submission `f094785a-b62b-4745-9f9c-1c49a236b174` (Toro Snowmass Holiday Menu). The stored model response and final API result already placed `S` after crab, `VG` after Vegan Tiradito, and `S` after oysters. Browser projection reused source whitespace during diff alignment, moving these new suffixes across `<br>` boundaries. Separately, dish extraction consumed Vegan Tiradito as crab's description, so Vegan Tiradito had no bold anchor. Short-line heading and row-index bold restoration heuristics compounded the formatting error.

The desired crab row is **Snow Crab Claws & Crab Legs** S: the entire name is correctly bold, as a dish rather than a heading. Vegan Tiradito is independently bold, with its description and VG plain. Related deterministic checks now avoid inserting a raw-food asterisk based solely on a preparation word in an explicitly vegan name and recognize trailing allergen codes on unpriced buffet dishes.

`services/dashboard/__fixtures__/basic-check/toro-holiday.json` records the relevant consecutive original and model-corrected rows. The original uploaded DOCX is unavailable locally; source HTML in tests is reconstructed, not represented as a recovered original file. Unit regressions cover projection, extraction, the recorded response through post-AI processing, bold restoration, and the text-integrity fallback.

For a live regression, start/rebuild Docker with `./dev-up.sh --rebuild -d`, then run `node scripts/basic-ai-formatting-browser-regression.js`. It checks the real no-change Basic Check route's anchors, then replays the recorded text through the real result handler (including AI highlighting), Quill editor, accepted preview, and submission HTML on both forms, with both initially plain and bold crab names. It makes no new model call and submits no menu. Set `BASIC_CHECK_SCREENSHOT` to an absolute PNG path to capture the verified preview.
