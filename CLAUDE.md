# Menu Manager - Project Context

> This file provides context for AI assistants working on this project.

## Project Overview

Menu Manager is an AI-powered service for automating the review process for menu design submissions from chefs worldwide. The system validates menus against templates, uses AI to review content, and manages a multi-level human approval workflow.

## Current Status

The project uses a **web-based form submission system** with AI-assisted review and multi-level approval workflow.

### What Exists (Phase 1 - Complete)
- Monorepo architecture with microservices in `services/`
- Web form for chef submissions with required approval attestations
- AI-powered two-tier review (general QA + detailed corrections)
- Reviewer dashboard
- DOCX parsing and redlining capabilities
- Notification system via SMTP
- Supabase database (PostgreSQL)

### Required Approval System (Complete)
Submitters must attest that the menu has been reviewed and approved before submission:
- Select Yes/No for approval status
- Enter approver's first and last name
- Enter approver's position
- Option to add an additional approver if needed

The form displays hint text suggesting appropriate approver roles based on menu type:
- **Food menus:** Property GM, Director of F&B, Executive Chef, Chef de Cuisine
- **Beverage menus:** Head of Mixology, Bar Director, Regional Director of Operations

Submission cannot proceed unless the approval is marked "Yes."

Note: This is an attestation-based system. We do NOT maintain a database of managers/positions. Submitters self-report who approved the menu.

### What We're Building (Phase 2 - Planned)
- ClickUp integration for task management
- Approved dishes database (running list of all approved dishes)
- Email notifications at each workflow step
- Role-based access (chef, reviewer, admin)

### Critical Error Blocking (Complete)
The AI review now enforces "hard stops" for critical issues that block submission:

**How it works:**
- Each AI suggestion has a `severity` field (`"critical"` or `"normal"`), independent of `confidence`
- Two critical error types are currently enforced:
  - **Missing Price** — Every dish on a standard menu must have a price. Flagged as critical.
  - **Incomplete Dish Name** — Every menu entry must have a recognizable dish name. Flagged as critical.
