# Submission Form Redesign — Upload-First, Progressive Disclosure

**Status:** Implemented (Jun 2026)

## Problem

The menu submission page (`/form`, [`services/dashboard/views/form.ejs`](../../services/dashboard/views/form.ejs)) presented everything at once: submitter fields, a `new` vs `modification` mode toggle, a workflow chooser between "I'll make menu changes here" (`edit_here`, unused) and "Upload Unapproved DOCX (Preserve Redlines)", a project-details grid, an optional Menu Image Upload, a Required Approval section, and a two-step (`#step1` → `#step2`) structure. It was dense and intimidating, and the `edit_here` path wasn't being used.

## Goal

A simpler, **upload-first** flow that reveals one thing at a time, driven by the uploaded document:

1. **Land** → the only thing visible is a prompt to upload the menu `.docx`.
2. **Upload** → always runs the **preserve-redlines** extraction (no mode/workflow choice).
3. The **side-by-side** menu appears below the upload: editable menu (left) + persistent redline preview (right).
4. As much as possible is **auto-filled** from the document. The fields the chef *still needs to fill* are highlighted (`needs-input`), clearing as each is completed — rather than highlighting the auto-filled ones.
5. **Project Details** animates in below the menu (no Menu Image Upload). An optional **"Copy details from a previous submission"** shortcut fills the project fields from an approved submission (`applyProjectPrefill`) without touching the uploaded menu.
6. Required project fields filled → **Required Approval** animates in.
7. Approval filled → **Submitter Information** animates in (revealed last, as its own stage).
8. Submitter info filled → the **Review with AI** button appears.
9. Pressing AI → AI suggestions render as a full-width strip above the two menu boxes, then the side-by-side **floats down** (FLIP) to sit just above Submit and the viewport scrolls to the moved review area.
10. Submit.

Reveal order is `menu + project details → approval → submitter info → AI` (`MenuFormStage.computeRevealState`). The Submitter Information card is relocated into `#submitterStage` on init so it appears last.

## Approach

This was a **re-sequencing + progressive-disclosure** change over the existing machinery — not a back-end or diff-engine rewrite. The framework question (React/Svelte vs vanilla) was evaluated and the decision was to **stay vanilla**: the goal was to simplify one page, not adopt a new client framework and build pipeline. The shared redline diff engine, the DOCX extraction APIs, the AI check, and submit are all reused unchanged.

### Stage controller (pure, testable)

[`services/dashboard/public/js/form-stage.js`](../../services/dashboard/public/js/form-stage.js) (`window.MenuFormStage`) holds the pure decision logic — "given this snapshot of the form, which sections are revealed?" — mirroring the IIFE/export pattern of `form-helpers.js` so it is both a browser global and `require()`-able in Jest. Stages: `upload → menu → details → approval → ai → submit`. `computeRevealState(formState)` returns booleans per section; `requiresAiReview(templateType)` returns false for `non_beverage` (which goes straight to submit). Covered by [`__tests__/form-stage.test.js`](../../services/dashboard/__tests__/form-stage.test.js).

### View wiring (`form.ejs`)

