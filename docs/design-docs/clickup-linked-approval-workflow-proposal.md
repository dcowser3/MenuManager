# ClickUp-Linked Approval Workflow Proposal

## Status

Local prototype implemented for testing. Not yet positioned as the only production approval flow.

## Current BAU Flow

1. A submission generates a DOCX and creates a ClickUp task.
2. The reviewer edits the DOCX offline.
3. The reviewer reuploads the DOCX and changes the ClickUp task status.
4. The webhook downloads the approved DOCX, stores it locally, uploads it to SharePoint, and continues the downstream approval pipeline.

## Implemented Prototype Flow

Goal: keep the existing DOCX output and ClickUp handoff, but let the reviewer make approval-stage edits directly in Menu Manager.

1. The ClickUp task includes a link back to a Menu Manager approval page for that submission.
2. The reviewer opens the page and edits the menu content directly on-site.
3. The page uses the same stable pattern as the existing modification flow: editable clean text on the left and a live tracked-change preview on the right.
4. No AI check runs in this approval-stage editor.
5. When the reviewer submits:
   - the submission is finalized in Menu Manager
   - a DOCX is generated from the submitted approval content
   - the DOCX is uploaded back to the ClickUp task
   - the DOCX is uploaded to the mapped SharePoint location
   - the ClickUp task is moved to the next BAU stage

Current route shape:

- approval page: `GET /approval/:submissionId`
- browser submit endpoint: `POST /api/approval/:submissionId/submit`
- downstream finalization endpoint: `POST /approval/finalize` on `clickup-integration`

## Why This Fits The Current Codebase

- The dashboard already supports browser-based editing and persistent redline rendering in the modification flow.
- The approval editor now reuses the same shared redline-preview engine and approval-baseline loading strategy instead of maintaining a separate copy of that logic.
- The ClickUp integration already supports:
  - task creation
  - attachment upload
  - status-driven webhook processing
  - SharePoint upload of approved DOCX files
- The design-approval flow already proves that a non-AI review path can live alongside the standard submission workflow.

## Recommended Local Test Shape

Build this as an optional approval mode, not a replacement for the current Word-doc reupload workflow.

Recommended test constraints:

1. Hide it behind a local/dev-only flag or explicit route.
2. Reuse existing submission records instead of introducing a new storage model first.
3. Generate the final DOCX only on submit, not continuously while typing.
4. Keep the current webhook-based BAU flow working unchanged for users who still want the Word-doc path.
5. Compare both modes against the same downstream outputs:
   - final DOCX content
   - ClickUp attachment behavior
   - SharePoint upload behavior
   - status transitions

## Open Design Decisions

1. Link format:
   - direct signed link to a submission approval route
   - or normal route plus lightweight access control token
2. Redline presentation:
   - inline in the editor only
   - or inline plus a generated "clean view" toggle
3. Finalization trigger:
   - submit directly moves the task
   - or submit stores draft approval changes and requires a separate confirm action
4. Dual-mode UX:
   - per submission choice at creation time
   - or a reviewer choice inside the ClickUp task

## Still Out Of Scope

- Replacement of the current Word-doc approval path for every reviewer
