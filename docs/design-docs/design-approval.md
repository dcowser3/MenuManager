# Design Approval

**Status:** Complete (Feb 2026)

A stateless comparison tool that validates printed PDF proofs against the original DOCX template. No database storage needed.

## User Flow

1. User visits `/submit/:token` (welcome page) or navigates directly to `/design-approval`
2. Uploads the DOCX template and the PDF proof
3. System extracts text from both documents and compares them
4. Differences are displayed, classified by type
5. User reviews and submits approval

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
- **Python scripts:** Located in `services/docx-redliner/`
  - `extract_pdf_text.py` — Uses PyMuPDF
  - `extract_project_details.py` — Uses python-docx
- **Python venv:** `services/docx-redliner/venv/bin/python`
- Submitter autocomplete is available on this form (see [submitter-autofill.md](submitter-autofill.md))
