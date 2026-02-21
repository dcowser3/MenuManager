# Design Documents

Catalog of design decisions and feature documentation for Menu Manager.

| Document | Status | Summary |
|----------|--------|---------|
| [ClickUp Integration](clickup-integration.md) | Complete | Outbound task creation + inbound webhook for correction handoff |
| [Critical Error Blocking](critical-error-blocking.md) | Complete | Severity system that blocks submission on missing prices / incomplete dish names |
| [Submitter Autofill](submitter-autofill.md) | Complete | Autocomplete from saved profiles + recent project loader |
| [Design Approval](design-approval.md) | Complete | DOCX vs PDF comparison tool for design proof validation |
| [Approval Attestation](approval-attestation.md) | Complete | Required manager approval attestation before submission |
| [Revision / Modification Flow](revision-modification-flow.md) | Complete | Dual-path revision workflow with DB search or uploaded approved baseline DOCX |
| [Reviewer Learning Loop](reviewer-learning-loop.md) | Complete (Phase 1) | Auto-learns recurring human reviewer corrections and injects stable rules into QA prompt |
| [Document Storage](document-storage.md) | Complete (Local/PV) | Environment-driven persistent document storage layout and deployment guidance |
