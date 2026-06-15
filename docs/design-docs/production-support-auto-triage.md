# Production Support Auto-Triage

**Status:** Design
**Service:** dashboard
**Related:** [User Error Reports](user-error-reports.md), [Critical Error Blocking](critical-error-blocking.md), [Automated Improvement Loop](automated-improvement-loop.md)

## Problem

When a submitter clicks **"Report this problem"** from the critical-error banner, support receives enough context to diagnose the issue, but the submitter is still blocked until a person replies. In the Aqimero brunch report on June 15, 2026, the submitter could have clicked **"Override - AI May Be Wrong"** because the AI was blocking on the instruction line `choose one`. Support had to manually email him with that guidance.

The future system should handle obvious support cases automatically while still preserving human review for ambiguous or risky blockers.

## Goal

After a user problem report is saved, the dashboard should classify whether the blocker is likely an AI false positive. If the confidence is high, it should automatically email the submitter with a specific next step, such as using **"Override - AI May Be Wrong"** for a suspect critical suggestion.

The reply should be operational support, not silent correction. The system should not auto-override, auto-submit, or remove auditability.

## Non-Goals

- Do not automatically override critical errors on behalf of the submitter.
- Do not send auto-replies for real missing prices, invalid uploads, server failures, required-field validation, or ambiguous AI output.
- Do not use a broad LLM judgment as the only reason to tell a submitter to override a blocker.
- Do not send repeated auto-replies for the same attempt/report pattern.

## Candidate Flow

1. Submitter clicks **"Report this problem"**.
2. Existing `/api/form/error-report` flow saves the screenshot, client-state JSON, and `user_error_report` attempt log.
3. New triage helper reads the normalized report and client state.
4. Triage returns one of:
   - `autoreply_override_guidance`
   - `support_review_required`
   - `no_autoreply`
5. If eligible, the dashboard queues an email to the submitter and logs the decision.
6. Support still receives the original problem-report email, with the auto-reply decision included.

## High-Confidence Auto-Reply Signals

Auto-reply is eligible only when all of these are true:

- The report was triggered from `critical_error_banner`.
- The AI check has completed.
- The submitter email is present and valid.
- The current blocker list is available in client state.
- All current critical blockers match allowlisted false-positive patterns.
- The attempt has not already received an equivalent auto-reply.

Initial allowlisted patterns:

- `Incomplete Dish Name` on standalone selection instructions such as `choose one`, `choice of one`, `select two`, or `pick your entree`.
- Critical suggestions already dropped by backend reconciliation with reason `critical_false_positive_selection_instruction`, once diagnostics are included in report state.

Explicitly ineligible patterns:

- `Missing Price`
- `Set Menu Item Price`
- prix-fixe top-price or course-numbering blockers
- required-field validation
- file upload, extraction, network, or submit failures
- mixed critical lists where only some blockers look false-positive

## Suggested Submitter Email

Subject:

```text
Menu Manager support: you can override this AI blocker
```

Body:

```text
Hi {submitterName},

Thanks for reporting the Menu Manager issue on {projectName}.

The blocker appears to be an AI false positive. It is stopping on "{menuItem}", but that line looks like a menu instruction rather than a dish that needs to be renamed.

You can continue by clicking "Override - AI May Be Wrong" on that red suggestion, then submit the menu for review.

We still received your report and will review it, but this should let you keep moving now.
```

## Implementation Notes

- Add a dashboard helper such as `services/dashboard/lib/support-auto-triage.ts`.
- Keep triage deterministic first. If an LLM is added later, use it only after allowlisted structured checks and require a conservative confidence reason.
- Reuse the existing Graph-first alert mail transport in `lib/alert-mail.ts`.
- Add feature flags:
  - `SUPPORT_AUTOREPLY_ENABLED=false` by default
  - `SUPPORT_AUTOREPLY_DRY_RUN=true` for initial production observation
  - `SUPPORT_AUTOREPLY_RECIPIENT_ALLOWLIST` for pilot users or domains
- Extend `form_attempt_logs` with events:
  - `user_error_report_autoreply_skipped`
  - `user_error_report_autoreply_queued`
  - `user_error_report_autoreply_sent`
  - `user_error_report_autoreply_failed`
- Include reason codes such as `selection_instruction_false_positive`, `mixed_critical_blockers`, `missing_submitter_email`, and `cooldown_active`.
- Add a cooldown by attempt ID plus reason code, for example one auto-reply per 24 hours.

## Safety and Audit

- BCC or log the outbound auto-reply so support can see what the submitter received.
- Store the triage decision in the saved report metadata.
- Do not hide the **"Report this problem"** path after sending an auto-reply.
- Keep the support fallback email visible.
- If email sending fails, do not fail the original problem-report request.
- The original report should remain available in `tmp/error-reports/` and `form_attempt_logs`.

## Tests

Add focused coverage before enabling:

- Triage returns `autoreply_override_guidance` for a `critical_error_banner` report with only `Incomplete Dish Name` on `choose one`.
- Triage skips mixed blockers, missing prices, upload failures, and missing submitter email.
- The route saves the original report even when auto-reply send fails.
- Dry-run mode logs the intended decision without sending.
- Cooldown prevents repeated emails for the same attempt and reason.

## Rollout Plan

1. Build deterministic triage in dry-run mode.
2. Add triage decision details to support emails only.
3. Review one to two weeks of production decisions.
4. Enable auto-replies for internal or allowlisted recipients.
5. Expand to all production users only after false-positive and false-negative review.

## Planning Loop

Use production reports to continuously improve the allowlist:

- Weekly, review `user_error_report` records triggered from `critical_error_banner`.
- Group by critical suggestion type, menu item, recommendation, and eventual support action.
- Promote only repeated, low-risk patterns into deterministic triage.
- For every promoted pattern, update the prompt, backend reconciliation, tests, and this document.
