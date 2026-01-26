# Validation System Improvements

## Overview

The validation system has been completely overhauled to enforce proper template usage and ensure chefs follow the SOP workflow before submitting menus.

---

## What Was Wrong Before

### ❌ Problem 1: Weak Template Validation
The old system only checked if these 5 text strings existed:
- "FOOD MENU DESIGN BRIEF REQUEST FORM"
- "PROJECT DESIGN DETAILS"
- "MENU SUBMITTAL SOP"
- "STEP 1: OBTAIN APPROVALS"
- "STEP 2: DESIGN DEVELOPMENT"

**Why this was bad:**
- Anyone could paste these headings into a random Word doc and it would pass
- Didn't verify the actual template structure
- Didn't check if required form fields were filled
- Didn't verify the boundary marker
- Couldn't tell if they used the real template or just faked it

### ❌ Problem 2: No Real QA Pre-Check
The old system just checked:
- Word count < 60 = reject
- Contains "lorem ipsum" or "TBD" = reject

**Why this was bad:**
- Didn't actually run the QA prompt that chefs are supposed to use
- Couldn't tell if the menu was properly cleaned before submission
- Let messy menus through to AI review (wasting money)
- No way to enforce the SOP workflow

---

## What's Fixed Now

### ✅ Solution 1: Comprehensive Template Validation

**Location:** `services/parser/src/validator.ts`

Now checks for:

#### Header & Structure
- ✅ Correct template type (Food or Beverage)
- ✅ Design Brief header present
- ✅ Project Design Details section

#### Required Form Fields (Must ALL be present)
- ✅ RESTAURANT NAME
- ✅ LOCATION
- ✅ MENU NAME
- ✅ MENU TYPE
- ✅ EFFECTIVE DATE
- ✅ SUBMITTED BY
- ✅ SUBMISSION DATE

#### SOP Sections
- ✅ MENU SUBMITTAL SOP section
- ✅ STEP 1: OBTAIN APPROVALS
- ✅ STEP 2: DESIGN DEVELOPMENT

#### Critical Boundary
- ✅ "Please drop the menu content below on page 2" marker exists
- ✅ Actual menu content exists after the boundary (at least 50 chars)

#### Document Completeness
- ✅ Minimum 500 characters total (ensures complete template)
- ✅ Menu content is substantial (not just a few words)

**Result:** If ANY of these checks fail, the document is rejected immediately with specific error messages telling them what's missing.

---

### ✅ Solution 2: Real QA Pre-Check

**Location:** `services/parser/index.ts` (function `runQAPreCheck`)

Now actually runs the SOP QA prompt:

#### With OpenAI API Key (Production Mode)
1. Loads the actual QA prompt from `sop-processor/qa_prompt.txt`
2. Sends the menu text to OpenAI with that prompt
3. Counts errors in the response (looks for "Description of Issue:")
4. If errors > 10 (threshold), **REJECTS** with message:
   > "Your menu has too many errors. Please run the SOP QA prompt (ChatGPT) to clean it up before resubmitting."
5. Returns the error count and feedback preview

#### Without OpenAI API Key (Demo/Test Mode)
Falls back to enhanced basic checks:
- Placeholder phrases (lorem ipsum, TBD, etc.)
- Word count validation
- Boundary marker content check
- More comprehensive than before

**Result:** Only properly cleaned menus make it to AI review, saving money and enforcing the SOP workflow.

---

## The New Validation Flow

```
1. File Upload
   ↓
2. File Type Check (must be .docx)
   ↓ PASS
3. LAYER 1: Template Validation
   • Checks template structure
   • Verifies all required fields
   • Confirms boundary marker
   • Validates menu content exists
   ↓ PASS
4. LAYER 2: QA Pre-Check
   • Runs actual SOP QA prompt
   • Counts errors found
   • If > 10 errors → REJECT
   ↓ PASS
5. Format Lint (optional)
   • Checks font, alignment, etc.
   ↓ PASS
6. AI Review (Tier 1 & 2)
   • Only processes clean menus
```

---

## Configuration

