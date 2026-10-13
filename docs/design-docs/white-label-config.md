# White-label tenant config

**Status:** Implemented

## Problem

The app was built for Richard Sandoval Hospitality (RSH). Business-specific
values — branding, email identities, the default allergen key, design-approval
roles, menu-template markers, and the seed rules/properties — were hardcoded
across services, EJS views, and seed data. Selling the app to other restaurant
businesses required hunting through code for each one.

## Goal

Pull every business-specific value into **one config bundle** so onboarding a new
business is a config edit, never a code edit — and changing a reusable value is
done once.

## Decision

- **One deployment per business** (own server + own database), no shared
  multi-tenant login. The app has no end-user auth, and per-instance databases
  already isolate data, so this was the fastest, lowest-risk model.
- **Config bundle** at `config/` (git-ignored override is *not* used — the bundle
  is committed per deployment; RSH is the committed tenant in this repo).
  `config.example/` is the reference template a new business clones.
- **Shared loader** `@menumanager/tenant-config` (mirrors `internal-auth` /
  `supabase-client`): loads `config/tenant.json` once (path overridable via
  `TENANT_CONFIG_PATH`, default `<repoRoot>/config`), deep-merges it over
  embedded RSH defaults, and exposes typed `getTenantConfig()`. The embedded
  defaults are the safety net so the app behaves identically if the bundle is
  ever absent (tests, minimal runtimes).

## Two categories of business-specific value

1. **Compiled-in constants** (need config to change): branding strings/colors/
   fonts/logo in the EJS views, page titles, `DEFAULT_ALLERGEN_KEY`, email
   identities (with env still taking precedence), approval-role labels, template
   validator markers + file names, and the prompt-builder injection anchors.
2. **Database-backed data** (per-instance automatically; config only supplies the
   *seed* for a fresh DB): the menu ruleset (`prompt_proposals` /
   `correction_rules`) and the property catalog (`properties` table). The
   hardcoded RSH values are retained in code only as embedded fallbacks.

## Implementation map

| Concern | Where | Config field |
|---|---|---|
| Loader + types + defaults | `services/tenant-config/src/index.ts` | — |
| Branding (header/footer/title/theme) | `dashboard/index.ts` (`app.locals.tenant`), `views/*.ejs` + `views/partials/theme.ejs` | `name`, `shortName`, `tagline`, `appName`, `branding.*` |
| Approval roles | `views/design-approval.ejs` | `approvalRoles[]` |
| Allergen key | `dashboard/index.ts` | `allergenKey` |
| Emails (env still wins) | `dashboard/index.ts`, `submission-workflow.ts`, three `smtp-config.ts`, `db/index.ts`, `clickup-handoff-rules.ts` | `emails.*`, including `emails.submissionConfirmationCc[]` for form-submission receipt visibility |
| Template validation + download | `parser/src/validator.ts`, `dashboard/index.ts` | `template.*` |
| Prompt injection anchors + debrand | `qa-prompt-builder.ts`, `improvement-cycle-core.ts`, `ai-review/index.ts` | `rulebook.guidelinesAnchor`, `rulebook.allergensAnchor` |
| Rulebook seed | `config/rulebook/qa_prompt.txt`; startup `ensureRuntimePromptSeed()` in `dashboard/index.ts` | `rulebook.seedFile` |
| Raw-marker placement convention | `review-pipeline.ts` (post-AI canonicalization gate), `qa-prompt-builder.ts` (`raw_marker_placement` prompt section) | `rulebook.rawMarkerPlacement` — `'description_end'` (default, canonicalize) or `'preserve'` (author placement is house style; missing markers still flagged). Shared-lib change: needs `./dev-up.sh --rebuild` |
| Property seed | `db/index.ts` `buildDefaultPropertyCatalog()`, `dashboard/lib/property-catalog.ts` | `propertiesSeedFile` |

The theme partial (`views/partials/theme.ejs`) is included near each view's
`</head>` and re-declares the `:root` CSS variables from config, so it overrides
each page's built-in defaults without rewriting every view.

