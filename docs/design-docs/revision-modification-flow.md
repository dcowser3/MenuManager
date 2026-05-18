# Revision / Modification Flow

## Status

Complete (MVP implemented)

## Goal

Support two chef submission paths in the same form:

1. **Brand New Menu**
2. **Modification of Existing Menu**

For modification flows, the baseline text must come from one of:

- Latest approved submission in Menu Manager database, or
- Chef-uploaded approved/redlined DOCX (for legacy projects not yet in DB), or
- Chef-uploaded **unapproved** DOCX with existing redlines/highlights preserved.

## Key Rules

- AI output is **not** final approval.
- Canonical approved text is captured only after Isabella uploads corrected DOCX in ClickUp and task reaches the configured approval status.
- Chef revision redlines are **persistent** (design-facing).
- AI suggestion highlights are **temporary** (review UX only).

## User Experience

## Step 1: Mode Selection

- `Brand New Menu Submission` (default)
- `Modification to Existing Menu`

## Step 2 (Modification only): Baseline Source Selection

- `Find In Database`:
  - Search approved submissions by project/property/service period/submitter. Submitted ClickUp tasks do not appear here until an approved DOCX has been processed and the submission status is `approved`.
  - Results are newest-first, with exact property + service-period matches prioritized when those fields are already selected.
  - Each result indicates whether it is the latest approved baseline for its property/service period.
  - Load approved baseline text into editor.
- `Upload Prior Approved DOCX`:
  - Upload previously approved/redlined DOCX.
  - System extracts clean menu text + project details to prefill fields.
- `Upload Unapproved DOCX (Preserve Redlines)`:
  - Upload DOCX still under review with existing tracked changes / highlights.
  - System extracts all visible text (including deletions) and preserves existing redlines as `existing-del` / `existing-ins` CSS classes.
  - Python script returns per-paragraph annotation ranges so the persistent preview can render both layers: existing redlines + new chef changes.

## Step 3: Editing + Review

- Chef edits menu as usual.
- Before AI review or final submission, the form checks the selected property/service period against the latest approved baseline. If the user selected an older or mismatched baseline, or starts a new menu where an approved baseline already exists, the form warns and offers to load the latest approved menu or continue intentionally.
- Right-side persistent preview shows live diff against approved baseline:
  - Deletions: red strike-through
  - Insertions: yellow highlight
- Separator and punctuation edits are diffed as first-class changes, so hyphen/comma/slash rewrites render as explicit insertions/deletions instead of being treated as unchanged text.
- In normal modification mode, AI review is scoped to changed lines only (computed against approved baseline).
- In uploaded unapproved/redlined DOCX mode, AI review runs against the full accepted visible menu text. Existing redline edits can already contain typos, so the full candidate text must be reviewed even when the chef makes no additional browser edits after upload.
- Re-run AI Check uses the same normalized editor text extraction as the initial check; it does not read raw browser `innerText`, which can introduce extra blank lines around rendered block elements on each pass.
- Managed footer handling is split into structured fields:
  - Menu body is used for AI review and persistent design redlines.
  - Allergen legends are normalized into the Allergen Key field and appended once during DOCX generation.
  - Property-specific legal/footer notes and custom raw-food warnings are preserved as footer text and appended during generation, but excluded from the editor diff so design does not see them as deleted menu changes.
- AI suggestion highlights remain temporary and separate from persistent chef revision markup, but they now preserve punctuation/separator mutations in the highlighted ranges instead of normalizing them away.

## Data Model Additions (JSON DB)

Submission fields:

- `project_name`
- `property`
- `date_needed`
- `menu_content`
- `menu_content_html`
- `submission_mode` (`new` | `modification`)
- `revision_source` (`database` | `uploaded_baseline` | `uploaded_unapproved`)
- `revision_base_submission_id` (nullable)
- `revision_baseline_doc_path` (nullable)
- `revision_baseline_file_name` (nullable)
- `base_approved_menu_content` (nullable)
- `chef_persistent_diff` (summary for now)
- `critical_overrides`

Approved-text fields set by ClickUp webhook:

- `approved_menu_content_raw`
- `approved_menu_content`
- `approved_text_extracted_at`

## File Storage Metadata (Teams-ready)

New `assets` collection supports storage abstraction:

- `original_docx` (chef form output)
- `baseline_approved_docx` (chef uploaded baseline for modification flow)
- `approved_docx` (Isabella-approved DOCX from ClickUp webhook)

Fields include provider/path/source to allow future migration from local filesystem to Teams/SharePoint.

## New / Updated Endpoints

Dashboard service:

- `GET /api/submissions/search`
- `GET /api/submissions/latest-approved` (property + service-period canonical lookup, with project/property fallback for older callers)
- `POST /api/modification/baseline-upload`
- `POST /api/modification/unapproved-upload`

DB service:

- `GET /submissions/search`
- `GET /submissions/latest-approved`
- `POST /assets`
- `GET /assets/by-submission/:submissionId`

ClickUp integration:

- Webhook now extracts/stores canonical approved text from Isabella upload.
- Task creation now includes modification metadata and attaches uploaded baseline DOCX when provided.
- Form submit persists the generated DOCX and baseline asset before triggering the full Tier 2 AI review asynchronously, so uploaded approved-baseline modification submissions are not held open by slow OpenAI review calls.

## ClickUp Behavior for Modifications

When chef uses uploaded baseline flow:

- The uploaded prior approved DOCX is attached to the ClickUp task.
- This gives Isabella direct visibility to verify the baseline version submitted by chef.
- The persistent preview receives the extracted baseline HTML, and `@menumanager/diff-core` maps text offsets back to rich HTML ranges so unchanged/deleted tokens keep baseline inline styles such as bold and italic. DOCX non-breaking spaces are treated as equivalent to normal spaces for style-index matching so one whitespace glyph does not flatten the whole preview.

