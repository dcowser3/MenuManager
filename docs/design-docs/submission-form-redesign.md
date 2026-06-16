# Submission Form Redesign — Upload-First, Progressive Disclosure

**Status:** Implemented (Jun 2026)

## Problem

The menu submission page (`/form`, [`services/dashboard/views/form.ejs`](../../services/dashboard/views/form.ejs)) presented everything at once: submitter fields, a `new` vs `modification` mode toggle, a workflow chooser between "I'll make menu changes here" (`edit_here`, unused) and "Upload Unapproved DOCX (Preserve Redlines)", a project-details grid, an optional Menu Image Upload, a Required Approval section, and a two-step (`#step1` → `#step2`) structure. It was dense and intimidating, and the `edit_here` path wasn't being used.

## Goal

A simpler, **upload-first** flow that reveals one thing at a time, driven by the uploaded document:

1. **Land** → the only thing visible is a prompt to upload the menu `.docx`.
2. **Upload** → always runs the **preserve-redlines** extraction (no mode/workflow choice).
3. The **side-by-side** menu appears below the upload: editable menu (left) + persistent redline preview (right).
4. As much as possible is **auto-filled** from the document.
5. **Project Details** animates in below the menu (no Menu Image Upload).
6. Required project fields filled → **Required Approval** animates in.
7. Approval filled → the **Review with AI** button appears.
8. Pressing AI → the side-by-side **floats down** (FLIP) to sit just above Submit, so the AI's changes are right where the chef is looking.
9. Submit.

## Approach

This was a **re-sequencing + progressive-disclosure** change over the existing machinery — not a back-end or diff-engine rewrite. The framework question (React/Svelte vs vanilla) was evaluated and the decision was to **stay vanilla**: the goal was to simplify one page, not adopt a new client framework and build pipeline. The shared redline diff engine, the DOCX extraction APIs, the AI check, and submit are all reused unchanged.

### Stage controller (pure, testable)

[`services/dashboard/public/js/form-stage.js`](../../services/dashboard/public/js/form-stage.js) (`window.MenuFormStage`) holds the pure decision logic — "given this snapshot of the form, which sections are revealed?" — mirroring the IIFE/export pattern of `form-helpers.js` so it is both a browser global and `require()`-able in Jest. Stages: `upload → menu → details → approval → ai → submit`. `computeRevealState(formState)` returns booleans per section; `requiresAiReview(templateType)` returns false for `non_beverage` (which goes straight to submit). Covered by [`__tests__/form-stage.test.js`](../../services/dashboard/__tests__/form-stage.test.js).

### View wiring (`form.ejs`)

- A new `#uploadStage` card with a single dropzone (`#menuUploadInput` → `onMenuUpload()`) is the only thing visible on load.
- `onMenuUpload()` always POSTs to `/api/modification/unapproved-upload` (preserve-redlines), applies the extracted payload (`applyUnapprovedUploadData`), auto-fills project details (`applyExtractedProjectToForm`), enters revision-tracking mode (the existing side-by-side), then `applyStageReveals()`.
- Progressively-disclosed sections are wrapped in `.reveal` containers (`#menuSplitBlock`, `#detailsStage`, `#approvalStage`, `#aiActionStage`, `#submitStage`). `applyStageReveals()` (called on every `input`/`change`) toggles a `.revealed`/`.show` class for the CSS fade+slide, gated by `MenuFormStage.computeRevealState`.
- The menu side-by-side is the existing `.step2-container`; on init it is relocated under the upload (`#menuSplitBlock`). After the AI check, `floatMenuToBottom()` FLIP-animates it into `#menuBottomSlot` just above Submit.
- Internally the flow is always a preserve-redlines **modification** (`submissionMode='modification'`, `unapprovedMode=true`), so the redline/submit plumbing is unchanged. The submit reads the live `#reviewedContentArea`.

### Animation

CSS `.reveal`/`.show` transitions for the reveals; a ~30-line `flipMove(node, mutate)` FLIP helper for the float-down. Both honor `prefers-reduced-motion` (instant).

### Removed

- Menu Image Upload (deleted).
- From the UI: the `new`/`modification` mode radios, the `edit_here` workflow + DB-baseline search + "Extract Baseline" panel, and the `#step2` read-only summary. (The legacy mode/workflow markup is currently **hidden** rather than deleted to preserve handler element refs and existing `form-view.test.js` assertions; full source excision + handler cleanup is a tracked follow-up.)

### Configurable port

`services/dashboard/index.ts` now reads `PORT` (`const port = Number(process.env.PORT) || 3005`) so the app can run alongside a Docker-bound 3005 for local browser verification (see the `dashboard-preview` config in `.claude/launch.json`).

## Reused (unchanged)

- Redline diff engine [`public/js/redline-preview.js`](../../services/dashboard/public/js/redline-preview.js) (shared with `approval-editor.ejs`).
- Helpers [`public/js/form-helpers.js`](../../services/dashboard/public/js/form-helpers.js).
- Endpoints `/api/modification/unapproved-upload`, `/api/form/basic-check[/start|/status]`, `/api/form/submit`, `/api/submitter-profiles/search`.
- Telemetry: `/api/form/attempt-log` and the "Report this problem" `/api/form/error-report`.

## Verification

- Unit: [`__tests__/form-stage.test.js`](../../services/dashboard/__tests__/form-stage.test.js) (stage/reveal logic) and [`__tests__/form-upload-first-view.test.js`](../../services/dashboard/__tests__/form-upload-first-view.test.js) (markup + JS wiring). The 1,191-line `redline-preview.test.js` and the server `modification-workflow.test.js` are unchanged.
- Live: verified via Claude Preview (on `PORT=3017` to avoid the Docker-bound 3005) — initial upload-only state, upload → menu renders with preserved redlines + details reveal, fill → approval reveal, fill → AI button, and the FLIP float-down relocating the menu below the form. The live AI call and full server submit require the AI/db services (run via Docker).

## Follow-ups

- Fully delete the hidden legacy mode/workflow markup and its handlers (`onSubmissionModeChange`, `onModificationSourceChange`, `uploadBaselineDoc`, DB submission search), and update `form-view.test.js`.
- Consider removing the now-unused server routes `/api/form/menu-image-upload` and `/api/modification/baseline-upload`.
