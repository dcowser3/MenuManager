# Menu Redlining Process: Summary & Improvement Proposals

**Date**: January 2026
**Purpose**: Document current state, challenges, and potential solutions for improving AI-driven menu review quality

---

## Current System Overview

### Architecture
The menu redlining system processes Word documents (.docx) through an AI-powered pipeline:

```
Input Document (.docx)
       ↓
[Boundary Detection] → Separates template header from menu content
       ↓
[Document Config] → Detects allergen legend, menu type (prix fixe, etc.)
       ↓
[Paragraph-by-Paragraph Processing]
       ├→ AI Correction (GPT-4o, temp=0.1)
       ├→ Word-Level Diff Generation
       └→ Apply Diffs with Format Preservation (strikethrough/highlight)
       ↓
Output: _Corrected.docx with tracked changes
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `ai_corrector.py` | GPT-4o integration; builds system prompts with rules, sends text for correction |
| `known_corrections.py` | Static rule storage: spelling pairs, RSH terminology preferences, context hints |
| `menu_redliner.py` | Document processing engine; diff computation; format-preserving change application |
| `bulk_process.py` | Batch processing with rate limiting |
| `dish_allergen_db.py` | JSON database for learned dish patterns |
| `training_pipeline.py` | Extracts patterns from human-reviewed documents (partially implemented) |

### How Corrections Currently Work

1. **Static Rules** (`known_corrections.py`): Hard-coded pairs like `tartar→tartare`, `bbq→barbeque sauce`
2. **System Prompt Engineering**: GPT-4o receives comprehensive instructions with:
   - General menu editing rules (preserve capitalization, allergens, asterisks)
   - Terminology corrections pulled from `TERMINOLOGY_CORRECTIONS`
   - French diacritic enforcement
   - Raw item asterisk rules
3. **Document-Specific Context**: Allergen legend detection adjusts model's understanding per-document

---

## Current Challenges

### 1. Inconsistent AI Corrections
- The batch results show the AI is not reliably applying corrections
- Model "forgets" or ignores rules despite detailed system prompts
- No feedback loop from human corrections back to the model

### 2. Limited Learning Mechanism
- `training_pipeline.py` exists but is not fully integrated
- ~100 before/after examples exist but aren't being used to improve the model
- Rules are manually added to `known_corrections.py` rather than learned

### 3. Word Document Redlining Complexity
- Format preservation is fragile (mixed bold, existing redlines, etc.)
- Many paragraphs get skipped due to complex formatting
- Applying diffs to Word documents introduces visual noise

---

## Proposed Direction: Shift to Form-Based Pre-Check

Based on company feedback, there's openness to:
1. Using the **form interface** for menu review (not Word redlining)
2. Adding more corrections in the **pre-check process**
3. Including **company-specific logic** at the pre-check stage

### Why This May Be Better

| Word Redlining | Form-Based Pre-Check |
|----------------|---------------------|
| Complex format preservation | Clean text processing |
| Difficult to review changes | Interactive correction UI |
| Hard to iterate on corrections | Easy to accept/reject/modify |
| Post-hoc changes | Corrections before document generation |
| Model must "get it right" in one pass | Human-in-the-loop refinement |

### Proposed Flow

```
Chef/User Enters Menu via Form
              ↓
[Pre-Check AI Analysis]
├→ Spelling corrections (tartare, jalapeño, etc.)
├→ RSH terminology enforcement (crust→rim for cocktails)
├→ Company-specific rules (loaded per-client)
├→ Allergen validation
├→ Raw item asterisk suggestions
              ↓
[Interactive Review UI]
User sees suggestions, accepts/rejects each
              ↓
[Clean Document Generation]
Final menu created without tracked changes
```

---

## Proposals for Improving AI Review Quality

### Option 1: Fine-Tuned Model

**Approach**: Use the ~100 before/after examples to fine-tune a custom OpenAI model

**How it works**:
- Convert before/after pairs into training examples (input: original text → output: corrected text)
- Fine-tune GPT-4o-mini or GPT-3.5-turbo (cheaper, faster)
- Deploy custom model for menu corrections

**Pros**:
- Model learns RSH-specific patterns implicitly
- Reduces prompt engineering burden
- More consistent behavior

**Cons**:
- Requires ongoing retraining as new patterns emerge
- Fine-tuning has costs ($)
- Less interpretable than explicit rules

**Implementation Complexity**: Medium

---

### Option 2: Retrieval-Augmented Generation (RAG)

**Approach**: Store all 100 examples in a vector database; retrieve similar examples at inference time

**How it works**:
- Embed each before/after pair
- When correcting new text, retrieve 3-5 most similar historical corrections
- Include retrieved examples in the prompt as few-shot demonstrations

**Pros**:
- No retraining needed; just add new examples
- Model sees relevant precedents
- Interpretable (can see which examples influenced correction)

**Cons**:
- Requires vector DB infrastructure
- Retrieval quality affects results
- More API tokens per request

**Implementation Complexity**: Medium-High

---

### Option 3: Structured Correction Database + Rule Engine

**Approach**: Extract explicit rules from the 100 examples; build a deterministic pre-processor

**How it works**:
1. Analyze all before/after pairs to extract:
   - Spelling corrections (word → word mappings)
   - Pattern-based rules (e.g., "add asterisk before allergens if dish contains X")
   - Context-dependent corrections (e.g., "crust → rim" only in drinks section)
2. Build a rule engine that applies corrections deterministically
3. Use AI only for ambiguous cases

**Pros**:
- Fast, predictable, no API costs for known corrections
- Fully explainable
- Easy to audit and update

**Cons**:
- Manual rule extraction effort
- Doesn't generalize to novel errors
- Requires ongoing maintenance

**Implementation Complexity**: Medium

---

### Option 4: Hybrid Approach (Recommended)

**Approach**: Combine deterministic rules with AI, using examples for prompt enhancement

**Architecture**:
```
Input Text
     ↓
