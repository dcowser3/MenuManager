# Revision / Modification Flow

## Status

Complete (MVP implemented)

## Goal

Support two chef submission paths in the same form:

1. **Brand New Menu**
2. **Modification of Existing Menu**

For modification flows, the baseline approved text must come from one of:

- Latest approved submission in Menu Manager database, or
- Chef-uploaded approved/redlined DOCX (for legacy projects not yet in DB).

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
  - Search approved submissions by project/property/submitter.
  - Load approved baseline text into editor.
- `Upload Prior Approved DOCX`:
  - Upload previously approved/redlined DOCX.
  - System extracts clean menu text + project details to prefill fields.

## Step 3: Editing + Review

- Chef edits menu as usual.
- Right-side persistent preview shows live diff against approved baseline:
  - Deletions: red strike-through
  - Insertions: yellow highlight
- AI check runs on edited text and overlays temporary suggestion highlights separately.

## Data Model Additions (JSON DB)

Submission fields:

- `project_name`
- `property`
- `date_needed`
- `menu_content`
- `menu_content_html`
- `submission_mode` (`new` | `modification`)
- `revision_source` (`database` | `uploaded_baseline`)
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
- `GET /api/submissions/latest-approved`
- `POST /api/modification/baseline-upload`

DB service:

- `GET /submissions/search`
- `GET /submissions/latest-approved`
- `POST /assets`
- `GET /assets/by-submission/:submissionId`

ClickUp integration:

- Webhook now extracts/stores canonical approved text from Isabella upload.
- Task creation now includes modification metadata and attaches uploaded baseline DOCX when provided.

## ClickUp Behavior for Modifications

When chef uses uploaded baseline flow:

- The uploaded prior approved DOCX is attached to the ClickUp task.
- This gives Isabella direct visibility to verify the baseline version submitted by chef.

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
  - Verifies revision fields are persisted and ClickUp payload includes baseline DOCX metadata
