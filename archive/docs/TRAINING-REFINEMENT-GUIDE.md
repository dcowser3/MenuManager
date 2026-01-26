# Training Refinement Guide

This document captures how to continuously improve the menu training system.

## Quick Reference: Known Correction Pairs

### 📍 SINGLE LOCATION (easy to update!):
**File:** `services/docx-redliner/known_corrections.py`

This file contains ALL known correction pairs in one place. The training pipeline automatically imports it.

### How to Add New Pairs:
1. Open `services/docx-redliner/known_corrections.py`
2. Add to the `KNOWN_PAIRS` set
3. Format: `('original', 'corrected'), ('corrected', 'original'),`
4. That's it! Both parts of the training pipeline will use the new pairs.

### Current Categories in known_corrections.py:
```python
KNOWN_PAIRS = {
    # Sauce/condiment terms
    ('mayo', 'aioli'), ('aioli', 'mayo'),
    
    # Abbreviations
    ('bbq', 'barbeque'), ('barbeque', 'bbq'),
    
    # Raw preparations
    ('tartare', 'tartar'), ('tartar', 'tartare'),
    
    # Diacritics - French terms
    ('puree', 'purée'), ('café', 'cafe'),
    ('crème', 'creme'), ('sauté', 'saute'),
    
    # Diacritics - Spanish terms
    ('jalapeño', 'jalapeno'), ('piña', 'pina'),
    
    # Common misspellings
    ('caesar', 'cesar'), ('mozzarella', 'mozarella'),
    ('espresso', 'expresso'),
    
    # Spelling variations
    ('yogurt', 'yoghurt'), ('donut', 'doughnut'),
    
    # Term standardization
    ('shrimp', 'prawn'), ('prawn', 'shrimp'),
}

KNOWN_ABBREVIATIONS = {
    'bbq': 'barbeque',
    'msg': 'monosodium glutamate',
    'evoo': 'extra virgin olive oil',
    'gf': 'gluten free',
    'v': 'vegetarian',
    'vg': 'vegan',
}
```

---

## Training Improvement Process

### Step 1: Upload Training Pairs
Upload original + redlined document pairs via the training dashboard or copy to:
```
/tmp/training/pairs/
```
Naming convention:
- `{name}_original.docx`
- `{name}_redlined.docx`

### Step 2: Run Training
```bash
cd services/docx-redliner
source venv/bin/activate
python training_pipeline.py \
    --directory "../../tmp/training/pairs" \
    --min-occurrences 2 \
    --merge-rules "../../sop-processor/sop_rules.json"
```

### Step 3: Review Generated Rules
Check: `services/docx-redliner/tmp/training/learned_rules_*.json`

Look for:
- ✅ **Good rules**: Spelling fixes, diacritics, terminology standardization
- ❌ **Bad rules**: Menu item swaps, price changes, ingredient substitutions

### Step 4: Add New Discoveries to Known Pairs
When you see a good single-occurrence correction that should always be included:
1. Add it to `known_pairs` in `training_pipeline.py` (BOTH locations!)
2. This ensures future training sessions will recognize it

### Step 5: Update Production Rules
The merged rules go to: `sop-processor/sop_rules_updated.json`

---

## What Gets Filtered Out (Automatically)

1. **Price changes** - numeric values like `160 → 150`
2. **Chef's menu edits** - text already highlighted yellow in the original document
3. **Long content swaps** - 30+ character strings with <30% word overlap

## What Gets Included (via Heuristics)

Even with just 1 occurrence, these patterns are included:
1. **Spacing fixes** - `sea food → seafood`
2. **Diacritic additions** - `jalapeno → jalapeño`
3. **Abbreviation expansions** - `bbq → barbeque sauce`
4. **Known terminology pairs** - anything in `known_pairs`
5. **High character similarity** - >60% character overlap
6. **Single word changes** - single word → single word

---

## Documents Already Trained

| Document | Date | Notes |
|----------|------|-------|
| Sushi & Bubbly Special Menu | Dec 6, 2025 | 3x mayo→aioli |
| Aquimero Mothers Day Brunch | Dec 6, 2025 | bbq→barbeque sauce |
| D'lena Brunch Menu | Dec 6, 2025 | Various corrections |

---

## Current Production Rules (Learned)

| Original | Corrected | Occurrences | Confidence |
|----------|-----------|-------------|------------|
| mayo | aioli | 6 | 0.6 |
| sea food | seafood | 1 | 0.1 |
| bbq | barbeque sauce | 1 | 0.1 |
| sorbete | sorbet | 1 | 0.1 |

---

## Troubleshooting

### Rules not being detected?
- Check if strikethrough/highlight formatting is correct in the redlined doc
- Verify the text isn't already highlighted in the original (chef's edit)

### Good corrections being filtered?
- Add the pattern to `known_pairs`
- Or lower `--min-occurrences` temporarily

### Bad rules getting through?
- Increase `--min-occurrences`
- Check if it's already highlighted in original (should be filtered)

---

*Last updated: December 7, 2025*

