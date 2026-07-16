# Implementation Spec: Menu as an Entity + Lightweight Identity

Handoff spec for implementing [docs/design-docs/menu-entity-and-identity.md](design-docs/menu-entity-and-identity.md). Read that doc first — it holds the rationale and UX decisions. This spec holds the build order, file pointers, contracts, and acceptance criteria.

**Required reading before starting:** `AGENTS.md` (conventions, Docker-first verification, route ordering, docs requirements), the design doc above, [design-docs/draft-concurrency-and-lineage.md](design-docs/draft-concurrency-and-lineage.md) (the system this supersedes in part), [design-docs/submitter-autofill.md](design-docs/submitter-autofill.md), [design-docs/approval-attestation.md](design-docs/approval-attestation.md), [feature-delivery-workflow.md](feature-delivery-workflow.md).

**Implement in phase order. Phases 1–3 are sequential. Phases 4 and 5 are independent of 1–3 and of each other; they may ship at any time. Do not start a later sequential phase until the prior phase's acceptance criteria pass.**

---

## Invariants (must hold at every commit)

1. `menus.current_submission_id` always points at an approved submission whose `menu_id` is that menu. The pointer moves **only** when a submission transitions into `APPROVED_SUBMISSION_STATUSES` (`services/db/index.ts` ~line 43). Concurrent approvals: latest `reviewed_at` wins (same rule as today's lineage tip).
2. The backfill never auto-links an ambiguous group. Ambiguity goes to the human review sheet; unmatched submissions become single-version menus.
3. Old versions never expose a direct edit path. Editing a menu always starts from `current_submission_id`. Downloads stay available for every version in every state.
4. After Phase 3, at most one `active` draft per `menu_id` (replaces the per-`base_submission_id` invariant, enforced DB-side like today).
5. No accounts. The Stage 1 profile is client-side convenience only; `last_edited_by` stays display-only, never access control.
6. Attestation still gates submit exactly as today. The Stage 5 dispute link is post-hoc: a dispute flags and notifies, it never blocks or unwinds anything automatically.
7. During Phases 1–2, all existing behavior (lineage gating, card states, freshness dialog) keeps working unchanged — the new tables ship dark.

---

## Phase 1 — Schema + backfill (ships dark, no behavior change)

### 1.1 Schema

New migration `supabase/migrations/<date>_menu_entity.sql` + mirror in `supabase/schema.sql` (schema-drift gate compares them — [design-docs/schema-drift-gate.md](design-docs/schema-drift-gate.md)):

```sql
CREATE TABLE IF NOT EXISTS menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property VARCHAR(200) NOT NULL,
    service_period VARCHAR(120) NOT NULL,
    name VARCHAR(200) NOT NULL,
    current_submission_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'active',  -- active | retired
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS menu_id UUID;
CREATE INDEX IF NOT EXISTS idx_submissions_menu ON submissions(menu_id);
ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS menu_id UUID;  -- populated Phase 3
```

- JSON fallback: `tmp/db/menus.json` keyed by id, following the `db` service's existing fallback conventions (no indexes — enforce invariants in code).
- Add `submissions: ['menu_id']`, `draft_sessions: ['menu_id']`, and a `menus` entry to `CRITICAL_SUPABASE_SCHEMA` (`services/db/index.ts` ~line 3165) so a missed migration fails loudly.
- No FK constraints on `current_submission_id`/`menu_id` in v1 — historical rows and the JSON fallback can't satisfy them; validate in code.

### 1.2 DB service plumbing (`services/db/index.ts`)

- CRUD helpers: `getMenuById`, `findMenus({ property?, servicePeriod?, status? })`, `saveMenu`, batch `getMenusByIds`. Named routes (`GET /menus`, `GET /menus/:id`, `POST /menus`) registered before any `/:id`-param capture per AGENTS.md.
- `normalizeSubmission`-adjacent mapping: expose `menu_id` on submission payloads (`mapApprovedSubmissionForClient` ~line 970).

### 1.3 Backfill script

`scripts/backfill-menus.ts` (one-off, both Supabase and JSON fallback), over approved submissions oldest-first:

1. Group by existing `revision_base_submission_id` chains (walk to root; one menu per chain).
2. For lineage-unknown approved submissions: run the existing near-exact text matcher (`isNearExactBaselineMatch`, `services/db/index.ts` ~line 1131) against already-grouped menus for the same property (narrowed by service period when set).
3. Remaining: exact property + service period + trimmed/lowercased `project_name` equality.
4. Anything still ambiguous (matches >1 group, or text-match below threshold but same property/service/name-ish) → emit to `tmp/menu-backfill-review.csv` with the candidate groups; **do not link** (invariant 2).
5. Unmatched → create a single-version menu.
6. For each menu: `current_submission_id` = version with latest `reviewed_at` (fallback `updated_at`).

Flags: `--dry-run` (default; writes the CSV + a summary, touches nothing) and `--apply`. A second script or flag `--apply-review <csv>` applies human-edited review-sheet decisions.

### 1.4 Acceptance (Phase 1)

- db tests (`services/db/__tests__/menus.test.ts`): CRUD + batch helpers, JSON fallback parity; backfill grouping on fixture data covering: clean lineage chain, doc-upload text-match join, name-equality join, ambiguous → CSV not linked, unmatched → single-version menu, pointer = latest `reviewed_at`.
- `npx tsc --noEmit --project services/db/tsconfig.json`.
- Live (Docker): `--dry-run` against seeded data produces a sane summary + CSV; `--apply` then `GET /menus` returns grouped menus; **no visible change** on `/approved-menus`, `/drafts`, or `/form`.
- Production prerequisite for Phase 3: run `--dry-run` against a production snapshot and have a human review the CSV before `--apply`.

---

## Phase 2 — Write path (menu resolution + pointer moves)

### 2.1 Pointer move on approval (DB service chokepoint)

Approval status is written from multiple callers (dashboard approval workflow, `services/clickup-integration/lib/approval-finalization.ts` ~line 37). Hook the transition **once** in the DB service where submission updates are persisted: when a submission's status enters `APPROVED_SUBMISSION_STATUSES` and `menu_id` is set → update that menu's `current_submission_id` and `updated_at`, guarded by the latest-`reviewed_at` rule (a late-arriving approval of an older version must not move the pointer backward). Audit first: `rg -n "status" services/db/index.ts` for every submission-write path and confirm all funnel through the chokepoint; if any caller writes Supabase directly, close that hole first.

### 2.2 Menu resolution at submission creation

Per the design doc's resolution table:

- **Draft submit / DB-baseline modification:** inherit `menu_id` from the baseline submission. Wire where `revision_base_submission_id` is set today (`services/dashboard/lib/submission-workflow.ts` ~lines 329, 487, 605).
- **Doc-upload modification:** on the existing Phase C confirm ("Yes, this replaces it"), inherit the matched baseline's `menu_id` alongside the lineage id. Declined/no-match → brand-new path.
- **Brand new:** at approval time (not submit time — rejected submissions must not create menus), if no `menu_id`: look for an active menu with same property + service period + name collision (trimmed/case-insensitive `project_name`). No collision → create the menu silently. Collision → reviewer prompt (2.3).

### 2.3 Reviewer prompt (collision-only)

On the reviewer approval action for a brand-new submission that collides with an active menu, ask once: **"New version of `<menu name>` (current version approved `<date>`), or a separate menu?"** — options `New version of <name>` / `Separate menu`. Fires only on collision (per the design doc's open-question resolution). Locate the approval UI via the approval-workflow handlers (`services/dashboard/lib/approval-workflow.ts`) and the review dashboard views; the ClickUp-webhook approval path can't prompt — collision there defaults to **separate menu** and logs a warning (never silently merge).

### 2.4 Acceptance (Phase 2)

- db tests: pointer moves on approval; pointer does not move backward on late approval of older version; rejected/pending never touch pointer; ClickUp-path collision default.
- dashboard tests: `menu_id` inheritance on all three guided paths; collision prompt only on collision; prompt result persisted.
- Live (Docker): full loop — edit an approved menu via draft → submit → approve → `GET /menus/:id` shows the new submission as current; brand-new submission with colliding name → prompt appears; choosing each option produces the right rows.
- `/approved-menus` UI still unchanged (reads still on the old path).

---

## Phase 3 — Read path (menu-centric UI + draft invariant re-key)

### 3.1 Approved Menus page becomes menu-centric

- `services/dashboard/lib/approved-menus.ts`: new `listMenus(filters)` returning menu cards — name, property, service period, current version (id, approved date, approved filename), `activeDraft`, version count. Search/filter semantics preserved (query, restaurant, servicePeriod — reuse the existing match helpers against the menu's current version fields).
- `views/approved-menus.ejs`: one card per **menu**. Card actions: `Edit This Menu` (targets current version), downloads for current version, `View version history` expander listing prior versions with per-version downloads and `View` only — no edit affordance on old versions (invariant 3). In-progress state renders as today (badge + Resume + Discard), keyed by menu.
- Keep `?submissionId=` deep links working: resolve a submission id to its menu's card.

### 3.2 Draft invariant re-key

- `POST /draft-sessions` (`services/db/index.ts` ~line 1390): resolve baseline → resolve `menu_id` → reject with `409 { currentVersion }` if the baseline is not the menu's current version (replaces `findApprovedChildren` gating); single-active lookup and the partial unique index move from `base_submission_id` to `menu_id`:
  `CREATE UNIQUE INDEX ... ON draft_sessions(menu_id) WHERE status = 'active';` (migration order: backfill `draft_sessions.menu_id` from each draft's baseline first, then swap indexes — same pattern as the Phase-A cleanup, keep newest active per menu, discard the rest).
- `/drafts` page and card enrichment switch to menu-keyed batch lookups. The July 2026 dual-id join workaround in `enrichApprovedMenuList` (`lib/approved-menus.ts`) can then be deleted — menu ids are uuid-only, minted by us.

### 3.3 Retire the inference machinery (read side)

- Card supersede state now = `submission.id !== menu.current_submission_id`. Remove the `/submissions/lineage-children` batch call from the `/approved-menus` route (`services/dashboard/index.ts` ~line 1282). Keep the endpoint itself — the progression timeline still reads chains.
- `findLatestApprovedByPropertyService` staleness inference (`type: 'stale'` in `views/form.ejs` `getBaselineFreshnessIssue`) is replaced by a pointer check against the draft's menu. Keep the `type: 'existing'` soft dialog for the brand-new form path — it remains useful pre-approval where no menu link exists yet.

### 3.4 Acceptance (Phase 3)

- dashboard tests: menu card states (current / in-progress / history expander), no edit affordance on old versions, submissionId deep-link resolution; db tests: 409-with-currentVersion on stale baseline, re-keyed single-active invariant, draft `menu_id` backfill keeps newest.
- Live (Docker): the user-reported scenarios from July 2026 all resolve — searching Tán shows one Lunch card (not N submissions); its Edit button opens/resumes with the badge visible; an old version can be viewed/downloaded but not edited.
- `README.md` updated (user-facing page change).

---

## Phase 4 — Identity Stage 1: remembered profile (independent; ship any time)

- `views/form.ejs`: on successful submit **and** on submitter-autocomplete selection (`onSubmitterNameInput` flow, [design-docs/submitter-autofill.md](design-docs/submitter-autofill.md)), store `{ name, email, jobTitle }` in `localStorage` (`menumanager.submitterProfile`, versioned key).
- On form/draft open: prefill `submitterName`/`submitterEmail`/`submitterJobTitle` **only when the fields are empty after draft restore** — draft `form_state` (July 2026 fix) takes precedence over the profile. Fields stay editable; editing updates the stored profile on next submit, never mid-session.
- Draft autosave: `lastEditedBy` falls back to the stored profile name when the visible field is empty (form.ejs autosave payload ~line 8247).
- Same behavior on `/design-approval` (it shares the profile endpoints).
- Tests: view-source tests per `draft-resume-view.test.js` pattern (storage key present, restore-precedence branch, autosave fallback). Live: submit once, reopen `/form` → prefilled; open a shared draft with someone else's saved fields → draft values win.

## Phase 5 — Identity Stage 2: approver dispute link (independent; ship any time)

- Schema (same migration or its own): `submissions.approver_dispute_token VARCHAR(64)`, `approver_disputed_at TIMESTAMPTZ`, `approver_dispute_note VARCHAR(500)`; mirror in `schema.sql` + `CRITICAL_SUPABASE_SCHEMA`.
- Token minted at submission creation (crypto-random, like draft tokens). The approver copy email (`services/dashboard/lib/submission-confirmation-mail.ts` — approver recipients ~line 88) gains one line for `role: 'approver'` recipients only: "If you did **not** approve this menu, let us know" → `GET /approval-dispute/:token` on the dashboard (named route before `/:id` routes; rate-limited like draft-token lookup).
- The route renders a minimal confirm page (one button + optional note field, tenant-branded, no auth) → `POST` records `approver_disputed_at`/`note`, notifies the review inbox via the notifier service (fire-and-forget with `.catch()`, per AGENTS.md cross-service convention), and renders "thanks, the team has been notified." Idempotent: re-visits show the already-recorded state.
- Review dashboard: prominent flag on disputed submissions. **No automatic unwind** (invariant 6). Token validity: indefinite in v1 (open question resolved: revisit only if abuse shows up).
- Tests: token round-trip, idempotency, email line only for approver recipients, flag rendering. Live: submit with a real inbox as approver email → click link → dispute recorded + flag visible.

---

## Documentation (required by AGENTS.md, each phase)

- Design doc Status line + [design-docs/index.md](design-docs/index.md) status column as phases land.
- `README.md`: Phase 3 (menu-centric Approved Menus) and Phase 4 (profile prefill) are user-facing.
- Update [design-docs/draft-concurrency-and-lineage.md](design-docs/draft-concurrency-and-lineage.md) when Phase 3 retires its gating (mark the superseded sections, don't delete the history).
- New env vars: none expected. New routes: dashboard-public, consistent with the existing no-auth model; rate-limit token routes.

## Out of scope

- Real sign-in / accounts / permissions (design doc Stage 3, explicitly deferred).
- Retired-menu management UI (column ships, UI later).
- Marketing-facing menu progression timeline.
- Any change to attestation gating at submit.
