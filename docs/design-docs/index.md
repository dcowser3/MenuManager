# Design Documents

Catalog of design decisions and feature documentation for Menu Manager.

| Document | Status | Summary |
|----------|--------|---------|
| [ClickUp Integration](clickup-integration.md) | Complete | Outbound task creation + inbound webhook for correction handoff |
| [ClickUp-Linked Approval Workflow Proposal](clickup-linked-approval-workflow-proposal.md) | Local Prototype | Browser-based approval flow linked from ClickUp that preserves the current DOCX and SharePoint handoff |
| [Critical Error Blocking](critical-error-blocking.md) | Complete | Severity system that blocks submission on missing prices / incomplete dish names |
| [Submitter Autofill](submitter-autofill.md) | Complete | Autocomplete from saved profiles + recent project loader |
| [Design Approval](design-approval.md) | Built, direct-link only | DOCX vs PDF comparison tool for design proof validation; not shown on the public welcome dashboard |
| [Design Comparison Rules](design-comparison-rules.md) | Complete | Configurable tolerance rules for design approval comparison |
| [Approval Attestation](approval-attestation.md) | Complete | Required manager approval attestation before submission |
| [Approved Dish Quality](approved-dish-quality.md) | Implemented | Provenance display, quality flags, idempotent extraction, and AI checks for questionable rows |
| [Dish Name Formatting](dish-name-formatting.md) | Implemented | Deterministic dish-name bolding after Basic AI Check with conservative shared-extractor anchors |
| [Diacritics Policy](diacritics-policy.md) | Implemented | ALL CAPS takes accents like any other case; brand orthography is pinned deterministically per brand (`Patrón` accented, `Jose Cuervo` not) |
| [Contextual Culinary Spelling](contextual-culinary-spelling.md) | Implemented | Contextual AI adjudication backed by reviewer-confirmed corrections, advisory approved-menu vocabulary, explicit dispositions, and overrideable unresolved-term blockers |
| [Review-learning B2: Scoped Canonical Policy](review-learning-b2-canonical-policy.md) | Implemented (B2) | Shared property/template policy resolution, bounded separator variants, newline-safe vocabulary, isolated cache keys, and matching prompt guidance |
| [Review-learning B3-A: Shared Coordinator](review-learning-b3-coordinator.md) | Implemented (B3-A) | Shared Basic/offline coordinator, immutable envelope, source-anchored merge, and bounded diagnostics |
| [Review-learning B4-A: Evaluation Contract](review-learning-b4-evaluation-contract.md) | Implemented (B4-A) | Fail-closed retrospective/holdout evaluation contract with raw expectations, frozen provenance, split hashes, and freshness labeling |
| [Review-learning B6-A: Behavior-artifact core](review-learning-b6-a-behavior-artifacts.md) | Implemented (B6-A) | Hash-frozen human explanation records, four-stage provenance, menu-update exclusion, bounded policy families, and deterministic execution; proposal wiring remains deferred |
| [Review-learning B6-B: Replay-retirement proof](review-learning-b6-b-replay-retirement.md) | Implemented (B6-B) | Fail-closed original-response replay proof, delivery-mismatch attribution, zero-model-call retirement predicate, and legacy-proof refresh guard; routing remains deferred |
| [Review-learning B6-C: Attempt-bound progress reader](review-learning-b6-c-progress-reader.md) | Implemented (B6-C) | Trusted-root progress reading, positive attempt-conflict rejection, owner-bound fallback for unavailable files, allowlisted terminal states, and bounded deadline reasons; worker wiring remains deferred |
| [Review-learning B6-D1: Behavior-artifact cycle wiring](review-learning-b6-d1-behavior-artifact-wiring.md) | Implemented (B6-D1) | Owner-only frozen behavior artifact at the pre-model boundary; human explanation deduplication and menu-update exclusion; replay/worker/UI wiring remains deferred |
| [Review-learning B6-D2a: Fail-closed replay-retirement routing](review-learning-b6-d2a-replay-retirement-routing.md) | Implemented (B6-D2a) | Verified-retirement-only cycle routing; backend now_correct observations remain actionable; audit production remains deferred |
| [Review-learning B6-D2b: Trusted same-attempt audit binding](review-learning-b6-d2b-trusted-audit-binding.md) | Implemented (B6-D2b) | Read-only exact-attempt audit binding and deterministic zero-model retirement proof; pending proposal refresh remains explicit |
| [Review-learning B6-D2c: Replay-retirement policy refresh](review-learning-b6-d2c-policy-refresh.md) | Implemented (B6-D2c) | Policy-version stamping and fail-closed pending-proposal supersede refresh; scheduler/UI/worker integration remains deferred |
| [Revision / Modification Flow](revision-modification-flow.md) | Complete | Dual-path revision workflow with DB search or uploaded approved baseline DOCX |
| [Submission Form Redesign](submission-form-redesign.md) | Implemented | Upload-first, progressively-revealed `/form`: upload drives the menu side-by-side, auto-filled details, approval, AI button, and a FLIP float-down |
| [Reviewer Learning Loop](reviewer-learning-loop.md) | Complete (Phase 1) | Auto-learns recurring human reviewer corrections and injects stable rules into QA prompt |
| [Weekly Prompt Optimization](prompt-optimization.md) | Complete | Weekly command that compiles corrected-menu history into candidate prompt edits + metrics |
| [Document Storage](document-storage.md) | Complete (Local/PV) | Environment-driven persistent document storage layout and deployment guidance |
| [Training Pipeline](training-pipeline.md) | Complete (v1) | End-to-end: data capture → rule aggregation → prompt injection → weekly optimization → cloud storage |
| [Learning Pipeline v2](learning-pipeline-v2.md) | Design | Human-in-the-loop prompt evolution: no auto-injection, rich correction context, weekly LLM prompt rewrite |
| [Review-learning B5-A trust kernel](review-learning-b5-a-trust-kernel.md) | Implemented, focused verification | Model-free code-proof integrity and backend approval blocking; worker execution remains deferred |
| [Review-learning B5-B verification store](review-learning-b5-b-verification-store.md) | Implemented, mocked adapter | Ownership-safe pending evidence writes with optimistic concurrency; live DB and worker orchestration remain deferred |
| [Review-learning B5-C1 attempt preparation](review-learning-b5-c1-attempt-preparation.md) | Implemented, credential-free preparation | Safe frozen artifacts and one complete running claim; worker execution remains deferred |
| [Review-learning B5-C2a draft safety](review-learning-b5-c2a-draft-safety.md) | Implemented, credential-free boundary | Revalidated artifacts, source snapshot, bounded patch/mapping checks; model and verifier execution remain deferred |
| [Automated Improvement Loop](automated-improvement-loop.md) | In progress | Daily gated cycle: new corrections → LLM proposal (prompt + rules) → eval against historical menus → human approval |
| [Schema-Drift Gate](schema-drift-gate.md) | Implemented (warn) | Pre-deploy check comparing `supabase/schema.sql` against the live DB (PostgREST); flags unapplied migrations before they strand writes in the local fallback |
| [User Error Reports](user-error-reports.md) | Complete | One-click "Report this problem" button that emails support a full-page screenshot + client form-state JSON |
| [White-label Tenant Config](white-label-config.md) | Implemented | One config bundle (`config/`) for all business-specific values (branding, emails, allergen key, approval roles, template markers, seed rules/properties) so the app rebrands per business with no code edits |
| [Production Support Auto-Triage](production-support-auto-triage.md) | Design | Future auto-reply flow for obvious AI false-positive blockers reported from production |
| [Approved Menu Click-to-Edit](approved-menu-click-to-edit.md) | Phase 1 implemented | Edit This Menu button on Approved Menus → prefilled in-browser modification editor, shareable draft sessions with staleness guard, collapsible redline preview, draft AI-check-before-confirm behavior |
| [Draft Concurrency + Menu Lineage Control](draft-concurrency-and-lineage.md) | Implemented (Phases A–C) | Single-active-draft-per-menu invariant with resume/discard, lineage-chain supersede gating (`revision_base_submission_id`), doc-upload lineage capture via auto-match + confirm, in-progress badges + `/drafts` dashboard |
| [Menu as an Entity + Lightweight Identity](menu-entity-and-identity.md) | Phases 1–5 built (menu entity end-to-end + remembered profile + approver dispute link); Stage-3 sign-in deferred | First-class `menus` records with a current-version pointer (replaces inferred supersede/staleness), menu-centric Approved Menus page, staged identity: remembered profile → approver dispute link ("if you did NOT approve this") → (deferred) sign-in |
