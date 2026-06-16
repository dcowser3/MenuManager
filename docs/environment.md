# Environment Variables

All variables are configured in `.env` at the project root. See `.env.example` for a template.

## Required

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname for email notifications (e.g., `smtp.gmail.com` or `richardsandoval-com.mail.protection.outlook.com`) |
| `SMTP_PORT` | SMTP server port (e.g., `587` for authenticated submission, `25` for Microsoft 365 IP relay) |
| `SMTP_AUTH` | SMTP auth mode. Omit or set `login` for username/password; set `none` for IP/certificate-based relay. |
| `SMTP_USER` | SMTP username / email address. Required unless `SMTP_AUTH=none`. |
| `SMTP_PASS` | SMTP password or app-specific password. Required unless `SMTP_AUTH=none`. |
| `OPENAI_API_KEY` | OpenAI API key for AI review service |
| `INTERNAL_API_TOKEN` | Shared secret required on internal service-to-service requests between dashboard, db, parser, ai-review, differ, and clickup-integration |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

## Optional

| Variable | Description |
|----------|-------------|
| `SMTP_FROM` | From address used for Menu Manager notification emails. Recommended when `SMTP_AUTH=none`; must use an accepted sender domain for Microsoft 365 relay. Defaults to `GRAPH_MAILBOX_ADDRESS`, then `SMTP_USER`, then `no-reply@richardsandoval.com`. |
| `SMTP_SECURE` | Set `true` for implicit TLS SMTP, typically port `465`; defaults to `false`. |
| `SMTP_REQUIRE_TLS` | Set `true` to require STARTTLS. Defaults to `true` when `SMTP_AUTH=none`, otherwise `false`. |
| `INTERNAL_REVIEWER_EMAIL` | Email address that receives internal review notifications |
| `ALERT_EMAIL` | Email address that receives system alert emails such as SharePoint upload, webhook, and extraction failures |
| `FORM_ATTEMPT_ALERT_EMAIL` | Email address that receives production public-form failure alerts such as `413` submit errors, plus user-initiated "Report this problem" emails with the page screenshot and client-state JSON attached (default: `dcowser@richardsandoval.com`) |
| `PUBLIC_FORM_SUPPORT_EMAIL` | Email address shown to submitters in the form footer and blocking/red form errors as the manual fallback next to the "Report this problem" button (default: `dcowser@richardsandoval.com`) |
| `ERROR_REPORT_FORCE_EMAIL` | Set `true` to send "Report this problem" emails outside production (normally they only email in production; the report is always saved to `tmp/error-reports/` and logged to `form_attempt_logs`) |
| `AI_REVIEW_MODEL` | OpenAI model used by AI review service (default: `gpt-4o-mini`) |
| `APPROVED_DISH_AI_QUALITY_TIMEOUT_MS` | DB-service timeout in milliseconds when asking ai-review to classify questionable extracted dish rows (default: `20000`) |
| `BASIC_AI_CHECK_TIMEOUT_MS` | Dashboard timeout in milliseconds for background public-form Basic AI Check calls to ai-review (default: `120000`; falls back to `AI_REVIEW_QA_TIMEOUT_MS` if set) |
| `AI_REVIEW_SUBMIT_TIMEOUT_MS` | Dashboard timeout in milliseconds for the post-submit full AI review handoff (default: `BASIC_AI_CHECK_TIMEOUT_MS`, normally `120000`) |
| `BASIC_AI_CHECK_JOB_TTL_MS` | How long dashboard keeps completed/failed Basic AI Check job results available for polling before cleanup (default: `900000`) |
| `BASIC_AI_CHECK_AUDIT_ENABLED` | Writes bounded Basic AI Check request/response audit rows to Supabase `basic_ai_check_audits` when Supabase is configured (default: `true`; set `false` to disable) |
| `BASIC_AI_CHECK_AUDIT_MAX_CHARS` | Maximum characters retained per large Basic AI Check audit text field such as reviewed text, prompt, raw feedback, and corrected menu (default: `120000`) |
| `BASIC_AI_CHECK_DEBUG_ENABLED` | Allows opt-in Basic AI Check diagnostics responses when the request includes `debugBasicCheck`; defaults to enabled outside production and disabled in production |
| `BASIC_AI_CHECK_DEBUG_MAX_CHARS` | Maximum characters retained per diagnostic text field such as AI prompt, reviewed text, and raw feedback (default: `60000`) |
| `BASIC_AI_PRECHECK_DISABLED` | Set `true` to disable deterministic pre-AI Basic AI Check corrections for A/B testing against prompt-first behavior (default: enabled) |
| `BASIC_AI_LEARNED_PRECHECK_DISABLED` | Set `true` to keep built-in pre-AI corrections enabled but skip accepted learned correction-rule replacements (default: learned replacements enabled) |
| `BASIC_AI_LEARNED_RULE_FETCH_TIMEOUT_MS` | Dashboard timeout in milliseconds when loading accepted correction rules from the DB service before Basic AI Check (default: `2500`) |
| `SOP_DOC_PATH` | Path to SOP document (default: `samples/sop.txt`) |
| `NEW_SUBMISSION_FORM_DEFAULT` | Which flow `/form` serves. Unset/`false` (default) → the legacy multi-section flow; `true`/`1`/`yes`/`on` → the new upload-first flow. The new flow is always reachable at `/form-new` and the legacy flow at `/form-legacy` regardless of this flag, so the new flow can be piloted before flipping the default. |
| `DASHBOARD_URL` | Base URL for email links (default: `http://localhost:3005`) |
| `DB_SERVICE_URL` | Base URL for DB service (default: `http://localhost:3004`) |
| `AI_REVIEW_URL` | Base URL for AI review service (default: `http://localhost:3002`) |
| `DIFFER_SERVICE_URL` | Base URL for differ service (default: `http://localhost:3006`) |
| `CLICKUP_SERVICE_URL` | Base URL for ClickUp integration service (default: `http://localhost:3007`) |
| `CLICKUP_TASK_CREATE_TIMEOUT_MS` | Dashboard timeout in milliseconds for the form submit to ClickUp task creation handoff (default: `60000`) |
| `CLICKUP_APPROVAL_FINALIZE_TIMEOUT_MS` | Dashboard timeout in milliseconds for browser approval editor finalization through ClickUp integration (default: `CLICKUP_TASK_CREATE_TIMEOUT_MS`, normally `60000`) |
| `INTERNAL_API_TIMEOUT_MS` | Default timeout in milliseconds for internal service-to-service HTTP calls (default: `5000`; individual long-running calls may override it) |
| `DOCUMENT_STORAGE_ROOT` | Root directory for persisted menu DOCX assets (default: `tmp/documents`) |
| `JSON_BODY_LIMIT` | Shared Express JSON/urlencoded body limit for services that need larger rich-text payloads (default where used: `5mb`) |
| `DASHBOARD_JSON_BODY_LIMIT` | Dashboard-specific override for chef form JSON/urlencoded bodies (default: `JSON_BODY_LIMIT` or `5mb`) |
| `ERROR_REPORT_JSON_BODY_LIMIT` | Dashboard-specific JSON body limit for `/api/form/error-report`, which carries screenshot data plus client state (default: `15mb`; fronting proxy body limits must be at least this high) |
| `DB_JSON_BODY_LIMIT` | DB-service-specific override for internal submission and raw-payload JSON bodies (default: `JSON_BODY_LIMIT` or `5mb`) |
| `LEARNING_DATA_DIR` | Root directory for differ comparison history and learned-rule snapshots (default: `tmp/learning`) |
| `LEARNING_MIN_OCCURRENCES` | Minimum repeated corrections needed before a learned rule is active (default: `2`) |
| `LEARNING_MAX_OVERLAY_RULES` | Legacy v1 overlay cap. The v2 Basic AI Check path no longer injects this overlay into the prompt; accepted exact rules are loaded from `correction_rules` for deterministic pre-AI replacement. |
| `GRAPH_CLIENT_ID` | Azure app client ID used for SharePoint/Microsoft Graph access |
| `GRAPH_TENANT_ID` | Azure tenant ID used for SharePoint/Microsoft Graph access |
| `GRAPH_CLIENT_SECRET` | Azure app client secret used for SharePoint/Microsoft Graph access |
| `GRAPH_MAILBOX_ADDRESS` | Mailbox the dashboard sends alert/problem-report email **as** via Graph `sendMail` (falls back to `GRAPH_USER_EMAIL`). Must be a real licensed or shared mailbox — a distribution list returns `ErrorInvalidUser`. Requires the app registration to have the `Mail.Send` application permission with admin consent. |
| `ALERT_MAIL_GRAPH_DISABLED` | Set `true` to skip the Graph transport for dashboard alert email and use SMTP only |
| `GRAPH_CLIENT_SECRET_EXPIRES` | The Azure expiry date of `GRAPH_CLIENT_SECRET` (`YYYY-MM-DD`, from App registrations → Certificates & secrets). The dashboard logs it on startup and the daily improvement cycle raises a `graph_secret_warning`/`graph_secret_expired` system alert as it nears/passes expiry, so the secret never lapses silently and takes down Graph email + SharePoint. Update it whenever you rotate the secret. |
| `ERROR_REPORT_TRIAGE_MODEL` | OpenAI model for AI-generated problem-report triage proposals (default: `IMPROVE_MODEL`, then `AI_REVIEW_MODEL`, then `gpt-4o-mini`) |
| `ERROR_REPORT_AI_TRIAGE_DISABLED` | Set `true` to disable production AI triage proposal emails for problem reports |
| `ERROR_REPORT_AI_TRIAGE_FORCE` | Set `true` to allow AI triage proposal emails outside production when `OPENAI_API_KEY` is configured |
| `IMPROVE_MIN_NEW_CORRECTIONS` | Improvement-cycle gate: minimum unconsumed reviewer corrections before a proposal is generated (default: `1`) |
| `IMPROVE_MODEL` | OpenAI model for the improvement-cycle analysis call (default: `PROMPT_REWRITE_MODEL` or `gpt-4o`) |
| `IMPROVE_NOTIFY_EMAIL` | Recipient for "proposal ready" emails (default: `FORM_ATTEMPT_ALERT_EMAIL`) |
| `IMPROVE_SKIP_EVAL` | Set `1` to skip the auto-eval step of the improvement cycle (proposal stored with `eval_status: skipped`) |
| `IMPROVE_EVAL_LIMIT` | Cap the number of eval cases per improvement-cycle run (default: all) |
| `REVIEW_EVAL_MODEL` | OpenAI model for the review eval harness (default: `AI_REVIEW_MODEL` or `gpt-4o-mini`) |
| `DASHBOARD_PUBLIC_URL` | Base URL used in improvement-cycle notification email links (default: `http://localhost:3005`) |
| `GITHUB_TOKEN` | GitHub personal access token with `issues:write` on `GITHUB_REPO`. When set, approving a proposal files each code recommendation as a GitHub issue; when unset, issue filing is skipped with a log line |
| `GITHUB_REPO` | Repository for improvement-cycle issues (default: `dcowser3/MenuManager`) |

