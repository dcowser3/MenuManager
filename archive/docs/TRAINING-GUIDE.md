# Menu Redliner Training Guide

This guide explains how to use your historical document backlog to train and improve the AI redlining model.

## Overview

The training pipeline allows you to:
1. Upload pairs of original + human-redlined documents
2. Automatically extract correction patterns
3. Generate new rules from repeated corrections
4. Optimize the AI prompt with learned examples
5. Continuously improve accuracy before production

## Quick Start

### Step 1: Organize Your Training Data

You have two options:

**Option A: Auto-Discovery (Recommended)**
```bash
cd services/docx-redliner

# Let the system find matching pairs automatically
python3 prepare_training_data.py \
    --directory /path/to/your/backlog \
    --auto \
    --output tmp/training/pairs
```

**Option B: Interactive Pairing**
```bash
# Manually select which documents are pairs
python3 prepare_training_data.py \
    --directory /path/to/your/backlog \
    --interactive \
    --output tmp/training/pairs
```

The system looks for naming patterns like:
- `Menu_original.docx` + `Menu_redlined.docx`
- `Menu_v1.docx` + `Menu_v2.docx`
- `Menu_draft.docx` + `Menu_final.docx`

### Step 2: Run the Training Pipeline

Once your pairs are organized:

```bash
# Train from all pairs in the directory
./batch_train.sh tmp/training/pairs
```

Or with custom settings:

```bash
# Require patterns to appear 3+ times before becoming rules
./batch_train.sh tmp/training/pairs 3
```

### Step 3: Review and Apply Results

The training generates:
- **New rules** in `tmp/training/learned_rules_TIMESTAMP.json`
- **Optimized prompt** in `tmp/training/optimized_prompt_TIMESTAMP.txt`
- **Session report** in `tmp/training/session_TIMESTAMP.json`
- **Updated SOP rules** (merged with existing)

Review the generated rules:
```bash
cat tmp/training/learned_rules_*.json
```

The rules are automatically categorized by type:
- **Spelling**: Common typos and corrections
- **Diacritics**: Accent marks and special characters
- **Punctuation**: Separator and formatting fixes
- **Case Changes**: Title case, sentence case corrections
- **Price Format**: Pricing display rules

### Step 4: Test the Improvements

Test with a sample document:
```bash
./test-redliner-demo.sh
```

Or test with a specific document:
```bash
python3 process_menu.py input.docx output.docx
```

### Step 5: Update Production Settings (When Ready)

Once you're satisfied with the results:

1. **Update AI Prompt**: Copy the optimized prompt to `ai_corrector.py`
   ```bash
   # Review the new prompt
   cat tmp/training/optimized_prompt_*.txt
   
   # Manually update ai_corrector.py with the enhanced prompt
   ```

2. **Merge Rules**: The rules are auto-merged, but you can review:
   ```bash
   # Check the updated rules file
   cat ../../sop-processor/sop_rules_updated.json
   ```

## Detailed Usage

### Naming Conventions for Document Pairs

For best results, name your files consistently:

**Good Examples:**
```
Menu_CASA_CHI_original.docx + Menu_CASA_CHI_redlined.docx
Toro_Valentine_v1.docx + Toro_Valentine_v2.docx
DXB_Brief_draft.docx + DXB_Brief_final.docx
```

**Also Supported:**
- Different version numbers: `doc_v1.docx`, `doc_v2.docx`
- Date suffixes: `menu_2024-01-15.docx`, `menu_2024-01-20.docx`
- Revision markers: `brief(1).docx`, `brief(2).docx`

### Understanding the Training Process

The pipeline performs several analyses:

1. **Text Comparison**
   - Extracts all paragraphs from both documents
   - Computes word-level differences
   - Categorizes each type of change

2. **Pattern Recognition**
   - Groups similar corrections together
   - Identifies recurring patterns (e.g., "avacado" → "avocado" appears 5 times)
   - Generates rules when patterns exceed minimum threshold

3. **Formatting Analysis**
   - Compares font properties, sizes, styles
   - Detects alignment changes
   - Identifies highlight/strikethrough patterns

4. **Rule Generation**
   - Creates structured rules from patterns
   - Assigns confidence scores based on frequency
   - Categorizes by correction type

5. **Prompt Enhancement**
   - Adds learned examples to AI prompt
   - Balances examples across categories
   - Improves consistency on edge cases

### Training Metrics

After training, you'll see a summary like:

```
TRAINING SESSION SUMMARY
================================================================
Session ID: 20250122_143022
Document pairs processed: 15
Total corrections found: 127
Rules generated: 23

Corrections by category:
  spelling: 45
  diacritics: 28
  separator: 18
  punctuation: 15
  price_format: 12
  case_change: 9
================================================================
```

### Advanced Options

#### Custom Rule Thresholds

Control how many times a pattern must appear to become a rule:

```bash
python3 training_pipeline.py \
    --directory tmp/training/pairs \
    --min-occurrences 5  # More conservative (fewer, more confident rules)
```

```bash
python3 training_pipeline.py \
    --directory tmp/training/pairs \
    --min-occurrences 1  # More aggressive (learn from single examples)
```

#### Manual Rule Review

Before merging, review individual rules:

```python
import json

# Load the generated rules
with open('tmp/training/learned_rules_TIMESTAMP.json') as f:
    data = json.load(f)

# Review each rule
for rule in data['rules']:
    print(f"Rule ID: {rule['rule_id']}")
    print(f"Category: {rule['category']}")
    print(f"Description: {rule['description']}")
    print(f"Confidence: {rule['details']['confidence']}")
    print(f"Occurrences: {rule['details']['occurrences']}")
    print()
```

