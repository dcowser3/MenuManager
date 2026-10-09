#!/usr/bin/env python3
"""Render PDF pages to PNG files for design-policy visual review.

Usage:
    python render_pdf_pages.py <pdf_path> <output_dir> [max_pages] [dpi]

The script writes image files to ``output_dir`` and emits JSON only on stdout.
"""

import json
import os
import sys

try:
    import pymupdf
except ImportError:
    print(json.dumps({"error": "PyMuPDF not installed. Run: pip install PyMuPDF"}))
    sys.exit(1)


def bounded_int(value: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(value)))
    except (TypeError, ValueError):
        return default


def render_pdf_pages(pdf_path: str, output_dir: str, max_pages: int, dpi: int) -> dict:
    os.makedirs(output_dir, exist_ok=True)
    document = pymupdf.open(pdf_path)
    total_pages = len(document)
    rendered_pages = []
    scale = dpi / 72.0
    matrix = pymupdf.Matrix(scale, scale)

    try:
        for page_index in range(min(total_pages, max_pages)):
            page = document[page_index]
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            image_path = os.path.join(output_dir, f"page-{page_index + 1:03d}.png")
            pixmap.save(image_path)
            rendered_pages.append({
                "page_number": page_index + 1,
                "path": image_path,
                "width": pixmap.width,
                "height": pixmap.height,
            })
    finally:
        document.close()

    return {
        "pages": rendered_pages,
        "page_count": total_pages,
        "rendered_count": len(rendered_pages),
        "truncated": total_pages > len(rendered_pages),
        "dpi": dpi,
    }


def main() -> None:
    if len(sys.argv) < 3 or len(sys.argv) > 5:
        print(json.dumps({
            "error": "Usage: python render_pdf_pages.py <pdf_path> <output_dir> [max_pages] [dpi]"
        }))
        sys.exit(1)

    max_pages = bounded_int(sys.argv[3] if len(sys.argv) >= 4 else "40", 40, 1, 100)
    dpi = bounded_int(sys.argv[4] if len(sys.argv) >= 5 else "120", 120, 72, 200)

    try:
        print(json.dumps(render_pdf_pages(sys.argv[1], sys.argv[2], max_pages, dpi)))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
