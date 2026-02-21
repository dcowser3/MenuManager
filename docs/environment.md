# Environment Variables

All variables are configured in `.env` at the project root. See `.env.example` for a template.

## Required

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname (e.g., `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP server port (e.g., `587`) |
| `SMTP_USER` | SMTP username / email address |
| `SMTP_PASS` | SMTP password or app-specific password |
| `OPENAI_API_KEY` | OpenAI API key for AI review service |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

## Optional

| Variable | Description |
|----------|-------------|
| `INTERNAL_REVIEWER_EMAIL` | Email address that receives internal review notifications |
| `SOP_DOC_PATH` | Path to SOP document (default: `samples/sop.txt`) |
| `DASHBOARD_URL` | Base URL for email links (default: `http://localhost:3005`) |
| `DOCUMENT_STORAGE_ROOT` | Root directory for persisted menu DOCX assets (default: `tmp/documents`) |
| `LEARNING_MIN_OCCURRENCES` | Minimum repeated corrections needed before a learned rule is active (default: `2`) |
| `LEARNING_MAX_OVERLAY_RULES` | Max learned rules injected into QA prompt overlay (default: `25`) |

## ClickUp Integration

These are optional. If `CLICKUP_API_TOKEN` or `CLICKUP_LIST_ID` are not set, the ClickUp integration service gracefully skips task creation (returns `{ skipped: true }`).

| Variable | Description |
|----------|-------------|
| `CLICKUP_API_TOKEN` | ClickUp personal API token |
| `CLICKUP_LIST_ID` | Target list ID for new tasks |
| `CLICKUP_TEAM_ID` | Team ID (required for webhook registration) |
| `CLICKUP_ASSIGNEE_ID` | User ID to auto-assign tasks to |
| `CLICKUP_WEBHOOK_URL` | Public URL for ClickUp webhook events |
| `CLICKUP_CORRECTIONS_STATUS` | Status name that triggers correction download (default: `"corrections complete"`) |

## Document Storage Layout

When `DOCUMENT_STORAGE_ROOT` is set (recommended for deployment), document files are persisted using:

`{DOCUMENT_STORAGE_ROOT}/{property}/{project}/{submissionId}/...`

Subfolders currently used:

- `original/` — generated DOCX from chef submission
- `baseline/` — chef-uploaded approved baseline DOCX (revision flow fallback)
- `approved/` — Isabella-approved corrected DOCX pulled from ClickUp webhook

If `DOCUMENT_STORAGE_ROOT` is not set, the default is `tmp/documents` under the repo root.
