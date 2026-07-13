# ClickUp Integration

**Status:** Complete (Updated Jun 2026)

When a chef submits a menu, a ClickUp task is automatically created with the generated DOCX attached and assigned to the reviewer. When the reviewer uploads corrections and changes the task status, the system detects this via webhook, downloads the corrected file, emails it to the submitter, feeds it to the differ service as training data, and asks the DB service to extract approved dishes into Supabase.

## Outbound Flow (Form Submit → ClickUp)

- Dashboard fires-and-forgets a `POST localhost:3007/create-task` after form submission
- Creates task named `"{projectName} — {property}"` with submission details in the description
- New tasks are now created in the ClickUp status configured by `CLICKUP_INITIAL_REVIEW_STATUS` (default: `Pending Initial ISA Review`)
- Task description now includes a direct browser approval link to `GET /approval/:submissionId`
- Submission payload includes both `menuType` and `servicePeriod` so ClickUp context matches the original chef request
- Modification submissions use human-readable ClickUp description labels that include the chosen workflow route, such as `I'll make menu changes here (Find in Database)`, `I'll make menu changes here (Upload Prior Approved DOCX)`, or `I already made my menu edits on a doc (Upload Unapproved DOCX, Preserve Redlines)`.
- Uploads the generated DOCX as an attachment
- Uploads optional menu image attachment when provided in the form (`menuImageUpload`)
- Adds Isabella as the assignee when `CLICKUP_ASSIGNEE_ID` is configured, sets ClickUp's task-level `notify_all` flag, and then creates an assigned reviewer comment with `notify_all: true`. The extra assigned comment gives ClickUp a second notification event for Isabella when the service is using Isabella's own API token as the task creator.
- Resolves the configured Marketing ClickUp User Group to its member user IDs and adds those users as task watchers after task creation
- If the submitter email is `isabella@richardsandoval.com`, creates the task directly in `CLICKUP_POST_APPROVAL_STATUS` (`To Do` by default) and assigns the resolved Marketing users instead of the Isabella assignee. This direct handoff does not use `CLICKUP_CORRECTIONS_STATUS`, and the webhook treats ClickUp's `Approved` status as passive/manual, so Isabella submissions are not placed in or pulled back from the `Approved` column by automation.
- After a direct Isabella handoff successfully creates the ClickUp task, the DB submission status is updated to `sent_to_marketing` so the row does not remain in Isabella's `/reviews` queue.
- Stores `clickup_task_id` on the submission record
- `due_date` is set from the form’s `YYYY-MM-DD` value using **noon UTC** on that calendar day so the task due date matches the chef’s date in US (and most other) timezones; naive `new Date("YYYY-MM-DD")` uses UTC midnight and showed up one day early in ClickUp for Americas users
- Gracefully skips if ClickUp env vars are not configured (`{ skipped: true }`)
- The dashboard waits up to `CLICKUP_TASK_CREATE_TIMEOUT_MS` (default `60000`) for create-task handoff so ClickUp task creation and attachment upload do not inherit the shorter internal-service default timeout.
- If task creation or attachment upload fails after the submission and DOCX are saved, the dashboard response includes `clickup.diagnosticReference` (the submission id) and the submitter warning shows that reference plus the `PUBLIC_FORM_SUPPORT_EMAIL` contact. Internal `clickup_task_failed` alerts include the same reference plus ClickUp service URL, submitter, project/property, generated filename, DOCX path, and structured axios error details.
- The dashboard records ClickUp handoff metadata under `submissions.raw_payload.clickup_handoff`, including the last create-task payload, last response/error, status, attempt timestamp, and retry count. Pending submissions without a `clickup_task_id` can be retried from `/review/:submissionId`, which rebuilds the create-task payload from the saved submission and stored asset metadata.
- The direct dashboard route `/reviews` lists submissions that still need Isabella's review, including AI-reviewed submissions in `pending_human_review` and manual-review fallback submissions in `submitted_no_ai_review`. Direct Isabella handoffs with a linked ClickUp task are excluded. If a linked ClickUp task is deleted, the submission can be marked `deleted` so it stays in the database for audit/history but leaves the review queue. The queue is intentionally unlisted from the public welcome dashboard; `/dashboard` returns to the welcome screen and legacy `/review-queue` redirects to `/reviews`.

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
- ClickUp reviewer notification behavior:
  - Reviewer-routed tasks create one assigned comment per configured `CLICKUP_ASSIGNEE_ID` user ID after the task is created
  - The comment includes the project, property, service period, date needed, and submission id when available
  - Comment failures are logged and returned as task-creation warnings, but they do not block task creation or DOCX attachment upload

