# Improved Validation Demo Guide

## What Changed

### ✅ BEFORE (Weak Validation)
**Template Check:** Only looked for 5 text strings
- Anyone could paste headings into any doc and it would pass
- Didn't verify actual template structure
- Didn't check for required form fields
- Didn't verify boundary marker

**Pre-Check:** Simple word count + placeholder detection
- Just checked for "lorem ipsum", "TBD", etc.
- Word count < 60 = reject
- **Did NOT run the actual QA prompt**

### ✅ AFTER (Strong Validation)

**Template Check (Layer 1):** Comprehensive structure validation
- ✅ Verifies template type (Food or Beverage)
- ✅ Checks ALL required form fields:
  - RESTAURANT NAME
  - LOCATION
  - MENU NAME
  - MENU TYPE
  - EFFECTIVE DATE
  - SUBMITTED BY
  - SUBMISSION DATE
- ✅ Verifies SOP sections present
- ✅ Confirms boundary marker exists: "Please drop the menu content below on page 2"
- ✅ Validates menu content exists after boundary marker
- ✅ Minimum 500 characters (ensures complete template)

**QA Pre-Check (Layer 2):** Runs the ACTUAL SOP QA prompt
- ✅ Calls OpenAI with the same QA prompt chefs should use
- ✅ Counts errors found (format: "Description of Issue:")
- ✅ Threshold: > 10 errors = REJECT
- ✅ Feedback: "Please run the SOP QA prompt to clean up your menu before resubmitting"
- ✅ Fallback: If no OpenAI key, does basic placeholder/length checks

---

## Demo Assets

**Sample Word docs** (in `samples/` folder):
- `samples/demo-wrong-template.docx` - Plain doc without RSH template
- `samples/demo-messy-menu.docx` - Template with 10+ errors
- `samples/demo-bad-format.docx` - Template with wrong font/alignment
- `samples/demo-minor-issues.docx` - Template with 1-2 small typos

**Run demo:** `./demo-scenarios.sh` (interactive menu to test each scenario)

Start services with `./start-services.sh` first.

---

## Demo Scenarios

### Scenario 1: Wrong Template (Immediate Reject)
**What happens:** Someone submits a random Word doc or uses wrong template

```bash
# Test with a non-template document
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-wrong-template.docx" \
  -F "from=chef@test.com"

# Expected Response:
# HTTP/400
# {
#   "message": "Document does not match the required template.",
#   "errors": [
#     "Document does not appear to be a valid RSH DESIGN BRIEF template",
#     "Please download and use the official template from the Menu Submission Guidelines",
#     "Missing required section: Design Brief Header",
#     "Missing required form field: Restaurant Name Field",
#     ...
#   ]
# }
```

**Or use:** `./demo-scenarios.sh` and select option 1

**Demo talking point:** "The system immediately rejects documents that don't use our official template, saving time and preventing confusion."

---

### Scenario 2: Too Many Errors (QA Pre-Check Reject)
**What happens:** Chef fills in menu but has lots of errors (didn't run QA prompt)

```bash
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-messy-menu.docx" \
  -F "from=chef@test.com"
```

**Or use:** `./demo-scenarios.sh` and select option 2

**Expected Response:**
```json
{
  "message": "Your menu has too many errors. Please run the SOP QA prompt...",
  "status": "needs_prompt_fix",
  "error_count": 12
}
```

**Demo talking point:** "The system runs the SAME quality check that chefs should run before submitting. If it finds too many errors (>10), it rejects and tells them to use ChatGPT to clean it up first."

---

### Scenario 3: Format Issues
**What happens:** Chef uses correct template but wrong font/alignment

```bash
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-bad-format.docx" \
  -F "from=chef@test.com"
```

**Or use:** `./demo-scenarios.sh` and select option 3

**Expected Response:**
```json
{
  "message": "Menu doesn't meet formatting standards.",
  "errors": [
    "Font is Arial (should be Calibri)",
    "Text is left-aligned (should be centered)",
    "Font size is 11pt (should be 12pt)"
  ]
}
```

**Demo talking point:** "Format issues are caught automatically. Chef gets specific instructions instead of vague feedback."

---

### Scenario 4: Clean Menu (Passes All Checks)
**What happens:** Chef properly filled template and ran QA prompt

```bash
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-minor-issues.docx" \
  -F "from=chef@test.com"
```

**Or use:** `./demo-scenarios.sh` and select option 4

**Expected Response:**
```json
{
  "message": "File passed validation and was sent for AI review.",
  "submission_id": "sub_1234567890"
}
```

**Demo talking point:** "When a menu is properly formatted, it passes all checks and goes straight to AI review. Open the dashboard to see the submission and AI corrections."

---

## Configuration

### For Demo (No OpenAI Key)
If `OPENAI_API_KEY` is not set, the system uses fallback validation:
- Basic placeholder detection
- Word count checks
- Boundary marker verification

### For Production (With OpenAI Key)
Set in `.env`:
```bash
OPENAI_API_KEY=sk-your-actual-key-here
```

The system will:
- Run full QA prompt analysis
- Count actual errors
- Provide detailed feedback
- Reject if > 10 errors found

---

## Error Threshold Tuning

You can adjust the error threshold in `services/parser/index.ts`:

```typescript
// Current setting: 10 errors
const ERROR_THRESHOLD = 10;

// More strict (fewer errors allowed):
const ERROR_THRESHOLD = 5;

// More lenient (more errors allowed):
const ERROR_THRESHOLD = 15;
```

---

## Benefits

1. **Saves Money:** Only processes properly formatted, pre-cleaned menus
2. **Better Quality:** Ensures chefs use the QA prompt before submitting
3. **Clear Feedback:** Tells them exactly what's wrong and how to fix it
4. **No Confusion:** Rejects wrong templates immediately
5. **Enforces Process:** Makes sure the SOP is followed

---

## Testing Checklist

- [ ] Submit PDF file → Should reject (wrong file type)
- [ ] Submit random .docx → Should reject (wrong template)
- [ ] Submit empty template → Should reject (no content)
- [ ] Submit template with placeholder text → Should reject (not ready)
- [ ] Submit messy menu (many errors) → Should reject (needs QA prompt)
- [ ] Submit clean menu (few errors) → Should pass to AI review

---

## Next Steps

1. Start services: `./start-services.sh`
2. Open dashboard: http://localhost:3005
3. Run through test scenarios above
4. Show stakeholders the improved validation
5. Demonstrate how it enforces the SOP workflow