## QA rulebook: seed vs. runtime vs. DB (edit the right file)

There are three layers to the QA prompt, and editing the wrong one silently does
nothing (this has bitten us):

1. **Seed (inert at runtime):** `config/rulebook/qa_prompt.txt` (`rulebook.seedFile`).
   Only used by `ensureRuntimePromptSeed()` (`dashboard/index.ts`) to create the
   runtime file **if it doesn't already exist**. Editing it on an existing
   install has no effect on reviews.
2. **Runtime file (what reviews actually read):** `sop-processor/qa_prompt.txt`.
   Read fresh on every review by `dashboard/index.ts` and `ai-review/index.ts`
   (no restart needed for edits). The dashboard's improvement cycle also writes
   approved prompt changes back to this file.
3. **DB approved copy:** the latest approved row in `prompt_proposals`. On
   dashboard startup `syncEffectivePromptFromDb()` decides which copy runs, using
   the repo's history of the prompt file (`lib/prompt-sync.ts`):

   | Situation | Result |
   |---|---|
   | Repo file and DB copy are the same text | Nothing to do |
   | DB copy is an older committed version of the repo file | **Repo file wins.** The deploy step pins it in the DB |
   | DB copy is not in the repo history (a dashboard approval git has never seen) | DB copy wins, and the deploy raises a `qa_prompt_not_in_git` alert |
   | No history available | DB copy wins (previous behavior), with a warning |

   "History" is the sha256 of every committed version of
   `sop-processor/qa_prompt.txt`. Production reads it from `tmp/prompt-lineage.txt`,
   which the deploy writes on the host (the image has no `.git`); a local checkout
   reads it from git, so a local hand edit is no longer reverted on restart.

**Why this changed (2026-10-13).** The old rule was "the DB copy always wins on
restart". Every repo edit to the prompt was reverted on deploy, and dashboard
approvals re-stamped the stale copy, so prod ran the **Jul 30 2026** prompt until
Oct 13 while seven repo prompt commits (including "allergen codes are suggestions
only") never reached the model.

**How a repo edit ships now.** Edit `sop-processor/qa_prompt.txt`, commit, push.
The deploy (`.github/workflows/deploy-lightsail.yml`) writes the lineage file,
runs `scripts/sync-prompt-on-deploy.js` in a one-off container before the stack is
swapped (pins the repo prompt when it supersedes the DB copy; never blocks the
deploy), and after startup checks `GET /api/health/prompt` (sha256, length,
decision) against the committed file, printing a GitHub warning if prod is not
serving it.

**How a dashboard approval gets into git.** An approval in the dashboard writes
the runtime file and the DB, but not git, so the next deploy keeps it and raises a
`qa_prompt_not_in_git` alert. Run `node scripts/commit-runtime-prompt.js --pull` to
write the DB copy into `sop-processor/qa_prompt.txt`, merge any repo-only edits,
commit, and push.

**Manual tools.** `node scripts/commit-runtime-prompt.js` (dry run) reports drift
between the runtime file and the DB copy; `--apply` pins the runtime file
immediately (add `--expected-db-sha256 <full-current-db-sha256>` to refuse if
another reviewer changed the DB copy meanwhile). The startup sync sees new rows
only on the next restart.

## Verification

- `npx jest` (full suite green; fixtures that render views directly now pass
  `tenant`).
- Live: with RSH config the UI renders identically; with
  `TENANT_CONFIG_PATH=./config.example` the header, titles, and emails reflow to
  "Your Business Name" / "YBN Menu Manager" with zero code edits.

## Not covered (future)

- Shared multi-tenant SaaS / login / `tenant_id` columns.
- N-role design approval (currently two roles: culinary + regional, labels
  configurable).
- `clickup-completed-import.js` is an RSH-history one-off and is not part of the
  white-label runtime path.
- `dashboard/lib/property-catalog.ts` and `db/index.ts` still duplicate the
  embedded fallback list (pre-existing duplication; both now prefer the config
  seed).
