# Menu Manager - Project Context

> This file provides context for AI assistants working on this project.

## Project Overview

Menu Manager is an AI-powered service for automating the review process for menu design submissions from chefs worldwide. The system validates menus against templates, uses AI to review content, and manages a multi-level human approval workflow.

## Current Status

The project uses a **web-based form submission system** with AI-assisted review and multi-level approval workflow.

### What Exists (Phase 1 - Complete)
- Monorepo architecture with microservices in `services/`
- Web form for chef submissions
- AI-powered two-tier review (general QA + detailed corrections)
- Reviewer dashboard
- DOCX parsing and redlining capabilities
- Notification system via SMTP
- Supabase database (PostgreSQL)

### What We're Building (Phase 2 - Planned)
- Multi-level approval workflow with reviewer selection
- ClickUp integration for task management
- Approved dishes database (running list of all approved dishes)
- Email notifications at each workflow step
- Role-based access (chef, reviewer, admin)

## Architecture

```
services/
├── ai-review/        # Two-tier AI review (QA + corrections)
├── dashboard/        # Web interface + submission form (Express + EJS)
├── db/               # Database service (JSON-based, migrating to Supabase)
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
| 1 | Set up PostgreSQL database schema | Pending |
| 2 | Build chef submission form with reviewer selection | Pending |
| 3 | Create reviewer dashboard (download/upload/approve) | Pending |
| 4 | Implement multi-level approval workflow | Pending |
| 5 | Add email notifications at each step | Pending |
| 6 | Build approved dishes extraction & database | Pending |
| 7 | ClickUp integration for task creation | Pending |
| 8 | Deploy to production (Railway) | Pending |
| 9 | Add authentication & roles (Clerk) | Pending |

## New Services to Build

```
services/
├── submission-form/      # Public chef submission form
├── workflow-engine/      # Multi-level approval orchestration
├── clickup-integration/  # ClickUp API integration
└── approved-dishes/      # Dish extraction & database service
```

## Workflow Overview

```
Chef Submission Flow:
  Chef → Web Form → Select Reviewer(s) → Upload Menu → Notification Sent

Multi-Level Approval Flow:
  Reviewer 1 → Download → Review → Upload Corrections → Approve
       ↓ (if needed)
  Reviewer 2 → Final Review → Approve → ClickUp Task Created

Approved Dishes Database:
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