## ClickUp Integration

These are optional. If `CLICKUP_API_TOKEN` or `CLICKUP_LIST_ID` are not set, the ClickUp integration service gracefully skips task creation (returns `{ skipped: true }`).

| Variable | Description |
|----------|-------------|
| `CLICKUP_API_TOKEN` | ClickUp personal API token |
| `CLICKUP_LIST_ID` | Target list ID for new tasks |
| `CLICKUP_TEAM_ID` | Team ID / Workspace ID (required for webhook registration and Marketing watcher group lookup) |
| `CLICKUP_ASSIGNEE_ID` | User ID to auto-assign initial-review tasks to; production uses Isabella's ClickUp user ID. Initial-review task creation also sends ClickUp `notify_all: true` so the API-token user receives the normal ClickUp inbox/email notification when the token belongs to Isabella. Post-approval routing removes this assignee when Marketing is assigned, unless the same user is part of Marketing. |
| `CLICKUP_MARKETING_WATCHER_GROUP_NAME` | ClickUp User Group name/handle to resolve into Marketing user IDs for new-task watchers and post-approval assignees (default: `"Marketing"`) |
| `CLICKUP_MARKETING_WATCHER_GROUP_ID` | Optional comma-separated ClickUp User Group ID(s) to resolve into Marketing user IDs instead of relying only on the group name |
| `CLICKUP_WATCHER_USER_IDS` | Optional comma-separated ClickUp user IDs to add directly when group lookup is unavailable; these IDs are used for new-task watchers and post-approval Marketing assignees |
| `CLICKUP_WEBHOOK_URL` | Public URL for ClickUp webhook events |
| `CLICKUP_WEBHOOK_SECRET` | Optional webhook signing secret from ClickUp (`POST /webhook/register` response). If set, webhook signatures are strictly verified. |
| `CLICKUP_INITIAL_REVIEW_STATUS` | Status assigned to newly created ClickUp tasks (default: `"pending initial isa review"`) |
| `CLICKUP_CORRECTIONS_STATUS` | Status name that triggers normal reviewer correction download (default: `"to do"`). ClickUp `approved` is treated as passive/manual and is ignored even if configured here. |
| `CLICKUP_CORRECTIONS_STATUSES` | Optional comma-separated trigger statuses for aliases or transitional workflows. ClickUp `approved` is treated as passive/manual and is ignored even if included. |
| `CLICKUP_POST_APPROVAL_STATUS` | Status applied to the ClickUp task after approved DOCX processing finishes when it is not already there; Isabella direct submissions are also created in this status (default: `"to do"`). If set to passive/manual `approved`, the service falls back to `"to do"`. |
| `CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRIES` | Number of extra DB lookup attempts after a ClickUp review-complete webhook sees no linked submission yet (default: `5`) |
| `CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRY_DELAY_MS` | Delay between those webhook submission lookup retries in milliseconds (default: `1000`) |

