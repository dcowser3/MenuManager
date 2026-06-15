# Critical Error Blocking

**Status:** Complete (Feb 2026)
**Last updated:** May 2026

The AI review enforces "hard stops" for critical issues that block submission.

## Critical Error Types

| Error | Applies To | Detection | Can Auto-Correct? |
|-------|-----------|-----------|-------------------|
| **Missing Price** | Standard menus only | AI flags it; backend forces `critical` via normalizer | No — left in suggestions only |
| **Set Menu Item Price** | Embedded set-menu sections inside standard menus | AI can flag it; deterministic guard synthesizes it for bare included-item prices | No — left in suggestions only |
| **Incomplete Dish Name** | All menus | AI flags it; backend forces `critical` via normalizer | No — left in suggestions only |
| **Prix Fixe Top Price Missing** | Prix fixe menus | Deterministic scan of top 5 non-empty lines (`enforcePrixFixeCriticalChecks`) | No |
| **Course Numbering** | Prix fixe menus | Deterministic check for number line above headings + AI can flag it | No |
| **Course Progression** | Prix fixe menus | AI flags it; backend forces `critical` via normalizer | No |
| **Pricing Structure** | Prix fixe menus | AI flags it; backend forces `critical` via normalizer | No |

**Prix fixe exemption:** Individual dishes on prix fixe menus do NOT need prices — only the top-level prix fixe price is required. The top-level price can use the per-person suffix `PP`/`pp`, so values like `50.00pp` count as valid prices.

**Embedded set-menu exemption:** A standard menu can contain an embedded set section, such as `Quick Lunch Menu $38` followed by `choice of one appetizer & one entree`. Included dishes inside that section do not need item prices. Bare trailing prices on included dishes are critical `Set Menu Item Price` issues; explicit plus prices like `+5` or `+ AED 50` are treated as premium upcharges and allowed.

## Three Detection Layers

Critical errors are detected and enforced across three layers. This is not a clean separation — there is overlap and redundancy. A future redesign could consolidate into a single source of truth.

### Layer 1: AI Prompt (`sop-processor/qa_prompt.txt`)
Tells the AI which suggestion types to mark `severity: "critical"`. The AI may or may not comply.
The prompt also tells the model that standalone selection instructions such as `choose one`, `choice of one`, `select two`, and `pick your entree` are not dish entries and should not be flagged as incomplete dish names or missing prices.

### Layer 2: Severity Normalizer (`services/dashboard/index.ts` → `parseAIResponse`)
A backend safety net that forces `critical` severity on known types regardless of what the AI returned:
- Matches by `type` field: `Missing Price`, `Incomplete Dish Name`
- Matches by `type` field (lowercase): `set menu item price`, `course progression`, `pricing structure`, `course numbering`
- Matches by regex on description: prix fixe top price issues, course numbering mentions
- Fallback regex: descriptions mentioning "missing price" or "missing dish name" get reclassified

### Layer 3: Deterministic Checks (`enforcePrixFixeCriticalChecks`)
Runs only for prix fixe menus. Programmatically scans the menu text (no AI involved):
- **Top price:** Checks if any of the first 5 non-empty lines match a price pattern, including `PP`/`pp` per-person prices
- **Course numbers:** Finds heading lines (Appetizers, Specialties, Desserts, etc.) and checks if the previous line is a standalone number or the heading starts with a number
- Adds critical suggestions if missing; removes false-positive course numbering suggestions if numbers ARE present

### Embedded Set-Menu Guard (`guardEmbeddedSetMenuPrices`)
Runs for standard menus when the dashboard detects a package title with a total price, a nearby choice instruction, and set-section headings:
- Injects prompt guidance so AI treats included dishes as part of the set section, not normal a la carte rows
- Drops Missing Price suggestions for included set-section dishes
- Restores bare item prices if AI removed them from corrected text
- Synthesizes critical `Set Menu Item Price` suggestions for bare included-item prices, while allowing explicit `+` premium prices

### Price Integrity Guard (`guardCorrectedMenuPrices`)
Runs after the model response has passed structure checks and high-confidence objective cleanup, but before critical reconciliation:
- Compares submitted non-empty lines against the AI-corrected non-empty lines by position when line counts match
- Removes any trailing price the AI added to a line that was submitted without a trailing price, while preserving other corrected text on that line
- Restores the submitted price value if the AI changes a trailing price value
- Keeps any existing `Missing Price` suggestion, or synthesizes one if the model added a price without flagging the issue
- Records guarded changes in Basic AI Check diagnostics and form-attempt details for incident review