#### Incremental Training

Train on new batches without losing previous learning:

```bash
# First batch
./batch_train.sh batch_1/

# Second batch (rules accumulate)
./batch_train.sh batch_2/

# Third batch
./batch_train.sh batch_3/
```

Each session creates a new rules file. Manually merge them if needed:

```python
# merge_rules.py
import json

sessions = [
    'tmp/training/learned_rules_session1.json',
    'tmp/training/learned_rules_session2.json',
    'tmp/training/learned_rules_session3.json'
]

all_rules = []
for session_file in sessions:
    with open(session_file) as f:
        data = json.load(f)
        all_rules.extend(data['rules'])

# Save combined
with open('tmp/training/all_learned_rules.json', 'w') as f:
    json.dump({'rules': all_rules}, f, indent=2)
```

## Best Practices

### 1. Start with High-Quality Pairs

- Use documents that have been thoroughly reviewed
- Ensure redlined versions reflect final approved changes
- Avoid incomplete or work-in-progress documents

### 2. Batch Similar Documents Together

Training on similar document types (e.g., all dinner menus, or all cocktail menus) in one session produces more focused rules.

### 3. Review Before Production

Always test generated rules on sample documents before deploying to production:

```bash
# Test on a sample
python3 process_menu.py test_input.docx test_output.docx

# Review the output
open test_output.docx
```

### 4. Iterate on Threshold

If you get too many rules:
- Increase `--min-occurrences` (e.g., to 3 or 5)
- Review and manually remove low-confidence rules

If you're missing important patterns:
- Decrease `--min-occurrences` (e.g., to 1)
- Add more training pairs

### 5. Monitor Rule Conflicts

Some rules might conflict. Review the `learned_rules` file for:
- Same pattern with different corrections
- Contradictory case rules
- Overlapping punctuation rules

### 6. Preserve Original Rules

The training merges with existing rules, but always:
- Keep backups of `sop_rules.json`
- Review merged files before replacing originals
- Test thoroughly after rule updates

## Integration with Production Workflow

### Current Production Flow
```
1. Menu submitted → 2. AI redlining → 3. Human review → 4. Approve/Edit
```

### Training Integration
```
1. Menu submitted → 2. AI redlining → 3. Human review → 4. Approve/Edit
                                                              ↓
                    [Training Pipeline] ← Store original + redlined pair
                           ↓
                    Improve rules periodically
```

### Recommended Training Schedule

**Pre-Production Phase (Now):**
- Train on entire backlog
- Iterate weekly on rule quality
- Test extensively on sample documents

**Production Phase (Later):**
- Collect pairs from human reviews
- Batch train monthly on new corrections
- Gradually improve accuracy over time

## Troubleshooting

### Problem: No pairs discovered automatically

**Solution:** Use interactive mode or check naming conventions
```bash
python3 prepare_training_data.py -d /path/to/docs --interactive
```

### Problem: Too few corrections extracted

**Possible causes:**
- Documents are already very similar
- Boundary marker not found (template content processed)
- File format issues

**Solution:** Validate documents manually:
```python
from docx import Document

doc = Document('test.docx')
for para in doc.paragraphs:
    print(para.text)
```

### Problem: Generated rules seem incorrect

**Solution:** Increase `--min-occurrences` threshold or review corrections:
```python
import json

with open('tmp/training/session_TIMESTAMP.json') as f:
    session = json.load(f)

# Review individual corrections
for corr in session['all_corrections']:
    print(f"{corr['original']} → {corr['corrected']}")
    print(f"Category: {corr['category']}")
    print()
```

### Problem: Training is slow

For large batches (20+ pairs), training can take several minutes. This is normal as it:
- Parses all paragraphs and formatting
- Computes word-level diffs
- Analyzes patterns across all documents

Consider batching very large datasets into smaller training sessions.

## Example Workflow

Here's a complete example from start to finish:

```bash
# 1. Navigate to redliner directory
cd services/docx-redliner

# 2. Prepare your backlog data
python3 prepare_training_data.py \
    --directory ~/Documents/MenuBacklog \
    --auto \
    --output tmp/training/backlog_batch_1

# 3. Run training
./batch_train.sh tmp/training/backlog_batch_1 2

# 4. Review results
cat tmp/training/learned_rules_*.json | jq '.rules[] | {id, description, confidence}'

# 5. Test on sample
python3 process_menu.py \
    samples/example_pairs/test_menu.docx \
    tmp/test_output.docx

# 6. Review test output
open tmp/test_output.docx

# 7. If satisfied, the rules are already merged!
# The system automatically updated: ../../sop-processor/sop_rules_updated.json

# 8. Optionally update the AI prompt
cat tmp/training/optimized_prompt_*.txt
# Copy relevant examples to ai_corrector.py system prompt
```

## Next Steps

Once you're confident in your trained rules:

1. **Deploy to staging**: Test with real menu submissions
2. **Monitor accuracy**: Track approval rates and manual edits
3. **Continuous improvement**: Keep training on new human reviews
4. **Fine-tune thresholds**: Adjust confidence requirements

## Support

For issues or questions:
- Check the training session JSON for detailed logs
- Review the corrections list to understand what's being learned
- Experiment with different `--min-occurrences` values
- Add more high-quality training pairs

---

**Remember**: The model learns from YOUR team's corrections. The more high-quality document pairs you provide, the better it becomes at matching your specific style and standards!

