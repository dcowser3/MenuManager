# DOCX Redliner - Menu Document Processor

This Python-based service processes Word documents containing menu content and applies AI-generated corrections with tracked changes (strikethrough for deletions, highlight for additions) while preserving all original formatting.

## Features

- **Preserves Template Formatting**: Only processes content after a boundary marker
- **Maintains Character-Level Styling**: Preserves fonts, bold, italic, colors, etc.
- **Tracks Changes Visually**: 
  - Red strikethrough for deletions
  - Yellow highlight for additions
- **AI-Powered Corrections**: Uses GPT-4 to intelligently correct menu items
- **Robust Diff Algorithm**: Uses Google's diff-match-patch for accurate comparisons

## Architecture

The solution uses three main components:

1. **MenuRedliner** (`menu_redliner.py`): Core document processor that:
   - Loads Word documents using python-docx
   - Finds the boundary marker
   - Processes menu paragraphs
   - Applies formatted diffs while preserving styles

2. **AICorrector** (`ai_corrector.py`): OpenAI integration that:
   - Provides intelligent menu corrections
   - Follows SOP rules and best practices
   - Supports single and batch corrections

3. **Process Menu** (`process_menu.py`): Main CLI that ties everything together

## Installation

### 1. Create a Virtual Environment (Recommended)

```bash
cd services/docx-redliner
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Create a `.env` file in this directory:

```bash
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=gpt-4o
```

Or export environment variables:

```bash
export OPENAI_API_KEY='your-api-key-here'
```

## Usage

### Basic Usage

```bash
python process_menu.py input_menu.docx
```

This will create `input_menu_Corrected.docx` in the same directory.

### Specify Output File

```bash
python process_menu.py input_menu.docx output_menu.docx
```

### Custom Boundary Marker

If your template uses a different boundary marker:

```bash
export BOUNDARY_MARKER="Your custom marker text here"
python process_menu.py input_menu.docx
```

## How It Works

### 1. Document Loading
The system loads the entire Word document into memory using python-docx, preserving all template content, headers, footers, and images.

### 2. Boundary Detection
It searches for the boundary marker (default: "Please drop the menu content below on page 2.") to identify where menu content begins.

### 3. Paragraph Processing
For each menu paragraph:
- Extracts the original text
- Sends it to the AI for correction
- Computes a character-level diff

### 4. Style Preservation
The core innovation is in `apply_formatted_diffs()`:
- Saves all original runs (text segments) and their styles
- Clears the paragraph
- Rebuilds it run-by-run based on the diff
- Copies original styles for each character position
- Applies diff formatting (strikethrough/highlight) on top

### 5. Document Saving
Saves the complete document with all changes tracked visually.

## Code Structure

```
services/docx-redliner/
├── menu_redliner.py      # Core document processor
├── ai_corrector.py       # OpenAI integration
├── process_menu.py       # Main CLI entry point
├── requirements.txt      # Python dependencies
├── README.md            # This file
└── test_redliner.py     # Test script
```

## Key Classes

### MenuRedliner

```python
from menu_redliner import MenuRedliner

redliner = MenuRedliner(boundary_marker="Custom marker")
result = redliner.process_document(
    "input.docx",
    correction_function,
    "output.docx"
)
```

### AICorrector

```python
from ai_corrector import AICorrector

corrector = AICorrector(model="gpt-4o")
corrected_text = corrector.correct_text("Original menu item text")
```

## Technical Details

### Diff Algorithm
Uses Google's diff-match-patch library:
- Character-level precision
- Semantic cleanup for word-level grouping
- Three operations: INSERT, DELETE, EQUAL

### Style Preservation
The `find_run_at_index()` helper maps character positions to their original runs, ensuring that:
- Bold text stays bold
- Italic text stays italic
- Font sizes and colors are preserved
- Custom formatting is maintained

### Handling Split Runs
Word documents often split text into multiple runs for various reasons. The algorithm handles this by:
- Working on the full concatenated text
- Mapping back to original runs by character index
- Immune to run boundaries

## Example Output

Given a menu item with an error:

```
Original: "Guacamole - Fresh avacado, lime, cilantro - $12"
```

The output document will show:
- "avacado" with red strikethrough
- "avocado" with yellow highlight

All other formatting (font, size, bold, italic) remains unchanged.

## Testing

Run the test script:

```bash
python test_redliner.py
```

This will:
1. Create a sample document with the template structure
2. Add menu items with deliberate errors
3. Process the document
4. Show before/after comparison

## Integration with Existing System

This Python service can be integrated with your existing TypeScript services in several ways:

### 1. CLI Integration
Call from Node.js using child_process:

```typescript
import { exec } from 'child_process';

exec('python services/docx-redliner/process_menu.py input.docx', 
  (error, stdout, stderr) => {
    // Handle result
  }
);
```

### 2. REST API Wrapper
Create an Express endpoint that calls this service.

### 3. Direct Processing
Add to your existing workflow pipeline after initial document processing.

## Troubleshooting

### "OpenAI API key not found"
Set the `OPENAI_API_KEY` environment variable or create a `.env` file.

### "Boundary marker not found"
The document doesn't contain the expected marker. Either:
- Update your template to include it
- Set a custom marker with `BOUNDARY_MARKER` environment variable
- The system will process all paragraphs if no marker is found

### Formatting Lost
Ensure you're using python-docx version 1.1.0 or higher. Earlier versions may not preserve all formatting.

### API Rate Limits
If processing large documents, consider:
- Using BatchAICorrector for more efficient API usage
- Adding delays between requests
- Using a different OpenAI tier

## Performance

- **Single paragraph**: ~1-2 seconds (includes AI call)
- **Full menu (20-30 items)**: ~30-60 seconds
- **Batch mode**: Can reduce time by 50% for large documents

## Future Enhancements

- [ ] Batch processing mode for multiple documents
- [ ] Progress bar for long documents
- [ ] Configurable diff colors
- [ ] Support for tables and nested structures
- [ ] Integration with SOP database
- [ ] Web UI for non-technical users

## License

Part of the MenuManager system.

## Support

For issues or questions, refer to the main MenuManager documentation or contact the development team.

