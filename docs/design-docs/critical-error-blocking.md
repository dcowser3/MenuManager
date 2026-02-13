# Critical Error Blocking

**Status:** Complete (Feb 2026)

The AI review enforces "hard stops" for critical issues that block submission.

## How It Works

- Each AI suggestion has a `severity` field (`"critical"` or `"normal"`), independent of `confidence`
- Two critical error types are currently enforced:
  - **Missing Price** — Every dish on a standard menu must have a price. Flagged as critical.
  - **Incomplete Dish Name** — Every menu entry must have a recognizable dish name. Flagged as critical.
- Prix fixe menus are exempt from missing price errors (individual dishes don't need prices)

## User Flow

1. Critical errors appear as red cards with a "CRITICAL" badge in the suggestions panel
2. The submit button is disabled with a banner: "Resolve or override all critical errors before submitting"
3. Users can fix the issue (Edit → modify text → Re-run AI Check) or override it ("Override — AI May Be Wrong")
4. Override data is included in the submission payload (`criticalOverrides`) for audit trail
5. "Re-run AI Check" button appears after user exits edit mode

## Architecture

- **AI prompt:** `severity` is set by the AI prompt (`sop-processor/qa_prompt.txt`)
- **Backend:** `services/dashboard/index.ts` normalizes severity as a safety net:
  - Defaults missing severity to `"normal"`
  - Forces known critical types (Missing Price, Incomplete Dish Name) to `"critical"`
  - Uses fallback regex detection
- **Frontend:** `services/dashboard/views/form.ejs` sorts critical suggestions first, manages override state, and gates the submit button

## Future Extensions

Additional critical error types (e.g., missing allergen codes) can be added by:
1. Adding the type to the AI prompt
2. Adding the type name to the backend normalization list
3. No frontend changes needed — the severity/blocking infrastructure handles it automatically
