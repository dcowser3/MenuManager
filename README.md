# Menu Manager

Menu Manager is an AI-powered service designed to automate the review process for menu design submissions. Chefs worldwide submit their menus via a web form, choose the property, menu type, and service period, and the system guides the submission through review and approval with AI-assisted corrections.

## Vision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHEF SUBMISSION                                   │
│  Chef → Web Form → Select Reviewer(s) → Upload Menu → Notification Sent     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MULTI-LEVEL APPROVAL                                │
│  Reviewer 1 Dashboard → Download → Review → Upload Corrections → Approve    │
│         ↓ (if needed)                                                       │
│  Reviewer 2 Dashboard → Final Review → Approve → ClickUp Task Created       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APPROVED DISHES DATABASE                            │
│  Extract dishes from approved menus → Store in searchable database          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

### Current (Phase 1)
- Web form for chef submissions
- Canonical property selection (type-to-search, value must match configured list)
- The dashboard includes a fallback property catalog so deployed forms can still search and validate properties if the DB property endpoint is temporarily unavailable
- DOCX template uploads can prefill project details and resolve split outlet/hotel/city hints to a canonical property when the match is unique
- Required service-period classification on submission (`breakfast`, `brunch`, `lunch`, `dinner`, `happy_hour`, `holiday`, `other`)
- AI-powered two-tier review (general QA + detailed corrections)
- Basic AI Check: if the model returns an objective spelling/grammar fix as an exact recommendation (e.g. `Change 'x' to 'y'`) but forgets to update the corrected menu text, or mislabels that fix as critical, the dashboard applies or recognizes the correction so green highlights and the persistent preview stay consistent without blocking submission. High-confidence raw-item asterisk suggestions are also applied before the line's allergen/price suffix.
- Learning/training dashboards stay off the public landing page; they are reachable by direct URL like other reviewer tools (no separate PIN step)
- Review highlights and persistent redlines surface punctuation/separator edits such as hyphen, comma, slash, and pipe changes
- Modification previews preserve bold/italic inline styling from uploaded prior approved DOCX baselines, including after live edits, by using the shared `diff-core` rich text range mapper.
- Submission normalization keeps exactly one managed allergen legend, while preserving chef-supplied legal/price/footer copy such as AED service-charge text and venue-specific foodborne warnings
- Modification previews exclude managed footer boilerplate from design-facing redlines while still preserving custom restaurant footer notes/raw warnings for generated DOCX output
- DOCX baseline uploads now prefill the allergen key field from either pipe-delimited legends or parenthesized legends such as `(C) CELERY (D) DAIRY`
- DOCX-extracted Date Needed values only override the turnaround-derived date when the extracted value is a valid `YYYY-MM-DD` date; invalid date text is ignored so the read-only field stays usable
- The default allergen legend is now `G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan`
- Approved-dish extraction now splits inline `Dish Name - description` menu rows into separate `dish_name` and `description` fields, captures trailing allergen codes, and skips the allergen legend / food-safety footer instead of storing them as dishes
- DOCX template validation and redlining
- Modification uploads with preserved redlines remain usable even if project metadata extraction cannot be parsed from the DOCX
- Public upload endpoints now enforce a 15 MB cap, validate file signatures, and sanitize stored rich-text/filename input before downstream processing; menu filenames preserve Unicode letters such as accented characters and tone marks
- Required-field validation now highlights missing submitter, project-details, and approval inputs directly in the form
- The submission form footer lists `dcowser@richardsandoval.com` as the support contact for help.
- Reviewer dashboard
- Notification system
- Approved dishes are extracted automatically when the ClickUp-reviewed DOCX is marked approved
- ClickUp tasks now include a browser approval link that opens a side-by-side approval editor: clean text editing on the left, live redline/highlight preview on the right, and final DOCX generation on submit
- Approved menus now appear in a dedicated dashboard so operations can download the finalized Word document only after Isabella approves it

### Planned (Phase 2)
- **Web Form Submission** - Chefs upload menus and select reviewers via web form
- **Multi-Level Approval** - Configurable approval chains with email notifications
- **ClickUp Integration** - Automatic task creation for reviewers and final handoff
- **Approved Dishes Database** - Searchable database of all approved dishes

## Project Architecture

This project is a **monorepo** using npm workspaces with independent microservices:

```
services/
├── ai-review/        # Two-tier AI review (QA + corrections)
├── clickup-integration/ # ClickUp API + webhook + corrections email
├── dashboard/        # Web interface for reviewers + submission form
├── db/               # Database service
├── diff-core/        # Shared tokenization + LCS diff helpers
├── differ/           # AI vs human comparison for training
├── docx-redliner/    # DOCX track changes
├── parser/           # DOCX validation and extraction
└── supabase-client/  # Shared Supabase database client
```

