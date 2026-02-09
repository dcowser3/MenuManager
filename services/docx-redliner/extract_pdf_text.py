#!/usr/bin/env python3
"""
Extract text content from a PDF file using PyMuPDF.
Outputs JSON to stdout with page-by-page text, full text, and metadata.

Usage:
    python extract_pdf_text.py <pdf_path>
"""

import sys
import json

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "PyMuPDF not installed. Run: pip install PyMuPDF"}), file=sys.stdout)
    sys.exit(1)


def extract_pdf_text(pdf_path: str) -> dict:
    """
    Extract text from a PDF file.

    Returns:
        dict with pages (list of page texts), full_text, page_count, has_text_layer
    """
    doc = fitz.open(pdf_path)

    pages = []
    full_text_parts = []
    has_text_layer = False

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        pages.append(text)
        full_text_parts.append(text)
        if text.strip():
            has_text_layer = True

    doc.close()

    return {
        "pages": pages,
        "full_text": "\n".join(full_text_parts),
        "page_count": len(pages),
        "has_text_layer": has_text_layer
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python extract_pdf_text.py <pdf_path>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        result = extract_pdf_text(pdf_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
