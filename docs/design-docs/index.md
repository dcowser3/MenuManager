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
| [Revision / Modification Flow](revision-modification-flow.md) | Complete | Dual-path revision workflow with DB search or uploaded approved baseline DOCX |
| [Submission Form Redesign](submission-form-redesign.md) | Implemented | Upload-first, progressively-revealed `/form`: upload drives the menu side-by-side, auto-filled details, approval, AI button, and a FLIP float-down |
| [Reviewer Learning Loop](reviewer-learning-loop.md) | Complete (Phase 1) | Auto-learns recurring human reviewer corrections and injects stable rules into QA prompt |
| [Weekly Prompt Optimization](prompt-optimization.md) | Complete | Weekly command that compiles corrected-menu history into candidate prompt edits + metrics |
| [Document Storage](document-storage.md) | Complete (Local/PV) | Environment-driven persistent document storage layout and deployment guidance |
| [Training Pipeline](training-pipeline.md) | Complete (v1) | End-to-end: data capture → rule aggregation → prompt injection → weekly optimization → cloud storage |
| [Learning Pipeline v2](learning-pipeline-v2.md) | Design | Human-in-the-loop prompt evolution: no auto-injection, rich correction context, weekly LLM prompt rewrite |
| [Automated Improvement Loop](automated-improvement-loop.md) | In progress | Daily gated cycle: new corrections → LLM proposal (prompt + rules) → eval against historical menus → human approval |
| [Schema-Drift Gate](schema-drift-gate.md) | Implemented (warn) | Pre-deploy check comparing `supabase/schema.sql` against the live DB (PostgREST); flags unapplied migrations before they strand writes in the local fallback |
| [User Error Reports](user-error-reports.md) | Complete | One-click "Report this problem" button that emails support a full-page screenshot + client form-state JSON |
| [White-label Tenant Config](white-label-config.md) | Implemented | One config bundle (`config/`) for all business-specific values (branding, emails, allergen key, approval roles, template markers, seed rules/properties) so the app rebrands per business with no code edits |
| [Production Support Auto-Triage](production-support-auto-triage.md) | Design | Future auto-reply flow for obvious AI false-positive blockers reported from production |
| [Approved Menu Click-to-Edit](approved-menu-click-to-edit.md) | Phase 1 implemented | Edit This Menu button on Approved Menus → prefilled in-browser modification editor, shareable draft sessions with staleness guard, collapsible redline preview, draft AI-check-before-confirm behavior |
| [Draft Concurrency + Menu Lineage Control](draft-concurrency-and-lineage.md) | Implemented (Phases A–C) | Single-active-draft-per-menu invariant with resume/discard, lineage-chain supersede gating (`revision_base_submission_id`), doc-upload lineage capture via auto-match + confirm, in-progress badges + `/drafts` dashboard |
| [Menu as an Entity + Lightweight Identity](menu-entity-and-identity.md) | Phases 1–5 built (menu entity end-to-end + remembered profile + approver dispute link); Stage-3 sign-in deferred | First-class `menus` records with a current-version pointer (replaces inferred supersede/staleness), menu-centric Approved Menus page, staged identity: remembered profile → approver dispute link ("if you did NOT approve this") → (deferred) sign-in |
