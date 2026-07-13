# Fix Spec: Approved DOCX files don't survive production redeploys

Production incident, 7/13/26: `/download/approved-clean/145fe319-…` (Tán – Brunch Bebidas, approved 4:53 PM that day) returned "Approved file not found," followed by a full instance outage during the redeploy. Read `AGENTS.md` first for conventions and required verification.

> **Infrastructure reality (supersedes the Azure docs):** production is a single AWS **Lightsail** Ubuntu instance (us-east-1, static IP 3.231.96.95, ~2GB RAM) running all services via `docker-compose.yml` from `~/MenuManager`. `docs/azure-production-status-*.md` describes a planned/abandoned setup — do not follow it for storage or deploy work.

## Root cause (confirmed on the instance, 7/13/26)

Documents live under `DOCUMENT_STORAGE_ROOT` (default `tmp/documents` in the app dir; in containers `/app/tmp/documents`). Where `/app/tmp` actually points has drifted across deployment styles on the same host:

- The compose project mounts the named volume `menumanager_menumanager_tmp` → holds **all historical documents** (verified: aqimero, bayou-bottle, casa-chi, t-n-new-york, tamayo, etc.).
- A parallel dev-style deployment (`mm-*` containers from a shared `menumanager/dev:latest` image) ran with **different/no volume mounts** — documents written during its windows went to the container writable layer or orphaned volumes, and were destroyed when those containers were removed (this is how the 7/13 approvals' DOCX files were lost; ~12 orphaned anonymous volumes and a stale bare `menumanager_tmp` volume corroborate the drift).
- Named volumes are also one `docker compose down -v` / `--nuke` away from deletion.

Aggravating factor: the download routes (`/download/approved-clean/:submissionId` ~line 1569 and `/download/approved/:submissionId`, `services/dashboard/index.ts`; candidates resolved in `getApprovedMenuDownload`, `services/dashboard/lib/approved-menus.ts` ~line 261) try only local paths — no fallback to the SharePoint copy (`sharepoint_approved_docx` asset) or to the clean text/HTML now stored in Supabase.

Secondary incident cause, fix alongside: a full parallel `docker compose build` of 7 Node images on a 2GB burstable instance with no swap wedged the machine (CPU burst exhaustion + memory pressure; required stop/start to recover). Swap has since been added manually (`/swapfile`, 2G, in fstab) — keep it.

## Fix — three parts, in priority order

### 1. One durable storage location: host bind mount (config, tiny code surface)

- In `docker-compose.yml`, replace `menumanager_tmp:/app/tmp` with a host bind mount `./tmp:/app/tmp` on **every** service (and consider the same for logs). Documents then live at `~/MenuManager/tmp/documents` on the host: visible with plain `ls`, shared by all containers, immune to `down -v`, volume pruning, container recreation, and image rebuilds.
- One-time migration (performed/verified during the incident): stop the stack, `cp -a /var/lib/docker/volumes/menumanager_menumanager_tmp/_data/. ~/MenuManager/tmp/`, `chown -R ubuntu:ubuntu`, switch the mount, start. After a soak period, remove the stale `menumanager_tmp` bare volume and the orphaned anonymous volumes (`docker volume prune` once nothing references them).
- **Retire the dual deployment styles.** The `mm-*` / `menumanager/dev:latest` pattern must not run in production again — it is how files silently landed outside the real volume. Production = `docker compose` from `~/MenuManager`, full stop. Remove the orphaned `mm-notifier` container once compose runs the notifier service.
- Deploy procedure hardening (document in [operations-playbook.md](operations-playbook.md)): builds on this instance must be sequential (`docker compose build <svc> && docker compose up -d <svc>`, one at a time) — a full parallel build has taken the site down. Never use `down -v` in any deploy script. Keep swap enabled.
- Add a startup log line in each service stating the resolved document storage root, so a mount regression is visible in one log check.
- Docs: update [environment.md](environment.md) (~line 172 section) and [design-docs/document-storage.md](design-docs/document-storage.md) with the Lightsail/bind-mount guidance and a note deprecating the Azure doc's storage instructions.

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
- Production verification after the bind-mount switch: historical downloads work; approve a menu → `docker compose down && up -d` (no `-v`) → both downloads still work and the file is visible at `~/MenuManager/tmp/documents/...` on the host; startup logs on every service show the same storage root.

## Out of scope

- Recovering documents already lost from previous deploys beyond what SharePoint copies and stored HTML allow (the audit script quantifies exactly what's gone).
- The bold-drift investigation from the click-to-edit editor ([edit-menu-approved-html-fix-spec.md](edit-menu-approved-html-fix-spec.md) follow-up) — blocked on having a surviving approved DOCX to inspect; re-test after this lands.
- Moving document storage to Supabase Storage/blob storage wholesale (bigger change; Azure Files keeps the current path-based model working).
