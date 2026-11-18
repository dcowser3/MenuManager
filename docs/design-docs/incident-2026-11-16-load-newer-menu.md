# Incident 2026-11-16: "Load Newer Menu" replaced a chef's edits with a different menu

## Status

Fixed on branch `fix/baseline-freshness-menu-identity`. Data cleanup for the affected rows was done separately.

## What happened

On the submission form, the dialog "A newer approved menu exists" offered a focused, primary-styled **Load Newer Menu** button. It decided "newer" by **property + service period**. One property files several different menus under one service period, and several were approved in one batch with the same timestamp, so "latest for property + service" was effectively arbitrary.

A chef editing a beverage menu in a draft session was offered a food menu from the same service period. Clicking the button replaced the editor text and project fields in place. Autosave then wrote the food menu over his saved draft. The AI check found zero changed lines and returned clean at once. He submitted twice, 0.4 seconds apart, which created two identical submissions with `chef_persistent_diff = {"insertions":0,"deletions":0}`. The same thing happened to two more menus. A reviewer approved the empty submissions, which moved the menu pointers for the wrong menus.

## Root cause

1. Staleness was decided by property + service period instead of menu identity.
2. The dialog could replace a draft's content and baseline id.
3. The server never checked that a draft submission matched its draft.
4. Nothing blocked a modification with zero changes.
5. The dialog put the destructive action first and asked again on every submit.
6. Submit was disabled only after an `await`, leaving a double-submit window.
7. Retiring the bad submissions by hand left `menus.current_submission_id` pointing at deleted rows.

## The seven fixes

| # | Fix | Where |
|---|-----|-------|
| 1 | "Newer" is decided by menu identity only: menu pointer → lineage children → not stale. Both id forms (`legacy_id`, uuid) compared. New `GET /submissions/baseline-freshness` (db) and `GET /api/submissions/baseline-freshness` (dashboard). `isLatestForPropertyService` / `latestForPropertyService` removed. Search results carry `isCurrentMenuVersion` (menu pointer) instead. | `services/db/index.ts` (`resolveBaselineFreshness`), `services/dashboard/index.ts`, `services/dashboard/public/js/baseline-freshness.js` |
| 2 | A draft session can never take on another baseline: no load action is offered in a draft; `applyApprovedBaseline()`, `applyProjectPrefill()`, every `revisionBaseSubmissionId` write, and draft autosave refuse a different baseline. A stale draft blocks AI check and submit and offers the current version in a new tab. | `services/dashboard/views/form.ejs`, `public/js/baseline-freshness.js` |
| 3 | Submit rejects (409) a draft submission whose `revisionBaseSubmissionId` is not the draft's base, whose base is stale at submit time, or whose project name / template type changed without `metadataChangeConfirmed: true`. Rejections are logged as `submit_rejected` in `form_attempt_logs`, before any DOCX, row, or ClickUp task exists. | `services/dashboard/lib/submission-workflow.ts` |
| 4 | Zero-change modifications are blocked on the client and rejected (422) on the server, comparing against the baseline loaded from the database with the AI check's line comparison (both directions, so deletions count). Project-detail-only changes are allowed. Brand-new and unapproved-upload flows are not gated. | `submission-workflow.ts`, `lib/changed-lines.ts`, both form views |
| 5 | Where "load" still exists (non-draft): the title names the menu, edits require a second confirmation that states how many lines are discarded, Cancel has focus, the replacing button is never primary, a "keep" answer is honored at submit, and brand-new mode lists every approved menu in the service period by name (`GET /submissions/approved-for-service`). | `public/js/baseline-freshness.js`, both form views |
| 6 | Submit is disabled synchronously at click; the server returns the first submission for a repeat of the same attempt id + draft token within 2 minutes. | both form views, `submission-workflow.ts` |
| 7 | Menu pointer readers fall back to the newest approved version of the menu when the pointer resolves to a non-approved row, and repair the pointer. `scripts/retire-submission.js` (dry run by default) retires a submission and moves the pointer back in the same run. | `services/db/index.ts` (`resolveMenuCurrentSubmission`), `scripts/retire-submission.js` |

Regression tests replay the incident with a Strand-shaped fixture (`services/db/__fixtures__/strand-incident.json`): `services/db/__tests__/baseline-freshness.test.ts`, `services/dashboard/__tests__/submission-baseline-guards.test.ts`, `baseline-freshness-client.test.js`, `baseline-incident-e2e.test.ts`, `submission-retirement.test.js`.

## Related

- [draft-concurrency-and-lineage.md](draft-concurrency-and-lineage.md)
- [revision-modification-flow.md](revision-modification-flow.md)
- [menu-entity-and-identity.md](menu-entity-and-identity.md)
