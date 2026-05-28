# Design Documents

Catalog of design decisions and feature documentation for Menu Manager.

| Document | Status | Summary |
|----------|--------|---------|
| [ClickUp Integration](clickup-integration.md) | Complete | Outbound task creation + inbound webhook for correction handoff |
| [ClickUp-Linked Approval Workflow Proposal](clickup-linked-approval-workflow-proposal.md) | Local Prototype | Browser-based approval flow linked from ClickUp that preserves the current DOCX and SharePoint handoff |
| [Critical Error Blocking](critical-error-blocking.md) | Complete | Severity system that blocks submission on missing prices / incomplete dish names |
| [Submitter Autofill](submitter-autofill.md) | Complete | Autocomplete from saved profiles + recent project loader |
| [Design Approval](design-approval.md) | Built, entry point disabled | DOCX vs PDF comparison tool for design proof validation; welcome card now shows "Feature Coming Soon" |
| [Design Comparison Rules](design-comparison-rules.md) | Complete | Configurable tolerance rules for design approval comparison |
| [Approval Attestation](approval-attestation.md) | Complete | Required manager approval attestation before submission |
| [Approved Dish Quality](approved-dish-quality.md) | Implemented | Provenance display, quality flags, idempotent extraction, and AI checks for questionable rows |
| [Revision / Modification Flow](revision-modification-flow.md) | Complete | Dual-path revision workflow with DB search or uploaded approved baseline DOCX |
| [Reviewer Learning Loop](reviewer-learning-loop.md) | Complete (Phase 1) | Auto-learns recurring human reviewer corrections and injects stable rules into QA prompt |
| [Weekly Prompt Optimization](prompt-optimization.md) | Complete | Weekly command that compiles corrected-menu history into candidate prompt edits + metrics |
| [Document Storage](document-storage.md) | Complete (Local/PV) | Environment-driven persistent document storage layout and deployment guidance |
| [Training Pipeline](training-pipeline.md) | Complete (v1) | End-to-end: data capture → rule aggregation → prompt injection → weekly optimization → cloud storage |
| [Learning Pipeline v2](learning-pipeline-v2.md) | Design | Human-in-the-loop prompt evolution: no auto-injection, rich correction context, weekly LLM prompt rewrite |