### Error Threshold
You can adjust how strict the QA pre-check is:

**File:** `services/parser/index.ts`
```typescript
// Line ~70
const ERROR_THRESHOLD = 10;  // Current setting

// More strict (fewer errors allowed):
const ERROR_THRESHOLD = 5;

// More lenient (more errors allowed):
const ERROR_THRESHOLD = 15;
```

### OpenAI Mode
**With API Key:** Runs full QA prompt analysis
**Without API Key:** Uses enhanced fallback validation

Set in `.env`:
```bash
OPENAI_API_KEY=sk-your-actual-key-here
```

---

## Error Messages

### Template Validation Errors
```json
{
  "message": "Document does not match the required template.",
  "errors": [
    "Missing required form field: Restaurant Name Field",
    "Missing boundary marker: 'Please drop the menu content below on page 2'",
    "No menu content found after the boundary marker"
  ]
}
```

### QA Pre-Check Errors
```json
{
  "message": "Your menu has too many errors. Please run the SOP QA prompt (ChatGPT) to clean it up before resubmitting.",
  "status": "needs_prompt_fix",
  "error_count": 15,
  "feedback_preview": "Menu Category: Appetizers\nMenu Item: GUACAMOLE\nDescription of Issue: Spelling error - 'avacado' should be 'avocado'..."
}
```

---

## Benefits

### 💰 Cost Savings
- Only processes properly formatted menus
- Doesn't waste AI tokens on messy submissions
- Catches issues before expensive AI review

### 📋 Enforces SOP
- Makes chefs use the official template
- Requires them to run QA prompt before submitting
- Ensures workflow is followed correctly

### 🎯 Better Quality
- Only clean, well-formatted menus reach AI review
- Reduces back-and-forth with chefs
- Higher success rate for final approval

### 💬 Clear Feedback
- Tells them exactly what's wrong
- Specific error messages for each issue
- Actionable instructions on how to fix

---

## Testing

### Run the test script:
```bash
./test-improved-validation.sh
```

This verifies:
- ✅ Template validation checks all required fields
- ✅ QA pre-check is properly implemented
- ✅ Error threshold logic works
- ✅ AI service has QA endpoint

### Manual testing scenarios:
See `demo-improved-validation.md` for complete demo guide with curl commands.

---

## Files Changed

### Modified Files
1. `services/parser/src/validator.ts` - Comprehensive template validation
2. `services/parser/index.ts` - QA pre-check implementation
3. `services/ai-review/index.ts` - QA check endpoint

### New Files
1. `demo-improved-validation.md` - Demo guide for stakeholders
2. `test-improved-validation.sh` - Automated test script
3. `VALIDATION-IMPROVEMENTS.md` - This document

---

## Migration Notes

### For Demo Without OpenAI
- Leave `OPENAI_API_KEY` blank in `.env`
- System uses enhanced fallback validation
- Still catches most issues

### For Production With OpenAI
- Set `OPENAI_API_KEY` in `.env`
- Full QA prompt analysis runs
- More accurate error detection

### Backward Compatibility
- Existing submissions not affected
- Only new uploads use new validation
- No database changes required

---

## Next Steps

1. ✅ Build services: `npm run build --workspaces`
2. ✅ Start services: `./start-services.sh`
3. ✅ Run tests: `./test-improved-validation.sh`
4. 📝 Create sample "messy" menu for demo
5. 📝 Create sample "clean" menu for demo
6. 🎯 Demo to stakeholders using `demo-improved-validation.md`

---

## Questions?

**Q: What if a chef has a legitimate reason for not using the template?**
A: They should contact the team. The template is required per SOP.

**Q: Can we adjust the error threshold?**
A: Yes, edit `ERROR_THRESHOLD` in `services/parser/index.ts` (currently 10).

**Q: What if OpenAI is down?**
A: Falls back to enhanced basic validation automatically.

**Q: Does this affect existing submissions?**
A: No, only new uploads are validated with the new system.

**Q: How do I test without OpenAI?**
A: Just don't set `OPENAI_API_KEY` - it will use fallback mode.

