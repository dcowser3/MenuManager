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

Approved form submissions are exposed in the dashboard’s `/approved-menus` page so operations users can download the final DOCX only after the approval flow has written the `approved/` artifact.

The dashboard download route now also normalizes stored container-style paths such as `/app/tmp/...` back into the repo-local `tmp/` tree when possible, and returns a clean `404` when the approved file metadata exists but the local artifact is no longer present on disk.

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

For cloud deploy, point `DOCUMENT_STORAGE_ROOT` to a persistent mounted volume/path.

Without persistent storage, files on ephemeral disks may be lost on restart/redeploy.

### Cloud Deployment Checklist (Required)

1. Provision persistent disk/volume for the app service.
2. Mount it into the runtime container/instance.
3. Set `DOCUMENT_STORAGE_ROOT` to that mounted path.
4. Verify write/read permissions for dashboard, ai-review, clickup-integration, notifier.
5. Submit one test menu and confirm:
   - `original/` DOCX is created
   - `baseline/` DOCX is saved for revision-upload flow (if used)
   - `approved/` DOCX is saved after ClickUp webhook correction
6. Confirm `assets.storage_path` rows point to mounted-volume paths.
7. Redeploy/restart and verify files remain available.

## Planned Next Step

Broaden the property-level SharePoint routing metadata beyond Tamayo and keep the folder-sync script as the operational way to refresh folder lists when property structures change.