- A new `#uploadStage` card with a single dropzone (`#menuUploadInput` → `onMenuUpload()`) is the only thing visible on load.
- `onMenuUpload()` always POSTs to `/api/modification/unapproved-upload` (preserve-redlines), applies the extracted payload (`applyUnapprovedUploadData`), auto-fills project details (`applyExtractedProjectToForm`), enters revision-tracking mode (the existing side-by-side), then `applyStageReveals()`.
- Progressively-disclosed sections are wrapped in `.reveal` containers (`#menuSplitBlock`, `#detailsStage`, `#approvalStage`, `#aiActionStage`, `#submitStage`). `applyStageReveals()` (called on every `input`/`change`) toggles a `.revealed`/`.show` class for the CSS fade+slide, gated by `MenuFormStage.computeRevealState`.
- The menu side-by-side is the existing `.step2-container`; on init it is relocated under the upload (`#menuSplitBlock`). After the AI check, `floatMenuToBottom()` FLIP-animates it into `#menuBottomSlot` just above Submit.
- After the AI check and after re-runs, `floatMenuToBottom(scrollAiReviewResultsIntoView)` waits for the FLIP move to settle and then scrolls to the moved `.step2-container`, so the chef sees the AI-reviewed side-by-side instead of remaining on the metadata/approval area. The move temporarily disables viewport scroll anchoring to avoid Chrome jumping above the target before the final scroll.
- AI suggestions are a full-width first row in `.step2-container`, displayed as stacked full-width cards with capped panel height. The reviewed menu and persistent preview remain the second row, so both menu bodies start at matching vertical positions after AI review.
- Suggestion cards show `Apply Change` only when the recommendation contains a direct, non-identical before/after pair such as `Change 'PN.TN' to 'PN,TN'`. Applying the change updates the reviewed menu, refreshes the persistent preview, and marks the AI check stale so the user can re-run review before submit.
- The AI review can auto-apply a high-confidence correction and still return a suggestion describing the same change. Non-critical suggestions whose change pair is already present in the corrected text (`formHelpers.isSuggestionAlreadyApplied`) are filtered out before cards render. If one still reaches the user (e.g. after manual edits), pressing `Apply Change` resolves the card as `Already Applied` with a success toast instead of the "no longer matches" warning. A change pair counts as applied when its `to` text is present and its `from` text is either absent or only survives as a substring of `to` occurrences (e.g. `Change 'Potato' to 'Loaded Potato'`).
- Action feedback from `showAlert()` renders as fixed top-right growl toasts with dismiss controls. Temporary success/info/warning toasts include a shrinking progress bar; persistent toasts remain visible until dismissed so action links and blocking guidance are not lost off-screen. The in-panel Auto-Corrected card is the only auto-correction completion message, avoiding a duplicate growl.
- AI review highlights currently mark inserted visible tokens only. Tiny punctuation insertions may be technically highlighted but subtle, and whitespace-only layout corrections are not highlighted by the current token-range helper.
- Internally the flow is always a preserve-redlines **modification** (`submissionMode='modification'`, `unapprovedMode=true`), so the redline/submit plumbing is unchanged. The submit reads the live `#reviewedContentArea`.
- The browser re-runs Step 1 validation immediately before the final `/api/form/submit` POST in both form views. This keeps changed or auto-cleared conditional fields, such as print `bleedMarks` on `PRINT`/`BOTH` assets, from reaching the server as a late 400 after the chef has already completed AI review. If the server still returns `missingFields`, the client reopens the editable form, hides the read-only summary, highlights the exact fields, and scrolls/focuses the first missing input.

### Animation

CSS `.reveal`/`.show` transitions for the reveals; a ~30-line `flipMove(node, mutate)` FLIP helper for the float-down. Both honor `prefers-reduced-motion` (instant).

### Removed

- Menu Image Upload (deleted).
- From the UI: the `new`/`modification` mode radios, the `edit_here` workflow + DB-baseline search + "Extract Baseline" panel, and the `#step2` read-only summary. (The legacy mode/workflow markup is currently **hidden** rather than deleted to preserve handler element refs and existing `form-view.test.js` assertions; full source excision + handler cleanup is a tracked follow-up.)

### Configurable port

`services/dashboard/index.ts` now reads `PORT` (`const port = Number(process.env.PORT) || 3005`) so the app can run alongside a Docker-bound 3005 for local browser verification (see the `dashboard-preview` config in `.claude/launch.json`).

### Approver email + submission confirmation emails

- The Required Approval card now collects an **Approver Email** — required for the primary approver, optional for the additional approver — rendered as a full-width row beneath the approved/name/position fields. The submitter stage stays gated until the primary approver email is filled (`MenuFormStage.approvalFieldsFilled`), and client validation requires a well-formed address (`isValidEmailAddress`, mirroring the server regex). The email rides along in each entry of the `approvals` payload (`{ approved, name, position, email }`).
- Server-side, [`request-normalization.ts`](../../services/dashboard/lib/request-normalization.ts) `normalizeApprovals()` now trims/caps each approval entry and lowercases the email instead of passing the raw client array through. The email is persisted in the stored `approvals` JSON.
- After a submission record is created, [`submission-workflow.ts`](../../services/dashboard/lib/submission-workflow.ts) fires `sendSubmissionConfirmationEmails` (fire-and-forget — a mail failure never fails the submission). It sends **one grouped receipt email** with the generated `.docx`: the first deliverable-looking recipient is the `To` address and remaining distinct submitter/approver recipients are `Cc`. The copy is intentionally framed as visibility/recordkeeping after sign-off, not a request for approval. Recipient de-duplication and the HTML/subject builders are pure functions in [`submission-confirmation-mail.ts`](../../services/dashboard/lib/submission-confirmation-mail.ts); the recipient builder drops syntactically valid but reserved placeholder domains such as `example.com`, `example.net`, `example.org`, `.test`, `.invalid`, `.localhost`, and `.example` so local/demo values do not generate Microsoft 365 bounces. `index.ts` reads the docx and sends via the existing `sendAlertMail` transport (Microsoft Graph over HTTPS, SMTP fallback — the same path admin alerts use, so no new config). When no transport is configured (local dev) the send is skipped with a log line; oversized attachments are stripped with a dashboard-link fallback by `sendAlertMail`.

