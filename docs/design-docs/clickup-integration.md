# ClickUp Integration

**Status:** Complete (Updated Mar 2026)

When a chef submits a menu, a ClickUp task is automatically created with the generated DOCX attached and assigned to the reviewer. When the reviewer uploads corrections and changes the task status, the system detects this via webhook, downloads the corrected file, emails it to the submitter, feeds it to the differ service as training data, and asks the DB service to extract approved dishes into Supabase.

## Outbound Flow (Form Submit → ClickUp)

- Dashboard fires-and-forgets a `POST localhost:3007/create-task` after form submission
- Creates task named `"{projectName} — {property}"` with submission details in the description
- New tasks are now created in the ClickUp status configured by `CLICKUP_INITIAL_REVIEW_STATUS` (default: `Pending Initial ISA Review`)
- Task description now includes a direct browser approval link to `GET /approval/:submissionId`
- Submission payload includes both `menuType` and `servicePeriod` so ClickUp context matches the original chef request
- Uploads the generated DOCX as an attachment
- Uploads optional menu image attachment when provided in the form (`menuImageUpload`)
- Adds Isabella as the assignee when `CLICKUP_ASSIGNEE_ID` is configured
- Resolves the configured Marketing ClickUp User Group to its member user IDs and adds those users as task watchers after task creation
- Stores `clickup_task_id` on the submission record
- `due_date` is set from the form’s `YYYY-MM-DD` value using **noon UTC** on that calendar day so the task due date matches the chef’s date in US (and most other) timezones; naive `new Date("YYYY-MM-DD")` uses UTC midnight and showed up one day early in ClickUp for Americas users
- Gracefully skips if ClickUp env vars are not configured (`{ skipped: true }`)

### Task metadata additions

- Description now includes:
  - Turnaround days
  - Asset-type-specific detail for `PRINT`, `DIGITAL`, or `BOTH`
  - Print region (`US` / `NON_US`), folded flag, and `A3/A4/A5` size when non-US
  - Critical override audit lines (when present)
- ClickUp watcher behavior:
  - ClickUp's task watcher update accepts user IDs, while ClickUp User Groups are resolved separately through `GET /group?team_id=...`
  - `CLICKUP_MARKETING_WATCHER_GROUP_NAME` defaults to `Marketing`; `CLICKUP_MARKETING_WATCHER_GROUP_ID` can pin the lookup to one or more group IDs
  - `CLICKUP_WATCHER_USER_IDS` can add explicit watcher user IDs when group lookup is unavailable
  - Watcher lookup/update failures are logged and returned as task-creation warnings, but they do not block task creation or DOCX attachment upload

## Inbound Flow (ClickUp Webhook → Corrections)

- ClickUp sends `taskStatusUpdated` events to `POST /webhook/clickup`
- Filters for review-complete statuses: `CLICKUP_CORRECTIONS_STATUSES` when set, `CLICKUP_CORRECTIONS_STATUS`, and `CLICKUP_POST_APPROVAL_STATUS` (`To Do` by default)
- Looks up submission via `GET /submissions/by-clickup-task/:taskId` on the DB service
- Downloads the latest attachment from the ClickUp task
- If no usable ClickUp attachment exists at approval time, falls back to the locally stored submitted DOCX so "perfect as submitted" menus can still be finalized
- Extracts canonical approved menu text from the corrected DOCX
- Updates submission to `status: 'approved'` with `final_path`, `approved_menu_content_raw`, and `approved_menu_content`
- After approved DOCX processing completes, moves the ClickUp task to `CLICKUP_POST_APPROVAL_STATUS` (default: `To Do`) only when it is not already there
- Calls `POST /approved-dishes/extract` on the DB service, waits for the result, and alerts if approved-dish extraction fails
- Fire-and-forget: clickup-integration sends `corrections_ready` email with the DOCX attached
- Fire-and-forget: differ compares AI draft vs corrected file for training
- If the property has SharePoint routing metadata, uploads the approved DOCX to the property base folder or matching service subfolder via Microsoft Graph

## Browser Approval Flow (Local Prototype)

