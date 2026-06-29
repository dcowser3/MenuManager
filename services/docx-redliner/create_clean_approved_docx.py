#!/usr/bin/env python3
"""
Create an editable approved DOCX by accepting visible redline artifacts.

DOCX files are ZIP packages of XML parts. This cleaner edits the Word XML
directly so the download route does not depend on python-docx startup:
- remove Word tracked deletions/move-from blocks
- unwrap Word tracked insertions/move-to blocks so their text remains
- remove manually struck-through runs
- clear highlight/strike styling from the remaining runs

Usage:
    python create_clean_approved_docx.py <input_docx> <output_docx>
"""

import os
import sys
import zipfile

from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DELETION_WRAPPERS = {"del", "moveFrom"}
INSERTION_WRAPPERS = {"ins", "moveTo"}
REVISION_MARKERS = {
    "moveFromRangeStart",
    "moveFromRangeEnd",
    "moveToRangeStart",
    "moveToRangeEnd",
    "delRangeStart",
    "delRangeEnd",
    "insRangeStart",
    "insRangeEnd",
}
RUN_STYLE_MARKERS = {"highlight", "strike", "dstrike"}


def w_tag(name):
    return f"{{{W_NS}}}{name}"


def local_name(tag):
    if not isinstance(tag, str):
        return ""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def remove_element(element):
    parent = element.getparent()
    if parent is not None:
        parent.remove(element)


def unwrap_element(element):
    parent = element.getparent()
    if parent is None:
        return

    index = parent.index(element)
    for child in list(element):
        parent.insert(index, child)
        index += 1
    parent.remove(element)


def run_has_strike(run_element):
    rpr = run_element.find(w_tag("rPr"))
    if rpr is None:
        return False
    return any(local_name(child.tag) in {"strike", "dstrike"} for child in rpr)


def accept_revisions(root):
    for element in list(root.iter()):
        if local_name(element.tag) in DELETION_WRAPPERS:
            remove_element(element)

    for element in list(root.iter()):
        if local_name(element.tag) in INSERTION_WRAPPERS:
            unwrap_element(element)

    for element in list(root.iter()):
        if local_name(element.tag) in REVISION_MARKERS:
            remove_element(element)


def clear_run_review_formatting(root):
    for run in list(root.iter(w_tag("r"))):
        if run_has_strike(run):
            remove_element(run)

    for rpr in list(root.iter(w_tag("rPr"))):
        for child in list(rpr):
            if local_name(child.tag) in RUN_STYLE_MARKERS:
                rpr.remove(child)


def process_xml_part(xml_bytes):
    parser = etree.XMLParser(remove_blank_text=False, recover=False)
    root = etree.fromstring(xml_bytes, parser=parser)

    accept_revisions(root)
    clear_run_review_formatting(root)

    for element in list(root.iter(w_tag("trackRevisions"))):
        remove_element(element)

    return etree.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=False,
    )


def should_process_part(name):
    return name.startswith("word/") and name.endswith(".xml")


def create_clean_docx(input_path, output_path):
    output_dir = os.path.dirname(os.path.abspath(output_path))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with zipfile.ZipFile(input_path, "r") as source_zip:
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as output_zip:
            for item in source_zip.infolist():
                data = source_zip.read(item.filename)
                if should_process_part(item.filename):
                    try:
                        data = process_xml_part(data)
                    except etree.XMLSyntaxError:
                        pass
                output_zip.writestr(item, data)


def main():
    if len(sys.argv) != 3:
        print("Usage: python create_clean_approved_docx.py <input_docx> <output_docx>", file=sys.stderr)
        sys.exit(1)

    try:
        create_clean_docx(sys.argv[1], sys.argv[2])
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
