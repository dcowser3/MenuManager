# Menu Manager

> AI-powered menu submission review and approval system for chefs worldwide.

## Services

| Service | Port | Description |
|---------|------|-------------|
| parser | 3001 | DOCX template validation and text extraction |
| ai-review | 3002 | Two-tier AI review: general QA + detailed corrections |
| notifier | 3003 | Email notifications via SMTP |
| db | 3004 | Database service + submitter profiles (JSON-based, migrating to Supabase) |
| dashboard | 3005 | Web UI, submission form, design approval (Express/EJS) |
| differ | 3006 | Compares AI draft vs human-approved corrections (training) |
| clickup-integration | 3007 | ClickUp task creation + webhook handler |
| docx-redliner | — | DOCX redlining / track changes (Python scripts invoked as subprocess by differ + clickup-integration; not a network service) |
| internal-auth | — | Shared internal-service auth middleware + axios client (library, no server) |
| supabase-client | — | Shared Supabase database client (library, no server) |

## Tech Stack

- **Runtime:** Node.js 18+ / TypeScript
- **Backend:** Express.js microservices
- **Templating:** EJS (dashboard views)
- **Database:** Supabase (PostgreSQL) — local JSON fallback in db service
- **Email:** SMTP (outbound notifications)
- **AI:** OpenAI API
- **Task Management:** ClickUp API (REST v2)
- **File Processing:** Mammoth (DOCX parsing), PyMuPDF (PDF text), python-docx

## Documentation Map

| Topic | File | Description |
|-------|------|-------------|
| Architecture | [docs/architecture.md](docs/architecture.md) | Service interactions, data flows, workflow diagrams |
| Roadmap | [docs/roadmap.md](docs/roadmap.md) | Implementation phases, status, planned services, cost estimates |
| Environment | [docs/environment.md](docs/environment.md) | All env vars (required + optional) with descriptions |
| Local Dev Troubleshooting | [docs/local-dev-troubleshooting.md](docs/local-dev-troubleshooting.md) | Known service-startup failures (OOM kills, EADDRINUSE, tsc shim, broken venv) and fixes |
| Design Decisions | [docs/design-docs/index.md](docs/design-docs/index.md) | Catalog of all design docs |
| — ClickUp Integration | [docs/design-docs/clickup-integration.md](docs/design-docs/clickup-integration.md) | Outbound/inbound flows, webhook, architecture |
| — Critical Error Blocking | [docs/design-docs/critical-error-blocking.md](docs/design-docs/critical-error-blocking.md) | 3-layer detection (AI prompt, normalizer, deterministic), all critical types, override flow |
| — Submitter Autofill | [docs/design-docs/submitter-autofill.md](docs/design-docs/submitter-autofill.md) | Autocomplete, recent projects, profile storage |
| — Design Approval | [docs/design-docs/design-approval.md](docs/design-docs/design-approval.md) | DOCX vs PDF comparison tool |
| — Approval Attestation | [docs/design-docs/approval-attestation.md](docs/design-docs/approval-attestation.md) | Required approval system, attestation model |
| — Revision / Modification Flow | [docs/design-docs/revision-modification-flow.md](docs/design-docs/revision-modification-flow.md) | New vs modification mode, baseline sourcing, persistent vs temporary change layers |
| — Training Pipeline (v1) | [docs/design-docs/training-pipeline.md](docs/design-docs/training-pipeline.md) | Full loop: correction capture → rule aggregation → prompt injection → weekly optimization → cloud storage |
| — Learning Pipeline v2 | [docs/design-docs/learning-pipeline-v2.md](docs/design-docs/learning-pipeline-v2.md) | Human-in-the-loop: no auto-injection, rich correction context, weekly LLM prompt rewrite |
| SOP Rules Reference | [docs/references/sop-rules.md](docs/references/sop-rules.md) | Pointer to SOP processing rules |
| Meeting Prep | [docs/meeting-prep-2026-02.md](docs/meeting-prep-2026-02.md) | Feb 2026 meeting preparation notes |

## Agent Conventions

- **Build check:** `npx tsc --noEmit --project services/<name>/tsconfig.json`
- **Python venv:** `services/docx-redliner/venv/bin/python` (try first, fallback to `python3`). If imports fail with empty stderr + SIGTERM, the venv is corrupted — see [local-dev-troubleshooting.md](docs/local-dev-troubleshooting.md).
- **Every TS service declares `typescript` locally** in its own `devDependencies` — don't rely on hoisting; a partial install can leave the hoisted `tsc` shim broken.
- **Templates:** `samples/` directory (food template has space in filename)
- **Route ordering:** Named routes BEFORE `/:id` params to avoid Express param capture
- **Cross-service calls:** Fire-and-forget with `.catch()` for non-critical side effects (e.g., profile save, ClickUp task creation)
- **DOCX boundary markers:** `"MENU"` (exact match) or `"Please drop the menu content below on page 2"`
- **DOCX template structure:** First table = project details; content starts after boundary marker
- **Severity vs confidence:** `severity` ("critical"/"normal") controls blocking; `confidence` is separate
- **Critical errors:** Detected across 3 layers (AI prompt → severity normalizer → deterministic checks); see [critical-error-blocking.md](docs/design-docs/critical-error-blocking.md) for full map
- **Prix fixe exemption:** Prix fixe menus skip missing-price critical errors
- **Archive:** Old docs and legacy services in `archive/` — web form is the only active submission path

## Key Directories

- `services/` — All microservices
- `sop-processor/` — SOP document processing scripts and prompts
- `samples/` — Sample menus, templates, and test files
- `archive/` — Historical documentation (preserved for reference)
- `docs/` — Detailed documentation (this map points there)
