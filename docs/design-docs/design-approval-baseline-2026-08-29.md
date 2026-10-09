# Design Approval Baseline — 2026-08-29

## Scope

The initial `/api/design-approval/compare` route was exercised against four local DOCX/PDF pairs documented in [`samples/Design Approval Pairs/README.md`](../../samples/Design%20Approval%20Pairs/README.md). Three were subsequently traced to Outlook/SharePoint handoffs and form the current curated regression; the older legacy tán Brunch Bebidas pair is retained for historical comparison but is not an Outlook-sourced regression fixture.

- Environment: Docker development stack
- Source revision: `0d3a7ab`
- PyMuPDF: `1.28.2`
- API output counts below exclude `info` differences because the route filters them before responding.

## Raw endpoint result

All four normal requests returned HTTP 400 before comparison. Importing the deprecated `fitz` API writes this line to stdout:

```text
warning: The `fitz` API is deprecated and will be removed in future. Use `import pymupdf` instead.
```

`extract_pdf_text.py` then writes its JSON to the same stream. `design-approval-workflow.ts` passes the combined stdout directly to `JSON.parse`, which fails on the leading warning.

To measure the comparison algorithm without editing project code, the dashboard was temporarily started with `PYMUPDF_MESSAGE=fd:2`. That redirects only PyMuPDF's diagnostic message to stderr. The normal dashboard container was restored after the run.

## Comparator results after diagnostic bypass

| Pair | Match | Critical | Warning | Total | Obvious alignment evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Legacy tán Brunch Bebidas | No | 18 | 8 | 26 | 10 of 18 critical missing entries contain words found elsewhere in the PDF. |
| tán Brunch | No | 47 | 41 | 88 | 39 of 43 critical missing entries contain words found elsewhere in the PDF. |
| Tamayo Happy Hour | No | 43 | 30 | 73 | 31 of 42 critical missing entries contain words found elsewhere in the PDF. |
| Aqimero DDLM Dinner | No | 16 | 16 | 32 | 8 of 14 extra lines contain words found in the DOCX. |

### Difference mix

| Pair | Critical missing | Critical price | Critical allergen | Warning extra | Warning spelling | Warning diacritical |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Legacy tán Brunch Bebidas | 18 | 0 | 0 | 1 | 2 | 5 |
| tán Brunch | 43 | 2 | 2 | 38 | 3 | 0 |
| Tamayo Happy Hour | 42 | 0 | 1 | 26 | 4 | 0 |
| Aqimero DDLM Dinner | 13 | 1 | 2 | 14 | 1 | 1 |

## Main findings

1. **The default route is currently blocked before comparison.** The PDF extractor's stdout is not a JSON-only contract with the installed PyMuPDF version.
2. **Line layout dominates the result.** The LCS alignment treats PDF line wrapping, separated dish names/allergen codes, columns, and reordered footer text as missing-plus-extra content. The tán and Tamayo results are mostly navigation noise rather than actionable menu discrepancies.
3. **Allergen legend text is cross-aligned as menu content.** Examples include `dairy` being compared with `(N)`, `nuts` with `(V)`, and `shellfish` with `(G)`, producing critical allergen findings that do not describe a real dish-level change.
4. **DOCX extraction includes source noise.** The Tamayo source contains duplicated tracked-edit text such as `PUREEPURÉE`, `SEERRANOSERRANO`, `AVAOCADOAVOCADO`, and `2122`, plus editorial instructions such as `(remove jackfruit tinga tacos)`. These become false mismatches.
5. **Some classifications are misleading.** Aqimero's `2026.` versus `2026` is classified as a critical price change. PDF ligatures and control characters such as `ﬂour`, `shellﬁsh`, and the extracted Mahi-Mahi separator create spelling/alignment noise.
6. **Real changes are present but buried.** The legacy pair exposes missing wine rows and ingredient changes. Aqimero includes real wording/spelling corrections and added presentation text. The current volume and severity of false positives make those findings difficult to review reliably.

## Recommended refinement order

1. Restore a strict JSON-only PDF extraction contract (`pymupdf` import and/or defensive JSON parsing).
2. Add these four pairs to an automated fixture harness that records full result JSON without writing normal approval records.
3. Normalize content into semantic blocks before alignment: section heading, dish name, description, allergen codes, and price.
4. Handle PDF line wrapping and column reading order before declaring missing or extra content.
5. Exclude or separately compare allergen legends, raw-food notices, service-charge text, dates, and other managed footer/header blocks.
6. Normalize ligatures, non-printing separators, punctuation-only changes, and numeric tokens before classification.
7. Establish reviewed expected differences for each pair, then use precision/recall rather than a raw difference count as the regression target.

## Post-refinement verification (2026-08-29)

The first six recommendations were implemented on 2026-08-29. Reviewers still need to establish a final accepted-difference set before precision/recall can replace the current reviewed count envelopes.

All four normal multipart upload requests now return HTTP 200 with valid JSON; the deprecated-import stdout failure is gone.

| Pair | Before actionable | After actionable | Before critical | After critical | Key retained findings |
| --- | ---: | ---: | ---: | ---: | --- |
| Legacy tán Brunch Bebidas | 26 | 25 | 18 | 16 | Missing bottomless price, ingredient omissions, missing wine rows |
| tán Brunch | 88 | 12 | 47 | 2 | Kale Salad and Maduros are absent from the proof |
| Tamayo Happy Hour | 73 | 15 | 43 | 2 | Source/proof naming and section differences remain visible; relocated prices no longer block |
| Aqimero DDLM Dinner | 32 | 14 | 16 | 8 | Missing `$85 pp`, four added allergen codes, and content corrections remain visible |

The route omits informational differences from its response. Managed legends/notices, proof wrapping, and content found elsewhere in the layout are retained only in comparator alignments and no longer inflate the actionable totals.

## Approved-DOCX markup-key refinement (2026-09-01)

The comparison source is now derived from the approved Word document's editing key:

- red text or strikethrough is excluded from the active baseline and must be absent from the PDF;
- yellow-highlighted text remains in the active baseline and must be present in the PDF;
- a marked dish name applies to the whole dish line, while an ingredient-only mark applies to that fragment.

The automated real-pair regression now contains only the three Outlook/SharePoint-sourced curated pairs.

| Pair | Current actionable | Current critical | Markup instructions found | Key retained findings |
| --- | ---: | ---: | ---: | --- |
| tán Brunch | 12 | 3 | 4 removals, 2 additions | Maduros required addition missing; `cherry` and Yucatan Kibis removal requests still present. Kale Salad is correctly absent and no longer flagged. |
| Tamayo Happy Hour | 17 | 5 | 11 removals, 14 additions | One required addition, one other missing-content result, and three failed removals remain for reviewer validation. |
| Aqimero DDLM Dinner | 14 | 8 | None | Missing `$85 pp`, four added allergen codes, and content corrections remain visible. |

The tán Brunch expectation is reviewed and asserted exactly. The Tamayo and Aqimero count envelopes remain provisional until the same document-by-document review is completed.