### Planned Services
```
services/
├── submission-form/      # Public chef submission form
├── workflow-engine/      # Multi-level approval orchestration
├── clickup-integration/  # ClickUp API integration
└── approved-dishes/      # Dish extraction & database
```

## The Review Workflow

1. **Submission** - Chef uploads menu via web form, selects property from the configured catalog, and sets menu type plus service period
2. **Template Validation** - System validates `.docx` structure
3. **Tier 1 AI Review** - High-level QA check (spelling, grammar, clarity)
4. **Decision Point** - If issues found, chef is notified to resubmit
5. **Tier 2 AI Review** - Detailed corrections based on SOP rules
6. **Human Review** - Reviewer downloads, reviews, uploads corrections
7. **Multi-Level Approval** - Additional reviewers if required
8. **ClickUp Integration** - Submission creates a ClickUp task and final approval writes the approved DOCX back into Menu Manager for downstream delivery and download
9. **Dishes Database** - Approved dishes extracted from the approved menu text and stored

Current ClickUp BAU status handoff:
- New tasks start in `Pending Initial ISA Review`
- New tasks are assigned through `CLICKUP_ASSIGNEE_ID` (Isabella in production) and add Marketing group members as watchers when the ClickUp group lookup is configured
- Isabella uploads the corrected DOCX in ClickUp and moves the task to `To Do`; that status change downloads the latest DOCX and feeds the learning dashboard
- When the approved DOCX is processed from any other configured review-complete status, the task is moved to `To Do`; if it is already in `To Do`, the status update is skipped
- Task due date is taken from the form "Date needed" using noon UTC on that calendar day so ClickUp does not display it one day early in US timezones (plain `YYYY-MM-DD` parsing used to mean UTC midnight)
- If ClickUp task creation or attachment upload fails after the menu is saved, the submitter warning includes the submission reference so support can match the screenshot to logs, `system_alerts`, and the generated DOCX.
- Pending submissions that saved successfully but have no `clickup_task_id` can be retried from the review page; retry metadata is kept in `raw_payload.clickup_handoff`.

Browser approval editor prototype:
- ClickUp tasks now include an approval link to `/approval/:submissionId`
- When the dashboard form is submitted from `localhost` outside production, ClickUp task creation is skipped, the browser automatically downloads the generated original DOCX, and the success alert shows an `Open approval editor` link for that same submission
- Isabella can edit approved text in a left-side browser editor while a right-side panel shows the live tracked-change preview with preserved imported redlines/highlights
- For submitted DOCX files that already contain redlines, the left editor uses the clean accepted text with deleted runs removed, while the preview keeps the imported deletion/insertion markup visible.
- The browser approval preview and the backend differ service use shared `diff-core` tokenization/LCS helpers so punctuation, separator, and word alignment rules are reused instead of duplicated per page/service.
- The live approval preview keeps adjacent imported deletion/insertion pairs separated after new edits, so corrections like `jalapeno` → `jalapeño` or `neapolitan` → `Neapolitan` do not get re-styled as one combined deleted token when another word is removed.
- Uploaded unapproved/redlined DOCX modifications now receive a full AI check on the accepted visible menu text, so pre-existing tracked edits such as misspelled inserted words are reviewed even if the chef makes no additional browser edits.
- Re-running AI Check reuses the normalized editor text extractor so repeated checks do not add browser-generated blank lines between menu rows.
- Modification flows keep footer/legal copy out of the persistent redline preview, but submit it as structured preserved footer text so restaurant-specific notes and raw-food warnings are retained instead of replaced by the default notice.
- Form submission now persists uploaded approved-baseline modifications before triggering the full Tier 2 AI review asynchronously, reducing gateway timeouts on slow AI review calls; non-JSON proxy errors also show a readable submit error instead of raw HTML parsing text.
- The modification `Find in Database` picker searches approved baselines only; submitted ClickUp tasks appear there after the approved DOCX is processed, and DB/search failures now show as search failures instead of empty results.
- The approval editor and `Download Original DOCX` resolve the **submitted** generated DOCX (`original_path`) first so on-screen text matches the file from the form; the modification baseline DOCX is used only when that path is missing, then `final_path`, then saved text/HTML fallback
- On modification flows, baseline extraction mode (`uploaded_baseline` vs `uploaded_unapproved`) still applies when the baseline path is the one that loads
- The approval editor preserves leading indentation from extracted DOCX text so alignment-sensitive sections such as allergen keys do not get flattened before review, trims leading empty HTML paragraphs in the preview so it lines up with the textarea before the first edit, and keeps bold/italic (and other inline markup from the DOCX) in the live redline preview after you type by cloning ranges from the baseline HTML
- Submitting that page uploads the approved DOCX back to the linked ClickUp task and only then leaves/advances the task at `To Do`, matching Isabella's manual handoff flow
- The dashboard now surfaces a warning when the ClickUp attachment upload or post-approval status move fails, instead of silently finalizing only on the local side
- Once a menu reaches approved state, the final DOCX is downloadable from `/approved-menus` for Carlos or other operations users
- The learning dashboard lets reviewers delete an individual learned submission row when test data should not remain in the training history; this removes that submission from differ training data and rebuilds detected patterns without touching the property catalog.

