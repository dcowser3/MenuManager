# Approved Menu Click-to-Edit + Shared Draft Sessions

## Status

Phase 1 implemented. Deliberately **not** routed into the main submission flow at launch — entry is a third button on the Approved Menus page only, so it can be trialed without touching the existing `/form` entry points.

Implemented scope:

- `/approved-menus` renders **Edit This Menu**, which creates a draft and redirects to `/form?draft=<token>`.
- Drafts persist through the DB service in `draft_sessions`, with Supabase schema/migration support and local JSON fallback.
- Draft links autosave editor HTML and form state, expose **Copy edit link**, reject stale saves with `409`, lock after submit, and expire after the tenant-configured idle window.
- The persistent revision preview is collapsible in draft mode and defaults collapsed for click-to-edit drafts.
- Draft AI checks can run before submitter, Date Needed, and approval/attestation fields are completed; final submit still validates those fields.

Not yet implemented from the original design:

- A separate confirm-fields-after-AI screen. Phase 1 reuses the current upload-first form-stage layout, keeping metadata fields visible while allowing draft AI checks before the confirmation-only fields are filled.

## Problem

Chefs revising an approved menu today either (a) download the DOCX, edit in Word, re-upload, and submit, or (b) know to open `/form`, pick Modification, and search the database. The in-browser modification editor already exists and works; the gaps are:

1. **Entry point** — there is no direct path from an approved menu to "edit this menu." The DB-search route inside `/form` is not discoverable from where chefs actually look at approved menus.
2. **Handoff** — chefs sometimes collaborate: one chef starts edits, a second chef finishes and submits. Today that requires the doc round-trip. There is no way to save in-progress browser edits or hand them to someone else.
3. **Editor width** — the side-by-side layout halves the editing surface versus full-screen Word. On large menus this is a real (if secondary) annoyance.

## Non-Goals

- **No inline (Word-style) track changes in the editing surface.** Live redlining inside the editor means non-editable deletion spans, cursor management around them, undo interactions, and re-fighting every offset-drift bug already documented in [revision-modification-flow.md](revision-modification-flow.md). The side-by-side dynamic diff stays as-is; we only change how much screen it occupies (see Layout below).
- **No real-time co-editing.** No websockets, no operational transforms, no presence. Collaboration is sequential handoff via a link; last saved state wins, with a staleness guard.
- **No accounts/permissions.** The share link is the capability, consistent with the rest of the dashboard.
- **No second editor.** This flow deep-links into the existing `/form` modification editor with the baseline preloaded. Any editor improvement lands for all modification routes.

## User Experience

### Entry: third button on Approved Menus

Each result card on `/approved-menus` currently has two actions: `Download Clean Word Doc` and `Download Original Approved`. Add a third: **`Edit This Menu`**.

Clicking it creates a draft session server-side and redirects to the existing form in modification mode with the baseline preloaded — equivalent to having chosen `Modification to Existing Menu` → `Choose from database` and selected this submission, with all steps up to the editor auto-completed.

The existing `/form` mode-selection UI is unchanged. Once this flow is validated, promoting it (e.g., surfacing "edit an approved menu" inside `/form`) is a follow-up decision, not part of this build.

### Editing

Identical to the current DB-baseline modification flow: left editor, right persistent preview (red strikethrough deletions, yellow highlight insertions), changed-lines-only AI scoping, baseline freshness checks, prix fixe exemption, allergen handling — all reused, not reimplemented.

**Layout change (applies to all modification routes):** make the right persistent preview collapsible. Default state for this entry point is collapsed: full-width editor with a `Show changes (N)` toggle (N = current insertion+deletion group count). Expanding restores the current side-by-side view; the state persists per draft. This recovers the full-screen Word feel for ~5% of the cost of inline redlining and reuses `renderPersistentPreview()` unchanged.

### Prefill

The baseline is a full submission record, so prefill is copy-from-DB, not extraction — stronger than the upload flow (no parser, no timeouts, no blank fields). Copy verbatim from the baseline submission: project name, property, service period, menu type, asset type, orientation, print size/region, crop/bleed marks, folded, allergen key, file delivery notes, raw/undercooked flag.

Deliberately **not** carried over:

