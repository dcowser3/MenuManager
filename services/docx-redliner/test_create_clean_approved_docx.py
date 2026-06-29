#!/usr/bin/env python3
"""Tests for create_clean_approved_docx.py."""

import os
import tempfile
import zipfile

from lxml import etree

from create_clean_approved_docx import process_xml_part


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


def _paragraph_text(root):
    return "".join(root.xpath("//w:t/text()", namespaces=NS))


def _process_document_xml(xml):
    output = process_xml_part(xml.encode("utf-8"))
    return etree.fromstring(output)


def test_process_xml_part_accepts_tracked_changes():
    root = _process_document_xml(
        f"""<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="{W_NS}">
          <w:body>
            <w:p>
              <w:r><w:t xml:space="preserve">base </w:t></w:r>
              <w:del w:id="1" w:author="Test">
                <w:r><w:delText xml:space="preserve">old </w:delText></w:r>
              </w:del>
              <w:ins w:id="2" w:author="Test">
                <w:r><w:t xml:space="preserve">new </w:t></w:r>
              </w:ins>
              <w:r><w:t>menu</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>
        """
    )

    assert _paragraph_text(root) == "base new menu"
    assert not root.xpath("//w:del", namespaces=NS)
    assert not root.xpath("//w:ins", namespaces=NS)


def test_process_xml_part_removes_struck_runs_and_clears_highlights():
    root = _process_document_xml(
        f"""<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="{W_NS}">
          <w:body>
            <w:p>
              <w:r>
                <w:rPr><w:strike/><w:color w:val="FF0000"/></w:rPr>
                <w:t xml:space="preserve">old item </w:t>
              </w:r>
              <w:r>
                <w:rPr><w:highlight w:val="yellow"/></w:rPr>
                <w:t>new item</w:t>
              </w:r>
            </w:p>
          </w:body>
        </w:document>
        """
    )

    assert _paragraph_text(root) == "new item"
    assert not root.xpath("//w:highlight", namespaces=NS)
    assert not root.xpath("//w:strike", namespaces=NS)


def test_create_clean_script_processes_docx_zip_package():
    from create_clean_approved_docx import create_clean_docx

    input_file = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    output_file = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    input_file.close()
    output_file.close()

    try:
        document_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="{W_NS}">
          <w:body>
            <w:p>
              <w:r><w:t xml:space="preserve">keep </w:t></w:r>
              <w:ins w:id="2" w:author="Test"><w:r><w:t>this</w:t></w:r></w:ins>
            </w:p>
          </w:body>
        </w:document>
        """
        with zipfile.ZipFile(input_file.name, "w") as package:
            package.writestr("word/document.xml", document_xml)
            package.writestr("[Content_Types].xml", "<Types/>")

        create_clean_docx(input_file.name, output_file.name)

        with zipfile.ZipFile(output_file.name, "r") as package:
            cleaned_xml = package.read("word/document.xml")
        root = etree.fromstring(cleaned_xml)

        assert _paragraph_text(root) == "keep this"
        assert not root.xpath("//w:ins", namespaces=NS)
    finally:
        for path in (input_file.name, output_file.name):
            if os.path.exists(path):
                os.unlink(path)