Design approval entry point:
- The DOCX-vs-PDF design approval tool remains in the codebase, but the welcome-page card is currently disabled and labeled `Feature Coming Soon`.

## Property Catalog

- The form property field is now restricted to a canonical list managed by the DB service.
- Submitters can type to search, but the selected value must match an allowed property.
- The old separate free-text location field is removed; location metadata is derived from the selected property.
- The form-side `Hotel Name` input is currently removed from chef entry flow.
- Learning dashboards reuse the same property list for location-specific rule assignment and filtering.
- Properties can also store SharePoint routing metadata:
  - base SharePoint folder path
  - resolved drive/library metadata
  - property-specific menu subfolders
- When a property has SharePoint folder metadata, the form `Service Period` dropdown is populated from that property’s stored folder names instead of the global default list.
- `Other` is always included in the `Service Period` dropdown so users can intentionally route the approved file to the property base folder when no subfolder applies.
- Approved menus can now be pushed to SharePoint after ClickUp approval using the property’s configured base folder and subfolder mapping.
- Generated and SharePoint-uploaded menu DOCX files are named `Restaurant_ServicePeriod_M.D.YY.docx`, for example `Aqimero_Breakfast_11.6.23.docx`, using the restaurant/outlet name from the selected property and the submission `date_needed` value.
- Before uploading into a matched SharePoint service subfolder, the service archives existing `.docx` files from that subfolder into its `old/` folder. Existing `.pdf` and `.ai` files are left in place.
- Seeded examples now include `Aqimero - Ritz-Carlton - Philadelphia`, `Maya - New York`, `Tamayo - Denver`, `Toro - Hotel Clio - Denver`, `Toro - Fairmont Millennium Park - Chicago`, `Toro - Dania Beach`, and `Toro - Viceroy - Snowmass`.

## Local Approved-Dish Testing

You can test approved-dish extraction directly against Supabase without replaying a full ClickUp webhook:

```bash
npm run test:approved-dishes -- --legacy-id form-1771781530178
npm run test:approved-dishes -- --legacy-id form-1771781530178 --write
```

Notes:
- `--id <uuid>` also works if you want to target the Supabase submission UUID directly.
- `--approved-only` forces the test to use only `approved_menu_content`; without it the script falls back to `menu_content`, matching the DB extraction endpoint behavior.
- The preview now shows `dish_name` and `description` separately when the menu uses inline rows like `Guacamole - avocado / lime / cilantro 12` or comma-delimited rows like `Punta Mita, prawns, tomato, onion C,F 95`.
- `--write` inserts rows into `approved_dishes` for that submission, so use a test submission when possible.

## Getting Started

### Prerequisites

- Node.js v18+
- npm v7+ (for workspace support)
- Docker Desktop
- SMTP server credentials
- OpenAI API key
- Supabase project (free tier)

### Quick Start

1. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

2. **Start the Docker dev stack:**
   ```bash
   ./dev-up.sh -d
   ```

3. **Open the dashboard:**
   ```bash
   open http://localhost:3005
   ```

Docker dev mode is the default local workflow. It runs the TypeScript services with `ts-node-dev`, keeps `node_modules` and the DOCX redliner Python venv inside the image, and bind-mounts source files for hot reload.

### Environment Variables

Create a `.env` file with:

