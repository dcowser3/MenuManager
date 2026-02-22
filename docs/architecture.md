# Architecture

## Service Map

```
services/
├── ai-review/            # Two-tier AI review (QA + corrections)
├── clickup-integration/  # ClickUp task creation + webhook handler (port 3007)
├── dashboard/            # Web interface + submission form (Express + EJS)
├── db/                   # Database service (JSON-based, migrating to Supabase) + submitter profiles
├── differ/               # Compares AI draft vs human-approved for training
├── docx-redliner/        # DOCX redlining/track changes (Python)
├── notifier/             # Email notifications (SMTP)
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
  ├─ Recent projects: dashboard → GET /api/recent-projects → db service
  ├─ Mode: New submission OR Modification
  │   ├─ Modification (DB): dashboard → GET /api/submissions/search → db service
  │   └─ Modification (upload): dashboard → POST /api/modification/baseline-upload
  │      └─ Python extractors: extract_clean_menu_text.py + extract_project_details.py
  │
  ▼
Fills form (submitter info, project details, approval attestation, menu content)
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
  │
  ├─ Fire-and-forget: POST notifier — corrections_ready email with DOCX attached
  └─ Fire-and-forget: POST differ — compare AI draft vs corrected file (training data)
```

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
- **clickup-integration** depends on: db, notifier, differ, ClickUp API
- **ai-review** depends on: OpenAI API
- **notifier** depends on: SMTP server
- **db** depends on: Supabase (optional), local JSON files (fallback)
- **supabase-client** is a shared library used by db service

## Port Assignments

| Port | Service |
|------|---------|
| 3001 | parser |
| 3002 | ai-review |
| 3003 | notifier |
| 3004 | db |
| 3005 | dashboard |
| 3006 | differ |
| 3007 | clickup-integration |
