# Draft Concurrency + Menu Lineage Control

## Status

Implemented (Phases A–C). Builds directly on [approved-menu-click-to-edit.md](approved-menu-click-to-edit.md) (Phase 1 implemented). The dashboard now enforces one active draft per approved baseline, gates only known lineage supersession, and captures uploaded-baseline lineage only after confirmation.

## Problem

Phase 1 shipped click-to-edit with persistent draft sessions, but with no concurrency or version control around them:

1. **Every `Edit This Menu` click creates a brand-new empty draft.** `POST /draft-sessions` has no reuse logic. Two chefs clicking the same card get two diverging drafts and neither knows the other exists. (Observed behavior of "my old edits came back when I clicked the button" is actually the user reopening a prior draft URL — the button itself never resumes.)
2. **No visibility.** Nothing on the Approved Menus card, or anywhere else, indicates a menu has an edit in progress.
3. **Nothing stops editing a superseded menu.** A chef can open an older approved Tán – Lunch (not the most recent) and branch stale content into a new submission.
4. **"Latest approved" is computed by property + service period** (`findLatestApprovedByPropertyService`). That key is wrong for multi-menu service periods: two independent "Holidays & Events" menus for the same restaurant collapse into one slot, so one of them always looks "superseded" when it isn't.
5. **The doc-upload modification path records no lineage.** `revision_base_submission_id` is set when the baseline comes from the DB (click-to-edit drafts and the form's choose-from-database path), but an uploaded baseline DOCX only stores `revision_baseline_doc_path` — no link to the approved submission it actually was.

## Core Model

### Lineage chain (the deterministic supersede signal)

A submission's parent is `revision_base_submission_id`. Already stored for the two DB-baseline flows; extended to the doc-upload flow below.

- A menu is **superseded** iff an *approved* submission points at it as parent. Rejected/pending children don't supersede.
- The **tip** of a chain is the approved submission with no approved child. The tip is the only editable version.
- Menus with no known children are never blocked — unknown lineage means "don't gate," never "guess." A false lineage link (wrongly greying out a live menu) is worse than a missing one.
- `findLatestApprovedByPropertyService` (property + service period) is demoted to a **soft fallback warning** where lineage is unknown — the existing baseline-freshness confirm dialog, not a hard block. It must no longer be treated as authoritative "latest," precisely because of the Holidays & Events case.
- If a node ends up with multiple approved children (possible: draft submit + a doc-upload submit both claiming the same parent), the tip is the child with the latest `reviewed_at`. Surface the anomaly in the lineage data rather than hiding it.

### Invariant: at most one active draft per approved menu

For every baseline submission there is **never more than one `active` draft**. There is exactly one Tán – Lunch at any point in time, so there is at most one Tán – Lunch edit in progress. Multi-menu service periods don't break this: two independent Holidays & Events menus are two distinct baseline submissions, each with its own single draft slot.

Enforced server-side in `POST /draft-sessions`, not just in UI:

- Active draft exists for `base_submission_id` → return the existing draft (`200`, `resumed: true`) instead of creating one. The button becomes idempotent.
- Baseline is not the tip of its chain → `409` with `{ supersededBy }`. The greyed-out button (below) is the UX; this is the enforcement behind it.
- **Start over = discard-and-replace, never coexist.** A new `discarded` status: discarding the existing draft and creating a fresh one is a single server-side operation, so two active drafts cannot exist even transiently. Discard requires an explicit confirmation in the UI ("This will throw away edits last saved <date>"). Discarded rows are kept, so accidental discards are manually recoverable.

`status` enum becomes: `active | submitted | expired | discarded`.

## User Experience

### Approved Menus card states

Each card resolves to exactly one edit-action state (downloads are always available in every state — full history stays downloadable):

| State | Condition | Card shows |
|-------|-----------|------------|
| Editable | Tip of chain (or unknown lineage), no active draft | `Edit This Menu` (unchanged) |
| In progress | Active draft exists for this baseline | Badge: **In progress — last saved \<relative time\>**. Primary button: `Resume Editing`. Secondary link: `Discard and start over` (confirmation required). |
| Superseded | An approved child exists (known lineage only) | `Edit This Menu` disabled. Notice: "A newer version was approved \<date\>" with a link to the tip's card / `Edit Latest Version`. |
| Possibly stale | Not latest by property+service period, but lineage unknown | No gating. Existing baseline-freshness confirm dialog fires on draft open, as today. |

Security note: `Resume Editing` on a public page hands the draft to anyone who can view Approved Menus. This is consistent with the existing model — drafts are already link-shareable bearer capabilities and the dashboard has no accounts — but it widens exposure from "people given the link" to "anyone browsing the dashboard." Accepted for now; revisit if/when the dashboard grows auth. Rate limiting on token lookup stays.

### Who's editing (best-effort identity)

Drafts have no identity until submit. For the badge and dashboard to say more than "someone," autosaves include an optional `last_edited_by` hint taken from the client-side submitter-autofill profile when present. Display-only, never access control, never trusted for anything else.

### In-progress dashboard

New page `/drafts` (named route registered before any `/:id`-style routes, per AGENTS.md):

- Lists all `active` drafts: restaurant, service period, menu/project name, baseline approved date, last saved, `last_edited_by` hint, Resume link, Discard action.
- A secondary section lists drafts submitted or discarded in the last 7 days, for context.
- Link to it from the Approved Menus page header.

### Lineage capture for the doc-upload modification path (auto-match + confirm)

The uploaded baseline in this flow is *supposed to be* a previously approved doc, and the parser already extracts its text. So:

1. At baseline upload, normalize the extracted text (whitespace, case) and compare against `approved_menu_content` of approved submissions for the same property (narrowed by service period when known).
2. Strong match (start exact/near-exact — a true progression should match almost perfectly; tune threshold later) → the confirm screen shows one line: **"This looks like an update to *Tán – Lunch, approved 7/1/26*"** with `Yes, this replaces it` / `No, this is a separate menu`.
3. Confirmed → `revision_base_submission_id` is set; the chain is complete for this path too. Declined or no match → no link, submission stays lineage-unknown (and therefore never gates anything).
4. Never auto-link without the human confirm.

This also closes the loop for the download → edit in Word → re-upload cycle: the downloaded clean doc's content came from `approved_menu_content`, so it round-trips to a near-exact match.

### Free byproduct: menu progression timeline

With chains complete for all guided flows, "show me how the Tán dinner menu evolved over the year" is a walk up `revision_base_submission_id` — approved docs, dates, diffs. A marketing-facing timeline view is explicitly **out of scope** here; this design just guarantees the data exists.

## Endpoints

Dashboard:

- `POST /api/drafts` — semantics change: returns existing active draft (`resumed: true`) when one exists; `409 { supersededBy }` when the baseline isn't the tip.
- `POST /api/drafts/:token/discard` — mark discarded (used by "start over" and dashboard discard).
- `GET /api/drafts?status=active` — feeds `/drafts` page.
- `/approved-menus` search results enriched per card with `{ activeDraft: { lastSavedAt, lastEditedBy }, supersededBy: { id, approvedAt } }` — one batch lookup for the result set, not N+1 per card.
- Submit path (uploaded-baseline mode) accepts the confirmed lineage id → `revision_base_submission_id`.

DB service: matching query support — active-draft lookup by `base_submission_id` (single + batch), draft listing by status, approved-children lookup by `revision_base_submission_id` (batch), baseline-text match endpoint for the upload flow. Supabase index on `draft_sessions(base_submission_id, status)` and `submissions(revision_base_submission_id)`; JSON fallback per `db` conventions. Named routes before `/:token`.

## Edge Cases

- **Draft open while baseline gets superseded** (e.g., someone else lands a doc-upload submission on the same parent): existing baseline-freshness check on draft open/submit already handles the dialog; the card badge should reflect both states (in progress *and* superseded), with the dialog resolving what happens to the draft.
- **Submitted/expired/discarded drafts** clear the in-progress state immediately.
- **Expiry** (30-day idle, existing) continues to apply; expired drafts free the slot the same way discard does.

## Rollout

1. **Phase A — stop the bleeding:** server-side single-active-draft invariant (reuse on create), `discarded` status + discard endpoint, card badge + Resume/Discard. No lineage work yet. This alone fixes silent parallel drafts.
2. **Phase B — supersede gating + visibility:** lineage-tip computation, 409 on superseded create, card supersede state, enriched search results, `/drafts` page.
3. **Phase C — doc-upload lineage:** text auto-match + confirm-screen link, submit-path plumbing.

## Test / Verification Plan

Per AGENTS.md required verification:

- **db unit/integration** (`services/db/__tests__/draft-sessions.test.ts` extension): create-returns-existing-active, discard-and-replace atomicity (no dual-active window), 409 on superseded baseline, batch active-draft lookup, approved-children tip resolution incl. multiple-children ordering.
- **dashboard tests** (alongside `modification-workflow.test.js`): card state resolution (all four states), enrichment batching, upload-flow match → confirm → `revision_base_submission_id` persisted, declined match → null.
- **Browser/live (Docker, `./dev-up.sh`):** click `Edit This Menu` twice from two browser profiles → same draft both times; discard-and-start-over; superseded card disabled and links to tip; `/drafts` lists and resumes; doc-upload of a downloaded clean doc surfaces the correct match on confirm.

## Open Questions

- Auto-match threshold: launch exact/near-exact only, or allow fuzzier matches with the confirm as the safety net?
- Should `Resume Editing` carry any friction (e.g., show "last saved by X" interstitial) or stay one-click? (One-click proposed.)
- Does discard need an in-UI undo window, or is keep-the-row + manual recovery enough for now?
- Should the `/drafts` page be linked from the welcome dashboard or only from Approved Menus?
