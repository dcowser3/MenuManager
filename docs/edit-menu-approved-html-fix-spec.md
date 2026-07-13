# Fix Spec: Edit This Menu shows pre-approval content (phantom redlines)

## Status

Implemented. Approval finalization now stores clean post-approval HTML, historical rows have a safe text-consistency fallback, and `scripts/backfill-approved-menu-html.js` can populate resolvable records.

Bug found during manual testing of the draft concurrency work; the cause predates it. Read `AGENTS.md` first for conventions and required verification.

## Symptom

Clicking `Edit This Menu` on a freshly approved menu (Tán – Dinner Beverage, approved 7/13/26) opens the editor with redline changes already present — e.g., ~~tito's~~ `titos`, ~~rosé~~ `rose`. These are the **inverse** of the corrections the reviewer (Isabella) made during approval. The clean Word download for the same submission is correct.

## Root cause

Two fields on an approved submission diverge whenever the reviewer edits during approval, and click-to-edit mixes them:

- `approved_menu_content` (plain text) **is** refreshed at approval: `buildApprovedSubmissionUpdate` (`services/clickup-integration/lib/approval-finalization.ts`) stores text extracted from the approved DOCX. Post-correction. Used as the diff baseline.
- `menu_content_html` is written once at submission (`services/dashboard/lib/submission-workflow.ts` ~line 499) and **never updated at approval**. It is the chef's pre-review HTML. But `mapApprovedSubmissionForClient` (`services/db/index.ts` ~line 986) exposes it as `approvedMenuContentHtml`, and the form prefers it to populate the editor (`views/form.ejs` ~lines 4395/4407, and the equivalent draft-load path).

So the editor content is *pre-correction* while the diff baseline is *post-correction*: every reviewer correction renders as a phantom edit that reverts it. This is worse than a display bug — submitting such a draft untouched would **silently revert the reviewer's corrections** in the next approved version. It only reproduces when the reviewer changed something during approval, which is why earlier tests looked fine.

The clean download is correct because it takes a different path: the approved DOCX (`final_path` / `approved_docx` asset) → `createCleanApprovedDocx` (`/download/approved-clean/:submissionId`, `services/dashboard/index.ts` ~line 1569).

## Fix

Store post-approval HTML at approval time, from the same source the clean download uses. The extraction already exists: `extractBaselineFromDocx` (`services/dashboard/index.ts` ~line 820) runs `docx-redliner/extract_clean_menu_text.py` against a DOCX and returns `approvedMenuContentHtml` — this is the reuse opportunity.

### 1. Schema

Migration + `supabase/schema.sql` (schema-drift gate): add nullable `submissions.approved_menu_content_html TEXT`. Add the column to the db service's Supabase mirror/normalize field lists (`services/db/index.ts` ~lines 448–460 and wherever `approved_menu_content` already appears).

### 2. Populate at approval finalization

Single choke point: `processApprovalFinalization` in `services/clickup-integration/index.ts` (~line 1372) already calls `extractApprovedMenuContent(input.approvedPath)` for raw/clean text. Extend that extraction to also produce clean HTML from the approved DOCX using the same `extract_clean_menu_text.py` mechanism as `extractBaselineFromDocx` (move/share the helper rather than duplicating the subprocess logic — note it must run against the *corrections-accepted* document; if the approved DOCX may contain track changes, apply the same accept-changes step `createCleanApprovedDocx` uses first). Pass it into `buildApprovedSubmissionUpdate` → `approved_menu_content_html`. Extraction failure must not block approval (warn, leave null) — same posture as the existing text extraction.

Both approval paths (browser approval editor and ClickUp/Word-upload) already flow through `/approval/finalize`, so one change covers both.

### 3. Read-side fallback with consistency guard

In `mapApprovedSubmissionForClient` (`services/db/index.ts` ~line 986):

```
approvedMenuContentHtml:
  approved_menu_content_html
  || (htmlTextMatchesApproved(menu_content_html, approved_menu_content) ? menu_content_html : '')
```

`htmlTextMatchesApproved`: strip tags → normalize whitespace/case → compare to normalized `approved_menu_content`. Match → the old HTML is safe (keeps bold formatting for historical records). Mismatch → return `''`; the form already falls back to plain `approvedMenuContent` via `quill.setText`, which loses bolding but is *correct*. Never serve HTML whose text disagrees with the approved text.

### 4. Backfill (optional but cheap)

One-off script (`scripts/`): for approved submissions with a resolvable approved DOCX (`final_path` or `approved_docx` asset), extract clean HTML and populate `approved_menu_content_html`. Skip on any per-record failure. Records it can't backfill are safely handled by the step-3 guard.

## Tests / verification (per AGENTS.md)

- Unit: `buildApprovedSubmissionUpdate` includes the HTML field; `mapApprovedSubmissionForClient` guard — (a) approved HTML present → used, (b) absent + stale `menu_content_html` (text mismatch) → `''`, (c) absent + matching → passthrough.
- Integration: approval with reviewer edits → subsequent draft create returns baseline whose HTML text equals `approved_menu_content`.
- Live (Docker, `./dev-up.sh`): submit a menu → approve via the browser approval editor **making at least one correction** → click `Edit This Menu` → editor opens with zero pending changes and shows the corrected text (e.g., `tito's`, `rosé`); persistent preview shows 0 insertions/deletions. Repeat via the ClickUp upload approval path if feasible. Verify clean download still matches the editor content.

## Out of scope

Changing the meaning of `menu_content_html` (it stays "as submitted" — the differ and training pipeline read it as the original, e.g. `services/clickup-integration/index.ts` ~line 1548).
