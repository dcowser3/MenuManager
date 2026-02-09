#!/usr/bin/env python3
"""
Extract project details and menu content from a populated RSH menu template DOCX.
Reverses the pattern in generate_from_form.py — reads template table fields
and extracts menu content after the boundary marker.

Usage:
    python extract_project_details.py <docx_path>
"""

import sys
import json
from docx import Document


def extract_project_details(docx_path: str) -> dict:
    """
    Extract project details from the template table and menu content
    from after the boundary marker.

    Returns:
        dict with project_details and menu_content
    """
    doc = Document(docx_path)

    # Extract project details from first table
    project_details = {
        "project_name": "",
        "property": "",
        "size": "",
        "orientation": "",
        "date_needed": ""
    }

    field_mapping = {
        "PROJECT NAME": "project_name",
        "PROPERTY": "property",
        "SIZE (PIXELS = WEB) OR (INCHES = PRINT)": "size",
        "ORIENTATION (PORTRAIT OR LANDSCAPE)": "orientation",
        "DATE NEEDED": "date_needed"
    }

    if len(doc.tables) > 0:
        table = doc.tables[0]
        for row in table.rows:
            cells = row.cells
            if len(cells) >= 2:
                field_name = cells[0].text.strip()
                if field_name in field_mapping:
                    key = field_mapping[field_name]
                    project_details[key] = cells[1].text.strip()

    # Find boundary marker and extract menu content after it
    boundary_markers = [
        "Please drop the menu content below on page 2",  # Food template
        "MENU"  # Beverage template
    ]
    boundary_index = None

    for i, paragraph in enumerate(doc.paragraphs):
        para_text = paragraph.text.strip()
        if para_text == "MENU":
            boundary_index = i
            break
        elif boundary_markers[0] in para_text:
            boundary_index = i
            break

    # Extract menu content after boundary
    # Also skip instruction lines that follow the boundary
    menu_lines = []
    if boundary_index is not None:
        for i in range(boundary_index + 1, len(doc.paragraphs)):
            text = doc.paragraphs[i].text
            stripped = text.strip()
            # Skip the instruction line and standalone "MENU" markers
            if stripped == "MENU" or "Please drop the menu content below" in stripped:
                continue
            menu_lines.append(text)
    else:
        # No boundary found — try to get all text after the table
        # Skip paragraphs that look like header/template content
        in_content = False
        for paragraph in doc.paragraphs:
            text = paragraph.text.strip()
            if in_content:
                menu_lines.append(paragraph.text)
            elif text and text not in field_mapping and not any(m in text for m in boundary_markers):
                # Heuristic: start capturing after we pass table-related content
                in_content = True
                menu_lines.append(paragraph.text)

    # Clean up: strip trailing empty lines
    while menu_lines and not menu_lines[-1].strip():
        menu_lines.pop()

    menu_content = "\n".join(menu_lines)

    return {
        "project_details": project_details,
        "menu_content": menu_content
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python extract_project_details.py <docx_path>"}))
        sys.exit(1)

    docx_path = sys.argv[1]

    try:
        result = extract_project_details(docx_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
