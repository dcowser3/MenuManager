# Design Approval

**Status:** Production workflow implemented, direct-link rollout (Updated Sep 2026)

A comparison tool that validates printed PDF proofs against the approved DOCX source.

**Priority update — 2026-09-04:** The next feature is [PDF Rule Review](pdf-rule-review.md): check an externally designed PDF against tenant menu rules without requiring an approved Word source. The workflow below describes the existing comparison implementation, not that planned PDF-only review. Derian also confirmed that designs sometimes intentionally change after Word approval, so a mismatch alone does not establish an error. Automatically reconciling those authorized changes is deferred.

The route remains a direct design-team link and is not shown on the public welcome dashboard. The production-shaped submission and ClickUp handoff are implemented; rollout still requires the tenant's exact post-design ClickUp status in `CLICKUP_POST_DESIGN_STATUS`.

The first real-world evaluation and post-refinement results are recorded in [Design Approval Baseline — 2026-08-29](design-approval-baseline-2026-08-29.md). The current automated regression uses the three Outlook/SharePoint-sourced pairs; the older local legacy pair is retained only as historical evidence. Reviewers can still record accepted expected differences through the documented override while the direct-link rollout is evaluated.

## User Flow

1. Designer navigates to `/design-approval` and enters their submitter identity
2. Searches and selects a menu from the system
   - the page starts with no visible menu options and uses the same restaurant, service-period, optional-keyword search pattern and result-card styling as Approved Menus
   - the picker reads `menus.current_submission_id`
   - only the current approved version of an active menu is selectable
   - historical approved versions cannot be selected accidentally
3. Uploads only the designed PDF proof; the server resolves the approved DOCX itself
   - if an older container-local DOCX is gone, the server recovers the SharePoint copy or regenerates a clean comparison DOCX from the approved content already stored with that exact version
4. System extracts text from both documents and compares them
5. When enabled, the designer PDF is rendered page-by-page and visually checked against the tenant's artwork policies
6. Text and visual differences are displayed together, classified by type
7. A clean result is saved and handed to ClickUp automatically
8. If needed, an authorized reviewer can submit a mismatch override with a required reason; the same ClickUp handoff then runs
9. An incomplete ClickUp handoff can be retried without uploading the PDF attachment twice

The design team no longer uploads or selects a local Word document and does not re-attest the culinary/regional approvals. Those approvals belong to the selected approved menu version and are copied into the design-review audit record.

## Comparison Algorithm

- **JSON-safe extraction:** `extract_pdf_text.py` uses the supported `pymupdf` import and emits JSON only. The workflow also accepts a valid final JSON line if an upstream dependency writes a diagnostic first.
- **Approved-DOCX markup key:** The source baseline is derived from Word formatting before comparison. Red font or strikethrough means the marked text must be removed from the designed PDF; yellow highlight means the marked text must be present. A marked dish name removes or requires the whole dish line, while marked ingredient wording applies only to that fragment. If a run is both deletion-marked and yellow, deletion takes precedence.
- **Semantic preparation:** Normalizes ligatures, non-printing separators, Unicode dashes, whitespace, ordinal headings, and accidental glued tracked-edit variants.
- **Managed-copy separation:** Allergen legends, raw-food notices, service-charge copy, and editorial instruction lines are excluded from menu-content matching and retained as informational alignments.
- **Layout-aware alignment:** One DOCX line can align to as many as four PDF lines, allowing names, descriptions, prices, and allergen codes to be separated by proof layout. Reordered lines found elsewhere are informational instead of missing-plus-extra blockers.
- **Structured comparison:** Prices and dish-level allergen codes are compared separately from lexical text. Price-like years, times, and ordinals are not treated as menu prices.
- **Diff classification:** Each actionable difference is categorized as one of:
  - `price` — Price discrepancy
  - `allergen` — Allergen code difference
  - `diacritical` — Accent/diacritical mark difference
  - `spelling` — Spelling change
  - `missing` — Content in template but not in proof
  - `extra` — Content in proof but not in template
  - `required_addition_missing` — Yellow-highlighted content is absent from the proof
  - `removal_failed` — Red or struck content is still present in the proof

