# User Error Reports ("Report this problem")

**Status:** Complete
**Service:** dashboard (form page only)

## Problem

When a submitter hit an error on the form (validation block, ClickUp handoff failure, payload too large, server exception), the only guidance was "email support and include screenshots." That depends on the chef knowing how to take a useful screenshot, actually attaching it, and describing what they had filled in — which almost never happens. Debugging meant reconstructing client state from `form_attempt_logs` fragments.

## Solution

A **"Report this problem"** button that, in one click, captures everything support needs and emails it:

1. **Full-page screenshot** — rendered client-side with [html2canvas](https://html2canvas.hertzen.com) (vendored at `services/dashboard/public/js/html2canvas.min.js`, MIT, lazy-loaded only when the button is clicked so the form pays nothing on normal loads). Captured *before* any UI changes so the open red error alert is part of the image. The cloned page normalizes modern CSS color functions, such as Safari's computed `color(...)` values, into `rgb()`/`rgba()` fallbacks before html2canvas parses the page.
2. **Client state JSON** — every input/select/textarea value (passwords excluded, file inputs as name+size only), Quill menu text + HTML, app-state globals (submission mode, revision source, AI check state, critical-error overrides, diff summary), the last 20 on-page alerts with timestamps, page URL, user agent, and viewport. Oversized reports are compacted by measured UTF-8 body size before the POST: full screenshot + full state first, then compact/minimal state while keeping the screenshot, then screenshot drop only as the final fallback.
3. **Context** — which surface triggered the report (`error_alert`, `critical_error_banner`, `support_footer`) and, for alerts, the exact error message on screen.

### Button placement

| Surface | Trigger value |
|---------|---------------|
| Every error alert (`showAlert(..., 'error')`) | `error_alert` (includes the alert message as context) |
| Critical-error banner above Submit | `critical_error_banner` |
| Support footer ("Need help?") | `support_footer` |

Each placement discloses what is sent: "(sends us a screenshot of this page and your form details)". The mailto link remains as fallback. The failure alert shown when a report itself fails uses `noReportAction: true` so it cannot recurse.

## Data flow

```
[click] → capture screenshot (html2canvas, 15s timeout, JPEG, ≤3.5MB data URL)
        → collect state snapshot
        → POST /api/form/error-report   (route-specific 15MB JSON cap; client stays just below it)
              ├─ generate incident id (`err-...`)
              ├─ save tmp/error-reports/<incidentId>/{report.json, client-state.json, screenshot.jpg|png}
              ├─ log `user_error_report` to Supabase form_attempt_logs (no screenshot)
              ├─ email FORM_ATTEMPT_ALERT_EMAIL a lightweight incident notice (incident id + saved path; no bulky attachments)
              └─ optionally email an AI triage proposal for the incident
```

- **Server lib:** `services/dashboard/lib/error-report.ts` — normalization/truncation, data-URL decoding (PNG/JPEG only, 4MB decoded cap), email builder, send gate.
- **Route:** `POST /api/form/error-report` in `services/dashboard/index.ts`, 15-second per-attempt cooldown (429) against double-clicks. The route has its own `ERROR_REPORT_JSON_BODY_LIMIT` parser (default `15mb`) registered before the dashboard-wide `5mb` JSON parser.
- **Disk copy always happens first**, so reports survive missing SMTP/Supabase config; the email send failure is logged but never fails the request.
- **The first email is fire-and-forget** (repo convention for non-critical side effects): the route responds as soon as the report is persisted and returns `incidentId`/`emailQueued`, never awaiting the mail transport. The email intentionally stays small: it contains the incident id, attempt metadata, saved server path, state/screenshot sizes, and recent alert summary instead of attaching the full JSON/screenshot. This matters operationally — an unreachable relay once held the response past nginx's 60s proxy timeout and turned every production report into a 504. The shared dashboard SMTP transport (`lib/smtp-config.ts`) also sets `connectionTimeout`/`greetingTimeout` 10s and `socketTimeout` 60s instead of nodemailer's multi-minute defaults; a failed send logs to console and writes an `error_report_email_failed` row to `system_alerts` with the on-disk path of the saved report.
- **Transport is Graph-first** (`lib/alert-mail.ts`, shared by all dashboard alert email): Microsoft Graph `sendMail` over HTTPS using the existing SharePoint app registration, with SMTP fallback. Production (Lightsail) blocks outbound port 25, so SMTP to the M365 relay can never connect there. Graph needs `Mail.Send` application permission and a real sender mailbox in `GRAPH_MAILBOX_ADDRESS`; oversized attachments are dropped with a note in the email body (the report stays on disk).
- **Interim path while `Mail.Send` awaits admin consent:** if `sendMail` returns 403, the transport writes the message **directly into the recipient's inbox** using the already-granted `Mail.ReadWrite` application permission (`POST /users/{to}/mailFolders/inbox/messages` with `PR_MESSAGE_FLAGS=4` so it lands as a normal unread message, not a draft). Works only for in-tenant recipients, which alert mail always targets; out-of-tenant recipients fall through to SMTP. Once `Mail.Send` is granted, `sendMail` succeeds first and this path goes dormant automatically.
- **AI triage proposal:** when `OPENAI_API_KEY` is configured and `NODE_ENV=production`, the dashboard sends a compact incident summary to `ERROR_REPORT_TRIAGE_MODEL` (default `IMPROVE_MODEL`, then `AI_REVIEW_MODEL`, then `gpt-4o-mini`) and emails the resulting likely-cause/action proposal to `FORM_ATTEMPT_ALERT_EMAIL`. Set `ERROR_REPORT_AI_TRIAGE_DISABLED=true` to disable it or `ERROR_REPORT_AI_TRIAGE_FORCE=true` to test outside production.

## Email gating

Mirrors the form-attempt failure email: sends only when an alert-mail transport is configured **and** `NODE_ENV=production`, so local dev (which may have real mail creds in `.env`) never emails by accident. Set `ERROR_REPORT_FORCE_EMAIL=true` to opt in outside production when deliberately testing the full path. Recipient is `FORM_ATTEMPT_ALERT_EMAIL` (default `dcowser@richardsandoval.com`).

## Failure behavior

- Screenshot library fails to load / capture times out / canvas too large → report still sends with `screenshotError` explaining why; the email says "Not captured (reason)".
- Screenshot + full state would exceed body limits → report still sends with compact/minimal state while keeping the screenshot when possible; screenshot is dropped only if the compact/minimal state plus screenshot still exceeds the route-specific cap.
- A successful final submit clears previous red error alerts and their report buttons before resetting the form, so a later report is not attached to a stale submission error after the menu has already gone through.
- POST fails → button restores, `error_report_client_failed` attempt event logged, error alert (without a report button) tells the user to email manually.
- Repeat click within 15s → 429 with a friendly message.
- AI triage fails or OpenAI is unconfigured → the saved incident and lightweight incident email still succeed; failures are logged to `system_alerts` as `error_report_ai_triage_failed`.

## Tests

- `services/dashboard/__tests__/error-report.test.ts` — normalization, truncation bounds, data-URL decoding, email gating, HTML escaping.
- `services/dashboard/__tests__/form-view.test.js` — button wiring on all three surfaces, capture-before-UI-change ordering, Safari CSS color fallback, byte-budgeted payload compaction, stale alert cleanup, no-recursion flag.
- `services/dashboard/__tests__/modification-workflow.test.js` — route-level verification that `/api/form/error-report` accepts bodies larger than the normal dashboard form JSON limit.
- `services/dashboard/__tests__/smtp-config.test.ts` — auth modes and the fail-fast transport timeouts.
