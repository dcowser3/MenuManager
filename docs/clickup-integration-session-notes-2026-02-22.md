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

Note:
- Active learned rules require repeat signals (default minimum occurrences is `2`), so a single corrected upload may appear in training data but not yet produce active rules.
