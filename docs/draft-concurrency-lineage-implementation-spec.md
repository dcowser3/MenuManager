# Implementation Spec: Draft Concurrency + Menu Lineage Control

Handoff spec for implementing [docs/design-docs/draft-concurrency-and-lineage.md](design-docs/draft-concurrency-and-lineage.md). Read that doc first — it holds the rationale and UX decisions. This spec holds the build order, file pointers, contracts, and acceptance criteria.

**Required reading before starting:** `AGENTS.md` (conventions, Docker-first verification, route ordering, docs requirements), the design doc above, [design-docs/approved-menu-click-to-edit.md](design-docs/approved-menu-click-to-edit.md) (the Phase 1 system this extends), [feature-delivery-workflow.md](feature-delivery-workflow.md).

**Implement in phase order. Each phase is independently shippable and verifiable. Do not start a later phase until the prior phase's acceptance criteria pass.**

---

## Invariants (must hold at every commit)

1. At most one `active` draft session per `base_submission_id`, enforced in the DB service (not only UI). No transient dual-active window during discard-and-replace.
2. Supersede gating uses **only** the `revision_base_submission_id` lineage chain. Unknown lineage never blocks or greys out anything. The property+service-period "latest" check (`findLatestApprovedByPropertyService`) remains a soft confirm only.
3. Downloads (`Download Clean Word Doc`, `Download Original Approved`) remain available on every approved-menus card in every state.
4. Lineage links from the doc-upload path are **never** written without explicit human confirmation.
5. Existing Phase 1 behavior preserved: staleness `409` on save, submit lock, 30-day expiry, share-by-link.

---

## Phase A — Single-active-draft invariant + resume/discard UX

### A1. Schema

