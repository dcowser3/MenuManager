# Menu Manager

Menu Manager is an AI-powered menu submission review and approval system. Chefs submit menus through the dashboard web form, the system runs deterministic checks and AI review, human reviewers approve or correct the work, and approved menus/dishes are retained for downstream operations.

This README is intentionally short. Detailed feature notes, runbooks, and design decisions live in `docs/` so agents and humans can load only the context they need.

## Start Here

| Need | Read |
|------|------|
| Agent instructions and repo conventions | [AGENTS.md](AGENTS.md) |
| Current product capabilities | [docs/current-capabilities.md](docs/current-capabilities.md) |
| Service map and data flows | [docs/architecture.md](docs/architecture.md) |
| Local startup and troubleshooting | [docs/local-dev-troubleshooting.md](docs/local-dev-troubleshooting.md) |
| Required delivery workflow | [docs/feature-delivery-workflow.md](docs/feature-delivery-workflow.md) |
| Environment variables | [.env.example](.env.example), [docs/environment.md](docs/environment.md) |
| Operational commands and maintenance | [docs/operations-playbook.md](docs/operations-playbook.md) |
| Design decisions by feature | [docs/design-docs/index.md](docs/design-docs/index.md) |
| Roadmap and priorities | [docs/roadmap.md](docs/roadmap.md) |
| SOP and deterministic review rules | [docs/references/sop-rules.md](docs/references/sop-rules.md), [docs/references/code-rules-manifest.md](docs/references/code-rules-manifest.md) |

## Workflow At A Glance

```text
Chef / manager submission
  -> Upload-first dashboard form: upload menu DOCX (redlines preserved), project details auto-filled and revealed progressively
  -> Basic AI Check with deterministic pre/post guards, known DOCX cleanup artifact suggestions, full-width suggestion rows above aligned review boxes, and fixed growl feedback
  -> Required approval block captures the approver's email
  -> Stored submission and generated original DOCX
  -> One confirmation email (with the submitted DOCX) sent to deliverable submitter and approver addresses
  -> Human review in ClickUp or browser approval editor
  -> Approved DOCX, ClickUp/Marketing handoff, optional SharePoint upload
  -> Approved-menu lookup with cleaned and original approved Word DOCX downloads and approved-dish extraction
  -> Learning / improvement loop from human-reviewed corrections
```

> **Rollout note:** the dashboard's `/form` link currently serves the **legacy** multi-section submission form while the new upload-first flow is piloted at `/form-new`. Both collect the approver email and send the grouped confirmation email. Flip `NEW_SUBMISSION_FORM_DEFAULT=true` to make `/form` serve the new flow (see [docs/environment.md](docs/environment.md)).

## Services

Menu Manager is an npm-workspace monorepo with Express microservices and shared libraries.

| Service | Port | Purpose |
|---------|------|---------|
| `parser` | 3001 | DOCX template validation and text extraction |
| `ai-review` | 3002 | Two-tier AI review and approved-dish quality checks |
| `notifier` | 3003 | SMTP notification helper |
| `db` | 3004 | Submission, property, profile, and approved-dish persistence |
| `dashboard` | 3005 | Web UI, public form, review queue, approval editor, learning dashboards |
| `differ` | 3006 | AI draft vs. human-approved comparison for training |
| `clickup-integration` | 3007 | ClickUp task creation, webhook handling, approval handoff |

Shared workspace packages include `diff-core`, `internal-auth`, `supabase-client`, and `tenant-config`. DOCX redlining/extraction scripts live in `services/docx-redliner/`.

The app is white-labelable: all business-specific values (branding, emails, allergen key, approval roles, menu-template markers, and seed rules/properties) live in one config bundle at `config/` and are loaded by `@menumanager/tenant-config`. To stand up the app for another business, copy `config.example/` to `config/` and edit it — no code changes. See [docs/onboarding-new-business.md](docs/onboarding-new-business.md).

The `/learning` dashboard separates auto-scanned detected patterns from active Pre-AI rules: detected patterns are candidate evidence for reviewer annotation, while only accepted safe exact replacement rules in the Active Pre-AI section can change submitted menu text. Pending Rules shows only unconsumed corrections still awaiting direct review; corrections already consumed by an approved prompt proposal are represented by the generated accepted rules instead. Detected patterns and the accepted-rule audit log also show the implementation lane and what the code does next time, or why the note remains guidance only.

## Quick Start

Prerequisites:

- Node.js 24 (`.nvmrc`, `.node-version`, and `package.json` pin the repo to Node 24)
- npm bundled with Node 24
- Docker Desktop
- `.env` values for the integrations you want to exercise

For Supabase-backed audit logs, set `SUPABASE_URL` plus either `SUPABASE_SERVICE_ROLE_KEY` (current Supabase dashboard label) or the legacy `SUPABASE_SERVICE_KEY`.

Start the Docker dev stack:

```bash
cp .env.example .env
# edit .env with local credentials
./dev-up.sh -d
open http://localhost:3005
```

Docker dev mode is the default local workflow. It runs service source with `ts-node-dev`, keeps `node_modules` and the DOCX redliner Python venv inside the image, and bind-mounts source files for hot reload.

Native service startup still exists for deliberate non-Docker work:

```bash
npm install
npm run build --workspaces --if-present
npm start --workspace=@menumanager/dashboard
```

## Verification

Use focused verification for the area you changed. Common commands:

```bash
npm test
npm run test:business
npm run approval-editor:harness
npm run test:approval-editor-browser
npm run smoke:basic-ai-check
```

For route, API, UI, or workflow changes, follow [docs/feature-delivery-workflow.md](docs/feature-delivery-workflow.md): build the affected workspace, restart the affected service, and verify the live behavior with a request or browser check.

## Documentation Rules

- Keep this README limited to orientation, startup, and links.
- Put durable feature behavior in [docs/current-capabilities.md](docs/current-capabilities.md) or the relevant design doc.
- Put operational commands in [docs/operations-playbook.md](docs/operations-playbook.md).
- Update [docs/environment.md](docs/environment.md) and [.env.example](.env.example) together when env vars change.
- Regenerate [docs/references/code-rules-manifest.md](docs/references/code-rules-manifest.md) with `npm run rules:manifest` after deterministic rule, guard, prompt-section, or critical-type changes.