## Approval Editor Source Reuse

- The browser approval editor loads the **submitted** menu DOCX first (`submission.original_path`) so the rich editor and downloads match the generated file from the form (including chef edits such as intentional spellings). The modification **baseline** artifact (`revision_baseline_doc_path`) remains stored for ClickUp attachments, differ, and training — it is only used when no submission DOCX path is available.
- Source priority (shared with “Download Original DOCX” resolution) is:
  1. `original_path`
  2. `final_path`
  3. `revision_baseline_doc_path`
  4. saved submission HTML/text fallback if every DOCX path fails extraction
- Extraction mode follows the candidate’s `revision_source` when the revision baseline path is chosen:
  - `uploaded_baseline` → clean baseline extraction
  - `uploaded_unapproved` → unapproved extraction with preserved redlines
- When an unapproved/redlined DOCX is used as the approval source, the editor keeps separate text baselines: clean accepted text for the left rich editor, and full visible text plus `existing-del` / `existing-ins` HTML for the right preview.
- DOCX-derived preview HTML is normalized to strip leading/trailing empty `<p><br></p>` blocks so the live preview aligns vertically with the editor (which trims leading blank lines).
- The left rich editor is initialized by projecting the DOCX baseline HTML onto the clean accepted text, removing imported deletion spans, unwrapping imported insertion spans, and preserving inline markup such as `<strong>` and `<em>`.
- When the editor must fall back to saved `menu_content_html`, temporary green AI-review highlight spans are unwrapped before display/submission so the approval editor only shows formatting plus imported/live redlines.
- Imported redline groups are resolved against live edits: if the reviewer changes accepted text back to the original deleted value, that imported redline is collapsed to plain text and no live insertion/deletion is shown for that group.
- After the chef edits, the live redline preview passes `baselineHtml` into `renderPersistentPreview` so unchanged and deleted tokens keep inline markup (`<strong>`, `<em>`, etc.) via `Range#cloneContents` instead of flattening to plain text.
- Approval-editor text normalization preserves leading indentation from extracted DOCX paragraphs so alignment-sensitive content such as allergen legends is not flattened in the review UI.

## Unapproved DOCX Flow (Preserve Existing Redlines)

When a chef uploads an unapproved DOCX:

1. **Python extraction** (`extract_clean_menu_text.py --mode unapproved`):
   - Returns `visible_text` (all text including deletions), `unapproved_html` (with `existing-del`/`existing-ins` spans), and per-paragraph `annotations` (char-offset ranges with type `del`/`ins`).
2. **Dashboard endpoint** (`POST /api/modification/unapproved-upload`):
   - Calls the Python script with `--mode unapproved` and also attempts project-detail extraction.
   - Project metadata and allergen-key extraction are best-effort; if `extract_project_details.py` times out or fails, the upload still succeeds and the redline editor opens with blank metadata/allergen fields rather than returning `500`.
   - Allergen-key extraction supports pipe-delimited keys and parenthesized keys such as `(C) CELERY (D) DAIRY`, normalizing detected keys into the pipe-delimited form used by the dashboard field and AI review prompt.
3. **Frontend** (`form.ejs`):
   - Loads `unapprovedBaseHtml` into the editable review area so existing redlines are visible during editing.
   - Strips managed footer paragraphs from uploaded baseline/unapproved HTML before building the editable/diff baseline, while retaining preserved footer text separately for submission.
   - `renderPersistentPreview()` uses annotation ranges to wrap unchanged tokens in `existing-del`/`existing-ins` spans; new changes get `persistent-del`/`persistent-ins` as usual.
   - Annotation wrapping splits tokens at imported redline boundaries, so adjacent DOCX deletion/insertion runs such as `neapolitan` + `Neapolitan` remain separately styled after a later live edit.
   - Tokenization, token equality, and LCS alignment come from `@menumanager/diff-core`, the same shared helper package used by the backend differ service.
   - Runs the AI check in full-review mode for uploaded unapproved DOCX content, while approved-baseline modification flows keep changed-only review.
   - The preview diff tokenizes punctuation and separators separately so ingredient-separator edits are visible in the persistent redline.
   - Extracted Date Needed values only apply when they are valid `YYYY-MM-DD` values; otherwise the read-only Date Needed field remains at the turnaround-derived minimum date.
4. **DOCX generation** (`generate_from_form.py`):
   - `existing-del` → red strikethrough, `existing-ins` → yellow highlight (same formatting as `persistent-del`/`persistent-ins`).
   - Submission-time footer normalization removes chef-supplied allergen legends from the editable body, normalizes the allergen key, and appends one managed allergen legend.
   - Legal/price/footer copy after the allergen legend, including AED service-charge text and venue-specific foodborne warnings, is preserved and appended after the managed allergen legend instead of being rewritten to the canonical warning.
   - If no foodborne warning is present but the menu is marked or detected as containing raw/undercooked items, the workflow appends the canonical foodborne warning.

## Notes / Limits

- Canonical text extraction is robust for:
  - manual strikethrough deletions
  - tracked changes deletions (`w:del`, `w:moveFrom`)
- Future improvement:
  - deeper handling for uncommon track-change edge cases across mixed run structures.

## Basic Test Coverage

- `services/dashboard/__tests__/modification-workflow.test.js`
  - Modification submit with DB baseline source
  - Modification submit with uploaded baseline source
  - Basic check short-circuits when no modification lines changed
  - Basic check sends only changed lines to AI in modification mode
  - Verifies revision fields are persisted and ClickUp payload includes baseline DOCX metadata