```
# Email sending (SMTP)
SMTP_HOST=
SMTP_USER=
SMTP_PASS=

# AI Review
OPENAI_API_KEY=
AI_REVIEW_MODEL=gpt-4o-mini

# Service URLs (override in cloud deployments)
DB_SERVICE_URL=http://localhost:3004
AI_REVIEW_URL=http://localhost:3002
DIFFER_SERVICE_URL=http://localhost:3006
CLICKUP_SERVICE_URL=http://localhost:3007
INTERNAL_API_TOKEN=replace-with-a-long-random-secret

# ClickUp workflow statuses
CLICKUP_INITIAL_REVIEW_STATUS=pending initial isa review
CLICKUP_CORRECTIONS_STATUS=to do
CLICKUP_POST_APPROVAL_STATUS=to do

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Running Services

Use Docker for day-to-day local development:

```bash
./dev-up.sh                # Build if needed, start all services, follow logs
./dev-up.sh -d             # Start all services detached
./dev-up.sh dashboard      # Start dashboard and its compose dependencies
./dev-up.sh --down         # Stop containers
./dev-up.sh --rebuild      # Rebuild image after dependency/shared-lib changes
./dev-up.sh --reset-venv   # Rebuild the image to refresh docx-redliner's Python venv
./dev-up.sh --nuke         # Stop and remove containers plus anonymous volumes
```

Basic smoke checks:

```bash
curl -i http://localhost:3005/
curl -i http://localhost:3005/form
curl -i http://localhost:3007/health

TOKEN=$(grep ^INTERNAL_API_TOKEN .env | cut -d= -f2)
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3004/properties
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3006/stats
```

Internal service routes intentionally return `401` when called directly without `x-menumanager-internal-token`. That does not block normal dashboard testing; browser requests go to the dashboard, and service-to-service calls attach the shared token from `.env`.

Local form submissions from `http://localhost:3005/form` include a developer-only testing shortcut: after a successful submit, ClickUp task creation is skipped, the generated DOCX downloads automatically, and the success alert links to `/approval/<submissionId>` for the same record. This shortcut is disabled when `NODE_ENV=production` or when the request host is not localhost.

Native mode is available when you specifically do not want Docker, but it is no longer the preferred default:

```bash
npm install
npm run build --workspaces
npm start --workspace=@menumanager/dashboard   # Dashboard + Form at http://localhost:3005
npm start --workspace=@menumanager/parser      # Template validation
npm start --workspace=@menumanager/ai-review   # AI review
npm start --workspace=@menumanager/clickup-integration # ClickUp + notifications
npm start --workspace=@menumanager/db          # Database
```

Or use the helper scripts:
```bash
./start-services.sh   # Native-mode start for all services
./stop-services.sh    # Stop all services
./verify-setup.sh     # Verify configuration
```

Developer workflow notes:

- [docs/feature-delivery-workflow.md](docs/feature-delivery-workflow.md) explains the required build, test, live-verification, `dist/`, and restart process for feature work.
- [docs/local-dev-troubleshooting.md](docs/local-dev-troubleshooting.md) covers common startup failures, bad local state, and reset steps.

Additional notes:

- Docker Desktop on macOS can be unreliable when bind-mounting repos from TCC-protected folders such as `~/Documents`, `~/Desktop`, or `~/Downloads`. If services fail with `Resource deadlock avoided`, grant Docker access to the folder, switch Docker Desktop's file-sharing implementation, or move the repo to a non-protected path such as `~/code/MenuManager`.
- In native mode, `start-services.sh` runs a full workspace build by default before starting services so latest TypeScript/EJS changes are always reflected.
- To skip the native build step (faster restart when nothing changed), run: `SKIP_BUILD=1 ./start-services.sh`
- Set the same `INTERNAL_API_TOKEN` for every service process. Internal API calls now fail closed if this token is missing or mismatched.

## Implementation Roadmap

| Phase | Task | Status |
|-------|------|--------|
| 1 | Set up PostgreSQL database schema (Supabase) | Pending |
| 2 | Build chef submission form with reviewer selection | Pending |
| 3 | Enhance reviewer dashboard (download/upload/approve) | Pending |
| 4 | Implement multi-level approval workflow (Inngest) | Pending |
| 5 | Add email notifications at each step (Resend) | Pending |
| 6 | Build approved dishes extraction & database | Complete |
| 7 | ClickUp integration for task creation | Complete |
| 8 | Deploy to production (Railway) | Pending |
| 9 | Add authentication & roles (Clerk) | Pending |

## Estimated Infrastructure Costs

**Starter Tier** (< 100 submissions/month): **~$5/month**

| Service | Provider | Cost |
|---------|----------|------|
| Hosting | Railway | $5/mo |
| Database | Supabase | Free |
| Auth | Clerk | Free |
| Email | Resend | Free |
| Workflows | Inngest | Free |
| ClickUp | API | Free (existing subscription) |

## Documentation

- `CLAUDE.md` — Project map and agent conventions (~66 lines)
- `docs/` — Detailed documentation (architecture, design decisions, environment, roadmap)
- `docs/design-docs/` — Feature design documents (ClickUp, critical errors, autofill, etc.)
- `docs/aws-deployment.md` — AWS deployment guide (EC2 + Docker Compose, ECS notes)
- `archive/` — Historical documentation from Phase 1

## Running Tests

```bash
npm test
```