## Inbound Flow (ClickUp Webhook → Corrections)

- ClickUp sends `taskStatusUpdated` events to `POST /webhook/clickup`
- Filters for review-complete statuses: `CLICKUP_CORRECTIONS_STATUSES` when set, `CLICKUP_CORRECTIONS_STATUS`, and `CLICKUP_POST_APPROVAL_STATUS` (`To Do` by default)
- Treats ClickUp status `Approved` as passive/manual. A move into `Approved` is ignored before the service fetches the task, downloads attachments, finalizes the submission, changes status, or changes assignees, even if `approved` is accidentally configured as a correction status.
- Ignores review-complete events for tasks whose ClickUp `list.id` does not match `CLICKUP_LIST_ID`, so workspace-wide Marketing task updates do not create Menu Manager alerts
- Looks up submission via `GET /submissions/by-clickup-task/:taskId` on the DB service
- Retries that submission lookup on transient `404` / `No submission found` responses using `CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRIES` and `CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRY_DELAY_MS`; this covers the brief race where ClickUp sends the status webhook before Menu Manager has persisted the returned `clickup_task_id`
- Skips submissions already marked as Isabella direct handoffs (`status: sent_to_marketing` plus Isabella submitter email), so a later review-complete webhook does not download an attachment, re-run finalization, move the task, or change assignees
- Downloads the latest attachment from the ClickUp task
- If no usable ClickUp attachment exists at approval time, falls back to the locally stored submitted DOCX so "perfect as submitted" menus can still be finalized
- Extracts canonical approved menu text and clean post-approval HTML from the corrected DOCX
- Updates submission to `status: 'approved'` with `final_path`, `approved_menu_content_raw`, `approved_menu_content`, and `approved_menu_content_html`; submitted HTML remains unchanged for training provenance
- After approved DOCX processing completes, moves the ClickUp task to `CLICKUP_POST_APPROVAL_STATUS` (default: `To Do`) only when it is not already there
- Routes the ClickUp task to Marketing assignees after approval processing by adding resolved Marketing users and removing `CLICKUP_ASSIGNEE_ID` when that reviewer is not part of the Marketing group
- Calls `POST /approved-dishes/extract` on the DB service, waits for the result, and alerts if approved-dish extraction fails
- Fire-and-forget: clickup-integration sends `corrections_ready` email with the DOCX attached
- Fire-and-forget: differ compares AI draft vs corrected file for training
- If the property has SharePoint routing metadata, uploads the approved DOCX to the property base folder or matching service subfolder via Microsoft Graph
- SharePoint routing writes structured `[sharepoint-upload]` logs for selected ClickUp attachments, skipped/no-attempt decisions, and the upload attempt itself. It also raises a `sharepoint_upload_skipped` warning alert when Graph credentials are missing, so production approvals leave a diagnosable trail even when no Graph request is made.

## Browser Approval Flow (Local Prototype)

- ClickUp task description includes a link back to the browser approval editor at `GET /approval/:submissionId`
- The dashboard loads the stored submission DOCX back into a side-by-side approval workspace: clean text editing on the left and live tracked-preview rendering on the right
- When the originally stored submission DOCX is missing locally, the approval page now falls back to the stored approved DOCX before using normalized saved submission text
- Imported `existing-del` and `existing-ins` markup stays visible in the preview wherever that original redline content remains unchanged
- Reviewer edits are submitted through `POST /api/approval/:submissionId/submit`
- Dashboard generates an approved DOCX from the edited HTML and calls `POST localhost:3007/approval/finalize` with `CLICKUP_APPROVAL_FINALIZE_TIMEOUT_MS` (defaulting to `CLICKUP_TASK_CREATE_TIMEOUT_MS`, normally `60000`) so approval upload/status/assignment work does not inherit the short internal default timeout
- `clickup-integration` uploads the approved DOCX back to the ClickUp task when configured, finalizes the submission, triggers SharePoint upload, notifications, differ, and approved-dish extraction, assigns the task to Marketing, then leaves/moves the task at `CLICKUP_POST_APPROVAL_STATUS`
- Approval finalization sends the original submission DOCX path and saved submitted rich HTML to differ when available so formatting audit signals can identify cases where the submitter already had final-approved dish-name bolding before AI changed it
- Browser approval now preserves Isabella's manual sequencing:
  - upload corrected DOCX to ClickUp first
  - only assign Marketing and leave/move the task at `CLICKUP_POST_APPROVAL_STATUS` after that upload succeeds
  - return a warning to the dashboard if the attachment upload, Marketing assignment, or post-approval status transition fails

