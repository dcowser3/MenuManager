# Security Hardening Notes — 2026-05-05

## Changes Landed

- Removed public landing-page links to the learning and training dashboards.
- A temporary PIN gate for `/learning`, `/training`, and `/api/learning/*` was added in this batch and **removed again** (2026-05-10): those routes are no longer gated by a PIN until real auth exists.
- Added server-side sanitizers for plain-text inputs, stored filenames, and rich-text HTML content before persistence or re-rendering. Filename sanitizers preserve Unicode letters and numbers, including accented characters and tone marks, while removing reserved path characters.
- Added upload limits and file-signature checks for:
  - modification baseline DOCX uploads
  - unapproved DOCX uploads
  - design approval DOCX/PDF uploads
  - optional menu image/PDF uploads
- Stopped trusting raw client-supplied temp paths during form submission by requiring uploaded file paths to stay inside the dashboard upload directory.
- Added containment checks before loading stored approval/download DOCX paths from disk.
- Narrowed `PUT /submissions/:id` in `services/db` to an explicit allowlist of approval/processing fields, added validation for known statuses, and required mutable submission paths to stay inside the repository `tmp/` tree.
- Stopped Supabase submission updates from overwriting `raw_payload` with partial patch payloads during incremental status/path updates.
- Added shared internal service authentication via `INTERNAL_API_TOKEN` for service-to-service HTTP calls, covering `db`, `parser`, `ai-review`, `differ`, and the internal-only `clickup-integration` routes.
- Added Jest regression coverage for the new sanitizers.

## Highest-Risk Findings Still Open

1. There is still no real user authentication/RBAC boundary across the broader dashboard and internal services.
2. The shared internal token is static and environment-scoped, so it still needs careful secret storage, rotation, and transport protection in deployment.
3. Internal services still rely on shared-secret trust rather than per-service identity or mTLS.
4. ClickUp webhook handling should require a secret in production and re-check authoritative task state before approval finalization.
5. Public and privileged routes still need deeper end-to-end coverage beyond the current handler-level Jest tests.
6. SharePoint routing needs an explicit delete-prevention guarantee: approved-file delivery may move older `.docx` files into `old/`, but the application should never issue delete/remove calls against SharePoint content.

## Recommended Next Refactor Order

1. Add real auth/RBAC for dashboard users, then place learning/admin/config routes behind role checks.
2. Stop publishing internal services directly on host ports in shared environments, or put them behind private networking only.
3. Upgrade from the shared token to stronger service identity if needed later, such as signed requests with timestamps/nonces or mTLS.
4. Add deeper contract tests around DB update routes and approval finalization paths across services.
5. Add Playwright coverage for the public submission flow and design approval flow once the auth and upload rules settle.