## Visual AI Review

The deterministic comparator remains responsible for wording, marked-content intent, prices, and allergens. Visual rules need page images because text extraction cannot tell whether a brand name is ordinary menu copy or part of a drawn product label.

- `render_pdf_pages.py` renders the uploaded PDF to bounded-resolution PNG pages.
- The dashboard sends those pages in small batches to `DESIGN_VISUAL_REVIEW_MODEL` (default `gpt-5.6-terra`) using structured JSON output.
- Rules come from `tenant.designApproval.visualPolicies`; the current branded-product rule permits ordinary brand names in menu text but prohibits third-party product illustrations, photos, logos, labels, packaging, and recognizable trade dress.
- A high-confidence violation uses the configured policy severity. Medium- or low-confidence detections are warnings for human review.
- If visual review is enabled but the model call fails, its key is missing, or the page limit truncates the document, the comparison receives a blocking `visual_review_unavailable` finding. The reviewer must complete a human visual review or use the existing documented override.
- The app shows the model, reviewed page count, finding count, page number, confidence, and visible evidence. It does not claim that a text-only pass is a complete design approval.

Visual AI is enabled by default in production. In local development it runs automatically when a real `OPENAI_API_KEY` is configured, or can be controlled explicitly with `DESIGN_VISUAL_REVIEW_ENABLED`.

## Architecture

- **Routes:** `/submit/:token` (welcome page), `/design-approval` (comparison tool)
- **Menu picker:** `GET /api/design-approval/menus` → DB `GET /menus/design-eligible`
- **API routes:** `POST /api/design-approval/compare`, `POST /api/design-approval/:submissionId/override`, `POST /api/design-approval/:submissionId/handoff`
- **ClickUp finalization:** dashboard calls protected `POST /design-approval/finalize` on `clickup-integration`
- **Python scripts:** Located in `services/docx-redliner/`
  - `extract_pdf_text.py` — Uses PyMuPDF
  - `render_pdf_pages.py` — Renders bounded-resolution PNGs for visual review
  - `extract_project_details.py` — Uses python-docx
- **Python venv:** `services/docx-redliner/venv/bin/python`
- **Comparator:** `services/dashboard/lib/design-comparison.ts`
- **Visual review:** `services/dashboard/lib/design-visual-review.ts`
- **Real-pair regression:** `services/dashboard/__tests__/design-comparison-real-pairs.test.ts`
- Submitter autocomplete is available on this form (see [submitter-autofill.md](submitter-autofill.md))

## Data Notes

- Design approval comparisons are saved as submissions (`source: design_approval`)
- The review uses `revision_base_submission_id` to link to the exact approved source version but is deliberately excluded from `menu_id` inheritance and menu-pointer reconciliation. A PDF review is an audit event, not a new menu-content version.
- The saved PDF lives below `DOCUMENT_STORAGE_ROOT/design-approvals/<review-id>/` and has an `assets` row with `asset_type: designed_pdf`.
- Review metadata records the source menu/version, comparison result, visual result, durable PDF path, and ClickUp handoff state.
- The selected approved version's required approvals are copied into the design-review record.
- Matched design approvals do not re-run approved-dish extraction because the selected approved menu was already extracted during culinary approval.
- When a clean or overridden design is approved, ClickUp attachment upload must succeed before a status move is attempted.
- `CLICKUP_POST_DESIGN_STATUS` intentionally has no default. If it is absent, the PDF is attached but the handoff remains visibly incomplete and retryable.
- Retry state remembers a successful attachment upload, so configuring/fixing the status and retrying does not attach a duplicate PDF.
- Override writes:
  - `status: approved_override`
  - `mismatch_override: true`
  - `mismatch_override_reason`
  - `mismatch_override_at`
