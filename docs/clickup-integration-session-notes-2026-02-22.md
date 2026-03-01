# ClickUp Integration Session Notes (2026-02-22)

## Scope Completed

### Outbound (Form -> ClickUp task)
- Task creation is working from `POST /api/form/submit` -> `POST /create-task`.
- ClickUp task naming was improved to structured format:
  - `RSH - {Property} - {Menu Type} Menu - {Project}` (and `- Modification` when applicable).
- Task description formatting was improved for readability (submission metadata sections).
- Approval data is now included in task description:
  - `Approval Attestations` section with level, status, approver name, approver position.
- Attachment upload logic was hardened:
  - Tries multipart field `attachment[]`, then fallback `attachment`.
  - Uses sanitized `.docx` filenames.
- Dashboard now surfaces a warning to chefs if task/doc upload fails, with fallback instruction to email the Word doc if persistent.

### Inbound (ClickUp webhook -> corrected doc retrieval)
- Webhook route is working at `POST /webhook/clickup`.
- Signature verification support added:
  - `CLICKUP_WEBHOOK_SECRET` enforced when present.
- Webhook registration route exists: `POST /webhook/register`.
- Corrected file retrieval logic improved:
  - No longer trusts raw attachment array order.
  - Picks most recent DOCX and prefers one different from original submitted filename.
- Corrected DOCX is saved under:
  - `tmp/documents/{property}/{project}/{submissionId}/approved/{submissionId}-corrected.docx`

### DB / update reliability
- Fixed `PUT /submissions/:id` behavior for mixed storage mode:
  - Supports updates when webhook passes UUID id while local JSON keys are legacy IDs.
  - Falls back to Supabase update path when local JSON key is absent.
- This addresses webhook error pattern:
  - `Found submission ...`
  - `Error processing ClickUp webhook: Submission not found.`

### Form-generated DOCX formatting updates
- Menu content now starts on a new page.
- Allergen section updated to compact line format (` | ` separators).
- Raw-consumption notice line appended under allergens.

### Startup/docs cleanup
- Removed stale inbound-email startup call from `start-services.sh`.
- Updated environment/docs for ClickUp webhook secret and corrected architecture port references.

---

## Current Working ClickUp Values

- `CLICKUP_TEAM_ID=8572371`
- `CLICKUP_LIST_ID=901408496144` (`F&B Menu Submissions`)
- `CLICKUP_ASSIGNEE_ID=114079264` (Isabella)
- `CLICKUP_CORRECTIONS_STATUS=approved`

---

## Webhook Setup That Worked

1. Use a real public tunnel URL with path:
   - `CLICKUP_WEBHOOK_URL=https://<tunnel-domain>/webhook/clickup`
2. Register or re-register webhook.
3. Confirm webhook list via API.
4. Set `CLICKUP_WEBHOOK_SECRET` to the exact secret from the currently active webhook endpoint.
5. Re-test status toggle away from `Approved` and back to `Approved`.

Failure patterns seen and fixed:
- `POST /` 404 in ngrok: endpoint registered without `/webhook/clickup`.
- 401 invalid signature: wrong secret for active webhook.
- `OAUTH_171 webhook already exists`: expected when duplicate registration attempted.

---

## Azure Deployment Status (as of 2026-02-22)

- Resource groups created:
  - `rg-menumanager-staging`
  - `rg-menumanager-prod`
- Blocked on App Service quota:
  - `SubscriptionIsOverQuotaForSku`
  - App Service quotas in region were `0 of 0`.
- Quota support request initiated.

## Azure Deployment Deltas (What Changes vs Local)

These are the items that must be different in Azure. The compare/extraction logic itself does not change.

1. Persistent storage path (required)
- Set `DOCUMENT_STORAGE_ROOT` to a persistent mounted path (do not use repo-local `tmp/documents` in cloud).
- Example App Service path: `/home/site/data/documents`.
- Reason: drafts and approved corrected files must survive restarts/redeploys.

2. Public webhook URL (required)
- Set `CLICKUP_WEBHOOK_URL` to production HTTPS endpoint:
  - `https://<your-domain>/webhook/clickup`
- Localhost/ngrok values are dev-only.

3. Webhook secret (required when signature validation is enabled)
- Register webhook in production and store returned secret as `CLICKUP_WEBHOOK_SECRET`.
- If webhook endpoint/record is replaced, update the secret and restart service.

4. ClickUp env values (required)
- Set production values for:
  - `CLICKUP_TEAM_ID`
  - `CLICKUP_LIST_ID`
  - `CLICKUP_ASSIGNEE_ID`
  - `CLICKUP_CORRECTIONS_STATUS`

