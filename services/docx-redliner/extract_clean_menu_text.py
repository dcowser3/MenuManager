#!/usr/bin/env python3
"""
Extract menu text from DOCX and produce a "cleaned" version that attempts
to remove redline/deletion artifacts.

Usage:
    python extract_clean_menu_text.py <docx_path>
"""

import json
import sys
from html import escape
from docx import Document

BOUNDARY_MARKERS = [
    "Please drop the menu content below on page 2",
    "MENU",
]


def find_boundary_index(paragraphs):
    for i, paragraph in enumerate(paragraphs):
        text = paragraph.text.strip()
        if text == "MENU":
            return i
        if BOUNDARY_MARKERS[0] in text:
            return i
    return None


def paragraph_clean_text(paragraph):
    """
    Best-effort cleaner:
    - Removes explicitly struck-through text (common manual redline deletion style).
    - Keeps inserted/highlighted text.
    - Removes Word tracked deletions (w:del / w:moveFrom) and keeps
      tracked insertions (w:ins / w:moveTo).
    """
    if not paragraph.runs:
        return paragraph.text

    def local_name(tag):
        if not isinstance(tag, str):
            return ""
        if "}" in tag:
            return tag.split("}", 1)[1]
        return tag

    def run_is_in_deleted_change(run):
        node = run._r
        while node is not None:
            if local_name(node.tag) in {"del", "moveFrom"}:
                return True
            node = node.getparent()
        return False

    # Remove tracked deletions and visual/manual redline deletions.
    cleaned_parts = []
    for run in paragraph.runs:
        text = run.text or ""
        if not text:
            continue
        if run_is_in_deleted_change(run):
            continue
        if run.font and run.font.strike:
            continue
        cleaned_parts.append(text)

    return "".join(cleaned_parts)


def paragraph_clean_html(paragraph):
    """
    Build cleaned HTML paragraph preserving basic inline formatting:
    bold, italic, underline. Tracked/manual deletions are removed.
    """
    def local_name(tag):
        if not isinstance(tag, str):
            return ""
        if "}" in tag:
            return tag.split("}", 1)[1]
        return tag

    def run_is_in_deleted_change(run):
        node = run._r
        while node is not None:
            if local_name(node.tag) in {"del", "moveFrom"}:
                return True
            node = node.getparent()
        return False

    fragments = []
    for run in paragraph.runs:
        if run_is_in_deleted_change(run):
            continue
        if run.font and run.font.strike:
            continue

        text = run.text or ""
        if not text:
            continue

        chunk = escape(text).replace("\n", "<br>")
        if run.bold:
            chunk = f"<strong>{chunk}</strong>"
        if run.italic:
            chunk = f"<em>{chunk}</em>"
        if run.underline:
            chunk = f"<u>{chunk}</u>"
        fragments.append(chunk)

    if not fragments:
        return "<p><br></p>"
    return f"<p>{''.join(fragments)}</p>"


def extract_texts(docx_path):
    doc = Document(docx_path)
    boundary_index = find_boundary_index(doc.paragraphs)

    if boundary_index is None:
        source_paragraphs = doc.paragraphs
    else:
        source_paragraphs = doc.paragraphs[boundary_index + 1 :]

    raw_lines = []
    cleaned_lines = []
    cleaned_html_paragraphs = []

    for paragraph in source_paragraphs:
        raw_text = paragraph.text
        cleaned_text = paragraph_clean_text(paragraph)

        # Skip instruction/template markers that may still appear.
        if raw_text.strip() == "MENU" or "Please drop the menu content below" in raw_text:
            continue

        raw_lines.append(raw_text)
        cleaned_lines.append(cleaned_text)
        cleaned_html_paragraphs.append(paragraph_clean_html(paragraph))

    # Trim trailing blank lines
    while raw_lines and not raw_lines[-1].strip():
        raw_lines.pop()
    while cleaned_lines and not cleaned_lines[-1].strip():
        cleaned_lines.pop()

    return {
        "menu_content": "\n".join(raw_lines),
        "cleaned_menu_content": "\n".join(cleaned_lines),
        "cleaned_menu_html": "".join(cleaned_html_paragraphs),
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python extract_clean_menu_text.py <docx_path>"}))
        sys.exit(1)

    docx_path = sys.argv[1]
    try:
        payload = extract_texts(docx_path)
        print(json.dumps(payload))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
