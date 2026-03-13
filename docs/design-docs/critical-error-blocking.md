# Critical Error Blocking

**Status:** Complete (Feb 2026)
**Last updated:** Mar 2026

The AI review enforces "hard stops" for critical issues that block submission.

## Critical Error Types

| Error | Applies To | Detection | Can Auto-Correct? |
|-------|-----------|-----------|-------------------|
| **Missing Price** | Standard menus only | AI flags it; backend forces `critical` via normalizer | No — left in suggestions only |
| **Incomplete Dish Name** | All menus | AI flags it; backend forces `critical` via normalizer | No — left in suggestions only |
| **Prix Fixe Top Price Missing** | Prix fixe menus | Deterministic scan of top 5 non-empty lines (`enforcePrixFixeCriticalChecks`) | No |
| **Course Numbering** | Prix fixe menus | Deterministic check for number line above headings + AI can flag it | No |
| **Course Progression** | Prix fixe menus | AI flags it; backend forces `critical` via normalizer | No |
| **Pricing Structure** | Prix fixe menus | AI flags it; backend forces `critical` via normalizer | No |

**Prix fixe exemption:** Individual dishes on prix fixe menus do NOT need prices — only the top-level prix fixe price is required.

## Three Detection Layers

Critical errors are detected and enforced across three layers. This is not a clean separation — there is overlap and redundancy. A future redesign could consolidate into a single source of truth.

### Layer 1: AI Prompt (`sop-processor/qa_prompt.txt`)
Tells the AI which suggestion types to mark `severity: "critical"`. The AI may or may not comply.

### Layer 2: Severity Normalizer (`services/dashboard/index.ts` → `parseAIResponse`)
A backend safety net that forces `critical` severity on known types regardless of what the AI returned:
- Matches by `type` field: `Missing Price`, `Incomplete Dish Name`
- Matches by `type` field (lowercase): `course progression`, `pricing structure`, `course numbering`
- Matches by regex on description: prix fixe top price issues, course numbering mentions
- Fallback regex: descriptions mentioning "missing price" or "missing dish name" get reclassified

### Layer 3: Deterministic Checks (`enforcePrixFixeCriticalChecks`)
Runs only for prix fixe menus. Programmatically scans the menu text (no AI involved):
- **Top price:** Checks if any of the first 5 non-empty lines match a price pattern
- **Course numbers:** Finds heading lines (Appetizers, Specialties, Desserts, etc.) and checks if the previous line is a standalone number or the heading starts with a number
- Adds critical suggestions if missing; removes false-positive course numbering suggestions if numbers ARE present

### Reconciliation (`reconcileCriticalSuggestionsAgainstCorrectedMenu`)
Filters out critical suggestions where the AI's corrected menu already resolved the issue (e.g., AI fixed a missing price in the corrected text but also flagged it as critical). Only handles Missing Price and Incomplete Dish Name types.

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
| `services/dashboard/index.ts` → `enforcePrixFixeCriticalChecks` | Deterministic prix fixe checks |
| `services/dashboard/index.ts` → `reconcileCriticalSuggestionsAgainstCorrectedMenu` | Removes false-positive criticals |
| `services/dashboard/views/form.ejs` | Renders critical cards, manages overrides, gates submit button |

## Future Considerations

- The three detection layers have overlapping responsibilities and inconsistent patterns — consider consolidating into a single registry of critical error definitions
- Additional critical types (e.g., missing allergen codes) can be added by: (1) adding to the AI prompt, (2) adding to the backend normalizer type list — no frontend changes needed
