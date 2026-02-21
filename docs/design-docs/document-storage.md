# Document Storage

**Status:** Implemented (Local/Persistent Volume), Teams integration pending

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

Replace `storage_provider: local` with a Teams/SharePoint-backed provider, while preserving the same metadata contract in `assets` so the rest of the workflow does not change.
