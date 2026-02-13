# Implementation Roadmap

## Phase Status

| Phase | Task | Status |
|-------|------|--------|
| 1 | Set up PostgreSQL database schema | Complete |
| 2 | Build chef submission form with required approval attestations | Complete |
| 3 | Create reviewer dashboard (download/upload/approve) | Complete |
| 4 | Add email notifications at each step | Pending |
| 5 | Build approved dishes extraction & database | Pending |
| 6 | ClickUp integration for task creation | Complete |
| 7 | Deploy to production (Railway) | Pending |
| 8 | Add authentication & roles (Clerk) | Pending |
| 9 | Menu content validation (prices, dish names) | Complete |
| 10 | Submitter autofill & recent project loader | Complete |
| 11 | Extended content validation (allergens, etc.) | Planned |

## What Exists (Phase 1 - Complete)

- Monorepo architecture with microservices in `services/`
- Web form for chef submissions with required approval attestations
- AI-powered two-tier review (general QA + detailed corrections)
- Reviewer dashboard
- DOCX parsing and redlining capabilities
- Notification system via SMTP
- Supabase database (PostgreSQL)

## In Progress (Phase 2)

- ~~ClickUp integration for task management~~ (Complete)
- Approved dishes database (running list of all approved dishes)
- Email notifications at each workflow step
- Role-based access (chef, reviewer, admin)

## Planned (Phase 3)

- **Extended menu content validation**: Additional critical error types beyond prices and dish names (e.g., missing allergen codes). The severity/blocking infrastructure is already in place.
- **Approved dishes database**: Extract dishes from approved menus into a searchable database.

## Planned Services

```
services/
└── approved-dishes/      # Dish extraction & database service
```

## Infrastructure Costs (Starter Tier)

Target: < 100 submissions/month (~$5/month total)

| Service | Provider | Cost |
|---------|----------|------|
| Hosting | Railway (Hobby) | $5/mo |
| Database | Supabase (Free) | $0 |
| Auth | Clerk (Free tier) | $0 |
| Email | Resend (Free tier) | $0 |
| Workflows | Inngest (Free tier) | $0 |
| ClickUp | API (existing subscription) | $0 |