## Alerting And Monitoring

Operational failures are logged to the `system_alerts` table in Supabase. When SMTP is configured and `ALERT_EMAIL` is set, services also send an email notification for alert events.

Public form journeys also write compact telemetry to `form_attempt_logs` when Supabase is configured and the table from `supabase/schema.sql` has been applied. These rows are keyed by browser-generated `attempt_id` and capture step-level events such as baseline uploads, Basic AI Check completion, final submit failures, request body size estimates, critical AI suggestions, and parser-level `413` failures. The logs intentionally store lengths and structured summaries rather than full menu content.

Basic AI Check additionally writes durable audit rows to `basic_ai_check_audits` unless `BASIC_AI_CHECK_AUDIT_ENABLED=false`. Each row stores bounded JSON copies of the exact `ai-review` request body (`text` and `prompt`), raw AI response or failure, parsed corrected-menu block, guard diagnostics, deterministic pre/post-AI corrections, and the final corrected menu returned to the browser. Use `BASIC_AI_CHECK_AUDIT_MAX_CHARS` to cap large text fields.

In production, public-form failure events also send an email to `FORM_ATTEMPT_ALERT_EMAIL` (or `dcowser@richardsandoval.com` when unset). Local development and non-production environments do not send these form failure emails.

Dashboard alert email (system alerts, form-failure alerts, user problem reports) prefers **Microsoft Graph `sendMail`** over HTTPS when `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET` plus a sender mailbox (`GRAPH_MAILBOX_ADDRESS` or `GRAPH_USER_EMAIL`) are configured, falling back to SMTP otherwise. This matters in production: Lightsail blocks outbound port 25 by default, so the Microsoft 365 IP-relay SMTP path times out. Graph requires the `Mail.Send` application permission with admin consent on the app registration. Until that consent is granted, a 403 from `sendMail` automatically falls back to writing the alert directly into the in-tenant recipient's inbox via the already-granted `Mail.ReadWrite` permission (see [design-docs/user-error-reports.md](design-docs/user-error-reports.md)).

