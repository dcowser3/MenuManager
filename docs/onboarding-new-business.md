# Onboarding a new business (white-label setup)

Menu Manager is white-labelable. Each business runs its **own deployment** (its
own server/subdomain and its own database); there is no shared multi-tenant
login. Everything business-specific lives in **one config bundle** (`config/`)
plus secrets in `.env`. You should never edit code to stand up a new business.

> Why a separate deployment per business: the live menu ruleset and property
> catalog are database-backed, so they are already per-instance. The config
> bundle covers the compiled-in constants (branding, emails, allergen key,
> approval roles, template markers) and the **seed** rules/properties for a
> fresh database. See [design-docs/white-label-config.md](design-docs/white-label-config.md).

## Steps

1. **Copy the example bundle.**
   ```bash
   cp -r config.example config
   ```
   (`config/` is what the app reads. `config.example/` is the reference template
   — keep it untouched.)

2. **Fill in `config/tenant.json`.** Field-by-field docs are in
   [config.example/README.md](../config.example/README.md). At minimum set
   `name`, `shortName`, `appName`, `emails.*`, and `allergenKey`. Adjust
   `branding.colors` / `branding.fonts` to taste, and `approvalRoles` to the
   business's sign-off roles.

3. **Add branding assets (optional).** Drop a logo/favicon in `config/branding/`
   and point `branding.logo` at it. Text-only branding works with `logo` empty.

4. **Author the seed rulebook.** Replace `config/rulebook/qa_prompt.txt` with the
   business's menu-review rules. Ensure the two anchor headings configured in
   `tenant.json` (`rulebook.guidelinesAnchor`, `rulebook.allergensAnchor`) appear
   verbatim in the prompt — the review pipeline injects prix-fixe and allergen
   sections after them. After the first approved prompt change in the dashboard,
   the live ruleset lives in the `prompt_proposals` DB table and evolves in-app
   with **no deploy**.

   > If you are reusing this repo (not a fresh clone), also delete the stale
   > runtime cache `sop-processor/qa_prompt.txt` so the app re-seeds it from your
   > bundle on first boot.

5. **Set the seed properties.** Replace `config/properties.json` with the
   business's locations (`[{ "name": "Restaurant - City" }, ...]`). City is
   derived from the text after the last ` - `. Leave `[]` to start empty and add
   properties in-app. After seeding, the live catalog lives in the database.

6. **Provide a menu template (if used).** Put the business's `.docx` template(s)
   in `samples/` and set `template.*.fileName` + the marker strings in
   `tenant.json` so the parser recognizes and validates uploads.

7. **Set secrets in `.env`.** Copy `.env.example` → `.env` and fill the
   integrations the business uses (SMTP/Graph, OpenAI, Supabase, ClickUp).
   Environment variables override the matching `config/tenant.json` email values.

8. **Deploy.** Build and run as usual (`./dev-up.sh -d` locally, or the production
   Docker images). The config bundle is baked into the image (`COPY . .`) and
   read at startup.

## Running multiple businesses' configs locally

Point the loader at a different bundle without moving files:

```bash
TENANT_CONFIG_PATH=./config-acme node services/dashboard/dist/index.js
```

This is also the **acceptance test**: with a throwaway `config-acme/`, the whole
UI, validation, and emails reflow to that business with zero code changes.

## What is NOT in the bundle

- Integration credentials → `.env` (git-ignored, per deployment).
- The live ruleset and property catalog after first edit → the database
  (`prompt_proposals`, `correction_rules`, `properties`).
