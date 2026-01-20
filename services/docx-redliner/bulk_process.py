#!/usr/bin/env python3
"""
Bulk Menu Processor
===================
Processes multiple menu documents with AI corrections and rate limiting.

Usage:
    python bulk_process.py <input_folder> <output_folder>
"""

import sys
import os
import time
from pathlib import Path
from dotenv import load_dotenv
from menu_redliner import MenuRedliner
from ai_corrector import AICorrector

# Load environment variables
load_dotenv()

# Rate limiting configuration
DELAY_BETWEEN_PARAGRAPHS = 0.5  # seconds between API calls
DELAY_BETWEEN_FILES = 2.0       # seconds between files
MAX_RETRIES = 3
RETRY_DELAY = 2.0               # seconds to wait after rate limit


class RateLimitedCorrector:
    """Wraps AICorrector with rate limiting and retry logic."""

    def __init__(self, corrector: AICorrector):
        self.corrector = corrector
        self.call_count = 0

    def set_allergen_codes(self, allergen_codes: dict):
        """Pass through allergen codes to the underlying corrector."""
        self.corrector.set_allergen_codes(allergen_codes)

    def correct_text(self, text: str) -> str:
        """Correct text with rate limiting and retries."""
        for attempt in range(MAX_RETRIES):
            try:
                # Add delay between calls
                if self.call_count > 0:
                    time.sleep(DELAY_BETWEEN_PARAGRAPHS)

                self.call_count += 1
                result = self.corrector.correct_text(text)
                return result

            except Exception as e:
                error_str = str(e)
                if "429" in error_str or "rate_limit" in error_str.lower():
                    # Rate limit hit - wait and retry
                    wait_time = RETRY_DELAY * (attempt + 1)
                    print(f"    Rate limit hit, waiting {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    # Other error - return original
                    print(f"    Error: {e}")
                    return text

        # Max retries exceeded
        print(f"    Max retries exceeded, returning original")
        return text


def process_folder(input_folder: str, output_folder: str):
    """Process all .docx files in a folder."""

    input_path = Path(input_folder)
    output_path = Path(output_folder)

    # Ensure output folder exists
    output_path.mkdir(parents=True, exist_ok=True)

    # Find all .docx files (excluding temp files and already processed files)
    docx_files = [
        f for f in input_path.glob("*.docx")
        if not f.name.startswith("~$")
        and not f.name.endswith("_Corrected.docx")
    ]

    if not docx_files:
        print(f"No .docx files found in {input_folder}")
        return

    print(f"Found {len(docx_files)} menu files to process")
    print("=" * 60)

    # Initialize components
    corrector = AICorrector(model=os.getenv("OPENAI_MODEL", "gpt-4o"))
    rate_limited = RateLimitedCorrector(corrector)
    redliner = MenuRedliner()

    # Track results
    successful = []
    failed = []

    for i, docx_file in enumerate(sorted(docx_files), 1):
        print(f"\n[{i}/{len(docx_files)}] Processing: {docx_file.name}")
        print("-" * 60)

        output_file = output_path / docx_file.name

        try:
            # Pass rate_limited as corrector so allergen codes can be detected
            # and configured from document-specific legends
            result = redliner.process_document(
                str(docx_file),
                rate_limited.correct_text,
                str(output_file),
                corrector=rate_limited
            )
            successful.append(docx_file.name)
            print(f"    Saved to: {output_file.name}")

        except Exception as e:
            print(f"    FAILED: {e}")
            failed.append((docx_file.name, str(e)))

        # Delay between files to avoid rate limits
        if i < len(docx_files):
            time.sleep(DELAY_BETWEEN_FILES)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Successful: {len(successful)}/{len(docx_files)}")
    print(f"Failed: {len(failed)}/{len(docx_files)}")

    if failed:
        print("\nFailed files:")
        for name, error in failed:
            print(f"  - {name}: {error}")

    print(f"\nOutput folder: {output_path}")


def main():
    if len(sys.argv) < 3:
        print("Usage: python bulk_process.py <input_folder> <output_folder>")
        print("\nExample:")
        print('  python bulk_process.py "samples/FW_ Zengo Doha - Menu" "samples/FW_ Zengo Doha - Menu/redlined"')
        sys.exit(1)

    input_folder = sys.argv[1]
    output_folder = sys.argv[2]

    if not os.path.isdir(input_folder):
        print(f"Error: Input folder '{input_folder}' not found")
        sys.exit(1)

    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set")
        sys.exit(1)

    process_folder(input_folder, output_folder)


if __name__ == "__main__":
    main()