User-initiated "Report this problem" reports follow the same production gate (override with `ERROR_REPORT_FORCE_EMAIL=true`): the email attaches the submitter's full-page screenshot and a `client-state.json` snapshot of everything filled in. Regardless of email, every report is saved under `tmp/error-reports/<timestamp>-<attemptId>/` and logged to `form_attempt_logs` as `user_error_report`. See [design-docs/user-error-reports.md](design-docs/user-error-reports.md).

For Microsoft 365 IP-based SMTP relay, configure the Exchange Online connector to trust the production server's outbound public IP address and use:

```env
SMTP_HOST=richardsandoval-com.mail.protection.outlook.com
SMTP_PORT=25
SMTP_AUTH=none
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_FROM=no-reply@richardsandoval.com
SMTP_USER=
SMTP_PASS=
```

The relay IP is part of the authentication boundary. Use the server's outbound public IP, not the inbound dashboard hostname.

Current examples include:

- `clickup_task_failed` from `dashboard` when the saved submission cannot create its ClickUp task; the submitter warning includes the submission reference, and alert details include the same diagnostic reference plus structured service error details
- `form_payload_too_large` from `dashboard` when Express rejects a public form JSON body before the route handler can create a submission row
- `clickup_task_retry_failed` from `dashboard` when a manual retry from the review page still cannot create the ClickUp task
- `sharepoint_upload_skipped` from `clickup-integration` when an approved DOCX reaches SharePoint routing but Graph credentials are missing, so no upload can be attempted
- `sharepoint_upload_failed` from `clickup-integration` when Microsoft Graph/SharePoint rejects the approved DOCX upload, including `403` permission errors
- `approved_dish_extraction_failed` from `clickup-integration` when approved-dish extraction fails after approval
- `clickup_webhook_failed` from `clickup-integration` when webhook processing fails
- `supabase_mirror_failed` from `db` when local submission changes cannot be mirrored to Supabase

