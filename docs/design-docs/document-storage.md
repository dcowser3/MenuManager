# Document Storage

**Status:** Implemented (Local/Persistent Volume) with SharePoint routing for approved DOCX when property metadata is configured

## Current Behavior

Generated and reviewed DOCX files are now stored under an environment-driven root:

- `DOCUMENT_STORAGE_ROOT` (recommended in deployment)
- fallback: `tmp/documents` (repo-local for development)

Path layout:

`{DOCUMENT_STORAGE_ROOT}/{property}/{project}/{submissionId}/`

Subfolders:

- `original/` — DOCX generated from chef form submission
- `baseline/` — uploaded approved baseline DOCX in revision fallback flow
- `approved/` — corrected/approved DOCX downloaded from ClickUp webhook

Approved form submissions are exposed in the dashboard’s `/approved-menus` page so chefs can search by restaurant, optionally filter by service period, and download either the cleaned editable DOCX (redlines and highlights removed) or the original approved file. The original approved DOCX remains the source artifact and is served from `/download/approved/:submissionId`; `/download/approved-clean/:submissionId` creates a temporary accepted copy with redlines and highlights removed at download time. The cleaner preserves normal text when a DOCX includes an explicitly disabled strike setting (`w:strike w:val="0"`), while still removing text that is visibly struck through.

The dashboard download route also normalizes stored container-style paths such as `/app/tmp/...` back into the configured document root when possible. If the local artifact is absent, it uses the approved SharePoint copy when available; the clean-download route can additionally regenerate from stored approved HTML/text.

## SharePoint Routing

Approved DOCX files can also be uploaded to SharePoint after ClickUp approval when the selected property has stored routing metadata.

- The local `approved/` copy remains the canonical on-disk artifact used by the rest of the workflow.
- SharePoint upload is an additional delivery step for the approved menu.
- Routing uses the property base folder plus an optional matched service subfolder.
- Routing is compatible with Microsoft Graph `Sites.Selected`; after sync stores a property `sharepoint_drive_id`, the upload step uses that drive directly.
- Generated and SharePoint-uploaded DOCX files use `Restaurant_ServicePeriod_M.D.YY.docx`, for example `Aqimero_Breakfast_11.6.23.docx`.
- When routing into a matched service subfolder, older `.docx` files are moved into `old/` before the new DOCX is uploaded.
- Existing `.pdf` and `.ai` files remain in the active folder.
- If the subfolder match is stale or missing, the upload falls back to the property base folder.

## Metadata Tracking

File metadata is recorded via DB `assets` records, including:

- `submission_id`
- `asset_type`
- `storage_provider` (currently `local`)
- `storage_path`
- `file_name`
- optional `meta`

## Deployment Guidance

For cloud deploy, point `DOCUMENT_STORAGE_ROOT` to a persistent **shared** mounted volume/path.

Without persistent storage, files on ephemeral disks may be lost on restart/redeploy. For Azure App Service, `/home` persists per app but is not shared across separately deployed web apps, so it does not satisfy the path handoff between dashboard, ClickUp integration, AI review, parser, and differ. Mount the same Azure Files share at the same path (for example `/mnt/menumanager-documents`) on every one of those apps and set the same `DOCUMENT_STORAGE_ROOT` value.

The dashboard logs the resolved fallback source in this order: local shared artifact, SharePoint-approved DOCX (retrieved through the internally authenticated ClickUp integration proxy), then stored approved HTML/text for the **Clean Word Doc** only. `Download Original Approved` is never regenerated; it returns a specific unavailable message if neither local shared storage nor SharePoint has the reviewer-original artifact. A recovered SharePoint file is re-materialized to the shared root and its `final_path` is updated for subsequent downloads.

Storage-root diagnostics are kept in deployment documentation and logs, not rendered on the Learning Rules dashboard, so rule-review users do not see container-local paths such as `/app/tmp/documents` during normal operation.

### Cloud Deployment Checklist (Required)

1. Provision one shared Azure Files disk/volume for all document artifacts.
2. Mount it at the identical absolute path on dashboard, clickup-integration, ai-review, parser, and differ.
3. Set `DOCUMENT_STORAGE_ROOT` to that mounted path on each app.
4. Verify write/read permissions for dashboard, ai-review, clickup-integration, parser, and differ.
5. Submit one test menu and confirm:
   - `original/` DOCX is created
   - `baseline/` DOCX is saved for revision-upload flow (if used)
   - `approved/` DOCX is saved after ClickUp webhook correction
6. Confirm `assets.storage_path` rows point to mounted-volume paths.
7. Redeploy/restart and verify files remain available from both approved download routes.

## Planned Next Step

Broaden the property-level SharePoint routing metadata beyond Tamayo and keep the folder-sync script as the operational way to refresh folder lists when property structures change.
