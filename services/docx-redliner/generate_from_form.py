#!/usr/bin/env python3
"""
Generate a Word document from the template and form data.
This script takes the RSH menu template and populates it with form field data
and menu content, then saves it as a new document.

Usage:
    python generate_from_form.py <template_path> <form_data_json> <output_path>
"""

import sys
import json
import re
from html.parser import HTMLParser
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH


class MenuHTMLParser(HTMLParser):
    """Parse HTML content from Quill editor and convert to structured data."""

    def __init__(self):
        super().__init__()
        self.lines = []
        self.current_line = []
        self.current_tags = []

    def handle_starttag(self, tag, attrs):
        if tag in ['p', 'br']:
            # New line
            if self.current_line:
                self.lines.append(self.current_line)
                self.current_line = []
        self.current_tags.append(tag)

    def handle_endtag(self, tag):
        if self.current_tags and self.current_tags[-1] == tag:
            self.current_tags.pop()
        if tag == 'p':
            if self.current_line:
                self.lines.append(self.current_line)
                self.current_line = []

    def handle_data(self, data):
        if data.strip():
            # Determine formatting based on current tags
            is_bold = 'strong' in self.current_tags or 'b' in self.current_tags
            is_italic = 'em' in self.current_tags or 'i' in self.current_tags
            is_underline = 'u' in self.current_tags

            self.current_line.append({
                'text': data,
                'bold': is_bold,
                'italic': is_italic,
                'underline': is_underline
            })

    def get_lines(self):
        """Get parsed lines with formatting."""
        if self.current_line:
            self.lines.append(self.current_line)
        return self.lines


def populate_template(template_path: str, form_data: dict, output_path: str):
    """
    Populate the Word template with form data.

    Args:
        template_path: Path to the RSH menu template .docx file
        form_data: Dictionary containing form fields (projectName, property, etc.)
        output_path: Path where the populated document should be saved
    """
    print(f"Loading template from: {template_path}")
    doc = Document(template_path)

    # Map form fields to table cells
    # The template has a table with form fields on page 1
    field_mapping = {
        'PROJECT NAME': form_data.get('projectName', ''),
        'PROPERTY': form_data.get('property', ''),
        'SIZE (PIXELS = WEB) OR (INCHES = PRINT)': form_data.get('size', ''),
        'ORIENTATION (PORTRAIT OR LANDSCAPE)': form_data.get('orientation', ''),
        'DATE NEEDED': form_data.get('dateNeeded', '')
    }

    print("Populating form fields in template...")

    # Find and populate the table (should be first table in document)
    if len(doc.tables) > 0:
        table = doc.tables[0]
        for row in table.rows:
            cells = row.cells
            if len(cells) >= 2:
                field_name = cells[0].text.strip()
                if field_name in field_mapping:
                    # Clear existing content and add new value
                    cells[1].text = field_mapping[field_name]
                    print(f"  ✓ Set '{field_name}' = '{field_mapping[field_name]}'")

    # Find the boundary marker paragraph
    boundary_marker = "Please drop the menu content below on page 2"
    boundary_index = None

    for i, paragraph in enumerate(doc.paragraphs):
        if boundary_marker in paragraph.text:
            boundary_index = i
            print(f"Found boundary marker at paragraph {i}")
            break

    if boundary_index is None:
        print("WARNING: Could not find boundary marker in template")
        boundary_index = len(doc.paragraphs) - 1

    # Remove any existing content after the boundary marker
    # (template might have placeholder text)
    paragraphs_to_remove = []
    for i in range(boundary_index + 1, len(doc.paragraphs)):
        paragraphs_to_remove.append(doc.paragraphs[i])

    for para in paragraphs_to_remove:
        p = para._element
        p.getparent().remove(p)

    print("Adding menu content...")

    # Check if we have HTML content to preserve formatting
    menu_content_html = form_data.get('menuContentHtml', '')
    menu_content_text = form_data.get('menuContent', '')

    if menu_content_html:
        # Parse HTML content to preserve formatting
        parser = MenuHTMLParser()
        parser.feed(menu_content_html)
        lines = parser.get_lines()

        for line_parts in lines:
            # Add paragraph to document
            para = doc.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER

            if line_parts:
                for part in line_parts:
                    run = para.add_run(part['text'])
                    run.font.name = 'Calibri'
                    run.font.size = Pt(12)
                    run.bold = part['bold']
                    run.italic = part['italic']
                    run.underline = part['underline']
            # Empty paragraph creates spacing

        print(f"Added {len(lines)} lines of formatted menu content")
    else:
        # Fall back to plain text if no HTML
        lines = menu_content_text.split('\n')

        for line in lines:
            # Add paragraph to document
            para = doc.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER

            if line.strip():
                run = para.add_run(line)
                run.font.name = 'Calibri'
                run.font.size = Pt(12)
            # Empty lines create spacing

        print(f"Added {len(lines)} lines of plain text menu content")

    # Save the populated document
    print(f"Saving document to: {output_path}")
    doc.save(output_path)
    print("✓ Document generated successfully")


def main():
    if len(sys.argv) != 4:
        print("Usage: python generate_from_form.py <template_path> <form_data_json> <output_path>")
        sys.exit(1)

    template_path = sys.argv[1]
    form_data_path = sys.argv[2]
    output_path = sys.argv[3]

    # Load form data
    try:
        with open(form_data_path, 'r') as f:
            form_data = json.load(f)
        print(f"Loaded form data: {list(form_data.keys())}")
    except Exception as e:
        print(f"ERROR: Could not load form data from {form_data_path}: {e}")
        sys.exit(1)

    # Generate document
    try:
        populate_template(template_path, form_data, output_path)
    except Exception as e:
        print(f"ERROR: Failed to generate document: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
