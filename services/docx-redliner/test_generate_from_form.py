#!/usr/bin/env python3
"""Tests for generated DOCX menu-body formatting."""

import os
import tempfile

from docx import Document

from generate_from_form import MenuHTMLParser, populate_template


def test_menu_html_parser_preserves_intentional_blank_paragraphs():
    parser = MenuHTMLParser()
    parser.feed(
        "<p>Lunch Menu</p>"
        "<p><br></p>"
        "<p><strong>Ensaladas y Sopa</strong></p>"
        "<p>Rainbow Quinoa Bowl</p>"
    )

    lines = parser.get_lines()

    assert ["".join(part["text"] for part in line) for line in lines] == [
        "Lunch Menu",
        "",
        "Ensaladas y Sopa",
        "Rainbow Quinoa Bowl",
    ]
    assert lines[2][0]["bold"] is True


def test_populate_template_keeps_preview_spacing_in_docx_body():
    template = Document()
    template.add_paragraph("MENU")

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as template_file:
        template.save(template_file.name)
        template_path = template_file.name

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as output_file:
        output_path = output_file.name

    try:
        populate_template(
            template_path,
            {
                "projectName": "Lunch Menu",
                "menuContentHtml": "<p>Lunch Menu</p><p><br></p><p>Para la Mesa</p>",
            },
            output_path,
        )

        generated = Document(output_path)
        body_text = [paragraph.text for paragraph in generated.paragraphs]
        assert body_text[-3:] == ["Lunch Menu", "", "Para la Mesa"]

        menu_paragraphs = generated.paragraphs[-3:]
        assert all(paragraph.paragraph_format.left_indent.inches == 1.0 for paragraph in menu_paragraphs)
        assert all(paragraph.paragraph_format.right_indent.inches == 1.0 for paragraph in menu_paragraphs)
        assert all(paragraph.paragraph_format.space_before.pt == 0 for paragraph in menu_paragraphs)
        assert all(paragraph.paragraph_format.space_after.pt == 0 for paragraph in menu_paragraphs)
        assert all(paragraph.paragraph_format.line_spacing == 1.15 for paragraph in menu_paragraphs)
    finally:
        os.unlink(template_path)
        os.unlink(output_path)