5. Service-to-service routing (required if split into separate apps)
- Current local calls use localhost ports.
- In Azure split-service deployments, replace localhost targets with internal service URLs.

6. Process model (required)
- Run each service once via App Service process/runtime.
- Avoid manual duplicate starts to prevent `EADDRINUSE`.

## Azure Deployment Deltas (What Does NOT Change)

- AI draft vs final corrected comparison behavior.
- Strikethrough/deletion cleaning used for reviewer-intent extraction in learning comparisons.
- Overall flow: webhook -> corrected file download -> differ `/compare` -> training data.

---

## How To Validate End-to-End Quickly

1. Submit via form (`http://localhost:3005/form`).
2. Confirm in ClickUp:
   - task created,
   - DOCX attached,
   - assignee applied,
   - approval section present in description.
3. Upload corrected DOCX and set status to `Approved`.
4. Check `logs/clickup-integration.log` for:
   - moved to approved,
   - submission lookup,
   - corrected file download,
   - submission update to approved.

---

## Learning / Training Verification

The auto-learning pipeline is powered by `differ` on port `3006`.

Data artifacts:
- `tmp/learning/training_data.jsonl`
- `tmp/learning/learned_rules.json`
- `tmp/learning/<submission-id>-comparison.json`

Dashboard pages:
- `http://localhost:3005/learning` (learned rules + prompt overlay)
- `http://localhost:3005/training` (legacy training session UI)

Useful API checks:
- `GET http://localhost:3006/stats`
- `GET http://localhost:3006/training-data`
- `GET http://localhost:3006/learning/rules`

Learning dashboard updates implemented in this session:
- `/learning` now includes a **Recent Learned Submissions** table:
  - submission id
  - timestamp
  - changes detected (YES/NO)
  - change percentage
  - draft/final filenames
- `/learning` now shows an explicit **Differ Connectivity Warning** if dashboard cannot reach differ endpoints instead of silently rendering zeros.
- `differ` now rebuilds `learned_rules.json` snapshot on startup from `training_data.jsonl` so counters persist across service restarts.

Operational gotchas observed:
- If browser shows `localhost:3005` unreachable but service appears up, test `http://127.0.0.1:3005/learning` and verify listener with:
  - `lsof -nP -iTCP:3005 -sTCP:LISTEN`
- Avoid manual duplicate starts after `./start-services.sh`; they cause `EADDRINUSE` and stale-log confusion.
- Webhook events are not replayed by ClickUp; if webhook was suspended, use backfill.

Automation added:
- Script: `scripts/clickup-webhook-reset.sh`
  - validates token
  - normalizes endpoint to `/webhook/clickup`
  - optional delete of existing hooks
  - re-registers webhook
  - prints new secret
  - optional pending backfill trigger
- New API endpoint: `POST /webhook/backfill-pending`
  - reconciles pending submissions with existing ClickUp tasks already in approved status.

Note:
- Active learned rules require repeat signals (default minimum occurrences is `2`), so a single corrected upload may appear in training data but not yet produce active rules.
- Deletion-only reviewer edits (for example striking/removing a word with no replacement token) can produce `changes_detected: true` but still yield `0` learned replacement rules.

---

## Follow-up Changes (2026-02-25)

### UX / Form behavior updates

1. Modification prefill now loads full project metadata from DB search
- Change:
  - `Find in database` now fills the same full project detail set as `Load from Recent` (project/property + dimensions/asset options/orientation/menu/template + print settings when present).
  - DB search payload was expanded to return those fields.
- Why:
  - Previously only partial fields populated, causing inconsistent Step 1 state and manual re-entry.
- Files:
  - `services/db/index.ts`
  - `services/dashboard/views/form.ejs`

2. Removed redundant raw-notice preview box from Step 2
- Change:
  - Removed the raw notice preview panel (`Remove/Restore Notice` UI) and kept the explicit checkbox control.
  - Internal decision logic remains in place for DOCX generation.
- Why:
  - The preview was redundant and confusing; checkbox is sufficient and cleaner.
- Files:
  - `services/dashboard/views/form.ejs`

3. Required re-run AI check after chef edits remains enforced
- Behavior:
  - If chef edits after AI run, submit is blocked until AI check is re-run.
- Why:
  - Prevents stale AI validation from being submitted.

### DOCX / Redline output updates

4. Modification submissions now preserve chef redlines in generated DOCX
- Change:
  - On submit (modification flow), dashboard now sends persistent revision diff HTML.
  - DOCX generator parses this and renders:
    - deletions as strikethrough
    - insertions as highlighted text
