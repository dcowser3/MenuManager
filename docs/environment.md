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
| `ALERT_EMAIL` | Email address that receives system alert emails such as SharePoint upload, webhook, and extraction failures |
| `AI_REVIEW_MODEL` | OpenAI model used by AI review service (default: `gpt-4o-mini`) |
| `SOP_DOC_PATH` | Path to SOP document (default: `samples/sop.txt`) |
| `DASHBOARD_URL` | Base URL for email links (default: `http://localhost:3005`) |
| `DB_SERVICE_URL` | Base URL for DB service (default: `http://localhost:3004`) |
| `AI_REVIEW_URL` | Base URL for AI review service (default: `http://localhost:3002`) |
| `DIFFER_SERVICE_URL` | Base URL for differ service (default: `http://localhost:3006`) |
| `CLICKUP_SERVICE_URL` | Base URL for ClickUp integration service (default: `http://localhost:3007`) |
| `DOCUMENT_STORAGE_ROOT` | Root directory for persisted menu DOCX assets (default: `tmp/documents`) |
| `LEARNING_MIN_OCCURRENCES` | Minimum repeated corrections needed before a learned rule is active (default: `2`) |
| `LEARNING_MAX_OVERLAY_RULES` | Max learned rules injected into QA prompt overlay (default: `25`) |
| `GRAPH_CLIENT_ID` | Azure app client ID used for SharePoint/Microsoft Graph access |
| `GRAPH_TENANT_ID` | Azure tenant ID used for SharePoint/Microsoft Graph access |
| `GRAPH_CLIENT_SECRET` | Azure app client secret used for SharePoint/Microsoft Graph access |

## ClickUp Integration

These are optional. If `CLICKUP_API_TOKEN` or `CLICKUP_LIST_ID` are not set, the ClickUp integration service gracefully skips task creation (returns `{ skipped: true }`).

| Variable | Description |
|----------|-------------|
| `CLICKUP_API_TOKEN` | ClickUp personal API token |
| `CLICKUP_LIST_ID` | Target list ID for new tasks |
| `CLICKUP_TEAM_ID` | Team ID (required for webhook registration) |
| `CLICKUP_ASSIGNEE_ID` | User ID to auto-assign tasks to |
| `CLICKUP_WEBHOOK_URL` | Public URL for ClickUp webhook events |
| `CLICKUP_WEBHOOK_SECRET` | Optional webhook signing secret from ClickUp (`POST /webhook/register` response). If set, webhook signatures are strictly verified. |
| `CLICKUP_INITIAL_REVIEW_STATUS` | Status assigned to newly created ClickUp tasks (default: `"pending initial isa review"`) |
| `CLICKUP_CORRECTIONS_STATUS` | Status name that triggers correction download (default: `"corrections complete"`) |
| `CLICKUP_POST_APPROVAL_STATUS` | Status applied to the ClickUp task after approved DOCX processing finishes (default: `"to do"`) |

## Alerting And Monitoring

Operational failures are logged to the `system_alerts` table in Supabase. When SMTP is configured and `ALERT_EMAIL` is set, services also send an email notification for alert events.

Current examples include:

- `sharepoint_upload_failed` from `clickup-integration` when Microsoft Graph/SharePoint rejects the approved DOCX upload, including `403` permission errors
- `approved_dish_extraction_failed` from `clickup-integration` when approved-dish extraction fails after approval
- `clickup_webhook_failed` from `clickup-integration` when webhook processing fails
- `supabase_mirror_failed` from `db` when local submission changes cannot be mirrored to Supabase

Notes:

- Alert emails are deduplicated with a 15-minute cooldown per `alert_type`.
- A SharePoint upload failure is monitored as a warning and does not block the rest of the approval flow.

## Document Storage Layout

When `DOCUMENT_STORAGE_ROOT` is set (recommended for deployment), document files are persisted using:

`{DOCUMENT_STORAGE_ROOT}/{property}/{project}/{submissionId}/...`

Subfolders currently used:

- `original/` — generated DOCX from chef submission
- `baseline/` — chef-uploaded approved baseline DOCX (revision flow fallback)
- `approved/` — Isabella-approved corrected DOCX pulled from ClickUp webhook

If `DOCUMENT_STORAGE_ROOT` is not set, the default is `tmp/documents` under the repo root.

## SharePoint Property Routing

Property records can now store SharePoint routing metadata:

- `sharepoint_site_url`
- `sharepoint_library_name`
- `sharepoint_drive_id`
- `sharepoint_base_folder_path`
- `sharepoint_service_folders`
- `sharepoint_last_synced_at`

When a property has `sharepoint_service_folders`, the form uses those folder names for the `Service Period` dropdown. On ClickUp approval:

- the newest approved DOCX is chosen from ClickUp attachments when available
- otherwise the locally stored submitted DOCX is used as the approved source
- `Other` remains available in the dropdown for every property and is treated as a deliberate base-folder upload choice
- the SharePoint-uploaded DOCX is renamed to `Property_ServicePeriod_M.D.YY.docx` using `date_needed` when available
- if the selected service folder matches a stored SharePoint subfolder, the file is uploaded there
- before uploading into a matched service folder, existing `.docx` files in that folder are moved into `old/`
- existing `.pdf` and `.ai` files are not moved
- if not, the file is uploaded to the property base folder

### Sync Script

Use the one-time/on-demand sync script to refresh a property’s SharePoint folder list and store it through the DB service:

```bash
npm run sharepoint:sync-property -- \
  --property "Tamayo - Denver" \
  --site-url "https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Tamayo" \
  --library-name "Shared Documents" \
  --base-folder-path "Tamayo/Brand & Marketing/Media Library/Menu Files"
```

Notes:

- The DB service must be running because the script stores the discovered folders via `PUT /properties/:name/sharepoint-config`.
- If Supabase is configured, the DB service mirrors the same property metadata to the `properties` table.
- The repo now seeds route metadata for `Aqimero - Ritz-Carlton - Philadelphia`, `Maya - New York`, `Tamayo - Denver`, `Toro - Hotel Clio - Denver`, `Toro - Fairmont Millennium Park - Chicago`, `Toro - Dania Beach`, and `Toro - Viceroy - Snowmass`; additional properties can be added the same way or refreshed with the sync script.