### Two flows + a flag-controlled default

Both flows are kept and served from stable URLs. The new upload-first flow is now the default, while the original multi-section form remains available as a fallback:

| URL | View | Notes |
|-----|------|-------|
| `/form` | default flow | The canonical URL the dashboard links to. Serves the new upload-first flow unless `NEW_SUBMISSION_FORM_DEFAULT=false` is set as a rollback. |
| `/form-new` | [`form.ejs`](../../services/dashboard/views/form.ejs) | The new upload-first flow, always available as a stable alias. |
| `/form-legacy` | [`form-legacy.ejs`](../../services/dashboard/views/form-legacy.ejs) (a snapshot of the `main` `form.ejs`) | The pre-redesign multi-section flow, always available. |

`NEW_SUBMISSION_FORM_DEFAULT` controls only what `/form` renders; `/form-new` and `/form-legacy` are unconditional. **Current default is the new upload-first flow** so every existing dashboard link/bookmark to `/form` follows the simplified experience. Set `NEW_SUBMISSION_FORM_DEFAULT=false` only as a temporary rollback to the legacy form. All three routes share `renderSubmissionForm()` and the same render locals.

The same **Approver Email** field (required primary, optional additional) was added to **both** flows, so they collect identical data and produce the same grouped confirmation email — the email send lives server-side in `/api/form/submit`, which both forms POST to. The legacy form reuses the same backend endpoints and the (additively-extended) shared `form-helpers.js`.

## Reused (unchanged)

- Redline diff engine [`public/js/redline-preview.js`](../../services/dashboard/public/js/redline-preview.js) (shared with `approval-editor.ejs`).
- Helpers [`public/js/form-helpers.js`](../../services/dashboard/public/js/form-helpers.js).
- Endpoints `/api/modification/unapproved-upload`, `/api/form/basic-check[/start|/status]`, `/api/form/submit`, `/api/submitter-profiles/search`.
- Telemetry: `/api/form/attempt-log` and the "Report this problem" `/api/form/error-report`.

## Verification

- Unit: [`__tests__/form-stage.test.js`](../../services/dashboard/__tests__/form-stage.test.js) (stage/reveal logic, incl. approver-email gating) and [`__tests__/form-upload-first-view.test.js`](../../services/dashboard/__tests__/form-upload-first-view.test.js) (markup + JS wiring, incl. the approver-email field). Approver-email + confirmation-email server logic: [`__tests__/request-normalization.test.ts`](../../services/dashboard/__tests__/request-normalization.test.ts) (`normalizeApprovals`), [`__tests__/submission-confirmation-mail.test.ts`](../../services/dashboard/__tests__/submission-confirmation-mail.test.ts) (recipient dedup, grouped subject/HTML), [`__tests__/alert-mail.test.ts`](../../services/dashboard/__tests__/alert-mail.test.ts) (`Cc` support in Graph/SMTP transport), and [`__tests__/submission-workflow-attempt-link.test.ts`](../../services/dashboard/__tests__/submission-workflow-attempt-link.test.ts) (generated-docx handoff to confirmation email). The `/form` default and `/form-legacy` fallback are covered by [`__tests__/dashboard-route-aliases.test.js`](../../services/dashboard/__tests__/dashboard-route-aliases.test.js). The public welcome links are covered by [`__tests__/welcome-page.test.js`](../../services/dashboard/__tests__/welcome-page.test.js). The 1,191-line `redline-preview.test.js` and the server `modification-workflow.test.js` are unchanged.
- Live: verified via Claude Preview (on `PORT=3017` to avoid the Docker-bound 3005) — initial upload-only state, upload → menu renders with preserved redlines + details reveal, fill → approval reveal, fill → AI button, and the FLIP float-down relocating the menu below the form. The live AI call and full server submit require the AI/db services (run via Docker).

## Follow-ups

- Fully delete the hidden legacy mode/workflow markup and its handlers (`onSubmissionModeChange`, `onModificationSourceChange`, `uploadBaselineDoc`, DB submission search), and update `form-view.test.js`.
- Consider removing the now-unused server routes `/api/form/menu-image-upload` and `/api/modification/baseline-upload`.