- **Date Needed** — recomputed from the turnaround-derived minimum (the baseline's date is in the past).
- **Submitter identity** — resolved at submit time for whoever actually submits (submitter-autofill profile), since the submitter may be the second chef in a handoff, not the person who opened the draft.
- **Approvals/attestation** — re-affirmed per submission, never inherited.

The raw/undercooked flag is prefilled but shown on the confirm screen, since edits can change it.

### Finish: "I'm Done" → AI check → confirm fields

Because project/property/service period are known from the baseline at entry, the AI check does not need a fields-first step in this flow. Order:

1. Chef clicks **`I'm Done — Run AI Check`**.
2. Basic AI Check runs with baseline-derived context (changed-lines scoping, allergen key, prix fixe exemption all resolve from the baseline/prefill).
3. Chef reviews/accepts suggestions (existing UX, including the re-run-required rule for post-check edits).
4. **Confirm screen**: all prefilled fields shown filled, Date Needed to set, submitter + attestation to complete. Fields are confirmation, not data entry.
5. Submit — identical downstream pipeline (DOCX generation, ClickUp task creation, Tier 2 async review, telemetry).

The existing `/form` flows keep their current field ordering; this ordering is specific to the click-to-edit entry where context is known up front.

## Draft Sessions + Share Link

### Model

New `draft_sessions` table (Supabase, JSON fallback per `db` service conventions):

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `token` | URL-safe random secret; the share capability |
| `base_submission_id` | The approved baseline submission |
| `menu_content_html` | Current editor rich HTML |
| `form_state` | JSON: prefilled/edited field values, preview collapsed state, AI-check state |
| `status` | `active` \| `submitted` \| `expired` |
| `created_at` / `updated_at` | `updated_at` drives the staleness guard |
| `submitted_submission_id` | Set on submit; locks the draft |

### Behavior

- **Create**: `Edit This Menu` creates the draft and redirects to `/form?draft=<token>` (exact param naming TBD at implementation; named route ordering per AGENTS.md).
- **Autosave**: debounced save of editor HTML + form state on edit (e.g., 2–3s idle), plus save on AI-check completion. No manual save button.
- **Share**: a `Copy edit link` action in the editor exposes the draft URL. Opening the link loads the latest saved state. That is the entire collaboration feature.
- **Staleness guard (required, even in the basic model)**: every save sends the `updated_at` the client loaded. If the server's is newer, reject the save and show: "This draft was updated by someone else — reload to get the latest edits." No merging, no locking, no presence. This prevents the A-opens-tab / B-edits / A-overwrites clobber, which is the one failure mode sequential handoff will actually hit.
- **Submit lock**: on successful submission, `status = submitted`. Opening the link afterward shows a read-only notice linking to the submission outcome, preventing double-submits from a stale shared tab.
- **Baseline freshness**: the existing latest-approved-baseline check runs on draft open and before submit. If the baseline was superseded while the draft sat idle, the existing full-screen decision dialog applies.
- **Expiry**: drafts untouched for a configured window (default 30 days, tenant-configurable) are marked `expired`; the link shows an explanatory message with a path to start fresh from the baseline.

### Security notes

- Token is a bearer capability: long, random, unguessable; never logged in full; drafts not enumerable.
- Draft endpoints are dashboard-public like the rest of the form (no auth regression), but rate-limited on token lookup.
- `attempt_id` telemetry (`form_attempt_logs`) gains a nullable `draft_session_id` so handoff funnels are observable.

## Endpoints (Dashboard + DB services)

Dashboard:

- `POST /api/drafts` — create from `base_submission_id` (called by the Edit This Menu button)
- `GET /form?draft=<token>` — load form in draft mode
- `PUT /api/drafts/:token` — autosave (carries client-known `updated_at`; `409` on staleness)
- Existing submit path extended to accept a draft token and lock the draft on success

DB service: matching CRUD for `draft_sessions` (named routes before `/:id` params).

## Rollout / Guardrails

1. **Phase 1 (this doc)**: third button on `/approved-menus`, draft sessions, collapsible preview, prefill + I'm-Done ordering. No changes to `/form` mode selection or existing entry points — chefs who use the current flows see nothing different unless they click the new button.
2. **Phase 2 (separate decision)**: based on pilot usage, decide whether the existing `/form` modification route (`Choose from database`) should adopt the same behaviors — draft autosave/share links, the confirm-fields-after-AI-check ordering, and the collapsed-by-default preview — or be retired in favor of always entering edits from the Approved Menus page.

## Test / Verification Plan

Per AGENTS.md required verification:

- Unit/integration: draft create/load/save/staleness-409/submit-lock/expiry in `services/dashboard/__tests__/` alongside `modification-workflow.test.js`; prefill field mapping (including the three deliberate non-copies); changed-lines AI scoping still computed against the baseline when entering via draft.
- Browser: extend the approval-editor/browser regression pattern to cover draft open → edit → autosave → second-tab staleness rejection → submit lock.
- Live check (Docker, `./dev-up.sh`): click Edit This Menu on a seeded approved submission, edit, copy link, open in second browser profile, verify latest edits appear, submit from the second session, verify first session shows the locked state.

## Open Questions

- Draft retention window default (30 days assumed) and whether expiry should email the draft creator (notifier service exists but we have no reliable identity until submit — likely skip).
- Whether `Show changes (N)` collapsed-by-default should also apply to the existing modification routes in Phase 1, or stay expanded there until the pilot validates it.
- Exact confirm-screen composition: single review panel vs. reusing the existing details card with a "prefilled" visual state.