- ClickUp task description includes a link back to the browser approval editor at `GET /approval/:submissionId`
- The dashboard loads the stored submission DOCX back into a side-by-side approval workspace: clean text editing on the left and live tracked-preview rendering on the right
- When the originally stored submission DOCX is missing locally, the approval page now falls back to the stored approved DOCX before using normalized saved submission text
- Imported `existing-del` and `existing-ins` markup stays visible in the preview wherever that original redline content remains unchanged
- Reviewer edits are submitted through `POST /api/approval/:submissionId/submit`
- Dashboard generates an approved DOCX from the edited HTML and calls `POST localhost:3007/approval/finalize`
- `clickup-integration` uploads the approved DOCX back to the ClickUp task when configured, finalizes the submission, triggers SharePoint upload, notifications, differ, and approved-dish extraction, then leaves/moves the task at `CLICKUP_POST_APPROVAL_STATUS`
- Browser approval now preserves Isabella's manual sequencing:
  - upload corrected DOCX to ClickUp first
  - only leave/move the task at `CLICKUP_POST_APPROVAL_STATUS` after that upload succeeds
  - return a warning to the dashboard if either the attachment upload or the post-approval status transition fails

## Architecture

- **Service:** `services/clickup-integration/index.ts` (port 3007)
- **Routes:** `POST /create-task`, `POST /approval/finalize`, `POST /webhook/clickup`, `POST /webhook/register`, `GET /health`
- **DB service:** added `GET /submissions/by-clickup-task/:taskId` lookup route, `POST /approved-dishes/extract` extraction route, and `POST /approved-dishes/backfill-approved` for already-approved submissions that missed extraction
- **Email send:** `clickup-integration` now sends `corrections_ready` emails directly (reads DOCX from disk and attaches to email)
- **Supabase schema:** `clickup_task_id VARCHAR(100)` column + index on submissions table, plus `service_period` on `submissions` and `approved_dishes`
- **Property metadata:** SharePoint site URL, library, drive ID, base folder path, and discovered service-folder names now live on `properties`
- **Local verification:** `npm run test:approved-dishes -- --legacy-id <id> [--write]` exercises the shared extraction logic directly against the target Supabase submission

## SharePoint Routing

The approval webhook now supports post-approval SharePoint routing for properties that have stored SharePoint metadata.

Routing rules:

- Match `submission.service_period` against the property’s stored `sharepoint_service_folders`
- Always keep `Other` available in the form so users can choose the property root/base folder explicitly
- Rename generated and SharePoint-uploaded DOCX files to `Restaurant_ServicePeriod_M.D.YY.docx`, for example `Aqimero_Breakfast_11.6.23.docx`
- Upload to `{sharepoint_base_folder_path}/{matchedFolder}` when matched
- Before uploading into a matched subfolder, move existing `.docx` files in that folder into `old/`
- Leave existing `.pdf` and `.ai` files in place
- Otherwise upload to `sharepoint_base_folder_path`
- Upload failures do not block approval finalization; they log a warning alert instead

### Property Sync

Folder lists are intended to be refreshed on demand, not fetched live on every form load. Use:

`npm run sharepoint:sync-property -- --property "<Property Name>" --site-url "<site>" --library-name "<library>" --base-folder-path "<path inside library>"`

The script:

- reads SharePoint children from Microsoft Graph
- stores them through `PUT /properties/:name/sharepoint-config`
- lets the dashboard form reuse the saved folder names for the `Service Period` dropdown

## Webhook Registration

One-time setup via `POST /webhook/register`. Requires `CLICKUP_TEAM_ID` and `CLICKUP_WEBHOOK_URL` env vars.

If ClickUp returns a `secret` in the webhook registration response, it must match `CLICKUP_WEBHOOK_SECRET` in runtime env for signature verification.

## Operational Runbook (Local + ngrok)

### Pre-demo local process (authoritative)

Run this in order before manual demo/testing:

1. Start `ngrok` tunnel to ClickUp integration service:
   - `ngrok http 3007`
2. Run one-command local prep:
   - `scripts/demo-ready.sh`
3. Confirm script reports:
   - ClickUp integration/DB connectivity/differ health checks passed
   - webhook endpoint exact match is `/webhook/clickup`
   - webhook health status is `active`
4. Manual event verification (required):
   - In ClickUp, upload or confirm a corrected DOCX, then toggle one known task status:
     - away from `To Do`, then back to `To Do`
   - Watch:
     - `tail -f logs/clickup-integration.log logs/differ.log`
   - Confirm:
     - task moved to `to do`
     - corrected file downloaded
     - submission updated to approved
     - differ comparison completed
