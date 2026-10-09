# PDF Rule Review

**Status:** Prioritized next feature; not implemented by this scope update (2026-09-04).

**Implementation handoff:** [External PDF Review — Implementation Spec](pdf-rule-review-implementation-spec.md). The user subsequently confirmed the endpoint: report critical issues, let the submitter fix/re-upload externally, then create a new ClickUp task when the PDF passes. How humans request further changes will be clarified later; build through handoff now in a separate task.

## Decision and source

The next priority is reviewing an externally designed menu PDF against the tenant's menu rules **without requiring an approved Word document or an existing approved-menu record**. Derian confirmed this direction after sharing his call with Myca on September 4, 2026. This supersedes the earlier priority of operationalizing approved-DOCX-to-PDF comparison and the August recommendation to place sales-kit review second.

Source: [Myca call transcript supplied on September 4](../business/myca-design-review-call-transcript-received-2026-09-04.txt), plus Derian's accompanying clarification. The transcript does not establish the actual call date. Operational observations and volumes below are stakeholder testimony, not independently measured usage.

The existing work in the task **Find design approval examples** remains documented in [Design Approval](design-approval.md). Its comparison workflow is a separate use case; its upload, PDF extraction/rendering, findings UI, and audit infrastructure provide reusable components.

## What Myca clarified

- Most properties in the portfolio make their own designs. Myca estimated that his team designs for roughly 6–15 locations; he did not give a total portfolio count.
- Corporate may receive only the finished property PDF. A Word brief may never have passed through culinary or operations review.
- Isabella checks the PDF for the same menu wording, spelling, and description consistency she would review in Word.
- Mel separately checks brand presentation, including fonts and sizing. Culinary/operations may still need to judge the menu mix and whether the right people approved it.
- The immediate benefit is making the property correct rule violations before the PDF reaches corporate reviewers.

## First workflow to build

1. The submitter selects their property and supplies identity and relevant menu context, then uploads the designed PDF. There is no approved-menu picker or DOCX prerequisite.
2. The system reads the PDF with page/layout context and checks its menu content against the current tenant rulebook and applicable deterministic/accepted rules. Reuse the existing food/beverage and prix-fixe distinctions.
3. Findings show the original wording, proposed correction, reason, severity, and page/location where available. Evaluate what is actually visible in the uploaded PDF.
4. The property corrects the source design in its own design tool and uploads the revised PDF for another check.
5. Unresolved critical findings prevent submission to corporate review. Unreadable pages or failed/incomplete checks must not appear as a clean pass; show retry/re-upload guidance. A submitter override/manual bypass is not part of this first flow.
6. A successful check submits the exact checked PDF by creating a new ClickUp task for corporate human review, with the PDF attached. Normal findings accompany that handoff. Isabella and the appropriate design/culinary reviewers retain their responsibilities. A rules pass is not final design approval or evidence of prior culinary sign-off.

Keep the existing severity-versus-confidence distinction. Myca's missing-accent example indicates that actionable spelling/diacritic corrections must be surfaced before handoff; it does not establish that every warning should become critical. Final release-blocking policy should be evaluated with representative findings rather than silently changing all tenant rules.

The first scope is menu-content QA. Full brand-manual ingestion, exact font/size compliance, and comprehensive visual-design approval are later extensions. Existing tenant-configured artwork checks may be reused where applicable, but do not claim they cover Mel's complete review.

## Reuse and required changes

| Existing component | Application to PDF rule review |
| --- | --- |
| PDF validation, extraction, and page rendering | Reuse with coverage checks for every page; current selectable-text extraction alone cannot cover image-only or mixed PDFs. |
| Menu rulebook and deterministic/accepted correction rules | Reuse the live `sop-processor/qa_prompt.txt`, tenant configuration, and applicable review rules; do not fork a hardcoded Sandoval prompt. |
| Menu-review pipeline | Adapt to findings about the submitted PDF. The current pipeline corrects extracted text and can reconcile findings as resolved; those corrections do not alter the actual PDF. Preserve original-file evidence and unresolved corrections until a revised file is checked. |
| Findings UI and durable PDF audit | Reuse concepts, recording the exact file/version checked, review coverage, findings, and human decisions. Replacing the PDF invalidates its prior check. |
| Existing comparison submission and ClickUp finalization | Do not reuse its automatic `approved` status or requirement for an existing approved version/task. This workflow needs a corporate-review submission with its own routing and state. |

