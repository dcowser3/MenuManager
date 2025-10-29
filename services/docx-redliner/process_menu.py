#!/usr/bin/env python3
"""
Process Menu Document
=====================
Main entry point for processing menu documents with AI corrections
and tracked changes.

Usage:
    python process_menu.py <input_file.docx> [output_file.docx]
    
Environment Variables:
    OPENAI_API_KEY: Your OpenAI API key (required)
    OPENAI_MODEL: Model to use (optional, default: gpt-4o)
    BOUNDARY_MARKER: Custom boundary marker (optional)
"""

import sys
import os
from pathlib import Path
from dotenv import load_dotenv
from menu_redliner import MenuRedliner
from ai_corrector import AICorrector

# Load environment variables
load_dotenv()


def main():
    """Main entry point for menu processing."""
    
    # Parse command line arguments
    if len(sys.argv) < 2:
        print("Usage: python process_menu.py <input_file.docx> [output_file.docx]")
        print("\nEnvironment Variables:")
        print("  OPENAI_API_KEY: Your OpenAI API key (required)")
        print("  OPENAI_MODEL: Model to use (optional, default: gpt-4o)")
        print("  BOUNDARY_MARKER: Custom boundary marker (optional)")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    # Validate input file
    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' not found.")
        sys.exit(1)
    
    if not input_file.lower().endswith('.docx'):
        print("Error: Input file must be a .docx file.")
        sys.exit(1)
    
    # Get configuration from environment
    boundary_marker = os.getenv(
        "BOUNDARY_MARKER",
        "Please drop the menu content below on page 2."
    )
    model = os.getenv("OPENAI_MODEL", "gpt-4o")
    
    # Check for API key
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set.")
        print("\nTo set it:")
        print("  export OPENAI_API_KEY='your-api-key-here'")
        print("\nOr create a .env file in this directory with:")
        print("  OPENAI_API_KEY=your-api-key-here")
        sys.exit(1)
    
    try:
        # Initialize AI corrector
        print(f"Initializing AI corrector with model: {model}")
        corrector = AICorrector(model=model)
        
        # Initialize document processor
        print(f"Initializing document processor")
        print(f"Boundary marker: '{boundary_marker}'")
        redliner = MenuRedliner(boundary_marker=boundary_marker)
        
        # Process the document
        print(f"\nProcessing document: {input_file}")
        print("-" * 60)
        
        result = redliner.process_document(
            input_file,
            corrector.correct_text,
            output_file
        )
        
        print("-" * 60)
        print(f"\n✓ Success! Corrected document saved to:")
        print(f"  {result}")
        
        # Print file size comparison
        input_size = os.path.getsize(input_file)
        output_size = os.path.getsize(result)
        print(f"\nFile sizes:")
        print(f"  Input:  {input_size:,} bytes")
        print(f"  Output: {output_size:,} bytes")
        
    except ValueError as e:
        print(f"Configuration Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error processing document: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