## Runtime And Spec Coverage

- ClickUp integration development and service images run on Node 24 LTS; the repo pins this with `.nvmrc`, `.node-version`, and `package.json` engines.
- Executable business specs for ClickUp actions and submission upload options live in `docs/business-requirements/`.
- Run them with `npm run test:business`; keep these business-readable scenarios updated when ClickUp status routing or upload-option behavior changes.

## Architecture

- **Service:** `services/clickup-integration/index.ts` (port 3007)
- **Routes:** `POST /create-task`, `POST /approval/finalize`, `POST /webhook/clickup`, `POST /webhook/register`, `GET /health`
- **DB service:** added `GET /submissions/by-clickup-task/:taskId` lookup route, `POST /approved-dishes/extract` extraction route, and `POST /approved-dishes/backfill-approved` for already-approved submissions that missed extraction
- **Email send:** `clickup-integration` now sends `corrections_ready` emails directly (reads DOCX from disk and attaches to email)
- **Supabase schema:** `clickup_task_id VARCHAR(100)` column + index on submissions table, plus `service_period` on `submissions` and `approved_dishes`
- **Property metadata:** SharePoint site URL, library, drive ID, base folder path, and discovered service-folder names now live on `properties`
- **Approved-dish extraction:** ClickUp webhook finalization, DB extract/backfill routes, dashboard design approval, local extraction tests, and ClickUp history imports all route through the shared `@menumanager/supabase-client` extractor and pass service period when available.
- **Local verification:** `npm run test:approved-dishes -- --legacy-id <id> [--write]` exercises the shared extraction logic directly against the target Supabase submission

## SharePoint Routing

The approval webhook now supports post-approval SharePoint routing for properties that have stored SharePoint metadata.

Routing rules:

- Match `submission.service_period` against the property’s stored `sharepoint_service_folders`
- Always keep `Other` available in the form so users can choose the property root/base folder explicitly
- Treat `Shared Documents` and Graph's `Documents` drive name as the same default SharePoint document library
- Rename generated and SharePoint-uploaded DOCX files to `Restaurant_ServicePeriod_M.D.YY.docx`, for example `Aqimero_Breakfast_11.6.23.docx`
- Upload to `{sharepoint_base_folder_path}/{matchedFolder}` when matched
- Before uploading into a matched subfolder, move existing `.docx` files in that folder into `old/`
- Leave existing `.pdf` and `.ai` files in place
- Otherwise upload to `sharepoint_base_folder_path`
- Upload failures do not block approval finalization; they log a warning alert instead
- The Graph app is expected to use `Sites.Selected` grants. Once a property has a synced `sharepoint_drive_id`, uploads go straight to that drive so selected-site routing does not depend on broad site enumeration.
- The approved-menus dashboard and `/download/approved/:submissionId` continue to use the local approved DOCX as an operational fallback.

### Property Sync

Folder lists are intended to be refreshed on demand, not fetched live on every form load. Use:

`npm run sharepoint:sync-property -- --property "<Property Name>" --site-url "<site>" --library-name "<library>" --base-folder-path "<path inside library>"`

The script:

- reads SharePoint children from Microsoft Graph
- accepts `--site-id "<site-id>"` when a selected-site grant should skip URL-based site resolution
- stores them through `PUT /properties/:name/sharepoint-config` with the configured internal service token
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
- Re-register and backfill missed `To Do` tasks:
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
   - `logs/clickup-integration.log` contains task moved to `To Do` + corrected file download lines.

Why this happens:
- The webhook secret rotates when a webhook is re-created.
- The reset script updates `.env`, but old exported shell vars can still keep stale values in runtime if not cleared.
- Signature validation now accepts both ClickUp signature header variants and common encodings, so remaining 401s are usually secret mismatch/drift.

### Backfill for missed webhook events

Webhook events are not replayed by ClickUp. If the webhook was suspended or misconfigured, use:

`POST /webhook/backfill-pending`

This scans pending submissions with `clickup_task_id`, checks current task status in ClickUp, and processes tasks already in a review-complete status (`To Do` by default, plus configured aliases).

### Historical completed-menu import dry run

For a bulk import from ClickUp history, start with the dashboard dry-run script inside Docker:

```bash
./dev-up.sh --rebuild -d
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:completed-dry-run -- --status complete
```

