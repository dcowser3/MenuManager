# AGENTS.md

> AI-powered menu submission review and approval system for chefs worldwide.

This file is the canonical agent-instruction document for the repo. Keep it small. Load topic-specific docs (see [Topic Pointers](#topic-pointers) below) only when the work actually touches that area.

## Required Post-Change Documentation

For any code, config, schema, API, or workflow change:
1. Update relevant docs in `docs/`.
2. Update `README.md` when user-facing behavior, setup, or usage changes.
3. Include documentation updates in the same set of changes as implementation updates.
4. If no documentation update is needed, explicitly state why in the final response.

See [docs/feature-delivery-workflow.md](docs/feature-delivery-workflow.md) for the required feature workflow around tests, live verification, `dist/` artifacts, and restart/reset steps.

## Required Verification

For any feature, bug fix, route, API, UI, or workflow change:
1. Add or update automated tests that cover the changed behavior when the codebase has a reasonable place to do so.
2. Run focused verification for the changed area before reporting completion.
3. For any new or changed page, route, download flow, or form submission path, verify the running app behavior directly with a live request or browser check, not only by static code inspection.
4. If verification cannot be completed, explicitly say what was not verified, why, and what risk remains before marking the work done.

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

Node.js 18+ / TypeScript • Express.js microservices • EJS templates • Supabase (PostgreSQL, with local JSON fallback in `db`) • SMTP for outbound mail • OpenAI API • ClickUp REST v2 • Mammoth (DOCX parsing), PyMuPDF (PDF), python-docx.

## Always-Applicable Conventions

These apply to almost every change — keep them in mind without needing a deeper read.

- **Docker-first local verification:** Use `./dev-up.sh` / `docker-compose.dev.yml` for local service startup, route/API/browser verification, and service-dependent debugging by default. Native `npm start --workspace=...`, `node dist/index.js`, and `./start-services.sh` are fallback-only paths for deliberately non-Docker work.
- **Docker reset:** If services, tests, or dependency state act strange, prefer `./dev-up.sh --down && ./dev-up.sh -d`; after dependency/shared-library/Python changes use `./dev-up.sh --rebuild`, `./dev-up.sh --reset-venv`, or `./dev-up.sh --nuke` as appropriate.
- **Build check:** `npx tsc --noEmit --project services/<name>/tsconfig.json`
- **Every TS service declares `typescript` locally** in its own `devDependencies` — don't rely on hoisting; a partial install can leave the hoisted `tsc` shim broken.
- **Python venv:** `services/docx-redliner/venv/bin/python` (try first, fallback to `python3`). In Docker mode the venv lives in the image — reset with `./dev-up.sh --reset-venv`.
- **Templates:** `samples/` directory (food template has space in filename: `RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`)
- **Route ordering:** Named routes BEFORE `/:id` params to avoid Express param capture
- **Cross-service calls:** Fire-and-forget with `.catch()` for non-critical side effects (e.g., profile save, ClickUp task creation)
- **DOCX boundary markers:** `"MENU"` (exact match) or `"Please drop the menu content below on page 2"`
- **DOCX template structure:** First table = project details; content starts after boundary marker
- **Severity vs confidence:** `severity` ("critical"/"normal") controls blocking; `confidence` is separate
- **Prix fixe exemption:** Prix fixe menus skip missing-price critical errors
- **Archive:** Old docs and legacy services in `archive/` — web form is the only active submission path

## Topic Pointers

Load these only when the task touches the area.

### Running locally / dev environment / startup failures
→ [docs/local-dev-troubleshooting.md](docs/local-dev-troubleshooting.md)

Docker is the default local workflow: `./dev-up.sh` uses [docker-compose.dev.yml](docker-compose.dev.yml) + [docker/Dockerfile.dev](docker/Dockerfile.dev). Native mode (`./start-services.sh`) is documented there only as an intentional fallback. The doc covers Docker smoke checks, OOM kills, EADDRINUSE, broken tsc shim, corrupted Python venv, missing `INTERNAL_API_TOKEN` — all real failure modes you'll re-derive without it.

### Architecture / how services interact
→ [docs/architecture.md](docs/architecture.md) — service interactions, data flows, workflow diagrams.

### Environment variables
→ [docs/environment.md](docs/environment.md) — all env vars (required + optional) with descriptions.

### Roadmap / what's planned
→ [docs/roadmap.md](docs/roadmap.md) — implementation phases, status, planned services, cost estimates.

### Feature deep-dives (design decisions)
→ [docs/design-docs/index.md](docs/design-docs/index.md) — catalog. Notable entries:

| Topic | File |
|-------|------|
| ClickUp integration | [docs/design-docs/clickup-integration.md](docs/design-docs/clickup-integration.md) |
| Critical error blocking (3-layer detection) | [docs/design-docs/critical-error-blocking.md](docs/design-docs/critical-error-blocking.md) |
| Submitter autofill | [docs/design-docs/submitter-autofill.md](docs/design-docs/submitter-autofill.md) |
| Design approval (DOCX vs PDF) | [docs/design-docs/design-approval.md](docs/design-docs/design-approval.md) |
| Approval attestation | [docs/design-docs/approval-attestation.md](docs/design-docs/approval-attestation.md) |
| Revision / modification flow | [docs/design-docs/revision-modification-flow.md](docs/design-docs/revision-modification-flow.md) |
| Training pipeline (v1) | [docs/design-docs/training-pipeline.md](docs/design-docs/training-pipeline.md) |
| Learning pipeline v2 (human-in-the-loop) | [docs/design-docs/learning-pipeline-v2.md](docs/design-docs/learning-pipeline-v2.md) |

### SOP rules (the actual menu rules the AI checks against)
→ [docs/references/sop-rules.md](docs/references/sop-rules.md)

### Meeting prep
→ [docs/meeting-prep-2026-02.md](docs/meeting-prep-2026-02.md)

## Key Directories

- `services/` — All microservices
- `sop-processor/` — SOP document processing scripts and prompts
- `samples/` — Sample menus, templates, and test files
- `archive/` — Historical documentation (preserved for reference)
- `docs/` — Detailed documentation (the topic pointers above resolve here)
