# External PDF Review — Implementation Spec and Handoff

**Status:** Ready for implementation in a separate task. No application implementation was made in the originating task.

## Deliverable

Build a designed-PDF submission flow that checks the uploaded menu against the existing tenant menu rules. Critical errors stop submission. The submitter corrects the design using their own tools, re-uploads, and checks again. A passing PDF creates a **new ClickUp task for corporate human review**, with the checked PDF attached.

The user explicitly requested this implementation in another task. Build through successful ClickUp handoff. The user will ask Myca how human-requested corrections should work; that later workflow is intentionally unresolved and must not block this deliverable.

Read [PDF Rule Review](pdf-rule-review.md) for the Myca call, business rationale, and deferred work. The latest clarification controls if earlier scope wording differs.

## Confirmed requirements

- No approved Word document, approved-menu ID, or existing ClickUp task is required.
- Menu Manager reports issues; it does not edit the PDF, regenerate its design, or upload changes into Canva/Adobe.
- Critical findings must be corrected externally and checked again before submission. Normal/warning findings remain visible and accompany the reviewer handoff; they do not silently become critical.
- Keep severity separate from confidence. Do not introduce a submitter-facing critical-error override in this first flow.
- A completed, fully readable check with zero critical findings is a pass. An unavailable or incomplete check is not a pass.
- On a pass, submit the exact checked PDF to corporate review by creating a new ClickUp task. Use a single **Check and submit PDF** action so the passing check continues into handoff without an extra confirmation step.
- The application records `pending_human_review` (or an equivalent established pending state), never `approved` or a design-complete state merely because AI passed.
- This first release ends at human-review intake. Do not build reviewer rejection, correction requests, post-review resubmission, final approval, publishing, or automatic Word/design reconciliation.

## Form and visible states

Add a dedicated direct-link page, proposed `/pdf-review`, using the existing tenant branding and form patterns. Keep the approved-Word comparison route working. Broader navigation/rollout can be configured after local verification; this task need not redesign the public landing page.

Required input: submitter name/email/job title, canonical property, project/menu name, service period, food or beverage context, à la carte or prix-fixe context, and PDF. Reuse established catalog/autofill behavior and meaningful existing validation. Do not require fabricated prior approvals or irrelevant Word/design-brief fields. Collect optional due date/notes only where the existing intake can use them.

| State | What the submitter sees | Server behavior |
| --- | --- | --- |
| Ready | PDF selection, context, Check and submit PDF | No ClickUp task yet. |
| Checking | Progress and selected file name | Validate/store upload, review every page; prevent duplicate starts from creating tasks. |
| Corrections needed | Critical errors first, then warnings; original wording, explanation, proposed correction, page where supported | Keep task creation blocked. Let the submitter replace the PDF and rerun. |
| Check unavailable/incomplete | A clear explanation and retry/re-upload action | No submission bypass, no success banner, no task. |
| Sending | Passing check, handoff progress | Persist pending submission; create one task and attach the exact PDF. |
| Submitted | Submission reference and confirmation that it was sent for human review | Persist task ID and attachment success. |
| Handoff incomplete | Saved submission reference, accurate failure message, retry action | Resume the missing step without duplicating a task or successful attachment. |

Normal suggestions should be available after a pass and in the review summary. A human reviewer may still find issues; say **Submitted for review**, not **Menu approved** or **Error-free**.

## Check engine

Reuse the current live rulebook (`sop-processor/qa_prompt.txt`), `getTenantConfig()`, accepted correction rules, menu-type logic, and deterministic checks. Use the same maintained rule sources as ordinary menu review; do not create an independent Sandoval-specific copy of the prompt.

Designed PDFs require page/layout evidence. Reuse selectable-text extraction and rendering, with visual reading/OCR as needed for image-only or mixed pages. Preserve columns, headings, descriptions, prices and allergen relationships rather than treating extraction order as menu structure. If a page cannot be read reliably or exceeds review bounds, expose incomplete coverage and block submission. Do not claim an unseen page passed.

The existing text-review pipeline mutates extracted text before and after AI and can mark issues resolved against the corrected copy. **Those operations never fix the uploaded PDF.** Adapt the engine to retain findings about the original PDF, including deterministic corrections that would otherwise disappear. Do not simply forward the existing pipeline's final `hasCriticalErrors` value as the PDF pass decision.

