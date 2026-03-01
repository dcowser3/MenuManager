# ClickUp Integration

**Status:** Complete (Feb 2026)

When a chef submits a menu, a ClickUp task is automatically created with the generated DOCX attached and assigned to the reviewer. When the reviewer uploads corrections and changes the task status, the system detects this via webhook, downloads the corrected file, emails it to the submitter, and feeds it to the differ service as training data.

## Outbound Flow (Form Submit → ClickUp)

- Dashboard fires-and-forgets a `POST localhost:3007/create-task` after form submission
- Creates task named `"{projectName} — {property}"` with submission details in the description
- Uploads the generated DOCX as an attachment
- Stores `clickup_task_id` on the submission record
- Gracefully skips if ClickUp env vars are not configured (`{ skipped: true }`)

## Inbound Flow (ClickUp Webhook → Corrections)

- ClickUp sends `taskStatusUpdated` events to `POST /webhook/clickup`
- Filters for status matching `CLICKUP_CORRECTIONS_STATUS` env var (default: `"corrections complete"`)
- Looks up submission via `GET /submissions/by-clickup-task/:taskId` on the DB service
- Downloads the latest attachment from the ClickUp task
- Updates submission to `status: 'approved'` with `final_path`
- Fire-and-forget: clickup-integration sends `corrections_ready` email with the DOCX attached
- Fire-and-forget: differ compares AI draft vs corrected file for training

## Architecture

- **Service:** `services/clickup-integration/index.ts` (port 3007)
- **Routes:** `POST /create-task`, `POST /webhook/clickup`, `POST /webhook/register`, `GET /health`
- **DB service:** added `GET /submissions/by-clickup-task/:taskId` lookup route (registered BEFORE `/:id`)
- **Email send:** `clickup-integration` now sends `corrections_ready` emails directly (reads DOCX from disk and attaches to email)
- **Supabase schema:** `clickup_task_id VARCHAR(100)` column + index on submissions table

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
   - In ClickUp, toggle one known task status:
     - `Approved -> To Do -> Approved`
   - Watch:
     - `tail -f logs/clickup-integration.log logs/differ.log`
   - Confirm:
     - task moved to approved
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
- Local logs show task creation but no `"moved to approved"`:
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
6. Toggle task status away from Approved and back to Approved.
7. Verify:
   - ngrok: `POST /webhook/clickup` -> `200`
   - local logs: `"ClickUp task <id> moved to \"approved\""`

### Scripted reset

Use:

`scripts/clickup-webhook-reset.sh`

Examples:

- Re-register and keep existing hooks:
  - `scripts/clickup-webhook-reset.sh`
- Re-register after deleting old hooks:
  - `scripts/clickup-webhook-reset.sh --delete-existing`
- Re-register and backfill missed approved tasks:
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
   - in ClickUp, toggle test task `Approved -> To Do -> Approved`
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

This scans pending submissions with `clickup_task_id`, checks current task status in ClickUp, and processes tasks already in the configured approved status.

## Environment Variables

See [docs/environment.md](../environment.md#clickup-integration) for the full list of ClickUp-related env vars and their descriptions.
