# Roadmap

This page tracks product direction at a high level. Keep detailed design and implementation notes in the feature-specific docs under [design-docs/](design-docs/index.md).

## Current Baseline

Menu Manager currently has:

- Docker-first local development and Docker Compose production deployment support.
- Dashboard-owned public submission form for new menus and modification flows.
- DOCX extraction, template validation, rich-text preservation, and redline-aware uploads.
- Async Basic AI Check with deterministic pre/post guards and manual-review fallback.
- Reviewer queue, browser approval editor, and ClickUp-linked Word approval flow.
- ClickUp task creation, webhook processing, Marketing handoff, and optional SharePoint upload.
- Approved-menu downloads and approved-dish extraction/search.
- Differ/learning infrastructure plus a gated automated improvement loop.
- Supabase-backed persistence with local JSON fallback for development/degraded states.

See [current-capabilities.md](current-capabilities.md) for the compact feature-state reference.

## Active Priorities

| Area | Status | Notes |
|------|--------|-------|
| Browser approval workflow | In use / improving | Continue hardening DOCX fidelity, imported redline behavior, and ClickUp finalization reliability. |
| Approved-dish quality | In use / improving | Continue reducing false positives and improving source provenance. |
| Production support tooling | In use / improving | Expand incident telemetry, problem-report triage, and operator-facing diagnostics. |
| Learning/improvement loop | In progress | Keep proposal generation gated by evals and human approval. |
| SharePoint routing | In progress | Continue property metadata setup, Graph permission hardening, and upload observability. |

## Planned Work

- Role-based access and reviewer/admin permissions.
- More complete notification coverage across the full workflow.
- Expanded approved-dish maintenance and editing tools.
- Additional deterministic menu-content validation beyond current price, dish-name, allergen, and formatting checks.
- Production support auto-triage for safe, obvious AI false-positive blockers. See [production-support-auto-triage.md](design-docs/production-support-auto-triage.md).
- Continued deployment hardening for the Docker Compose/Lightsail path. See [aws-deployment.md](aws-deployment.md).

## No Longer Planned As Separate Services

These capabilities exist, but not as standalone services:

| Old idea | Current location |
|----------|------------------|
| `submission-form` service | Dashboard form routes/views |
| `workflow-engine` service | Dashboard, ClickUp integration, and DB status transitions |
| `approved-dishes` service | DB extraction routes, dashboard views, and shared extraction helpers |

## Budget Notes

Avoid keeping fixed provider price tables in this roadmap. Provider pricing changes; check current pricing before budgeting. The intended deployment posture is still low-cost: one small Docker host, Supabase, existing ClickUp/Microsoft accounts, and OpenAI usage based on review volume.
