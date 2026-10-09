#!/usr/bin/env python3
"""Tests for project-detail extraction from populated RSH template DOCX files."""

import os
import tempfile

from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.shared import RGBColor

from extract_project_details import detect_allergen_key, extract_project_details


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


def test_detects_parenthesized_allergen_key():
    doc = Document()
    doc.add_paragraph("(C) CELERY (D) DAIRY (E) EGGS (F) FISH (G) GLUTEN (L) LUPIN")
    doc.add_paragraph("(M) MUSTARD (P) PORK (PN) PEANUTS (S) SHELLFISH (SL) SULPHITES")
    doc.add_paragraph("(SS) SESAME (SY) SOY (TN) TREE NUTS (V) VEGETARIAN")

    assert detect_allergen_key(doc.paragraphs) == (
        "C celery | D dairy | E eggs | F fish | G gluten | L lupin | "
        "M mustard | P pork | PN peanuts | S shellfish | SL sulphites | "
        "SS sesame | SY soy | TN tree nuts | V vegetarian"
    )


def test_parenthesized_allergen_key_stops_before_footer_copy():
    doc = Document()
    doc.add_paragraph(
        "(C) CELERY (D) DAIRY (E) EGGS (F) FISH (G) GLUTEN (V) VEGETARIAN "
        "ALL PRICES ARE IN AED, INCLUSIVE OF 7% MUNICIPALITY FEES, 10% SERVICE CHARGE AND 5% VAT."
    )

    assert detect_allergen_key(doc.paragraphs) == (
        "C celery | D dairy | E eggs | F fish | G gluten | V vegetarian"
    )


def test_extract_project_details_returns_parenthesized_allergen_key():
    doc = Document()
    doc.add_paragraph("MENU")
    doc.add_paragraph("Ice Cream & Sorbets D,E,G,PN,SY,TN 35")
    doc.add_paragraph("(D) DAIRY (E) EGGS (G) GLUTEN (PN) PEANUTS (SY) SOY (TN) TREE NUTS")

    result = _save_and_extract(doc)

    assert result["allergen_key"] == "D dairy | E eggs | G gluten | PN peanuts | SY soy | TN tree nuts"


def test_extracts_red_struck_removals_and_yellow_requirements_for_design_comparison():
    doc = Document()
    doc.add_paragraph("MENU")

    red_item = doc.add_paragraph()
    red_run = red_item.add_run("Kale Salad, apple, cheese D")
    red_run.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)

    struck_item = doc.add_paragraph()
    struck_run = struck_item.add_run("Yucatan Kibis, beef D")
    struck_run.font.strike = True

    partial_removal = doc.add_paragraph()
    partial_removal.add_run("Shrimp Ceviche, avocado, ")
    cherry = partial_removal.add_run("cherry")
    cherry.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
    partial_removal.add_run(" tomato S")

    yellow_item = doc.add_paragraph()
    yellow_run = yellow_item.add_run("Maduros, plantains, crema D,V")
    yellow_run.font.highlight_color = WD_COLOR_INDEX.YELLOW

    result = _save_and_extract(doc)

    assert result["menu_content"] == (
        "Kale Salad, apple, cheese D\n"
        "Yucatan Kibis, beef D\n"
        "Shrimp Ceviche, avocado, cherry tomato S\n"
        "Maduros, plantains, crema D,V"
    )
    assert result["comparison_menu_content"] == (
        "\n\nShrimp Ceviche, avocado, tomato S\nMaduros, plantains, crema D,V"
    )
    assert [(item["text"], item["scope"]) for item in result["removed_content"]] == [
        ("Kale Salad, apple, cheese D", "line"),
        ("Yucatan Kibis, beef D", "line"),
        ("cherry", "fragment"),
    ]
    assert result["required_content"] == [{
        "text": "Maduros, plantains, crema D,V",
        "context": "Maduros, plantains, crema D,V",
        "active_text": "Maduros, plantains, crema D,V",
        "scope": "line",
        "markers": ["yellow"],
        "paragraph_index": 4,
    }]


if __name__ == "__main__":
    test_extracts_split_property_fields_from_new_template()
    test_detects_parenthesized_allergen_key()
    test_parenthesized_allergen_key_stops_before_footer_copy()
    test_extract_project_details_returns_parenthesized_allergen_key()
    test_extracts_red_struck_removals_and_yellow_requirements_for_design_comparison()
