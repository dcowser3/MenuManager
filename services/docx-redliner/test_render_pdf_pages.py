import tempfile
import unittest
from pathlib import Path
import sys

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_pdf_pages import render_pdf_pages


class RenderPdfPagesTest(unittest.TestCase):
    def test_renders_pdf_pages_and_reports_truncation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "menu.pdf"
            output_dir = root / "rendered"
            document = pymupdf.open()
            for label in ("Page one", "Page two"):
                page = document.new_page()
                page.insert_text((72, 72), label)
            document.save(pdf_path)
            document.close()

            result = render_pdf_pages(str(pdf_path), str(output_dir), max_pages=1, dpi=96)

            self.assertEqual(result["page_count"], 2)
            self.assertEqual(result["rendered_count"], 1)
            self.assertTrue(result["truncated"])
            self.assertTrue(Path(result["pages"][0]["path"]).exists())


if __name__ == "__main__":
    unittest.main()
