# Architecture

## Service Map

```
services/
├── ai-review/            # Two-tier AI review (QA + corrections)
├── clickup-integration/  # ClickUp task creation + webhook handler + notifications (port 3007)
├── dashboard/            # Web interface + submission form (Express + EJS)
├── db/                   # Database service (JSON-based, migrating to Supabase) + submitter profiles
├── differ/               # Compares AI draft vs human-approved for training
├── docx-redliner/        # DOCX redlining/track changes (Python)
├── parser/               # DOCX validation and text extraction
└── supabase-client/      # Shared Supabase database client (library)
```

### Planned Services

```
services/
└── approved-dishes/      # Dish extraction & database service
```

## Data Flows

### Chef Submission Flow

```
Chef opens web form (/form)
  │
  ├─ Autocomplete: dashboard → GET /api/submitter-profiles/search → db service
  ├─ Property catalog: dashboard → GET /api/properties → db service (`properties` table / local mirror)
  ├─ Recent projects: dashboard → GET /api/recent-projects → db service
  ├─ Mode: New submission OR Modification
  │   ├─ Modification (DB): dashboard → GET /api/submissions/search → db service
  │   └─ Modification (upload): dashboard → POST /api/modification/baseline-upload
  │      └─ Python extractors: extract_clean_menu_text.py + extract_project_details.py
  │         Metadata extraction is best-effort; menu extraction should still succeed if project-detail parsing fails.
  │
  ▼
Fills form (submitter info, project details, menu type, service period, approval attestation, menu content)
  Note: property must be selected from canonical list; separate free-text location field is removed.
  Client validation marks missing required inputs in submitter, project-details, and approval sections before submission.
  │
  ▼
Runs AI Check
  dashboard → POST parser (validate DOCX structure)
  dashboard → POST ai-review (two-tier: QA prompt → corrections prompt)
  Note: in modification mode, dashboard scopes QA payload to changed lines only versus approved baseline.
  │
  ▼
Reviews AI suggestions
  Critical errors (missing price, incomplete dish name) block submission
  User fixes via edit + re-run, or overrides
  │
  ▼
Submits menu
  dashboard → POST /submissions (db service) — stores all form data
  dashboard → POST /assets (db service) — store original_docx metadata
  dashboard → POST /submitter-profiles (db service) — fire-and-forget profile save
  dashboard → POST localhost:3007/create-task (clickup-integration) — fire-and-forget
  Local-only test helper: localhost, non-production submissions skip ClickUp task creation and return
    `/download/original/:id` plus `/approval/:id` so the browser can download the generated DOCX
    and open the approval editor without sending anything to ClickUp.
    │
    └─ clickup-integration → ClickUp API: create task + upload DOCX attachment(s)
       └─ modification upload mode: attach baseline approved DOCX for Isabella verification
       clickup-integration → PATCH /submissions/:id (db service) — store clickup_task_id
```

### ClickUp Review Flow (Inbound Webhook)

```
Reviewer works in ClickUp
  Uploads corrected DOCX → Changes status to "corrections complete"
  │
  ▼
ClickUp sends taskStatusUpdated webhook
  POST /webhook/clickup (clickup-integration)
  │
  ├─ Filters: only processes status matching CLICKUP_CORRECTIONS_STATUS
  ├─ GET /submissions/by-clickup-task/:taskId (db service) — lookup submission
  ├─ GET ClickUp API — download latest attachment
  ├─ Python extractor: extract_clean_menu_text.py — derive canonical approved text
  ├─ PATCH /submissions/:id (db service) — update status to 'approved', set final_path + approved_menu_content
  ├─ POST /assets (db service) — store approved_docx metadata
  ├─ POST /approved-dishes/extract (db service) — parse approved menu text into `approved_dishes`
  │
  ├─ Fire-and-forget: internal email send — corrections_ready email with DOCX attached
  └─ Fire-and-forget: POST differ — compare AI draft vs corrected file (training data)
```

