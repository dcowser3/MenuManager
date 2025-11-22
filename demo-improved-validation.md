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

## Demo Assets You Can Re-Use

1. **Sample Word docs** (already checked in):
   - `samples/demo-docs/demo_wrong_template.docx`
   - `samples/demo-docs/demo_empty_template.docx`
   - `samples/demo-docs/demo_messy_menu.docx`
   - `samples/demo-docs/demo_clean_menu.docx`
2. **Command helper:** `./demo-validation-scenarios.sh`
   - `./demo-validation-scenarios.sh wrong`
   - `./demo-validation-scenarios.sh empty`
   - `./demo-validation-scenarios.sh messy`
   - `./demo-validation-scenarios.sh clean`
   - `./demo-validation-scenarios.sh all` (runs everything back-to-back)

Each run prints the HTTP status, pretty-prints the JSON response, and highlights what the reviewer sees. Start services with `./start-services.sh` first.

---

## Demo Scenarios

### Scenario 1: Wrong Template (Immediate Reject)
**What happens:** Someone submits a random Word doc or uses wrong template

```bash
# Test with a non-template document
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/demo-docs/demo_wrong_template.docx" \
  -F "submitter_email=chef.demo@example.com" -i

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

**Shortcut:** `./demo-validation-scenarios.sh wrong`

**Demo talking point:** "The system immediately rejects documents that don't use our official template, saving time and preventing confusion."

---

### Scenario 2: Empty Template (Pre-Check Reject)
**What happens:** Chef downloads template but doesn't fill in menu content

```bash
# Test with empty official template
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/demo-docs/demo_empty_template.docx" \
  -F "submitter_email=chef.demo@example.com" -i

```

**Shortcut:** `./demo-validation-scenarios.sh empty`

```json
# Expected Response:
# HTTP/202 (Accepted but needs work)
# {
#   "message": "Your menu has too many errors. Please run the SOP QA prompt...",
#   "status": "needs_prompt_fix",
#   "error_count": 15,
#   "feedback_preview": "Basic validation issues:\n- No substantial menu content..."
# }
```
**Demo talking point:** "If they submit an empty or incomplete template, the system catches it and asks them to add content first."

---

### Scenario 3: Messy Menu (QA Prompt Reject)
**What happens:** Chef fills in menu but has lots of errors (didn't run QA prompt)

Create a test file with intentional errors:
```
GUACAMOLE - avacado lime cilantro onion - 12 dollars
AL PASTOR TACOS - Pork, pinapple, salsa verde - $16
chicken mole - sesame chocolate rice - 22.00
CEASAR SALAD - romaine parmesian croutons - $10
```

```bash
# Submit menu with many errors
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/demo-docs/demo_messy_menu.docx" \
  -F "submitter_email=chef.demo@example.com" -i
```

**Shortcut:** `./demo-validation-scenarios.sh messy`

```json
# Expected Response (if OpenAI configured):
# HTTP/202
# {
#   "message": "Your menu has too many errors. Please run the SOP QA prompt (ChatGPT)...",
#   "status": "needs_prompt_fix",
#   "error_count": 12,
#   "feedback_preview": "Menu Category: Appetizers\nMenu Item: GUACAMOLE\n..."
# }
```

**Demo talking point:** "The system runs the SAME quality check that chefs should run before submitting. If it finds too many errors (>10), it rejects and tells them to use ChatGPT to clean it up first. This ensures we only process high-quality submissions."

---

### Scenario 4: Clean Menu (Passes All Checks)
**What happens:** Chef properly filled template and ran QA prompt

```bash
# Submit a clean, well-formatted menu
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/demo-docs/demo_clean_menu.docx" \
  -F "submitter_email=chef.demo@example.com" -i
```

**Shortcut:** `./demo-validation-scenarios.sh clean`

```json
# Expected Response:
# HTTP/200
# {
#   "message": "File passed validation and was sent for AI review.",
#   "submission_id": "sub_1234567890"
# }
```

**Demo talking point:** "When a menu is properly formatted and has been pre-cleaned with the QA prompt, it passes all checks and goes straight to AI review for red-lining."

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

