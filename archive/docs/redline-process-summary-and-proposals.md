# Menu Review Process: Form-Based AI Pre-Check

**Date**: January 2026
**Purpose**: Document the form-based menu review workflow with AI pre-check

---

## Current Direction: Form-Based Review (No Word Redlining)

### Key Decision
We are **not** doing automated redlining/highlighting in Word documents. All corrections happen during the form entry process, before document generation. Human reviewers handle any markup after receiving the clean document.

### Architecture

```
Chef Enters Menu via Form
         ↓
[Press "AI Check" Button]
         ↓
[AI Pre-Check Pipeline]
├→ SOP Rules Enforcement (sop_rules.md)
├→ Spelling corrections (tartare, jalapeño, etc.)
├→ RSH terminology enforcement
├→ Allergen validation
├→ Formatting rules
         ↓
[Display Suggestions to Chef]
Chef reviews, accepts/rejects corrections
         ↓
[Chef Makes Final Edits] (optional)
         ↓
[Press "Submit" Button]
         ↓
[Clean Document Generation]
Creates .docx without any tracked changes/redlining
         ↓
[Send to Relevant Reviewer]
         ↓
[Human Reviewer Does Redlining]
Reviewer marks up document as needed during their review
```

### Why This Approach

| Previous (Word Redlining) | New (Form-Based Pre-Check) |
|---------------------------|---------------------------|
| Complex format preservation | Clean text processing |
| Difficult to review changes | Interactive correction UI |
| Hard to iterate on corrections | Easy to accept/reject/modify |
| Post-hoc changes | Corrections before document generation |
| Model must "get it right" in one pass | Human-in-the-loop refinement |
| Fragile diff application | Simple text replacement |

### Key Components

| Component | Purpose |
|-----------|---------|
| `sop-processor/sop_rules.md` | **Primary rule source** - comprehensive rules in markdown, optimized for AI consumption |
| `ai_corrector.py` | GPT-4o integration; builds system prompts with rules, sends text for correction |
| `known_corrections.py` | Static rule storage: spelling pairs, RSH terminology preferences, context hints |
| `dish_allergen_db.py` | JSON database for learned dish patterns |

---

## Existing SOP-Derived Rules

The system has **comprehensive rules extracted from the RSH SOP** stored in `sop-processor/sop_rules.md`. These include:

### Submission Rules (SUB-*)
- Documents must be .docx format using official template
- *(Note: highlighting/strikethrough is done by human reviewers after they receive the clean document)*

### Formatting Rules (FMT-*)
- Dish names: Calibri 12pt Bold, Sentence Case
- Descriptions: Calibri 12pt, always lowercase
- No ALL CAPS except approved acronyms (RSH, TT)
- Do not capitalize: australian, roasted, grilled, seared, braised, smoked, etc.

### Pricing Rules (PRC-*)
- Whole numbers only (no $ or .00)
- Dual prices separated by ` | ` not `/`

### Allergen Rules (ALG-*)
- Placed on same line as dish name, superscript
- Alphabetical order, comma-separated, no spaces (e.g., D,G,N)
- Raw items marked with trailing asterisk (*)
- Keyword→code mappings: milk→D, cheese→D, shrimp→C, panko→G, sesame→SE, etc.

### Vocabulary Rules (VOC-*)
- Specific spellings: barbeque (not BBQ), aioli (not mayo), Caesar, tartare, mozzarella, yuzu kosho
- Avoid redundant words: fresh, creamy, warm, juice, syrup, garnish, purée
- Diacritics required: Açaí, Jalapeño, Purée, Crème Brûlée, Flambéed, Sautéed, Rosé, Añejo, etc.

### Structure Rules (STR-*)
- Categories must be plural (Appetizers, Entrées)
- Ingredients must be singular (exceptions: beans, chips, greens, fries, seeds, herbs, noodles, sprouts)
- Prix fixe menus need numbered courses
- Latin concepts use Spanish categories (PARA LA MESA, ANTOJITOS, SOPAS, ESPECIALIDADES, POSTRES, CÓCTELES)