Notes:

- Alert emails are deduplicated with a 15-minute cooldown per `alert_type`.
- SharePoint upload skips/failures are monitored as warnings and do not block the rest of the approval flow.
- `clickup-integration` also writes structured `[sharepoint-upload]` log lines for `source_attachment_selected`, `not_attempted`, `start`, `property_config`, `target_resolved`, `archive_complete`, `put_start`, `success`, `skipped`, and `failed` events. These include submission id, ClickUp task id, property/service period, selected ClickUp DOCX/latest attachment, target SharePoint path, matched folder, drive/site ids, archive count, and skipped/error details without logging Graph tokens.

## Internal Service Authentication

Internal HTTP routes now require the shared `INTERNAL_API_TOKEN` header on service-to-service calls.

- Protected services: `db`, `parser`, `ai-review`, and `differ`
- Protected ClickUp integration routes: `/create-task`, `/approval/finalize`, `/webhook/backfill-pending`, and `/webhook/register`
- Public exceptions remain for the dashboard itself, ClickUp's inbound webhook route, and `GET /health`

Set the same `INTERNAL_API_TOKEN` value for every service process in the environment. If it is missing, internal requests fail closed with `503` or `401` responses instead of falling back to network trust.

Internal service clients also apply `INTERNAL_API_TIMEOUT_MS` (default `5000`) when a request does not specify a timeout. This prevents dashboard routes from waiting indefinitely on a sick dependency; routes that need more time can still pass an explicit timeout. The browser-facing Basic AI Check flow is async: `/api/form/basic-check/start` returns a check id quickly, and the form polls `/api/form/basic-check/status/:checkId` while submit remains blocked. The background AI call uses `BASIC_AI_CHECK_TIMEOUT_MS` (default `120000`) so real menu reviews have time to complete without holding a gateway request open. After form submission, full AI review uses `AI_REVIEW_SUBMIT_TIMEOUT_MS`, the ClickUp handoff uses `CLICKUP_TASK_CREATE_TIMEOUT_MS`, and browser approval editor finalization uses `CLICKUP_APPROVAL_FINALIZE_TIMEOUT_MS` so slower external ClickUp attachment/status/assignment work does not inherit the 5-second internal default. For local diagnosis, append `?debugBasicCheck=1` to `/form`; the completed poll response includes the reviewed text, prompt, raw AI feedback, parsed suggestions, and reconciliation drops, and the browser stores the same object on `window.lastBasicCheckDiagnostics`. In production, set `BASIC_AI_CHECK_DEBUG_ENABLED=true` before using that opt-in because diagnostics can include full menu text.

