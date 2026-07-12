# Current Capabilities

This is the compact product-state reference for Menu Manager. Keep implementation details in feature design docs and use this file for the current behavior someone needs before working in the repo.

## Public Submission Form

- Chefs submit new menus or modifications through the dashboard form at `/form`.
- Property selection is restricted to the canonical DB-managed property catalog.
- Property and submitter search are accent/tone-mark insensitive while preserving canonical stored values.
- DOCX uploads can prefill clean project details, allergen legends, raw-item notice state, and menu content.
- Modification submissions support database baselines, uploaded approved baselines, and uploaded unapproved/redlined DOCX files.
- Required fields are highlighted inline before submission, including submitter, project details, service period, and approval attestation.
- Public upload endpoints enforce file-size limits, file-signature checks, and filename/rich-text sanitization while preserving Unicode menu names.
- Submitter confirmation emails include the generated DOCX for deliverable submitter/approver addresses and any configured confirmation CC recipients.

Related docs:

- [Submitter autofill](design-docs/submitter-autofill.md)
- [Approval attestation](design-docs/approval-attestation.md)
- [Revision / modification flow](design-docs/revision-modification-flow.md)
- [User error reports](design-docs/user-error-reports.md)

## Basic AI Check

- Basic AI Check runs as an async dashboard job. The browser starts a check, polls status, and keeps final submission blocked until the check completes or returns the manual-review fallback.
- Deterministic pre-AI cleanup handles accepted spelling/diacritic replacements, allergen-code formatting, raw-item marker placement, learned accepted correction rules, and curated guards before the model call.
- Post-AI guards reject unsafe model output that drops submitted lines, loses too many tokens, becomes much shorter than the input, or changes submitted prices.
- Basic AI Check also raises non-critical, actionable suggestions for known DOCX/redline cleanup artifacts in menu text, such as malformed wine-region terms that should be reviewed before submission.
- Missing-price and incomplete-dish-name blockers remain critical unless an exemption applies, such as included dishes inside supported set-menu sections.
- Basic AI Check can fall back to manual review when the AI service is unavailable, preserving deterministic corrections that already ran.
- Debug diagnostics are available with `?debugBasicCheck=1` outside production, or in production when `BASIC_AI_CHECK_DEBUG_ENABLED=true`.

Related docs:

- [Critical error blocking](design-docs/critical-error-blocking.md)
- [Dish name formatting](design-docs/dish-name-formatting.md)
- [SOP rules](references/sop-rules.md)
- [Code rules manifest](references/code-rules-manifest.md)

## Human Review And Approval

- Isabella's review queue is available by direct link at `/reviews`; legacy `/review-queue` redirects there.
- ClickUp tasks include a browser approval link at `/approval/:submissionId`.
- The approval editor shows editable clean text on the left and a live tracked-change preview on the right.
- Uploaded redlined DOCX files are normalized into a clean accepted editor side plus a reconstructed preview of imported changes.
- Browser approval finalization uploads the approved DOCX to ClickUp, finalizes the DB submission, assigns Marketing, and leaves or moves the task to the configured post-approval status.
- The older Word/ClickUp correction path still processes reviewer-uploaded DOCX files from configured review-complete statuses.

Related docs:

- [ClickUp integration](design-docs/clickup-integration.md)
- [ClickUp-linked approval workflow proposal](design-docs/clickup-linked-approval-workflow-proposal.md)
- [Architecture data flows](architecture.md)

## Approved Menus And Dishes

- Approved menus appear at `/approved-menus` as a chef-facing lookup: choose a restaurant, optionally narrow by service period, then download the cleaned editable Word DOCX or the original approved file. `Edit This Menu` starts a draft with saved inline formatting, including bold dish names, preserved when available.
- Approved dishes appear at `/approved-dishes`, grouped by derived brand and canonical property/location.
- Approved-dish extraction splits dish names, descriptions, prices, allergen codes, categories, source lines, and provenance where available.
- Extraction uses deterministic quality flags first, then selectively asks `ai-review` for advisory classification of risky rows.
- Re-extraction is idempotent: successful writes deactivate previous active rows for the same source submission before inserting the new clean set.
- Approved menus can be uploaded to SharePoint after approval when property folder metadata and Graph credentials are configured.

Related docs:

- [Approved dish quality](design-docs/approved-dish-quality.md)
- [Document storage](design-docs/document-storage.md)
- [Operations playbook](operations-playbook.md)

## Learning And Improvement

- The differ service compares AI drafts against human-approved corrections after approval.
- Reviewers can annotate learning examples and accepted correction rules on learning dashboards.
- Accepted manual rules can be scoped globally, to food/beverage menus, or to a property.
- The automated improvement loop can assemble new annotated corrections, propose prompt/rule changes, run evals, and wait for human approval before applying changes.
- When the daily improvement loop finds a pending proposal with **no** new unconsumed corrections, it emails a reminder for that pending proposal instead of silently skipping the day. When new corrections arrive, it supersedes the pending proposal with a fresh one that combines all evidence.
- Deterministic rule or prompt-section changes should be followed by `npm run rules:manifest`.

Related docs:

- [Training pipeline](design-docs/training-pipeline.md)
- [Learning pipeline v2](design-docs/learning-pipeline-v2.md)
- [Automated improvement loop](design-docs/automated-improvement-loop.md)

## Operational Support

- Public form attempts write compact `form_attempt_logs` telemetry for baseline uploads, Basic AI Check, final submit, parser `413` failures, and problem reports.
- Basic AI Check can write bounded `basic_ai_check_audits` rows with request, raw response, parsed response, guard diagnostics, and final result.
- The one-click "Report this problem" action saves incident details under `tmp/error-reports/<incidentId>/`, logs telemetry, and emails support in production.
- Dashboard alert email prefers Microsoft Graph `sendMail` when configured and falls back to SMTP.

Related docs:

- [Environment variables](environment.md)
- [User error reports](design-docs/user-error-reports.md)
- [Operations playbook](operations-playbook.md)

## Disabled Or Direct-Link Surfaces

- Learning/training dashboards are direct-link reviewer tools and are intentionally not linked from the public landing page.
- The design approval tool still exists at `/design-approval`, but it is a direct-link tool and is not shown on the public welcome dashboard.
- There is no active separate `submission-form`, `workflow-engine`, or `approved-dishes` service; those capabilities currently live in `dashboard`, `db`, `clickup-integration`, and shared libraries.
