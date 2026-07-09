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
3. **DB override (wins on restart):** on dashboard startup,
   `syncEffectivePromptFromDb()` restores the latest **approved prompt proposal
   from the DB** over the runtime file when they differ. A hand edit to the
   runtime file can therefore be reverted by the next restart — durable manual
   changes should go through the prompt-proposal/approval flow (or be reconciled
   with the latest approved proposal in the DB).

Rule of thumb: hot-fix in `sop-processor/qa_prompt.txt`, then make it durable
via the proposal flow; touch `config/rulebook/qa_prompt.txt` only when changing
what a *fresh* install starts with.

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