After approval, operations users can open `/approved-menus` in the dashboard service to browse approved form submissions and download the final DOCX from `/download/approved/:submissionId`. That dashboard now reads approved-menu metadata through the shared Supabase/local-storage layer directly, so it does not depend on the DB HTTP route being current before the page can render.

For browser approvals, `POST /approval/finalize` mirrors the same operational handoff: it uploads the corrected DOCX back to the ClickUp task first, then moves the task to the configured post-approval status (`To Do` by default). If the ClickUp upload fails, the task is not advanced.

### Design Approval Flow

```
User visits /submit/:token (welcome page) or /design-approval directly
  │
  ▼
Uploads DOCX template + PDF proof
  │
  ▼
dashboard → Python scripts (extract_pdf_text.py, extract_project_details.py)
  │
  ▼
Comparison: LCS line alignment → word-by-word diff within matched lines
  Classifies diffs: price, allergen, diacritical, spelling, missing, extra
  │
  ▼
User reviews differences, submits approval
  dashboard → POST /submitter-profiles (db service) — fire-and-forget profile save
```

## Dependency Directions

- **dashboard** depends on: db, ai-review, parser, clickup-integration, docx-redliner (Python scripts)
- **clickup-integration** depends on: db, differ, ClickUp API, SMTP server
- **ai-review** depends on: OpenAI API
- **db** depends on: Supabase (optional), local JSON files (fallback)
- **supabase-client** is a shared library used by db service

## Dashboard Module Notes

The dashboard service still uses a single Express entrypoint, but the highest-risk logic is now split into focused `lib/` modules so routing stays thinner and workflow behavior is easier to test in isolation:

- `lib/restricted-access.ts` — temporary PIN-gate helpers and middleware for learning/training routes
- `lib/upload-security.ts` — upload limits, filename sanitization, HTML/text sanitization, file-signature checks, and safe-path helpers
- `lib/request-normalization.ts` — request-body normalization for chef submission and design-approval flows
- `lib/approval-baseline.ts` — approval editor baseline loading/fallback logic
- `lib/approval-transitions.ts` — shared approval-state payload builders for standard approvals, design approvals, and finalize handoff requests
- `lib/submission-workflow.ts` — menu-image upload and chef submission handlers
- `lib/design-approval-workflow.ts` — DOCX/PDF comparison and mismatch-override handlers
- `lib/approval-workflow.ts` — quick-approve, corrected-upload, and browser approval/finalization handlers

`services/dashboard/index.ts` now primarily composes dependencies, mounts routes, and keeps shared helpers that are still used across multiple dashboard areas.

## ClickUp Integration Module Notes

The ClickUp integration service still uses a single Express entrypoint, but approval-finalization payload shaping is now split into `lib/approval-finalization.ts` so the approved-submission DB patch and asset metadata records are defined in one place and covered by focused tests.

## DB Service Notes

The DB service still fronts both local JSON persistence and the Supabase mirror, but mutable submission updates are now funneled through `lib/submission-updates.ts` so approval/status patches are allowlisted, path-bearing fields are validated against the repository `tmp/` tree, and partial mirror updates do not overwrite `raw_payload`.

## Internal Service Auth Notes

Shared internal HTTP authentication now lives in the `@menumanager/internal-auth` workspace package (`services/internal-auth/src/index.ts`).

- Outbound callers attach `INTERNAL_API_TOKEN` on service-to-service requests through a shared axios helper.
- Inbound middleware protects internal-only routes in `db`, `parser`, `ai-review`, and `differ`.
- `clickup-integration` applies the same middleware only to its internal routes, while leaving the external ClickUp webhook endpoint and `GET /health` publicly reachable.

## Port Assignments

| Port | Service |
|------|---------|
| 3001 | parser |
| 3002 | ai-review |
| 3004 | db |
| 3005 | dashboard |
| 3006 | differ |
| 3007 | clickup-integration |
