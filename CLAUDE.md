# Menu Manager - Project Context

> This file provides context for AI assistants working on this project.

## Project Overview

Menu Manager is an AI-powered service for automating the review process for menu design submissions from chefs worldwide. The system validates menus against templates, uses AI to review content, and manages a multi-level human approval workflow.

## Current Status

The project is transitioning from an **email-based submission system** to a **web-based form submission system** with enhanced workflow capabilities.

### What Exists (Phase 1 - Complete)
- Monorepo architecture with microservices in `services/`
- Email inbox monitoring via Microsoft Graph API
- AI-powered two-tier review (general QA + detailed corrections)
- Basic dashboard for reviewers
- DOCX parsing and redlining capabilities
- Notification system via SMTP

### What We're Building (Phase 2 - Planned)
- Web form for chef submissions (replacing email)
- Multi-level approval workflow with reviewer selection
- ClickUp integration for task management
- Approved dishes database (running list of all approved dishes)
- Email notifications at each workflow step
- Role-based access (chef, reviewer, admin)

## Architecture

```
services/
├── ai-review/       # Two-tier AI review (QA + corrections)
├── dashboard/       # Web interface for reviewers (Express + EJS)
├── db/              # Database service
├── differ/          # Compares AI draft vs human-approved for training
├── docx-redliner/   # DOCX redlining/track changes
├── inbound-email/   # Email monitoring (Microsoft Graph)
├── notifier/        # Email notifications (SMTP)
└── parser/          # DOCX validation and text extraction
```

## Tech Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Backend:** Express.js microservices
- **Templating:** EJS (dashboard)
- **Email:** Microsoft Graph API (inbound), SMTP (outbound)
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
GRAPH_CLIENT_ID=        # Microsoft Azure app
GRAPH_CLIENT_SECRET=
GRAPH_TENANT_ID=
GRAPH_MAILBOX_ADDRESS=
SMTP_HOST=              # Email sending
SMTP_USER=
SMTP_PASS=
OPENAI_API_KEY=         # AI review
DATABASE_URL=           # PostgreSQL (future)
```

## Notes for Development

- Old documentation archived in `archive/` directory
- The email-based flow still works but web form is the future direction
- ClickUp integration uses their REST API (free with existing subscription)
- Supabase provides both database and file storage
- Inngest recommended for workflow orchestration (handles retries, timeouts)
