# Submitter Autofill & Recent Projects

**Status:** Complete (Feb 2026)

Returning users can quickly fill forms using saved profiles and past project data.

## Submitter Autocomplete

Available on both `/form` and `/design-approval`.

- Type 2+ characters in the "Your Name" field to see matching profiles
- Selecting a profile auto-fills name, email, and job title (fields remain editable)
- Profiles are saved automatically on each form submission (fire-and-forget)
- Keyboard navigation: ArrowUp/Down to highlight, Enter to select, Escape to dismiss
- Uses 250ms debounce, minimum 2 characters
- Dropdown uses `onmousedown` (not `onclick`) to avoid blur race condition

## Recent Project Loader

Available on `/form` only.

- "Load from Recent" dropdown appears in Project Details card when past projects exist
- Populates all project fields except Date Needed (always fresh per submission)
- Groups submissions by project name, shows most recent of each

## Architecture

### Storage

- DB service (`services/db/index.ts`) stores profiles in `/tmp/db/submitter_profiles.json`, keyed by `name.toLowerCase().trim()`
- Supabase schema includes `submitter_profiles` table for future migration

### API Endpoints

**DB service:**
- `GET /submitter-profiles/search?q=` — search profiles by name prefix
- `POST /submitter-profiles` — upsert profile
- `GET /submissions/recent-projects` — get recent unique projects

**Dashboard proxies:**
- `GET /api/submitter-profiles/search` → db service
- `GET /api/recent-projects` → db service

### Profile Save

Profile save is triggered in both `POST /api/form/submit` and `POST /api/design-approval/compare`. Both use fire-and-forget (`.catch()` only).

### Important DB Fix

`POST /submissions` was fixed to spread `req.body` instead of only persisting 3 fields. All form data (project_name, property, submitter_name, etc.) is now stored correctly.

### Route Registration

All named routes (`/submitter-profiles/search`, `/submissions/recent-projects`, `/submissions/by-clickup-task/:taskId`) are registered BEFORE the `/:id` param route to avoid Express param capture.