### Punctuation Rules (PUNC-*)
- Preserve existing separators (don't change commas to slashes)
- Don't split compound words: yuzu-lime, cacao-ancho, cucumber-cilantro, house-made

### Learned Rules (LEARNED-*)
- mayo → aioli (6 occurrences, 60% confidence)
- sea food → seafood
- bbq → barbeque sauce
- sorbete → sorbet

---

## How Rules Currently Flow Into the AI

### In `known_corrections.py` (30+ pairs):
```python
TERMINOLOGY_CORRECTIONS = {
    'crust': 'rim',           # For cocktails
    'bbq': 'barbeque sauce',
    'sorbete': 'sorbet',
}

KNOWN_PAIRS = {
    ('tartar', 'tartare'), ('bbq', 'barbeque'),
    ('puree', 'purée'), ('jalapeno', 'jalapeño'),
    ('mozarella', 'mozzarella'), ('ceasar', 'caesar'),
    # ... diacritics, spelling variations
}
```

### In `ai_corrector.py` System Prompt (~200 lines):
The AI receives:
- 11 critical rules (never remove allergens, preserve caps, fix spelling, etc.)
- Terminology corrections section built from `TERMINOLOGY_CORRECTIONS`
- Before/after examples
- Allergen code definitions (document-specific when detected)

### Next Step: Integrate SOP Rules into AI Corrector
The `sop_rules.md` file contains **comprehensive rules** (formatting, structure, vocabulary, allergen mappings) that need to be fed into the AI corrector. Currently the AI only receives:
- ~3 terminology corrections from `known_corrections.py`
- A subset of vocabulary rules hard-coded in the prompt

The markdown rules file is designed for direct inclusion in AI prompts.

---

### How Corrections Currently Work

1. **Static Rules** (`known_corrections.py`): Hard-coded pairs like `tartar→tartare`, `bbq→barbeque sauce`
2. **System Prompt Engineering**: GPT-4o receives comprehensive instructions with:
   - General menu editing rules (preserve capitalization, allergens, asterisks)
   - Terminology corrections pulled from `TERMINOLOGY_CORRECTIONS`
   - French diacritic enforcement
   - Raw item asterisk rules
3. **Document-Specific Context**: Allergen legend detection adjusts model's understanding per-document

---

## Implementation Focus: AI Pre-Check on Form

### What Happens When Chef Presses "AI Check"

1. **Load SOP Rules** from `sop_rules.json`
2. **Run All Rule Categories**:
   - Spelling (VOC rules): tartare, jalapeño, mozzarella, etc.
   - Terminology (VOC rules): crust→rim for cocktails, barbeque not BBQ
   - Formatting (FMT rules): sentence case, no ALL CAPS
   - Allergens (ALG rules): validate codes, check ordering
   - Structure (STR rules): plural categories, singular ingredients
   - Pricing (PRC rules): whole numbers, proper separators
   - Punctuation (PUNC rules): preserve separators, compound words
3. **Display Suggestions** to chef with accept/reject options
4. **Chef Reviews and Edits** as needed

### What Happens When Chef Presses "Submit"

1. Take final text (after AI suggestions and any chef edits)
2. Generate clean Word document from template
3. **No redlining or highlighting** - just clean content
4. Route to relevant reviewer based on menu type/location
5. Human reviewer handles all markup during their review

---

## Current Priority: Integrate SOP Rules into AI Pre-Check

### Integration Task
The `sop_rules.md` file contains **comprehensive rules** ready for AI integration. Load and include this markdown directly in the AI corrector prompt.

### Implementation Plan

1. **Load all SOP rules** when "AI Check" is pressed
2. **Build comprehensive prompt** including:
   - All VOC (vocabulary) rules
   - All FMT (formatting) rules
   - All ALG (allergen) rules
   - All STR (structure) rules
   - Context from `known_corrections.py`
3. **Run AI correction** with full rule set
4. **Return suggestions** for chef review

### Future Enhancements (Optional)

Once the basic form flow is working, we could improve AI quality with:

**Option A: Rule Engine Pre-Processing**
- Apply deterministic rules first (known spelling corrections)
- Only use AI for ambiguous cases
- Faster and more predictable

**Option B: Few-Shot Examples**
- Include 3-5 similar historical corrections in the prompt
- Model sees relevant precedents

**Option C: Prompt Chaining**
- Separate AI calls for spelling, terminology, allergens
- Easier to debug which category is failing

---

## Next Steps

1. **Integrate SOP rules** into the AI pre-check on form submission
2. **Build suggestion UI** so chef can review/accept/reject corrections
3. **Implement clean document generation** (no tracked changes)
4. **Set up routing** to send generated document to relevant reviewer

---

## Appendix: Relevant Code Locations

| File | Path | Purpose |
|------|------|---------|
| **SOP Rules** | `sop-processor/sop_rules.md` | **Primary rule source** - comprehensive markdown rules from company SOP |
| AI Corrector | `services/docx-redliner/ai_corrector.py` | GPT-4o integration (needs SOP rules integration) |
| Known Corrections | `services/docx-redliner/known_corrections.py` | Static spelling/terminology rules |
| Dish DB | `services/docx-redliner/dish_allergen_db.py` | Allergen patterns |

### Deprecated (No Longer Needed)
The following components were for Word document redlining and are no longer part of the workflow:
- `menu_redliner.py` - Word document diff/redline processing
- `bulk_process.py` - Batch document processing
- `training_pipeline.py` - Learning from human-reviewed documents
