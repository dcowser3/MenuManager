# Design Approval

**Status:** Complete (Updated Mar 2026)

A comparison tool that validates printed PDF proofs against the approved DOCX source.

## User Flow

1. User visits `/submit/:token` (welcome page) or navigates directly to `/design-approval`
2. Completes required approvals (`RSH Culinary`, `RSH Regional`)
3. Chooses DOCX source:
   - Upload local DOCX, or
   - Search and select an approved submission from the database
4. Uploads the PDF proof
5. System extracts text from both documents and compares them
6. Differences are displayed, classified by type
7. If needed, user can submit a mismatch override with required reason

## Comparison Algorithm

- **Text extraction:** `extract_pdf_text.py` (PyMuPDF) for PDFs, `extract_project_details.py` (python-docx) for DOCX
- **Line alignment:** Uses Longest Common Subsequence (LCS) algorithm
- **Word-level diff:** Within matched lines, performs word-by-word comparison
- **Diff classification:** Each difference is categorized as one of:
  - `price` — Price discrepancy
  - `allergen` — Allergen code difference
  - `diacritical` — Accent/diacritical mark difference
  - `spelling` — Spelling change
  - `missing` — Content in template but not in proof
  - `extra` — Content in proof but not in template

## Architecture

- **Routes:** `/submit/:token` (welcome page), `/design-approval` (comparison tool)
- **API routes:** `POST /api/design-approval/compare`, `POST /api/design-approval/:submissionId/override`
- **Python scripts:** Located in `services/docx-redliner/`
  - `extract_pdf_text.py` — Uses PyMuPDF
  - `extract_project_details.py` — Uses python-docx
- **Python venv:** `services/docx-redliner/venv/bin/python`
- Submitter autocomplete is available on this form (see [submitter-autofill.md](submitter-autofill.md))

## Data Notes

- Design approval comparisons are saved as submissions (`source: design_approval`)
- Required approvals are stored in submission metadata
- Override writes:
  - `status: approved_override`
  - `mismatch_override: true`
  - `mismatch_override_reason`
  - `mismatch_override_at`
