# User Error Reports ("Report this problem")

**Status:** Complete
**Service:** dashboard (form page only)

## Problem

When a submitter hit an error on the form (validation block, ClickUp handoff failure, payload too large, server exception), the only guidance was "email support and include screenshots." That depends on the chef knowing how to take a useful screenshot, actually attaching it, and describing what they had filled in — which almost never happens. Debugging meant reconstructing client state from `form_attempt_logs` fragments.

## Solution

A **"Report this problem"** button that, in one click, captures everything support needs and emails it:

1. **Full-page screenshot** — rendered client-side with [html2canvas](https://html2canvas.hertzen.com) (vendored at `services/dashboard/public/js/html2canvas.min.js`, MIT, lazy-loaded only when the button is clicked so the form pays nothing on normal loads). Captured *before* any UI changes so the open red error alert is part of the image.
2. **Client state JSON** — every input/select/textarea value (passwords excluded, file inputs as name+size only), Quill menu text + HTML, app-state globals (submission mode, revision source, AI check state, critical-error overrides, diff summary), the last 20 on-page alerts with timestamps, page URL, user agent, and viewport.
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
        → POST /api/form/error-report   (drops screenshot, then state, if body > 4.5MB)
              ├─ save tmp/error-reports/<timestamp>-<attemptId>/{report.json, client-state.json, screenshot.jpg|png}
              ├─ log `user_error_report` to Supabase form_attempt_logs (no screenshot)
              └─ email FORM_ATTEMPT_ALERT_EMAIL with screenshot + client-state.json attached
```

- **Server lib:** `services/dashboard/lib/error-report.ts` — normalization/truncation, data-URL decoding (PNG/JPEG only, 4MB decoded cap), email builder, send gate.
- **Route:** `POST /api/form/error-report` in `services/dashboard/index.ts`, 15-second per-attempt cooldown (429) against double-clicks.
- **Disk copy always happens first**, so reports survive missing SMTP/Supabase config; the email send failure is logged but never fails the request.
- **The email is fire-and-forget** (repo convention for non-critical side effects): the route responds as soon as the report is persisted and returns `emailQueued`, never awaiting SMTP. This matters operationally — an unreachable relay once held the response past nginx's 60s proxy timeout and turned every production report into a 504. The shared dashboard SMTP transport (`lib/smtp-config.ts`) also sets `connectionTimeout`/`greetingTimeout` 10s and `socketTimeout` 60s instead of nodemailer's multi-minute defaults; a failed send logs to console and writes an `error_report_email_failed` row to `system_alerts` with the on-disk path of the saved report.

## Email gating

Mirrors the form-attempt failure email: sends only when SMTP is configured **and** `NODE_ENV=production`, so local dev (which has real SMTP creds in `.env`) never emails by accident. Set `ERROR_REPORT_FORCE_EMAIL=true` to opt in outside production when deliberately testing the full path. Recipient is `FORM_ATTEMPT_ALERT_EMAIL` (default `dcowser@richardsandoval.com`).

## Failure behavior

- Screenshot library fails to load / capture times out / canvas too large → report still sends with `screenshotError` explaining why; the email says "Not captured (reason)".
- POST fails → button restores, `error_report_client_failed` attempt event logged, error alert (without a report button) tells the user to email manually.
- Repeat click within 15s → 429 with a friendly message.

## Tests

- `services/dashboard/__tests__/error-report.test.ts` — normalization, truncation bounds, data-URL decoding, email gating, HTML escaping.
- `services/dashboard/__tests__/form-view.test.js` — button wiring on all three surfaces, capture-before-UI-change ordering, no-recursion flag.
- `services/dashboard/__tests__/smtp-config.test.ts` — auth modes and the fail-fast transport timeouts.
