# Fix Spec: Approved DOCX files don't survive production redeploys

Production incident, 7/13/26: `/download/approved-clean/145fe319-…` (Tán – Brunch Bebidas, approved 4:53 PM that day) returns "Approved file not found." The file existed at approval time — the finalization HTML extraction ran against it successfully — and disappeared after the same-day redeploy. Read `AGENTS.md` first for conventions and required verification.

## Root cause

Approved DOCX files (and originals, AI drafts, baselines) are written to local disk under `DOCUMENT_STORAGE_ROOT`, which defaults to `tmp/documents` **inside the repo/app directory** (`services/dashboard/index.ts` ~line 495, `services/clickup-integration/index.ts` ~line 189). On Azure App Service, the deployed app directory is replaced on every deploy, so every production deploy silently deletes all documents written since the storage was last provisioned. Supabase rows survive and keep pointing at dead paths (`final_path`, `assets.storage_path`).

Two aggravating factors:

1. **Cross-app filesystems.** Production runs services as separate web apps on one App Service plan (see [azure-production-status-and-pricing-2026-02-25.md](azure-production-status-and-pricing-2026-02-25.md)). Services exchange *file paths* over internal APIs (e.g., differ `/compare` receives `ai_draft_path`/`final_path`; clickup-integration reads the approved DOCX the dashboard generated in browser approval). Separate web apps have separate filesystems — path handoff only works if all file-touching services mount the **same** storage. Any current behavior that appears to work across apps is accidental.
2. **No fallback.** The download routes (`/download/approved-clean/:submissionId` ~line 1569 and `/download/approved/:submissionId`, `services/dashboard/index.ts`; path candidates resolved in `getApprovedMenuDownload`, `services/dashboard/lib/approved-menus.ts` ~line 261) try only local paths, even though a SharePoint copy (`sharepoint_approved_docx` asset) and, as of the click-to-edit HTML fix, clean text + HTML in Supabase often exist.

## Fix — three parts, in priority order

### 1. Persistent shared document storage (config + deploy, small code surface)

- Provision an **Azure Files share** and mount it at the same path (e.g., `/mnt/menumanager-documents`) on **every** web app that touches documents: dashboard, clickup-integration, differ, parser (audit each service for `DOCUMENT_STORAGE_ROOT` / `getRepoRoot()`-relative file writes before assuming this list is complete). Set `DOCUMENT_STORAGE_ROOT=/mnt/menumanager-documents` on each app. `/home` alone is NOT sufficient: it persists across deploys but is per-app, which breaks the cross-app path handoff.
- Code: verify every document read/write actually flows through the storage-root helper rather than hardcoded `tmp/documents` (grep for `tmp/documents`, `tmp/uploads` in non-temp contexts). Temp/scratch dirs (`tmp/uploads`, redliner temp) can stay app-local — only artifacts whose *paths are persisted to the DB or passed between services* must live under the shared root.
- Add a startup log line in each service stating the resolved document storage root, so a misconfigured app is visible in one log check.
- Docs: update [environment.md](environment.md) (line ~172 section) and [design-docs/document-storage.md](design-docs/document-storage.md) with the App Service guidance; add a post-deploy smoke step to [operations-playbook.md](operations-playbook.md): approve (or use a seeded approved record) → redeploy → download must still work.

### 2. Download fallback chain (dashboard)

For both approved-download routes, when no local candidate path resolves, fall back in order:

1. **SharePoint copy.** The `sharepoint_approved_docx` asset row carries `storage_path`, `meta.drive_id`, etc. Graph credentials live in clickup-integration (upload already uses `PUT /drives/{driveId}/root:/{path}:/content`, `services/clickup-integration/index.ts` ~line 1278). Add an internal clickup-integration endpoint `GET /sharepoint/file?submissionId=…` that streams the file via the corresponding Graph `GET …:/content` (internal-auth protected, like the rest); the dashboard proxies it. Do not copy Graph credentials into the dashboard.
2. **Regenerate (clean download only).** If SharePoint has nothing but `approved_menu_content_html` (or `approved_menu_content`) exists, regenerate a clean DOCX via the existing `generateDocxFromForm` path with the stored HTML/text and the submission's template metadata — same inputs the browser-approval path uses. Label is already "Clean Word Doc," and content-wise this is identical data. `Download Original Approved` must NOT be regenerated (it means the reviewer's actual file); if it's unrecoverable, return a specific message ("Original file no longer available; a SharePoint copy was not found") rather than the generic 404.
3. Optionally re-materialize the fetched/regenerated file into the (now persistent) storage root so the fallback is one-time per record.

### 3. Audit + recovery script

`scripts/audit-approved-documents.js`: for every approved submission, check whether `final_path` / `approved_docx` asset paths exist on disk (run on the production host or against the mounted share); report per-record status (local OK / SharePoint copy exists / regenerable from stored HTML / unrecoverable) and totals. Optional `--restore` flag: for records with a SharePoint copy, download into the persistent root and update `assets.storage_path`. Follows the backfill script's conventions (Supabase + local JSON fallback, per-record failures skipped and reported).

## Tests / verification (per AGENTS.md)

- Unit: fallback-chain ordering in the download handlers (local hit short-circuits; SharePoint tried next; regenerate only for the clean route; original route returns the specific unrecoverable message); storage-root helper honored everywhere the audit touched.
- Integration/live (Docker): set `DOCUMENT_STORAGE_ROOT` to a bind-mounted dir, approve a seeded submission, delete the local file, hit `/download/approved-clean/:id` → regenerated (or SharePoint-served if configured) DOCX downloads; `/download/approved/:id` → specific message.
- Production verification after the Azure Files mount: approve a menu → trigger a redeploy → both downloads still work; startup logs on every app show the shared root.

## Out of scope

- Recovering documents already lost from previous deploys beyond what SharePoint copies and stored HTML allow (the audit script quantifies exactly what's gone).
- The bold-drift investigation from the click-to-edit editor ([edit-menu-approved-html-fix-spec.md](edit-menu-approved-html-fix-spec.md) follow-up) — blocked on having a surviving approved DOCX to inspect; re-test after this lands.
- Moving document storage to Supabase Storage/blob storage wholesale (bigger change; Azure Files keeps the current path-based model working).