- Prix fixe menus are exempt from missing price errors (individual dishes don't need prices)

**User flow:**
- Critical errors appear as red cards with a "CRITICAL" badge in the suggestions panel
- The submit button is disabled with a banner: "Resolve or override all critical errors before submitting"
- Users can fix the issue (Edit → modify text → Re-run AI Check) or override it ("Override — AI May Be Wrong")
- Override data is included in the submission payload (`criticalOverrides`) for audit trail

**Architecture:**
- `severity` is set by the AI prompt (`sop-processor/qa_prompt.txt`)
- Backend (`services/dashboard/index.ts`) normalizes severity as a safety net — defaults missing severity to `"normal"`, forces known critical types to `"critical"`, and uses fallback regex detection
- Frontend (`services/dashboard/views/form.ejs`) sorts critical suggestions first, manages override state, and gates the submit button

### Submitter Autofill & Recent Projects (Complete)
Returning users can quickly fill forms using saved profiles and past project data:

**Submitter Autocomplete** (both `/form` and `/design-approval`):
- Type 2+ characters in the "Your Name" field to see matching profiles
- Selecting a profile auto-fills name, email, and job title (fields remain editable)
- Profiles are saved automatically on each form submission (fire-and-forget)
- Keyboard navigation: ArrowUp/Down to highlight, Enter to select, Escape to dismiss

**Recent Project Loader** (`/form` only):
- "Load from Recent" dropdown appears in Project Details card when past projects exist
- Populates all project fields except Date Needed (always fresh per submission)
- Groups submissions by project name, shows most recent of each

**Architecture:**
- DB service (`services/db/index.ts`) stores profiles in `/tmp/db/submitter_profiles.json`, keyed by normalized name
- DB service has `GET /submitter-profiles/search?q=`, `POST /submitter-profiles` (upsert), `GET /submissions/recent-projects`
- Dashboard (`services/dashboard/index.ts`) proxies via `GET /api/submitter-profiles/search` and `GET /api/recent-projects`
- Profile save triggered in both `POST /api/form/submit` and `POST /api/design-approval/compare`
- Supabase schema includes `submitter_profiles` table for future migration

**Important DB fix included:** `POST /submissions` now spreads `req.body` instead of only persisting 3 fields. All form data (project_name, property, submitter_name, etc.) is now stored correctly.

### Future Enhancements (Phase 3 - Planned)
- **Extended menu content validation**: Additional critical error types beyond prices and dish names (e.g., missing allergen codes). The severity/blocking infrastructure is already in place.

## Architecture

```
services/
├── ai-review/        # Two-tier AI review (QA + corrections)
├── dashboard/        # Web interface + submission form (Express + EJS)
├── db/               # Database service (JSON-based, migrating to Supabase) + submitter profiles
├── differ/           # Compares AI draft vs human-approved for training
├── docx-redliner/    # DOCX redlining/track changes
├── notifier/         # Email notifications (SMTP)
├── parser/           # DOCX validation and text extraction
└── supabase-client/  # Shared Supabase database client
```

## Tech Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Backend:** Express.js microservices
- **Templating:** EJS (dashboard)
- **Database:** Supabase (PostgreSQL)
- **Email:** SMTP (outbound notifications)
- **AI:** OpenAI API
- **File Processing:** Mammoth (DOCX parsing)

## Planned Services & Costs (Starter Tier)

Target: < 100 submissions/month (~$5/month total)

| Service | Provider | Cost |
|---------|----------|------|
| Hosting | Railway (Hobby) | $5/mo |
| Database | Supabase (Free) | $0 |
| Auth | Clerk (Free tier) | $0 |
| Email | Resend (Free tier) | $0 |
| Workflows | Inngest (Free tier) | $0 |
| ClickUp | API (existing subscription) | $0 |

## Implementation Roadmap

| Phase | Task | Status |
|-------|------|--------|
| 1 | Set up PostgreSQL database schema | Complete |
| 2 | Build chef submission form with required approval attestations | Complete |
| 3 | Create reviewer dashboard (download/upload/approve) | Complete |
| 4 | Add email notifications at each step | Pending |
| 5 | Build approved dishes extraction & database | Pending |
| 6 | ClickUp integration for task creation | Pending |
| 7 | Deploy to production (Railway) | Pending |
| 8 | Add authentication & roles (Clerk) | Pending |
| 9 | Menu content validation (prices, dish names) | Complete |
| 10 | Submitter autofill & recent project loader | Complete |
| 11 | Extended content validation (allergens, etc.) | Planned |

## Services

```
services/
├── ai-review/           # Two-tier AI review (QA + corrections)
├── dashboard/           # Web interface + submission form (Express + EJS)
├── db/                  # Database service
├── differ/              # Compares AI draft vs human-approved
├── docx-redliner/       # DOCX redlining/track changes
├── notifier/            # Email notifications (SMTP)
├── parser/              # DOCX validation and text extraction
└── supabase-client/     # Shared Supabase database client
```

## Planned Services

```
services/
├── clickup-integration/  # ClickUp API integration
└── approved-dishes/      # Dish extraction & database service
```

## Workflow Overview

```
Chef Submission Flow:
  1. Chef opens web form
  2. Fills submitter info (autocomplete from saved profiles) and project details (load from recent projects)
  3. Attests required approval (name, position of approver) - optional second approver
  4. Pastes menu content
  5. Runs AI check (QA validation)
  6. Reviews AI suggestions — critical errors (missing prices, incomplete dish names) block submission
  7. Resolves critical errors by editing + re-running AI check, or overrides them
  8. Submits menu for human review

Review Flow:
  Reviewer → Downloads menu → Reviews → Uploads corrections → Approves

Future: Approved Dishes Database
  Extract dishes from approved menus → Store in searchable database
```

## Key Files

- `README.md` - Project overview and setup instructions
- `CLAUDE.md` - This file (AI context)
- `services/` - All microservices
- `sop-processor/` - SOP document processing scripts
- `samples/` - Sample menus and test files
- `archive/` - Old documentation (preserved for reference)

## Environment Variables

Required in `.env`:
```
SMTP_HOST=              # Email sending
SMTP_USER=
SMTP_PASS=
OPENAI_API_KEY=         # AI review
SUPABASE_URL=           # Supabase project URL
SUPABASE_ANON_KEY=      # Supabase anon key
SUPABASE_SERVICE_KEY=   # Supabase service role key
```

## Notes for Development

- Old documentation and legacy services archived in `archive/` directory
- Web form is the only submission path (email-based flow is archived)
- ClickUp integration uses their REST API (free with existing subscription)
- Supabase provides both database and file storage
- Inngest recommended for workflow orchestration (handles retries, timeouts)
