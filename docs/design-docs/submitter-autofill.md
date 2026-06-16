# Submitter Autofill & Recent Projects

**Status:** Complete (Feb 2026)

Returning users can quickly fill forms using saved profiles and past project data.

## Submitter Autocomplete

Available on both `/form` and `/design-approval`.

- Type 2+ characters in the "Your Name" field to see matching profiles
- Search ignores accent/tone marks, so typing `tan` can match saved names such as `Tàn`.
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
- Project search ignores accent/tone marks in the typed query and stored project names.

## Property Catalog (Canonical)

Available on `/form` and learning rule workflows.

- Property is selected from a configured list (type-to-search + pick), not free text.
- Property search ignores accent/tone marks and treats punctuation/separators as spaces, so users can type natural queries such as `toro st regis kanai` for `Toro - St. Regis Kanai - Riviera Maya`; selecting a suggestion still writes the configured canonical property value.
- The property value must match one of the configured properties (validated server-side).
- The previous free-text location field is removed; location metadata is derived from selected property.
- The `Hotel Name` input is temporarily removed from the chef form UI.
- DOCX project-detail extraction supports newer templates that split property identity across `OUTLET NAME`, `HOTEL NAME`, and `CITY / COUNTRY`. The dashboard resolves those hints to a single canonical property when possible, and otherwise leaves the field blank without showing an extraction warning so the submitter can choose the property from the dropdown.
- DOCX date extraction only fills Date Needed when the upload provides a valid date that satisfies turnaround rules. Invalid or too-soon dates keep the automatically calculated date without showing an extraction warning.
- The dashboard carries a baked-in canonical fallback catalog for form rendering and `/api/properties`, so search and DOCX property matching still work if the DB property endpoint is temporarily unavailable or empty. DB metadata remains preferred when available. The fallback stays aligned with the DB default catalog for active selectable properties, including separate dLeña Houston and Washington, D.C. entries.

## Architecture

### Storage

- DB service (`services/db/index.ts`) stores profiles in `/tmp/db/submitter_profiles.json`, keyed by `name.toLowerCase().trim()`
- Supabase schema includes `submitter_profiles` table for future migration

### API Endpoints

**DB service:**
- `GET /submitter-profiles/search?q=` — search profiles by name prefix
- `POST /submitter-profiles` — upsert profile
- `GET /submissions/recent-projects` — get recent unique projects
- `GET /properties` — canonical property list for submission/learning UIs
- `GET /properties/validate?name=` — validate a property name against canonical list
- `GET /submissions/search?q=` — search approved baselines for modifications; search matching ignores accent/tone marks across project/property/service/submitter fields.

**Dashboard proxies:**
- `GET /api/submitter-profiles/search` → db service
- `GET /api/recent-projects` → db service
- `GET /api/properties` → db service

### Profile Save

Profile save is triggered in both `POST /api/form/submit` and `POST /api/design-approval/compare`. Both use fire-and-forget (`.catch()` only).

### Important DB Fix

`POST /submissions` was fixed to spread `req.body` instead of only persisting 3 fields. All form data (project_name, property, submitter_name, etc.) is now stored correctly.

### Route Registration

All named routes (`/submitter-profiles/search`, `/submissions/recent-projects`, `/submissions/by-clickup-task/:taskId`) are registered BEFORE the `/:id` param route to avoid Express param capture.