## Document Storage Layout

When `DOCUMENT_STORAGE_ROOT` is set (recommended for deployment), document files are persisted using:

`{DOCUMENT_STORAGE_ROOT}/{property}/{project}/{submissionId}/...`

Subfolders currently used:

- `original/` — generated DOCX from chef submission
- `baseline/` — chef-uploaded approved baseline DOCX (revision flow fallback)
- `approved/` — Isabella-approved corrected DOCX pulled from ClickUp webhook

If `DOCUMENT_STORAGE_ROOT` is not set, the default is `tmp/documents` under the repo root.

## Learning Data Layout

When `LEARNING_DATA_DIR` is set, the differ service stores comparison history and learned-rule snapshots there. If it is not set, the default is `tmp/learning` under the repo root.

Files currently used:

- `training_data.jsonl` — comparison history for eligible human-review final approvals, upserted by submission/source so repeated finalization does not double-count one learned submission
- `<submissionId>-comparison.json` — detail file for a single learned submission
- `learned_rules.json` — rebuilt detected-pattern snapshot
- `rule_overrides.json` and `location_specific_rules.json` — legacy/local learning controls

The learning dashboard can delete an individual learned submission through the differ service. Deletion removes matching JSONL entries and the detail comparison file, then rebuilds `learned_rules.json`.

## Upload Guardrails

- Dashboard uploads are capped at 15 MB per file.
- Dashboard chef form JSON bodies and DB submission/raw-payload JSON bodies default to a 5 MB cap so preserved rich HTML and redline previews do not fail at Express's 100 KB default.
- Dashboard user problem reports use a separate 15 MB JSON cap by default so screenshot data and client state can be saved server-side without raising every form/API endpoint.
- Modification baseline uploads only accept `.docx`.
- Design approval uploads accept `.docx` plus `.pdf`.
- Optional menu reference uploads accept `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, or `.pdf`.
- The dashboard now verifies both file extensions and file signatures before passing uploads into downstream parsers.

## SharePoint Property Routing

Property records can now store SharePoint routing metadata:

- `sharepoint_site_url`
- `sharepoint_library_name`
- `sharepoint_drive_id`
- `sharepoint_base_folder_path`
- `sharepoint_service_folders`
- `sharepoint_last_synced_at`

The Microsoft Graph app uses application permissions with `Sites.Selected`. IT must grant the app write access to each configured SharePoint site. After a property is synced and stores `sharepoint_drive_id`, approval routing uploads directly through that drive ID instead of re-resolving the site/library every time.

When a property has `sharepoint_service_folders`, the form uses those folder names for the `Service Period` dropdown. On ClickUp approval:

- the newest approved DOCX is chosen from ClickUp attachments when available
- otherwise the locally stored submitted DOCX is used as the approved source
- `Shared Documents` and Graph's `Documents` drive name are treated as the same default SharePoint document library
- `Other` remains available in the dropdown for every property and is treated as a deliberate base-folder upload choice
- generated and SharePoint-uploaded DOCX files use `Restaurant_ServicePeriod_M.D.YY.docx`, for example `Aqimero_Breakfast_11.6.23.docx`
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

- If a selected-site tenant blocks path-based site lookup but IT provides the Graph site ID, pass `--site-id "<site-id>"` to skip URL resolution while discovering the drive and service folders.
- The DB service must be running because the script stores the discovered folders via `PUT /properties/:name/sharepoint-config`; when `INTERNAL_API_TOKEN` is set, the script sends it as the internal auth header.
- If Supabase is configured, the DB service mirrors the same property metadata to the `properties` table.
- The repo now seeds route metadata for `Aqimero - Ritz-Carlton - Philadelphia`, `Maya - New York`, `Tamayo - Denver`, `Toro - Hotel Clio - Denver`, `Toro - Fairmont Millennium Park - Chicago`, `Toro - Dania Beach`, and `Toro - Viceroy - Snowmass`; additional properties can be added the same way or refreshed with the sync script.