Finding fields should include a stable ID, rule/type, original visible wording or evidence, explanation, suggested correction when known, severity, confidence, page number when grounded, and provenance (rule or model). Do not invent page coordinates or missing ingredient facts. Escape all user/model text in the view.

Apply existing food/beverage and set-menu exemptions. The first release is external-property menus. Keep the engine reusable for private-event PDF QA; do not expand this task into BEO ingestion or customer-selection verification. Full brand manuals/font compliance and sales-kit photo annotations are out of scope.

## Review identity and persistence

Use a dedicated source/workflow discriminator, proposed `pdf_rule_review`, distinct from `form` and approved-source `design_approval`.

Persist the uploaded PDF under the established document-storage root with a server-generated ID and safe filename. Store the original filename, content hash, context, submitter information, check timestamps, rule/prompt/model version evidence, page coverage, findings, check state, and handoff state. Keep failed-check attempts separate from submitted human-review work; a failed check must not populate the ordinary pending-review queue or create a task.

Bind the check to the exact bytes and rule-relevant context. The server owns the pass decision and retrieves its stored PDF; ignore client-supplied pass flags, findings, file paths, and task IDs. Changing the PDF or property/menu context invalidates the prior check. Prevent a late response for an earlier file from authorizing the currently selected file. Apply an explicit check lifetime/version policy so expired or invalidated checks cannot be reused unnoticed.

Use existing token/session access patterns for viewing results, downloading PDFs, and retrying handoff. A random check ID alone must not grant broad mutation rights. Enforce existing upload limits, extension/signature validation, and allowed-root path checks. Use argument-safe subprocess invocation for extraction/rendering.

Do not let PDF intake create/update a current approved-menu pointer, populate approved dishes, inherit fictitious source approvals, or feed a final approved-document learning pair. Review DB hooks and source filters, not just the new route.

## ClickUp handoff contract

Create a **new review task**, not an attachment on a previous design task. Reuse the configured ClickUp list and ordinary incoming-review status/assignees where appropriate. All business-specific IDs, names and routing remain in existing environment/tenant config. Do not guess a post-design status.

The task must contain:

- The actual reviewed PDF as `application/pdf`, preserving a safe `.pdf` filename.
- Property, project/menu name, service period, menu context, submitter details and supplied notes/date.
- A concise AI-check summary, unresolved normal findings, review coverage, and submission reference.
- Wording that it awaits corporate human review. If linking back to the app, use a PDF-compatible read-only review/summary surface; do not link to the Word approval editor.

For this workflow, do not reuse the existing submitter-email shortcut that sends Isabella's submissions directly to Marketing. The PDF must still enter review. Do not invoke Word correction/approval webhooks, DOCX generation, dish extraction, or automatic source replacement for the new source type.

Make submission and retry idempotent per reviewed upload: concurrent/double submissions must not create two tasks. Persist the task ID before attaching where possible; persist attachment success separately so a failed attachment retries against the same task. If task creation has an ambiguous timeout, reconcile by a stable submission reference before attempting another creation. Do not promise exactly-once delivery through an unhandled network ambiguity.

If ClickUp is unconfigured, errors, or has not received the attachment, show **handoff incomplete**. The existing `{ skipped: true }` response is not successful submission to Sandoval. Persist enough state to recover after service restart and report task-created/attachment-failed honestly. Do not fire-and-forget this primary handoff while displaying success.

## Suggested technical layout

Route names are implementation defaults, not requirements to preserve at the expense of established architecture:

- `GET /pdf-review`: intake/check interface.
- `POST /api/pdf-review/check`: validated multipart PDF/context; starts an asynchronous check and subsequent handoff on pass.
- `GET /api/pdf-review/checks/:checkId`: authorized status/result polling.
- `POST /api/pdf-review/checks/:checkId/retry-handoff`: server-owned retry after a passing check, using its stored submission/file.
- A protected or token-scoped PDF download/summary route if needed for review.

Keep PDF review orchestration in a new focused dashboard module. Share rule evaluation and extraction helpers rather than duplicating the large existing form handler. Extend or add a protected ClickUp intake handler that supports PDF records with durable idempotency; do not disguise a PDF as `docxPath` to reuse the existing handler unchanged.

Relevant current implementation:

| Location | What to inspect |
| --- | --- |
| `services/dashboard/lib/design-approval-workflow.ts` | Upload validation, stored PDF, comparison and existing-task finalization. Its approved-source requirement and auto-approval semantics do not fit the new flow. |
| `services/dashboard/lib/design-visual-review.ts` | Page rendering, bounded multimodal calls, findings validation and coverage errors. Its current prompt only checks configured artwork policies. |
| `services/docx-redliner/extract_pdf_text.py`, `render_pdf_pages.py` | Existing text extraction and rendering; check coverage of scanned/mixed PDFs. |
| `services/dashboard/lib/review-pipeline.ts`, `qa-prompt-builder.ts`, `pre-ai-deterministic-rules.ts` | Shared rule evaluation; retain original PDF issues instead of clearing them against rewritten text. |
| `services/dashboard/index.ts` | Existing async Basic AI Check polling, property catalogs, route registration and stored-submission retry. Current retry requires a DOCX. |
| `services/dashboard/lib/submission-workflow.ts`, `approval-transitions.ts` | Submission persistence and source/state boundaries. |
| `services/clickup-integration/index.ts` | `/create-task` currently attaches DOCX, has an identity-based Marketing shortcut, and stores task ID late. Existing `/design-approval/finalize` attaches to a prior approved task. Neither can be adopted unchanged. |
| `services/db/index.ts`, `services/dashboard/lib/approved-menus.ts` | Source gating, review queues, menu-pointer updates and extraction hooks. Existing exclusions explicitly recognize `design_approval`; consider the new source. |
| `services/tenant-config/src/index.ts`, `config/`, `.env.example` | Current branding/routing/rules and any necessary configurable defaults. |

Re-read current code before edits; the original checkout contains substantial uncommitted work from other tasks.

## Verification and acceptance

Implement focused automated coverage for:

1. Upload signature/size/context validation, no Word/menu-ID dependency, async progress and failed coverage.
2. Critical findings prevent both pending human-review submission and ClickUp creation; normal findings alone permit handoff.
3. Deterministic/AI corrections proposed only in memory do not clear errors in an unchanged PDF.
4. Corrected re-upload passes; stale check, changed context, modified bytes, forged pass fields and late responses cannot bypass review.
5. Passing input creates one pending-review record and one task with the exact PDF and findings; never auto-approves or routes directly to Marketing based on submitter identity.
6. Duplicate/concurrent submit, attachment failure, transient/ambiguous creation failure, missing ClickUp config, retry and restart recovery do not falsely report success or duplicate known tasks/attachments.
7. New PDF submissions cannot enter DOCX-only approval/extraction paths or replace approved-menu data.
8. Existing Word submission and approved-source comparison tests still pass for affected shared code.

Run TypeScript checks, affected workspace builds, and focused tests. Use `./dev-up.sh` / Docker Compose for service startup and direct route/browser verification, following `AGENTS.md` and `docs/feature-delivery-workflow.md`. Verify upload → critical findings → corrected re-upload → passing handoff and retry behavior in the running app.

Use isolated local DB/test state and a local ClickUp HTTP stub for automated/live handoff verification; assert task payload and actual attached bytes. Do not notify real reviewers, send emails/comments, or create live customer tasks merely to test the feature. Verify the PDF/AI portion with representative local PDFs and the configured provider where available; if that cannot run, report that precise gap rather than substituting mock accuracy claims. Existing `samples/Design Approval Pairs/` PDFs can exercise the reader, but are not a validated external-property benchmark.

Update relevant docs, README, environment/config references and business-workflow specs with implementation. Regenerate the rules manifest if rule/guard/prompt behavior changes. Follow the repo's affected-service build/restart requirements; do not deploy or merge as part of this handoff.

## Handoff environment

- Originating checkout: `/Users/deriancowser/Documents/MenuManager`.
- Related task: **Find design approval examples**, ID `01a04f23-1601-71e0-b443-1831c7e78311`.
- This spec and the product-priority note may be untracked. Reusable PDF implementation and other fixes are also uncommitted in the originating checkout.
- The new task should work in its assigned worktree. Compare its baseline with the original checkout read-only; selectively bring over the prerequisite PDF/review work and this spec if absent. Do not reset, clean, stash, commit all, or overwrite unrelated original-checkout changes.
- Coordinate Docker ports/Compose project names before starting another stack; do not accidentally operate an original stack while believing it serves the new worktree.
- Stop scope at pending corporate review with successful ClickUp PDF delivery. Human-requested changes are the only business-flow question explicitly deferred by the user; do not wait for that answer to build the authorized portion.