5. UI validation:
   - `/learning` shows updated learned submissions table
   - modification search includes the newly approved submission

Why step 5 is still manual:
- ClickUp webhooks are external push events.
- A script can validate config and health, but cannot reliably prove event delivery without a real status-change event.

### Common failure signals

- ngrok shows `POST /` `404`:
  - Webhook endpoint was registered without `/webhook/clickup`.
- Webhook health is `suspended` / high `fail_count`:
  - ClickUp stopped sending events to your endpoint.
- Local logs show task creation but no `"moved to \"to do\""`:
  - Live webhook events are not reaching the integration service.

### Quick reset steps

1. Start ngrok to `3007`.
2. Ensure `.env` has:
   - `CLICKUP_WEBHOOK_URL=https://<ngrok-domain>/webhook/clickup`
   - `CLICKUP_TEAM_ID=<team-id>`
   - `CLICKUP_API_TOKEN=<personal-token>`
3. Reset/re-register webhook.
4. Script auto-updates `.env` with:
   - `CLICKUP_WEBHOOK_URL`
   - `CLICKUP_WEBHOOK_SECRET` (if returned by ClickUp)
5. Restart services so updated `.env` is loaded.
5. Restart `clickup-integration` service.
6. Toggle task status away from `To Do` and back to `To Do`.
7. Verify:
   - ngrok: `POST /webhook/clickup` -> `200`
   - local logs: `"ClickUp task <id> moved to \"to do\""`

### Scripted reset

Use:

`scripts/clickup-webhook-reset.sh`

Examples:

- Re-register and keep existing hooks:
  - `scripts/clickup-webhook-reset.sh`
- Re-register after deleting old hooks:
  - `scripts/clickup-webhook-reset.sh --delete-existing`
- Re-register and backfill missed To Do/approved tasks:
  - `scripts/clickup-webhook-reset.sh --delete-existing --backfill-pending`
- Pre-demo strict mode (recommended):
  - `scripts/clickup-webhook-reset.sh --demo-ready`
- Skip local health checks (only if local services are intentionally down):
  - `scripts/clickup-webhook-reset.sh --skip-local-checks`

Required env vars for the script:
- `CLICKUP_API_TOKEN`
- `CLICKUP_TEAM_ID`
- `CLICKUP_WEBHOOK_URL` is optional fallback only (used if ngrok API is unavailable)
  - script first attempts discovery from `http://127.0.0.1:4040/api/tunnels`
  - script normalizes endpoint to `/webhook/clickup`

The script now also enforces:
- local service readiness (`3007`, `3004`, `3006`) unless `--skip-local-checks`
  - `3004` check uses `GET /submissions/pending` (DB has no `/health` route)
- exact endpoint match for newly registered webhook
- webhook health status `active`
- optional pending-backfill call when requested
- automatic `.env` upsert of `CLICKUP_WEBHOOK_URL` and `CLICKUP_WEBHOOK_SECRET`

### Daily 401 Signature Fix (Important)

If ngrok shows `POST /webhook/clickup` with `401` and local logs show:
- `Rejected ClickUp webhook with invalid signature`

use this exact sequence:

1. Start ngrok:
   - `ngrok http 3007`
2. Run:
   - `scripts/demo-ready.sh`
3. Re-run one real event:
   - in ClickUp, toggle test task away from `To Do`, then back to `To Do`
4. Verify:
   - ngrok: `POST /webhook/clickup` -> `200`
   - `logs/clickup-integration.log` contains task approved + corrected file download lines.

Why this happens:
- The webhook secret rotates when a webhook is re-created.
- The reset script updates `.env`, but old exported shell vars can still keep stale values in runtime if not cleared.
- Signature validation now accepts both ClickUp signature header variants and common encodings, so remaining 401s are usually secret mismatch/drift.

### Backfill for missed webhook events

Webhook events are not replayed by ClickUp. If the webhook was suspended or misconfigured, use:

`POST /webhook/backfill-pending`

This scans pending submissions with `clickup_task_id`, checks current task status in ClickUp, and processes tasks already in a review-complete status (`To Do` by default, plus configured aliases).

## Environment Variables

See [docs/environment.md](../environment.md#clickup-integration) for the full list of ClickUp-related env vars and their descriptions.