Server-side submission gating must bind a completed review to the exact submitted PDF and relevant context. A changed file, property, menu type, or stale check must not inherit a previous pass. Internal fixes to an extracted text copy must never make an unchanged PDF look corrected.

Use the existing configured incoming-review ClickUp destination/status/assignees for the new task where appropriate; do not assume an internal design task or a post-design status already exists. The user confirmed that there is enough information to implement through this handoff. The later human-requested correction loop remains deferred.

## Known gap: intentional changes after Word approval

Derian reports that designs sometimes intentionally change after the Word document is approved. The final design can therefore differ from the stored approved Word source for valid reasons.

- A DOCX/PDF mismatch is evidence of a difference, not proof that design made an error.
- This gap prevents treating the existing source comparison as fully autonomous approval.
- A PDF-only rule review can check compliance, but cannot establish that menu selections, changed prices, or other content changes were authorized without authoritative evidence.
- Do not silently overwrite approved Word content, menu records, or approved-dish data to match a design.
- Future work could capture authorized design changes and reconcile the approved source/version history. **Automatic reconciliation is explicitly not a current priority.**

This may also occur at other customers; record it as a discovery question, not a verified industry-wide fact.

## Reuse for private-event menus / BEOs

The next application of the same PDF checker is the guest-facing private-event menu edited in Canva. Run applicable menu rules against the finished PDF to catch typos and other content issues even when there is no approved Word brief.

Keep two checks distinct:

- **PDF menu QA:** Does the guest-facing menu follow the applicable rules? This shares the first feature's engine.
- **BEO comparison:** Does the menu match the host's signed selections, substitutions, and declared dietary requests? This additionally requires the signed BEO or authoritative event data and separate comparison rules.

Do not claim that a PDF-only check verifies a booking agreement or establishes complete allergen safety. Private-event menus may also legitimately omit guest-facing prices; define their context before applying à la carte completeness rules.

Myca said sales staff edit centrally maintained Canva templates and that he saw nearly 400 menus in the tán private-event folder. That is a possible historical test collection, not a monthly/annual volume or a reviewed benchmark. He described the location as **Canva → Private Events → property subfolders**, not SharePoint. Myca's team does not routinely review these event menus; Megan Fightmaster is a relevant operational contact. No Canva access or file retrieval was performed for this scope update.

## Sales kits and other priorities

Myca described sales kits as mixed photo/text PDFs covering spaces, terms, event menus, and private-event offerings. The specific unresolved request was how to ask for a photo replacement when menu content changes. He described it as infrequent and suitable for an ad hoc process for now.

PDF annotations with an image replacement upload or image-library URL are a possible later feature. Sales-kit support is no longer second priority on the strength of the earlier discussion alone. Broader mixed-media review may still be useful to other customers, subject to discovery.

Priority order from this update:

1. External-property designed PDF → tenant menu-rule check → corrections/re-upload → corporate review.
2. Reuse PDF menu QA for private-event/Canva menus; separately scope signed-BEO verification.
3. Defer automatic Word/design reconciliation, full brand-manual review, and sales-kit image-change tooling.

Other previously discussed integration ideas remain discovery/backlog work; this call does not promote them ahead of PDF rule review. MakeReady outreach and the OpenTable project were mentioned separately, not added to this implementation scope.

## Acceptance evidence for implementation

- A PDF can be checked without a Word file, approved-menu ID, or existing ClickUp task.
- Representative external-property PDFs preserve columns, line wrapping, headings, dish/price/allergen relationships, and page references well enough to avoid layout-driven false positives.
- Deliberate spelling/diacritic and applicable completeness errors are surfaced in the original PDF even if the shared text pipeline proposes or internally applies a correction.
- A corrected re-upload clears the corresponding issue; an unchanged file or substituted unchecked file cannot inherit a clean submission state.
- Food, beverage, set-menu, and private-event context is tested without inventing missing prices or dietary facts.
- Unreadable/image-only/mixed pages and model failures explicitly report incomplete review instead of passing unseen content.
- A clean AI check queues human review and does not mark the menu approved, publish it, or overwrite a previous approved version.
- Focused automated tests and direct Docker/browser checks cover the check, re-upload, and submission paths. Review real findings with Isabella before claiming operational accuracy or time savings.
