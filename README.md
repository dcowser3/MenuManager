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
- Required service-period classification on submission (`breakfast`, `brunch`, `lunch`, `dinner`, `happy_hour`, `holiday`, `other`)
- AI-powered two-tier review (general QA + detailed corrections)
- Review highlights and persistent redlines surface punctuation/separator edits such as hyphen, comma, slash, and pipe changes
- Submission normalization keeps exactly one managed allergen legend and foodborne warning footer: chef-supplied footer text is reused or corrected to the canonical wording instead of being duplicated
- Approved-dish extraction now splits inline `Dish Name - description` menu rows into separate `dish_name` and `description` fields, captures trailing allergen codes, and skips the allergen legend / food-safety footer instead of storing them as dishes
- DOCX template validation and redlining
- Modification uploads with preserved redlines remain usable even if project metadata extraction cannot be parsed from the DOCX
- Required-field validation now highlights missing submitter, project-details, and approval inputs directly in the form
- Reviewer dashboard
- Notification system
- Approved dishes are extracted automatically when the ClickUp-reviewed DOCX is marked approved

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
8. **ClickUp Integration** - Submission creates a ClickUp task and final approval webhook pulls the corrected DOCX back in
9. **Dishes Database** - Approved dishes extracted from the approved menu text and stored

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
- SharePoint uploads now standardize approved DOCX names as `Property_ServicePeriod_M.D.YY.docx` using the submission `date_needed` value when available.
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
- The preview now shows `dish_name` and `description` separately when the menu uses inline rows like `Guacamole - avocado / lime / cilantro 12`.
- `--write` inserts rows into `approved_dishes` for that submission, so use a test submission when possible.

## Getting Started

### Prerequisites

- Node.js v18+
- npm v7+ (for workspace support)
- SMTP server credentials
- OpenAI API key
- Supabase project (free tier)

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Build all services:**
   ```bash
   npm run build --workspaces
   ```

4. **Start services:**
   ```bash
   ./start-services.sh
   ```

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

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Running Services

Start individual services:

```bash
npm start --workspace=@menumanager/dashboard   # Dashboard + Form at http://localhost:3005
npm start --workspace=@menumanager/parser      # Template validation
npm start --workspace=@menumanager/ai-review   # AI review
npm start --workspace=@menumanager/clickup-integration # ClickUp + notifications
npm start --workspace=@menumanager/db          # Database
```

Or use the helper scripts:
```bash
./start-services.sh   # Start all services
./stop-services.sh    # Stop all services
./verify-setup.sh     # Verify configuration
```

Notes:
- `start-services.sh` now runs a full workspace build by default before starting services so latest TypeScript/EJS changes are always reflected.
- To skip the build step (faster restart when nothing changed), run: `SKIP_BUILD=1 ./start-services.sh`

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