- Why:
  - Design team needs reviewer-intent deltas visible in the uploaded DOCX; plain clean text loses that context.
- Files:
  - `services/dashboard/views/form.ejs`
  - `services/dashboard/index.ts`
  - `services/docx-redliner/generate_from_form.py`

### AI review formatting + policy enforcement

5. Step 2 formatting preservation improved
- Change:
  - Preserves blank-line structure from original when AI output collapses spacing.
  - Reapplies heading emphasis to maintain visual hierarchy in reviewed content.
- Why:
  - AI-corrected output was flattening formatting (loss of bold/spacing), making review harder.
- Files:
  - `services/dashboard/views/form.ejs`

6. Asterisk placement normalized to end-of-dish convention
- Change:
  - Server-side normalization now moves inline raw markers (e.g., `sauce*`) to end-of-description placement before allergens/price.
  - Example normalized style:
    - `... demi-glace * D,S 85`
- Why:
  - Required SOP consistency: raw marker belongs at dish end, not inside ingredient phrase.
- File:
  - `services/dashboard/index.ts`

7. Prix fixe checks upgraded to deterministic critical enforcement
- Change:
  - Severity normalization now force-promotes prix fixe structural violations to `critical` for varied AI label text.
  - Added deterministic server-side checks for:
    - missing top-level prix fixe price at top
    - missing course numbering on course sections
  - These are injected as critical suggestions when absent from model output.
- Why:
  - These are hard-gate business rules and must block submit unless fixed/overridden.
- File:
  - `services/dashboard/index.ts`

### ClickUp operational hardening

8. Webhook reset script became pre-demo readiness gate
- Added/updated script behavior (`scripts/clickup-webhook-reset.sh`):
  - local preflight checks for:
    - clickup-integration configured health
    - DB connectivity (`GET /submissions/pending`)
    - differ health (`GET /stats`)
  - strict endpoint validation (`/webhook/clickup` + HTTPS)
  - webhook endpoint + `active` health verification after registration
  - `--demo-ready` mode (delete existing + backfill pending)
  - auto-discovery of ngrok HTTPS tunnel from `http://127.0.0.1:4040/api/tunnels`
  - fallback to `CLICKUP_WEBHOOK_URL` only if ngrok API unavailable
  - malformed/truncated endpoint guard (prevents `http://free.dev/...` class failures)
  - automatic `.env` upsert of:
    - `CLICKUP_WEBHOOK_URL`
    - `CLICKUP_WEBHOOK_SECRET` (from active webhook registration response)
- Why:
  - Eliminates recurring setup drift (wrong URL, secret mismatch, suspended hooks, stale env values) before demo.
- Files:
  - `scripts/clickup-webhook-reset.sh`
  - `docs/design-docs/clickup-integration.md`

### Important operational note

- Even with script hardening, one manual validation step remains required:
  - Trigger real ClickUp status change (`Approved -> To Do -> Approved`) and confirm log flow.
- Why:
- Webhooks are external push events; config checks cannot fully prove live event delivery without an actual event.

---

## Follow-up Changes (2026-02-26)

### 401 webhook signature stabilization

1. Signature verification robustness improved in clickup-integration
- Change:
  - Accept both header names used in ClickUp deliveries:
    - `X-Signature`
    - `X-Webhook-Signature`
  - Accept common signature formats:
    - `sha256=<hex>`
    - raw hex
    - base64/base64url
- Why:
  - Real webhook deliveries varied by header/encoding shape; strict single-format parsing caused false 401s.
- File:
  - `services/clickup-integration/index.ts`

2. Local process clarified to avoid stale-secret drift
- Required sequence:
  1) `scripts/clickup-webhook-reset.sh --demo-ready`
  2) `unset CLICKUP_WEBHOOK_URL CLICKUP_WEBHOOK_SECRET`
  3) `./stop-services.sh && ./start-services.sh`
  4) real status toggle (`Approved -> To Do -> Approved`)
- Why:
  - Reset updates `.env`, but stale exported shell vars can still override runtime and cause repeated invalid-signature 401s.

3. Documentation/runbook updated
- Added a dedicated "Daily 401 Signature Fix" section to:
  - `docs/design-docs/clickup-integration.md`

4. New local wrapper script for next-day startup
- Added:
  - `scripts/demo-ready.sh`
- Behavior:
  - loads `.env`
  - unsets webhook URL/secret shell overrides
  - restart services (pass 1)
  - run `scripts/clickup-webhook-reset.sh --demo-ready`
  - restart services (pass 2) so refreshed webhook URL/secret apply
  - prints final manual status-toggle verification steps
- Why:
  - Reduces repetitive setup mistakes and makes local demo prep one command.
