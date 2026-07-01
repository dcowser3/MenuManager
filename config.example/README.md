# Tenant config bundle

Everything in this folder is **business-specific**. To stand up the app for a new
business, copy this folder to `config/` and edit the values — you should never have
to touch code to rebrand or re-point the app.

```bash
cp -r config.example config
# then edit config/tenant.json, config/rulebook/qa_prompt.txt, config/properties.json
```

The loader (`@menumanager/tenant-config`) reads `config/tenant.json` at runtime.
Point it elsewhere with `TENANT_CONFIG_PATH=/abs/or/relative/dir` (used by the
swap test and for running multiple businesses' configs locally).

## Files

| File | What it is |
|------|------------|
| `tenant.json` | All compiled-in constants: business name, branding colors/fonts/logo, email identities, default allergen key, approval roles, menu-template markers. |
| `rulebook/qa_prompt.txt` | The **seed** menu-review prompt for a fresh database. After the first approved prompt change in the dashboard, the live ruleset lives in the `prompt_proposals` DB table — no deploy needed to change rules. |
| `properties.json` | The **seed** property/location catalog for a fresh database. Editable in-app after seeding. |
| `branding/` | Optional logo / favicon image files referenced by `branding.logo`. |

## `tenant.json` fields

- **name / shortName / tagline / appName** — header text and page titles. Roles render as `"<shortName> <role.label>"` (e.g. `RSH Culinary`).
- **branding.colors** — CSS custom properties injected into every page's `:root`.
- **branding.fonts** — `heading`/`body` become the `--font-*` CSS vars; `googleFontsHref` is the `<link>` that loads them (leave empty to use system fonts only).
- **emails.\*** — default identities. Environment variables still take precedence over these (e.g. `SMTP_FROM`, `FORM_ATTEMPT_ALERT_EMAIL`, `PUBLIC_FORM_SUPPORT_EMAIL`). `submissionConfirmationCc` is a list of extra visibility recipients copied on every successful form-submission confirmation email.
- **allergenKey** — default allergen legend used when a submission supplies none.
- **approvalRoles** — the named sign-offs on the design-approval screen.
- **template** — strings the parser uses to recognize and validate uploaded menu templates, plus the downloadable template file names. The validation *logic* is shared; only these strings change per business.
- **rulebook.guidelinesAnchor / allergensAnchor** — the exact headings the review prompt-builder inserts prix-fixe and custom-allergen sections after. **These must appear verbatim in `rulebook/qa_prompt.txt` (and in any prompt later approved in-app)** or that injection silently no-ops.

## Secrets do NOT go here

Integration credentials (SMTP, OpenAI, Supabase, ClickUp, Microsoft Graph) live in
`.env`, which is git-ignored and set per deployment. See `.env.example`.
