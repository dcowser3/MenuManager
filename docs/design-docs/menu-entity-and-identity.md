# Menu as an Entity + Lightweight Identity

## Status

Design (July 2026). Follow-up to [draft-concurrency-and-lineage.md](draft-concurrency-and-lineage.md), motivated by production use of the July 2026 build. Near-term fixes shipped alongside this doc (form_state persistence, id-join fix, resume banner, staleness-at-open banner) treat the symptoms; this doc proposes fixing the causes.

**Phase 1 built (2026-07-16, ships dark):** `menus` table + `submissions.menu_id` + `draft_sessions.menu_id` (migration `20260716_menu_entity.sql`); db CRUD/batch helpers + `GET/POST /menus` routes; grouping backfill `scripts/backfill-menus.js` (`npm run backfill:menus`, dry-run default) with pure algorithm in `services/db/lib/menu-backfill.ts`. No read path consumes the new tables yet. Production `--apply` is gated on a human reviewing `tmp/menu-backfill-review.csv` first. Phases 2–5 pending — see the [implementation spec](../menu-entity-and-identity-implementation-spec.md).

Implementation handoff: [../menu-entity-and-identity-implementation-spec.md](../menu-entity-and-identity-implementation-spec.md) (build order, file pointers, acceptance criteria).

## Problem

Three issues observed in production trace back to two modeling gaps, not to bugs in the draft machinery:

1. **Resumed drafts lose the submitter and approver sections**, and "edited by" only shows a name when the user happened to retype it that session. (Symptom fixed by persisting the fields; the cause is that the system has no notion of who is editing.)
2. **Editing an approved menu gives no signal that a draft already exists** — the server correctly resumes the single active draft, but the UI can't reliably say so. (Symptom fixed by repairing the id join; the cause is that "the current state of this menu" is reconstructed per page rather than stored.)
3. **Editing an outdated menu gives no signal that a newer version exists.** Supersede gating is lineage-only by design — `revision_base_submission_id` links exist only when a guided flow captured them. Doc-upload submissions before Phase C, declined confirms, and historical imports all leave lineage unknown, and unknown lineage never gates. For real data, "unknown" is the common case, so the guard rarely fires.

### The two gaps

**Gap 1 — submissions are the primary object; menus are inferred.** Users think in terms of "the Tán lunch menu," a thing that evolves over time. The system stores a pile of submissions and tries to reconstruct menu identity afterward: lineage chains when captured, text matching for doc uploads, property+service-period heuristics as a soft fallback (explicitly non-authoritative because of the multi-menu Holidays & Events case). Every reconstruction failure surfaces as a UX hole: stale menus look editable, current and outdated versions look identical, the Approved Menus page shows 11 sibling submissions with no indication which one is live.

**Gap 2 — no identity.** Submitter, approver, and "edited by" are all free text retyped per session. [approval-attestation.md](approval-attestation.md) documents the attestation model as a deliberate choice (no org chart, trust the chef), and that stays — but attestation without even a remembered profile means the same person retypes their own name dozens of times, drafts can't say who is editing without a hint field, and nothing distinguishes "Derian typed Derian" from "anyone typed Derian."

## Proposal

### Part 1: first-class `menus` records

New table:

```sql
CREATE TABLE menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property VARCHAR(200) NOT NULL,
    service_period VARCHAR(120) NOT NULL,
    name VARCHAR(200) NOT NULL,            -- e.g. "Lunch", "Brunch Bebidas", distinguishes multi-menu service periods
    current_submission_id UUID REFERENCES submissions(id),
    status VARCHAR(24) NOT NULL DEFAULT 'active',  -- active | retired
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE submissions ADD COLUMN menu_id UUID REFERENCES menus(id);
```

Semantics:

