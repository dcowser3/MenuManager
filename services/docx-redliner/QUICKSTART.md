# Quick Start Guide - DOCX Redliner

Get up and running with the DOCX Redliner in 5 minutes.

## Prerequisites

- Python 3.8 or higher
- OpenAI API key
- A Word document with menu content

## Installation (5 steps)

### 1. Navigate to the service directory

```bash
cd services/docx-redliner
```

### 2. Create virtual environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Set up environment variables

```bash
export OPENAI_API_KEY='your-api-key-here'
```

Or create a `.env` file:

```bash
echo "OPENAI_API_KEY=your-api-key-here" > .env
```

### 5. Test the installation

```bash
python test_redliner.py
```

You should see output showing the creation and processing of test documents.

## Basic Usage

### Process a document

```bash
python process_menu.py your_menu.docx
```

This creates `your_menu_Corrected.docx` with tracked changes.

### Specify output file

```bash
python process_menu.py input.docx output.docx
```

### Test without AI (no API key needed)

```bash
python test_redliner.py
```

This creates test documents and processes them with predefined corrections.

## What to Expect

### Input Document Requirements

Your document should have this structure:

```
Page 1: Template Content
- Project information
- Headers, logos, etc.
- A boundary marker line (default: "Please drop the menu content below on page 2.")

Page 2+: Menu Content
- Menu items to be corrected
- Each paragraph is processed independently
```

### Output Document

The output document will show:
- **Red strikethrough**: Text that was removed/corrected
- **Yellow highlight**: New/corrected text
- **Original formatting preserved**: Bold, italic, fonts, sizes, etc.

### Example

**Before:**
```
Guacamole - Fresh avacado, lime, cilantro - $12
```

**After (visualized):**
```
Guacamole - Fresh [avacado strikethrough in red][avocado highlighted in yellow], lime, cilantro - $12
```

## Testing with Sample Documents

### 1. Create a test document

The test script creates documents automatically:

```bash
python test_redliner.py
```

This generates:
- `test_menu_input.docx` - Document with deliberate errors
- `test_menu_output.docx` - Processed document with tracked changes

### 2. Use your own document

```bash
# Make a copy first (always work on copies!)
cp /path/to/your/menu.docx test_my_menu.docx

# Process it
python process_menu.py test_my_menu.docx

# Open the result
open test_my_menu_Corrected.docx
```

## Common Scenarios

### Scenario 1: Different boundary marker

If your template uses different text:

```bash
export BOUNDARY_MARKER="Menu Items Start Here"
python process_menu.py your_menu.docx
```

### Scenario 2: No boundary marker

If there's no marker, the system processes all paragraphs:

```bash
python process_menu.py your_menu.docx
# Warning will be shown, but processing continues
```

### Scenario 3: Custom AI model

Use a different OpenAI model:

```bash
export OPENAI_MODEL=gpt-4
python process_menu.py your_menu.docx
```

### Scenario 4: Batch processing

Process multiple documents:

```bash
for file in menus/*.docx; do
  python process_menu.py "$file"
done
```

## Verifying Results

### 1. Open in Microsoft Word

```bash
open your_menu_Corrected.docx
```

Look for:
- Red strikethrough on errors
- Yellow highlighting on corrections
- All formatting preserved

### 2. Check file sizes

```bash
ls -lh your_menu*.docx
```

Both files should be similar in size (within 10-20%).

### 3. Review corrections

The script outputs statistics during processing:

```
Processed 25 paragraphs, modified 8
Saved corrected document to: your_menu_Corrected.docx
```

## Troubleshooting

### "OpenAI API key not found"

**Solution:**
```bash
export OPENAI_API_KEY='your-key-here'
```

Or create `.env` file with the key.

### "Module not found"

**Solution:**
```bash
# Make sure virtual environment is activated
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

### "Boundary marker not found"

**Solution:**
- Update your template to include the marker, OR
- Set custom marker: `export BOUNDARY_MARKER="your text here"`, OR
- Proceed anyway (it will process all paragraphs)

### No changes in output

**Possible reasons:**
1. Document is already correct (no errors to fix)
2. Boundary marker not found (check console warnings)
3. Empty paragraphs (skipped automatically)

**Solution:**
- Check the console output for "Processed X paragraphs, modified Y"
- Try the test script to verify the system works: `python test_redliner.py`

## Next Steps

### For Development

1. Read `README.md` for detailed documentation
2. Review `INTEGRATION.md` to integrate with existing system
3. Customize `ai_corrector.py` for your specific SOP rules

### For Production Use

1. Set up environment variables in your deployment
2. Add to your workflow (see `INTEGRATION.md`)
3. Monitor API usage and costs
4. Consider batch processing for efficiency

### For Advanced Usage

1. Modify `AICorrector` system prompt for your needs
2. Implement custom correction logic
3. Add support for tables and complex structures
4. Create web UI for non-technical users

## Examples

### Complete Example 1: First Time User

```bash
# Navigate to directory
cd services/docx-redliner

# Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure
echo "OPENAI_API_KEY=sk-your-key" > .env

# Test
python test_redliner.py

# Use with your document
python process_menu.py ../../samples/test_menu.docx

# View result
open ../../samples/test_menu_Corrected.docx
```

### Complete Example 2: Daily Use

```bash
# Activate environment (if not already active)
cd services/docx-redliner
source venv/bin/activate

# Process today's menus
python process_menu.py ~/Downloads/restaurant_a_menu.docx
python process_menu.py ~/Downloads/restaurant_b_menu.docx

# Results are in the same directory as input files
```

### Complete Example 3: Integration Script

```bash
#!/bin/bash
# process_all_menus.sh

cd services/docx-redliner
source venv/bin/activate

for file in ../../tmp/uploads/*.docx; do
  echo "Processing: $file"
  python process_menu.py "$file"
done

echo "All menus processed!"
```

## Performance Notes

- **Single menu (20-30 items)**: ~30-60 seconds
- **Large menu (50+ items)**: ~2-3 minutes
- **Batch mode**: Can reduce time by ~50%

Most time is spent on API calls to OpenAI. Processing is otherwise very fast.

## Cost Estimates

With GPT-4o pricing (as of 2024):
- **Per menu item**: ~$0.001-0.002
- **Average menu (25 items)**: ~$0.025-0.05
- **100 menus per day**: ~$2.50-5.00

Actual costs depend on text length and API pricing.

## Getting Help

1. **Check console output** - Most errors are clearly explained
2. **Run test script** - `python test_redliner.py` to verify setup
3. **Review documentation** - See `README.md` and `INTEGRATION.md`
4. **Check logs** - Error traces show exactly what went wrong

## Summary

✅ **What this tool does:**
- Finds and corrects errors in menu documents
- Preserves all original formatting
- Shows changes with visual tracking (strikethrough/highlight)
- Maintains template structure

✅ **What you need:**
- Python 3.8+
- OpenAI API key
- Word documents (.docx)

✅ **Time to first result:**
- 5 minutes setup
- ~30 seconds per document

That's it! You're ready to start processing menu documents. 🚀

