# Menu Manager

Menu Manager is an AI-powered service designed to automate the review process for menu design submissions. Chefs worldwide submit their menus via a web form, select reviewers, and the system guides the submission through a multi-level approval workflow with AI-assisted corrections.

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
- AI-powered two-tier review (general QA + detailed corrections)
- DOCX template validation and redlining
- Reviewer dashboard
- Notification system

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
├── dashboard/        # Web interface for reviewers + submission form
├── db/               # Database service
├── differ/           # AI vs human comparison for training
├── docx-redliner/    # DOCX track changes
├── notifier/         # Email notifications (SMTP)
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

1. **Submission** - Chef uploads menu via web form, selects reviewer(s)
2. **Template Validation** - System validates `.docx` structure
3. **Tier 1 AI Review** - High-level QA check (spelling, grammar, clarity)
4. **Decision Point** - If issues found, chef is notified to resubmit
5. **Tier 2 AI Review** - Detailed corrections based on SOP rules
6. **Human Review** - Reviewer downloads, reviews, uploads corrections
7. **Multi-Level Approval** - Additional reviewers if required
8. **ClickUp Integration** - Final approval creates task in ClickUp
9. **Dishes Database** - Approved dishes extracted and stored

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
npm start --workspace=@menumanager/notifier    # Notifications
npm start --workspace=@menumanager/db          # Database
```

Or use the helper scripts:
```bash
./start-services.sh   # Start all services
./stop-services.sh    # Stop all services
./verify-setup.sh     # Verify configuration
```

## Implementation Roadmap

| Phase | Task | Status |
|-------|------|--------|
| 1 | Set up PostgreSQL database schema (Supabase) | Pending |
| 2 | Build chef submission form with reviewer selection | Pending |
| 3 | Enhance reviewer dashboard (download/upload/approve) | Pending |
| 4 | Implement multi-level approval workflow (Inngest) | Pending |
| 5 | Add email notifications at each step (Resend) | Pending |
| 6 | Build approved dishes extraction & database | Pending |
| 7 | ClickUp integration for task creation | Pending |
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

- `CLAUDE.md` - AI assistant context and project details
- `archive/` - Historical documentation from Phase 1

## Running Tests

```bash
npm test
```