- New migration `supabase/migrations/<date>_draft_concurrency.sql` + mirror the change in `supabase/schema.sql` (schema-drift gate compares them — see [design-docs/schema-drift-gate.md](design-docs/schema-drift-gate.md)):
  - `draft_sessions.status` gains allowed value `'discarded'` (column is `VARCHAR(30)`, no enum change needed — document the value set `active | submitted | expired | discarded` in a comment).
  - Add nullable `draft_sessions.last_edited_by VARCHAR(160)`.
  - Add partial unique index enforcing the invariant at the database level:
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_sessions_one_active_per_base ON draft_sessions(base_submission_id) WHERE status = 'active';`
- JSON fallback (`data/draft_sessions.json` via `services/db/index.ts`): enforce the same invariant in code — the fallback has no unique indexes.
- Update the Supabase mirror column list for `draft_sessions` in `services/db/index.ts` (~line 2869) to include `last_edited_by`.

### A2. DB service (`services/db/index.ts`, draft routes start ~line 1201)

- **`POST /draft-sessions` — reuse semantics.** Before creating: look up an `active` draft for the resolved `base_submission_id`. If found, run `expireDraftIfNeeded` on it; if still active, return `200` with the existing draft payload plus `resumed: true`. Only create (current behavior, `201`) when none exists. Creation must handle the unique-index violation race (concurrent double-click): on conflict, re-fetch and return the existing draft as a resume.
- **`POST /draft-sessions/:token/discard`** — new route, registered before any `/:token`-param routes per AGENTS.md route ordering. Rules: `404` unknown token; `409` if `submitted`; idempotent success if already `discarded`/`expired`; otherwise set `status='discarded'`, bump `updated_at`. Keep the row (manual recovery).
- **Discard-and-replace** — extend `POST /draft-sessions` to accept optional `replaceToken`. When present and it names the current active draft for the same `base_submission_id`: discard it and create the new draft in one code path (write discard before create; under Supabase the unique index guarantees no dual-active even if the process dies between the two writes — a retry resumes cleanly). `400` if `replaceToken` doesn't match that baseline's active draft.
- **`GET /draft-sessions?status=active`** — list endpoint (also accept `baseSubmissionIds` as a comma-separated batch filter for Phase B card enrichment). Registered before `/:token`. Response items: draft fields + baseline summary (`property`, `projectName`, `servicePeriod`, baseline `reviewedAt`) via `mapApprovedSubmissionForClient`-style joining. **Never include `token` in list responses except as needed for resume links — see security note in the design doc; tokens in this listing are an accepted, deliberate exposure consistent with the link-sharing model.**
- **`PUT /draft-sessions/:token`** — accept optional `lastEditedBy` (sanitized, max 160 chars) and persist to `last_edited_by`.

### A3. Dashboard service (`services/dashboard/index.ts`, draft proxy routes ~line 2708)

- `POST /api/drafts`: pass through `replaceToken`; preserve the existing 303-redirect-to-`/form?draft=` behavior for both `201` created and `200` resumed.
- `POST /api/drafts/:token/discard`: new proxy route (before `/:token` param routes).
- `GET /api/drafts?status=active`: new proxy route.
- Autosave path in `views/form.ejs`: include `lastEditedBy` from the client-side submitter-autofill profile when available (display-only hint; do not block or validate on it).

### A4. Approved Menus card states (`views/approved-menus.ejs` + `lib/approved-menus.ts`)

- Enrich `listApprovedMenus` results (`services/dashboard/lib/approved-menus.ts`, `buildApprovedMenuList` ~line 100): batch-fetch active drafts for the result's submission ids (one call via `GET /draft-sessions?status=active&baseSubmissionIds=...`, not N+1) and attach `activeDraft: { lastSavedAt, lastEditedBy } | null`.
- Card rendering:
  - No active draft → unchanged `Edit This Menu`.
  - Active draft → badge `In progress — last saved <relative time>` (+ `by <name>` when known); primary button `Resume Editing` (links `/form?draft=<token>`); secondary link `Discard and start over` → confirmation dialog stating the last-saved date → `POST /api/drafts` with `replaceToken`.

### A5. One-time cleanup

Phase 1 has been creating a new draft per button click, so multiple stale `active` drafts per baseline already exist. Add `scripts/` one-off (or migration step): for each `base_submission_id` with >1 active draft, keep the most recently `updated_at`, mark the rest `discarded`. Must run for both Supabase and JSON fallback. Run before the unique index is applied (index creation fails otherwise).

### A6. Tests + verification (Phase A acceptance)

- `services/db/__tests__/draft-sessions.test.ts`: create-returns-existing-active (`resumed: true`); expired active draft → new draft created; discard rules (404/409/idempotent); discard-and-replace atomicity — at no observable point two active drafts for one baseline; `replaceToken` mismatch → 400; list endpoint filtering + batch param; `last_edited_by` round-trip; cleanup script keeps newest.
- `services/dashboard/__tests__/` (alongside `modification-workflow.test.js`): card enrichment attaches `activeDraft` via one batch call; proxy routes.
- Build check per service: `npx tsc --noEmit --project services/db/tsconfig.json` and same for dashboard.
- Live (Docker, `./dev-up.sh`): click `Edit This Menu` on a seeded approved submission from two browser profiles → both land in the same draft; edit in one, resume in other → edits visible; discard-and-start-over → fresh editor, old draft `discarded`; badge appears/disappears correctly.

---

## Phase B — Lineage-based supersede gating + `/drafts` page

### B1. Lineage tip computation (DB service)

- Index: `CREATE INDEX IF NOT EXISTS idx_submissions_revision_base ON submissions(revision_base_submission_id);` (migration + `schema.sql`).
- Helper `findApprovedChildren(submissionIds: string[])`: batch lookup of submissions with `revision_base_submission_id` in the given set AND status in `APPROVED_SUBMISSION_STATUSES` (`services/db/index.ts` ~line 43). Only approved children supersede. Multiple approved children → tip is latest `reviewed_at` (fall back `updated_at`); include all children in the payload so the anomaly is visible.
- A submission is `superseded` iff it has ≥1 approved child. `supersededBy` = the tip-ward child: `{ id, projectName, approvedAt }`.

### B2. Enforcement in `POST /draft-sessions`

- After resolving the baseline: if it has an approved child, return `409 { error, supersededBy }`. Dashboard proxy surfaces this; non-JSON requests render the error page with a link to the tip. (UI should prevent reaching this, but the server rule is the actual control.)
- Keep the existing `findLatestApprovedByPropertyService` freshness data flowing to the client unchanged — it stays a soft confirm dialog only (invariant 2).

### B3. Approved Menus card supersede state

- Extend the Phase A enrichment batch to also attach `supersededBy` (one `findApprovedChildren` call per search result set).
- Superseded card: `Edit This Menu` disabled (greyed, not hidden) + notice `A newer version was approved <date>` + link `Edit Latest Version` targeting the tip submission. If a superseded baseline *also* has an active draft (stale draft from before supersession), show both the in-progress badge and the superseded notice; `Resume Editing` stays available — the existing baseline-freshness dialog on draft open handles resolution.

### B4. `/drafts` page (dashboard)

- New route `GET /drafts` in `services/dashboard/index.ts`, registered before any `/:id`-style routes. New view `views/drafts.ejs` (follow `approved-menus.ejs` styling/tenant conventions — no hardcoded business strings; use `app.locals.tenant`).
- Content: table of active drafts — restaurant, service period, project/menu name, baseline approved date, last saved, `last_edited_by`, `Resume` link, `Discard` action (same confirm as cards). Secondary section: drafts `submitted` or `discarded` in the last 7 days (read-only).
- Link to `/drafts` from the Approved Menus page header.

### B5. Tests + verification (Phase B acceptance)

- db tests: `findApprovedChildren` batching; rejected/pending children do NOT supersede; multi-child tip = latest `reviewed_at`; `409 supersededBy` on create; superseded baseline with unknown lineage sibling (same property+service period, no `revision_base_submission_id`) is NOT gated.
- dashboard tests: card resolves to exactly one edit-action state for all four states in the design doc's table; `/drafts` route renders and lists.
- Live (Docker): approve a modification submitted from a draft → original card shows superseded, edit disabled, `Edit Latest Version` goes to the new submission's card; `/drafts` lists an active draft and resumes it; create a second unrelated "Holidays & Events" menu for the same property → neither Holidays card is greyed out.

---

## Phase C — Doc-upload lineage capture (auto-match + confirm)

### C1. Match endpoint (DB service)

- `POST /submissions/baseline-match` (named route before `/:id` routes): body `{ extractedText, property, servicePeriod? }`. Normalize (trim, collapse whitespace, lowercase) and compare against `approved_menu_content` of approved submissions for that property (narrowed by service period when provided). Launch threshold: near-exact — ≥95% matching normalized non-empty lines, both directions. Response: `{ match: { id, projectName, servicePeriod, approvedAt } | null }`. Return only the single best match; below threshold → `null`. No fuzzy tiers in v1 (open question in the design doc).

### C2. Dashboard wiring

- `POST /api/modification/baseline-upload` (`services/dashboard/index.ts` ~line 2757, `handleCleanDocxMenuUpload` in `lib/`): after extraction, call baseline-match; include `lineageSuggestion` in the response.
- Form confirm screen (`views/form.ejs`): when `lineageSuggestion` present, show one line — `This looks like an update to <projectName>, approved <date>` with `Yes, this replaces it` / `No, this is a separate menu`. Default: **neither preselected**; submission proceeds without a choice as "no link" (never auto-link — invariant 4).
- Submit path (`services/dashboard/lib/submission-workflow.ts` ~lines 329, 487, 605): when the user confirmed, populate `safeRevisionBaseSubmissionId` → `revision_base_submission_id` for uploaded-baseline modifications (today it is null on that path). Validate the confirmed id server-side: must be an approved submission for the same property; reject otherwise (don't trust the client-echoed id blindly).

### C3. Tests + verification (Phase C acceptance)

- db tests: exact round-trip text matches; sub-threshold returns null; property mismatch returns null.
- dashboard tests: suggestion flows into form payload only when confirmed; declined/no-answer → `revision_base_submission_id` null; server-side validation of confirmed id.
- Live (Docker): download a clean approved DOCX → re-upload it via the modification upload path → confirm screen shows the correct match → submit with "Yes" → new submission has `revision_base_submission_id` set → after approval, Phase B greys out the old card.

---

## Documentation (required by AGENTS.md, each phase)

- Update the design doc's Status line as phases land (`Design` → `Phase A implemented`, etc.).
- Update [design-docs/index.md](design-docs/index.md) status column.
- `README.md`: user-facing changes (resume behavior, `/drafts` page, superseded cards, confirm-screen lineage question).
- New env vars: none expected. New routes: no auth (dashboard-public, consistent with existing draft endpoints); keep rate limiting on token lookup.

## Out of scope

- Marketing-facing menu progression timeline (enabled by this data; separate effort).
- Real-time co-editing, presence, accounts/permissions.
- Changing `/form` mode-selection entry points.
- Fuzzy (sub-95%) baseline matching tiers.