- An approved submission is a **version** of exactly one menu. Approving a submission whose `menu_id` is set moves that menu's `current_submission_id` pointer. "Superseded" stops being an inference (`does an approved child exist?`) and becomes a comparison (`is this submission the menu's current pointer?`).
- `revision_base_submission_id` lineage stays, as history *within* a menu — cheap to keep and it already feeds the progression-timeline byproduct. It is no longer the supersede signal.
- The single-active-draft invariant re-keys from `base_submission_id` to `menu_id`: one active draft **per menu**, not per baseline submission. This closes the case where someone starts a draft on an old version while another draft exists on the current version — today those are two "different baselines" and both drafts are allowed.
- Multi-menu service periods work naturally: two Holidays & Events menus are two `menus` rows. The property+service-period heuristic and its false-supersede problem disappear.

**Approved Menus page becomes menu-centric.** List menus (name, property, service period, current version + date, in-progress badge), not submissions. Each menu expands to its version history with per-version downloads. Old versions get "View / Download" but never a bare "Edit This Menu" — editing a menu always starts from its current version. The "11 recent approved submissions" wall of near-identical cards goes away.

**Menu resolution at submission time:**

| Path | Resolution |
|------|-----------|
| Click-to-edit / draft submit | Inherit `menu_id` from the baseline submission. Automatic. |
| Form, DB-baseline modification | Inherit from selected baseline. Automatic. |
| Doc-upload modification | Existing Phase C text auto-match already finds the baseline submission → inherit its `menu_id` on confirm. Declined match → treated as new menu (below). |
| Brand new | Create a `menus` row at approval time (property + service period + project name). If an active menu with the same property/service/name exists, the reviewer approval screen asks: "new version of X, or separate menu?" — one question, at the moment a human is already reviewing. |

**Backfill.** One-time script over approved submissions, oldest first: follow existing lineage chains to group versions; where lineage is unknown, use the existing near-exact text matcher to propose groupings; fall back to property+service+project-name equality for exact-name matches; emit a review sheet (CSV) for a human pass on ambiguous groups rather than auto-linking. Unmatched submissions each become single-version menus — harmless. This is the same "never auto-link without a human" principle Phase C established.

### Part 2: identity in stages

Stage 1 — **remembered profile (client-side), no accounts.** The db service already stores `submitter_profiles` and the form already has profile autocomplete ([submitter-autofill.md](submitter-autofill.md)). Extend: after any submission (and on profile-autocomplete selection), store the profile in `localStorage`; on every form/draft open, prefill Submitter Information and stamp autosaves' `last_edited_by` from it. Cost: small. Payoff: "edited by" is populated from the first keystroke of any session, and users stop retyping their own details.

Stage 2 — **approver dispute link (negative confirmation).** The approver-email copy already exists. Add one line with a per-submission token link: **"If you did NOT approve this menu, click here."** Silence means everything is fine — the common case requires nothing from the approver, so there is nothing to miss. A click records `approver_disputed_at` on the submission, flags it prominently on the review dashboard, and notifies the reviewer. Submission flow is unchanged (attestation still gates submit). Positive click-to-confirm was considered and rejected: most approvers would never click, "unconfirmed" would become the ambient state, and reviewers would learn to ignore the marker. Negative confirmation closes the actual hole — today anyone can type any name and the named person never finds out — while keeping the documented no-org-chart decision.

Stage 3 (deferred) — **real sign-in.** Magic-link auth for chefs and reviewers. Only worth it when RSH asks for per-user permissions or audit guarantees; the schema above doesn't block it (profiles become users, `last_edited_by` becomes a user reference). Explicitly out of scope now — the dashboard is intentionally account-free and link-shareable.

## What this replaces / removes

- `findLatestApprovedByPropertyService` as a freshness signal (menus pointer replaces it; keep the function for menu-resolution suggestions only).
- Lineage-children batch lookup for card gating (pointer comparison replaces it).
- The "possibly stale / unknown lineage" card state — every approved submission belongs to a menu after backfill, so cards are either current, outdated, or in-progress.

## Rollout

1. **Schema + backfill (no behavior change):** `menus` table, `submissions.menu_id`, backfill script + human review sheet. Ship dark. ✅ Built 2026-07-16.
2. **Write path:** set `menu_id` on approval for all four paths; move `current_submission_id` pointer on approval; reviewer "new version or separate menu?" prompt.
3. **Read path:** menu-centric Approved Menus page; draft invariant re-keyed to `menu_id`; retire heuristic gating.
4. **Identity Stage 1** (can ship independently, any time): localStorage profile prefill + `last_edited_by` stamping.
5. **Identity Stage 2:** approver dispute link ("If you did NOT approve this menu…") in the existing approver email.

## Test / verification plan

Per AGENTS.md: db unit tests for pointer moves on approval (incl. concurrent approvals — last `reviewed_at` wins, matching current tip rules), menu resolution per path, backfill grouping on fixture data; dashboard tests for menu-centric card states; live Docker check of the full click-edit-approve loop moving the pointer; backfill dry-run against a production snapshot with the review sheet inspected by a human before apply.

## Open questions

- Should "retired" menus (seasonal, discontinued) be first-class now or later? (Proposed: a `status` column now, UI later.)
- Reviewer prompt fatigue: is the "new version or separate menu?" question acceptable on every brand-new approval, or should it only fire on a property/service/name collision? (Proposed: collision-only.)
- What happens downstream of a Stage 2 dispute click — does it only flag the submission for the reviewer, or should it also freeze/unwind anything (e.g., pause the design handoff) while the dispute is resolved? (Proposed: flag + notify only; no automatic unwind.)
- Stage 2 dispute-link expiry: leave the token valid indefinitely, or expire it once a newer version of the menu is approved?
