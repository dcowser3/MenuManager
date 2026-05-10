#!/usr/bin/env python3
"""Tests for project-detail extraction from populated RSH template DOCX files."""

import os
import tempfile

from docx import Document

from extract_project_details import extract_project_details


def _save_and_extract(doc):
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        doc.save(f.name)
        try:
            return extract_project_details(f.name)
        finally:
            os.unlink(f.name)


def test_extracts_split_property_fields_from_new_template():
    doc = Document()
    table = doc.add_table(rows=0, cols=2)
    rows = [
        ("MENU NAME", "Dinner Menu"),
        ("OUTLET NAME", "Maya"),
        ("HOTEL NAME", "Le Royal Meridien"),
        ("CITY / COUNTRY", "Dubai"),
        ("SIZE (PIXELS = WEB) OR (INCHES = PRINT)", "8.5 x 11 inches"),
        ("ORIENTATION (PORTRAIT OR LANDSCAPE)", "Portrait"),
        ("DATE NEEDED", "2026-05-20"),
    ]
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].text = label
        cells[1].text = value

    doc.add_paragraph("MENU")
    doc.add_paragraph("Taco - grilled fish")

    result = _save_and_extract(doc)

    assert result["project_details"] == {
        "project_name": "Dinner Menu",
        "property": "",
        "outlet": "Maya",
        "hotel": "Le Royal Meridien",
        "city": "Dubai",
        "size": "8.5 x 11 inches",
        "orientation": "Portrait",
        "date_needed": "2026-05-20",
    }
    assert result["menu_content"] == "Taco - grilled fish"


if __name__ == "__main__":
    test_extracts_split_property_fields_from_new_template()
