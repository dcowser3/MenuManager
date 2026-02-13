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
- Fire-and-forget: notifier sends `corrections_ready` email with the DOCX attached
- Fire-and-forget: differ compares AI draft vs corrected file for training

## Architecture

- **Service:** `services/clickup-integration/index.ts` (port 3007)
- **Routes:** `POST /create-task`, `POST /webhook/clickup`, `POST /webhook/register`, `GET /health`
- **DB service:** added `GET /submissions/by-clickup-task/:taskId` lookup route (registered BEFORE `/:id`)
- **Notifier:** added `corrections_ready` email type (reads DOCX from disk via `fsPromises.readFile`, attaches to email)
- **Supabase schema:** `clickup_task_id VARCHAR(100)` column + index on submissions table

## Webhook Registration

One-time setup via `POST /webhook/register`. Requires `CLICKUP_TEAM_ID` and `CLICKUP_WEBHOOK_URL` env vars.

## Environment Variables

See [docs/environment.md](../environment.md#clickup-integration) for the full list of ClickUp-related env vars and their descriptions.
