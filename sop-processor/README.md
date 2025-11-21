# SOP Processor

This directory contains the scripts and data for processing the company's Standard Operating Procedures (SOP) document. The goal is to convert the human-readable SOP into structured data that can be used to validate menu submissions and train an AI model.

## Steps

1.  **Add SOP PDF**: Place your company's SOP document, named `company_sop.pdf`, into this directory.

2.  **Install Dependencies**: Set up a Python virtual environment and install the required packages.
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows use `venv\Scripts\activate`
    pip install -r requirements.txt
    ```

3.  **Extract Text**: Run the extraction script to parse the PDF and create a raw text file.
    ```bash
    python extract_sop.py
    ```
    This will generate a `sop_raw_text.txt` file.

4.  **Curate Rules**: Open `sop_raw_text.txt` and the placeholder `sop_rules.json`. Manually transfer the rules from the text file into the structured JSON format. This is a crucial step that requires careful interpretation of the SOP.

5.  **Build Examples**: Based on historical data (old menus and their corrections), populate the `training_examples.json` file with "before" and "after" examples.

## Prompts and Usage

- **QA Pre‑Check (Chef‑Facing, SOP‑Only)**  
  File: `qa_prompt.txt`  
  Purpose: Provide a generic quality check aligned with the SOP prompt given to chefs.  
  Notes: Do not add custom house rules here; this must match what any chef can run with standard ChatGPT.

- **Redlining (Internal, House Rules Applied)**  
  Rules source: `sop_rules.json`  
  Consumers: Tier‑2 redline prompt in `services/ai-review/index.ts` and AI corrector in `services/docx-redliner/ai_corrector.py`.  
  Notes: Enforces separators, dual‑price formatting, diacritics, non‑trivial spellings, allergen formatting, non‑ALL‑CAPS item names, and legacy red‑highlight interpretation (read‑only).