### Reconciliation (`reconcileCriticalSuggestionsAgainstCorrectedMenu`)
Filters out critical suggestions where the corrected menu already resolved the issue. Missing Price reconciliation only runs after the price integrity guard has removed AI-added prices, so an unpriced submitted line cannot be treated as resolved just because the model invented a price. Reconciliation only handles Missing Price and Incomplete Dish Name types.

Missing-price reconciliation also handles add-on/enhancement rows. If the AI reports an item such as `add mushrooms`, the matcher checks both the full phrase and the option name without the leading add-on verb, so a same-line option like `add chorizo 5 | mushrooms V 4` counts as priced and does not block submission.

Missing-price reconciliation treats a bare trailing whole number as a valid price even without allergen codes before it. If the model wraps an item into a continuation line, such as splitting `Short Rib al Carbón, ... roasted tomato salsa,` from `butter lettuce, pickled red onion 54`, the matcher joins likely continuation lines before checking for the trailing price.

Incomplete-dish-name reconciliation drops model false positives on short standalone selection instructions. Lines such as `choose one`, `choice of one`, `select two`, and `pick your entree` are preserved in the corrected menu but treated as menu instructions, not dish entries, so they do not block submission.

### Auto-Applied Objective Corrections (`applyHighConfidenceSuggestionsToMenu`)
Before critical blocking is calculated, the dashboard applies exact objective spelling/grammar recommendations such as `Change 'avocad' to 'avocado'` to the corrected menu text when the target token is still present. If the corrected menu already contains the replacement, the stale suggestion is removed. High-confidence raw-item asterisk suggestions are also applied before allergen/price suffixes. This is intentionally defensive because the model can occasionally put an auto-correctable fix in SUGGESTIONS or mark it as `critical`; these items should appear as applied AI changes, not chef-blocking errors.

Allergen-code alphabetization suggestions also pass through a deterministic guard before display. If the model recommends changing an already alphabetized code list to a non-alphabetized order with the same codes, such as `D,G` to `G,D`, the suggestion is dropped and any matching corrected-menu change is restored to the alphabetized order.

A leading standalone `Menu` line is treated as a document title, not a singular category. If the model deletes it or pluralizes it to `Menus`, the dashboard restores the original title line before diffing, highlighting, and critical-error reconciliation.

## User Flow

1. Critical errors appear as red cards with a "CRITICAL" badge in the suggestions panel
2. The submit button is disabled with a banner: "Resolve or override all critical errors before submitting"
3. Users can fix the issue (Edit → modify text → Re-run AI Check) or override it ("Override — AI May Be Wrong")
4. Override data is included in the submission payload (`criticalOverrides`) for audit trail
5. "Re-run AI Check" button appears after user exits edit mode

## Key Files

| File | What It Does |
|------|-------------|
| `sop-processor/qa_prompt.txt` | Tells AI which types are critical (lines 70–86) |
| `services/dashboard/index.ts` → `parseAIResponse` | Severity normalizer — forces critical on known types |
| `services/dashboard/lib/apply-high-confidence-suggestions.ts` | Applies or recognizes exact objective spelling/grammar corrections before blocking checks |
| `services/dashboard/lib/embedded-set-menu-guard.ts` | Detects embedded set-menu sections and enforces bare-price review behavior |
| `services/dashboard/lib/price-integrity-guard.ts` | Prevents AI-added or AI-changed trailing prices from reaching corrected menu output |
| `services/dashboard/index.ts` → `enforcePrixFixeCriticalChecks` | Deterministic prix fixe checks |
| `services/dashboard/index.ts` → `reconcileCriticalSuggestionsAgainstCorrectedMenu` | Removes false-positive criticals |
| `services/dashboard/views/form.ejs` | Renders critical cards, manages overrides, gates submit button |

## Future Considerations

- The three detection layers have overlapping responsibilities and inconsistent patterns — consider consolidating into a single registry of critical error definitions
- Additional critical types (e.g., missing allergen codes) can be added by: (1) adding to the AI prompt, (2) adding to the backend normalizer type list — no frontend changes needed