[Rule Engine] → Apply known corrections (fast, free, reliable)
     ↓
[RAG Lookup] → Find similar historical corrections
     ↓
[AI Review] → GPT-4o with:
              - Remaining text after rule application
              - 3-5 similar examples as few-shot
              - Structured output format for consistency
     ↓
[Human Review] → Form-based accept/reject interface
     ↓
[Learning Loop] → Accepted corrections feed back into rule DB
```

**Why this is promising**:
1. Rules handle the known cases reliably (no AI randomness)
2. RAG provides context for similar situations
3. AI handles novel/ambiguous cases
4. Human review catches errors AND generates training data
5. Continuous learning loop improves over time

**Implementation Complexity**: High (but most value)

---

### Option 5: Prompt Chaining with Validation

**Approach**: Break correction into multiple specialized AI calls with self-validation

**How it works**:
```
[Spelling Checker LLM Call] → Focus only on spelling
         ↓
[Terminology LLM Call] → Focus only on RSH terminology
         ↓
[Allergen Validator LLM Call] → Focus only on allergen codes
         ↓
[Validator LLM Call] → Compare original to corrections, flag suspicious changes
         ↓
Human Review
```

**Pros**:
- Each call is simpler, more focused
- Validation step catches errors
- Easier to debug which step failed

**Cons**:
- Higher latency (multiple API calls)
- Higher cost
- More complex orchestration

**Implementation Complexity**: Medium

---

## Leveraging the 100 Before/After Examples

Regardless of which approach is chosen, here's how to extract value from existing data:

### Step 1: Data Preparation
```
For each document pair:
1. Extract all text changes (diff the content)
2. Categorize each change:
   - Spelling (tartar → tartare)
   - Terminology (crust → rim)
   - Allergen (added D,G)
   - Punctuation (added asterisk)
   - Formatting (case change)
   - Other
3. Record context (document type, section, surrounding text)
```

### Step 2: Pattern Extraction
```
Aggregate all changes:
- Most common spelling corrections → Add to known_corrections.py
- Context-dependent rules → Add to CONTEXT_HINTS
- Allergen patterns → Add to dish_allergen_db.py
```

### Step 3: Training Set Creation
```
For fine-tuning or few-shot:
- Create JSONL with {"prompt": "...", "completion": "..."} pairs
- Include original paragraph + context as prompt
- Include corrected paragraph as completion
```

### Step 4: Evaluation Set
```
Reserve 10-20% for testing:
- Run current system against test set
- Measure accuracy (corrections made vs. expected)
- Identify failure modes
```

---

## Recommended Next Steps

1. **Short-term**: Extract patterns from 100 examples into `known_corrections.py`
2. **Medium-term**: Implement form-based pre-check with rule engine
3. **Long-term**: Add RAG for similar example retrieval + continuous learning

---

## Questions for Further Research

1. What percentage of corrections in the 100 examples are:
   - Simple spelling fixes (could be rule-based)?
   - Context-dependent (need AI reasoning)?
   - Subjective/style preferences (need human judgment)?

2. How much variation exists in "correct" output for the same input across different reviewers?

3. What is the acceptable error rate? (Guides whether to prioritize precision vs. recall)

4. Are there company-specific correction patterns that differ significantly between clients?

---

## Appendix: Current Code Locations

| File | Path | Purpose |
|------|------|---------|
| AI Corrector | `services/docx-redliner/ai_corrector.py` | GPT-4o integration |
| Known Corrections | `services/docx-redliner/known_corrections.py` | Static rules |
| Menu Redliner | `services/docx-redliner/menu_redliner.py` | Document processor |
| Bulk Process | `services/docx-redliner/bulk_process.py` | Batch processing |
| Training Pipeline | `services/docx-redliner/training_pipeline.py` | Learning from examples |
| Dish DB | `services/docx-redliner/dish_allergen_db.py` | Allergen patterns |

---

*This document is intended to be shared with other LLMs for additional research and proposal refinement.*
