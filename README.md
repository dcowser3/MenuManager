# Menu Manager

Menu Manager is an AI-powered menu submission review and approval system. Chefs submit menus through the dashboard web form, the system runs deterministic checks and AI review, human reviewers approve or correct the work, and approved menus/dishes are retained for downstream operations.

This README is intentionally short. Detailed feature notes, runbooks, and design decisions live in `docs/` so agents and humans can load only the context they need.

## Approved-menu revisions

The Approved Menus page is **menu-centric**: it shows one card per menu (e.g. "Tán — Lunch"), not one per approved submission. Each card surfaces the current approved version with its downloads and an "Edit This Menu" action (which always starts from the current version), an in-progress badge with Resume / Discard-and-start-over when a draft is open, and a "View version history" expander listing prior versions with per-version downloads — older versions are view/download only and never editable. `/drafts` provides a shared list of active and recently closed drafts. A menu's current version is a stored pointer (`menus.current_submission_id`) that advances on approval, so "current vs outdated" is a fact, not an inference; starting a draft from an outdated version is rejected in favor of the current one, and there is at most one active draft per menu.

The submission form and design-approval page remember your Submitter Information (name, email, job title) in the browser after a submit or an autocomplete pick, and prefill it next time. Draft-saved values always win — the remembered profile only fills fields left empty after a draft is restored. This is a local convenience, not an account or any access control.

Each submission's approver-copy email includes a private "If you did **not** approve this menu, let us know" link. It is negative confirmation: silence means all is well, and a click records the dispute, flags the submission for reviewers, and notifies the review inbox. It never unwinds or blocks anything automatically — attestation still gates submission.

Approved-menu edits load the reviewer-approved text and formatting, not the original submitted HTML. This prevents reviewer corrections from appearing as pending edits or being accidentally reverted in the next revision.

When Basic AI Check or a suggestion updates an editable menu, heading and dish-name formatting is mapped against the live editor text so collapsed whitespace cannot shift bold styling onto neighboring words or lines.

Clean approved-menu extraction also collapses accidental repeated in-line spaces left by accepted tracked changes, keeping the stored text and HTML representations aligned.

After a revision is approved, only a known `revision_base_submission_id` lineage relationship supersedes its parent; unrelated menus in the same property and service period remain editable. When a prior approved DOCX is uploaded as a baseline, the form may suggest a matching approved menu, but it records a lineage link only if the user explicitly confirms it.

Approved DOCX files require a shared persistent `DOCUMENT_STORAGE_ROOT` in multi-app production deployments. The clean-download route can recover from SharePoint or stored approved content when the local artifact is missing; the original-approved route is served only from the reviewer file or its SharePoint copy. See [document storage](docs/design-docs/document-storage.md) and the [operations playbook](docs/operations-playbook.md).

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
  -> One confirmation email (with the submitted DOCX) sent to deliverable submitter and approver addresses, plus configured visibility CCs
  -> Human review in ClickUp or browser approval editor
  -> Approved DOCX, ClickUp/Marketing handoff, optional SharePoint upload
  -> Approved-menu lookup with cleaned/original approved Word DOCX downloads, Edit This Menu draft links that preserve saved inline formatting, and approved-dish extraction
  -> Learning / improvement loop from human-reviewed corrections
```

> **Rollout note:** the dashboard's `/form` link serves the new upload-first submission form by default. The original multi-section form remains available at `/form-legacy`, and `/form-new` is kept as a stable alias for the new flow. Set `NEW_SUBMISSION_FORM_DEFAULT=false` only as a temporary rollback (see [docs/environment.md](docs/environment.md)).

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

The `/learning` dashboard separates auto-scanned detected patterns from active Pre-AI rules: detected patterns are candidate evidence for reviewer annotation, while only accepted safe exact replacement rules in the Active Pre-AI section can change submitted menu text. Pending Rules shows only unconsumed corrections still awaiting direct review; corrections already consumed by an approved prompt proposal are represented by the generated accepted rules instead. The improvement loop emails when a proposal is ready and sends a reminder when a daily run is blocked by an older pending proposal. Detected patterns and the accepted-rule audit log also show the implementation lane and what the code does next time, or why the note remains guidance only.

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