The script scans completed ClickUp tasks, downloads each newest DOCX attachment, extracts clean menu text with the docx-redliner venv, previews approved-dish extraction, infers property/service period, and marks the newest task for each property + service-period group. It writes `tmp/clickup-history-import/completed-dry-run.json` and `.csv`; review warning rows before any write-mode import. Historical bare `dLeña` ClickUp tasks are treated as inactive `dLeña - Washington, D.C.` work unless the task or file explicitly says Houston, so they are not silently imported into the current `dLeña - Houston` baseline. If the task title and DOCX filename imply conflicting service periods, for example a `Dessert Menu` task with a `Dinner Menu` attachment, the row receives `service_task_filename_conflict`, is ignored when choosing the newest valid property/service task, and is excluded from `--apply --only-clean`.

The approved-dish extractor joins common wrapped dish rows before parsing, keeps continuation ingredients in `description`, handles parenthesized trailing prices, compact `PP` prices, single trailing allergen codes after prices, cup/bowl pricing, high comma-separated wine prices, all-caps two-line table-style dish rows, section price-only beverage groups including bare numeric prices in beverage sections, and price-bearing rows followed by separate two-line dishes. It treats known beverage headings such as `Pick Me Up`, `Cocteles`, `Zero Proof`, `Espumoso`, `Blanco`, `Rosado`, `Rojo`, `Cerveza`, `Flights`, and `Vino by the Bottle` as categories, strips visual leader dots from names, preserves numeric brand names such as `123 Organic Vertical`, and lets `name price` beverage rows consume a following no-price ingredient line as `description`. It skips obvious non-dish metadata such as service hours, weekday labels, per-guest/package labels, event instructions, attribution lines, course labels, taco-count notes, side-count options, short beverage headings, grill/service labels, oatmeal topping continuations, DOCX form markers, fused pricing grids such as `À La Carte PricingAntojitos`, and `add ...` modifiers. Section-level enhancement and pairing prices are carried onto following unpriced rows as numeric item prices. Per-person/prix fixe set-menu prices are not treated as individual dish prices; following unpriced dishes are marked `prix fixe` in the price field. Storage also applies `prix fixe` to missing item prices for service periods that imply package menus, including event, brunch/buffet, holiday, restaurant-week, private-group, half-board, and set-menu service periods. When a terse dish name is enriched from its section, the inferred word is added in parentheses, e.g. `Kale (Salad)`. New extraction rows carry parser-captured source line and line number when available. Bulk history imports still need spot checks because beverage lists and special-event menus can contain legitimate names that look unusual out of context.

After an import, run the read-only approved-dish audit inside Docker:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:audit-approved-dishes
```

The audit reads imported `approved_dishes` rows from Supabase and writes `tmp/clickup-history-import/dish-extraction-audit.json` plus `.csv`. It flags suspicious rows such as missing prices, prices left in names, service hours, package/course labels, instruction or attribution text, section headings stored as dishes, beverage headings stored as names, layout leaders left in names, beverage name/description swaps, category/description contamination, pricing grids, one-word wrapped ingredients, leftover allergen clusters in descriptions, and exact duplicate dish/category/description rows within the same imported submission. Missing-price rows include `price_audit_class`, `source_line`, `previous_line`, and `next_line` columns so reviewers can separate recoverable parser misses from package/set-menu items that do not have item-level prices. Treat the report as review guidance rather than a delete list; a few beverage or event-menu names can be legitimately unusual. A zero-row audit is the preferred gate before moving from spot checks to broader ClickUp history imports. Approved-dish prices are stored as normalized values without currency symbols; enhancement section prices are stored as the numeric enhancement amount, while unpriced dishes in prix fixe or per-person set menus are marked `prix fixe`.

After reviewing the dry-run report, import only clean rows with:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:completed-dry-run -- --status complete --apply --only-clean
```

`--apply --only-clean` requires extraction to run, upserts approved `submissions` by `legacy_id = clickup-<taskId>` / `clickup_task_id`, deactivates that submission's previous active `approved_dishes` before inserting the clean extraction output, and keeps warning rows out of Supabase. Dry-run warning generation includes deterministic approved-dish quality flags, so rows with obvious pricing-grid or category-contamination issues are not imported as clean rows. Imported rows use `source = clickup_history_import`; approved-baseline search and latest property/service lookup include that source.

## Environment Variables

See [docs/environment.md](../environment.md#clickup-integration) for the full list of ClickUp-related env vars and their descriptions.
