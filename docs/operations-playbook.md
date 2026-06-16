# Operations Playbook

Use this file for commands and maintenance flows that are useful but too detailed for the README.

For local startup failures, reset paths, Docker issues, or broken dependency state, use [local-dev-troubleshooting.md](local-dev-troubleshooting.md).

## Docker Dev Stack

```bash
./dev-up.sh                # build if needed, start services, follow logs
./dev-up.sh -d             # start all services detached
./dev-up.sh dashboard      # start dashboard and compose dependencies
./dev-up.sh --down         # stop containers
./dev-up.sh --rebuild      # rebuild after dependency/shared-lib changes
./dev-up.sh --reset-venv   # rebuild Python venv in the image
./dev-up.sh --nuke         # remove containers plus anonymous volumes
```

Basic smoke checks:

```bash
curl -i http://localhost:3005/
curl -i http://localhost:3005/form
curl -i http://localhost:3007/health

TOKEN=$(grep ^INTERNAL_API_TOKEN .env | cut -d= -f2)
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3004/properties
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3006/stats
```

Internal service routes intentionally return `401` without `x-menumanager-internal-token`; that does not block normal dashboard testing.

## Form And AI Review Checks

Run a live async Basic AI Check smoke test against `DASHBOARD_URL`:

```bash
npm run smoke:basic-ai-check
```

Run the offline pre-AI replay over curated DOCX pairs:

```bash
npm run preai:ab-replay
npm run preai:ab-replay -- --source all
```

Reports are written under `tmp/pre-ai-ab-replay/`.

Useful improvement-loop commands:

```bash
npm run improve:cycle -- --dry-run
npm run review:eval -- --limit 5
npm run rules:manifest
npm run backfill:audit-links -- --apply
```

Regenerate the code rules manifest after changing deterministic rules, guards, prompt sections, or critical types.

## Approval Editor Regression Harness

```bash
npm run approval-editor:harness
npm run test:approval-editor-browser
npm run benchmark:approval-preview
```

The harness serves the checked-in Venga unapproved-DOCX redline fixture at `http://localhost:3015/approval/approval-editor-venga-venga` by default. The browser regression starts its own harness on port `3016` and fails if the preview spinner sticks or known corruption strings appear.

## Business Specs

Executable business specs live in `docs/business-requirements/`.

```bash
npm run test:business
```

Use these `.feature` files for business-readable ClickUp action rules and submission upload-option expectations before or alongside lower-level Jest tests.

## Approved-Dish Extraction

Test approved-dish extraction directly against Supabase without replaying a full ClickUp webhook:

```bash
npm run test:approved-dishes -- --legacy-id form-1771781530178
npm run test:approved-dishes -- --legacy-id form-1771781530178 --write
```

Repair approved-dish rows by re-running the current extractor against existing source submissions. The command is dry-run by default and writes a JSON report under `tmp/reports/`.

```bash
npm run repair:approved-dishes -- --all
npm run repair:approved-dishes -- --brand Tamayo
npm run repair:approved-dishes -- --source-submission-id <uuid> --apply
```

In Docker, run the same maintenance flow from the dashboard workspace:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run repair:approved-dishes -- --all
```

Notes:

- `--id <uuid>` targets a Supabase submission UUID directly.
- `--approved-only` forces tests to use only `approved_menu_content`; otherwise the script falls back to `menu_content`, matching the DB extraction endpoint behavior.
- `--write` stores rows in `approved_dishes` for that submission and follows the shared replacement behavior, so use a test submission when possible.
- `repair:approved-dishes` applies only candidates whose fresh extraction is non-empty, has no high/exclude quality rows, passes row-count safety gates, and shows an obvious quality improvement unless `--include-clean` is supplied.

## ClickUp Completed-Menu Import

Run completed-task import discovery inside Docker so it uses the same Node dependencies and DOCX redliner venv as the app:

```bash
./dev-up.sh --rebuild -d
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:completed-dry-run -- --status complete
```

The dry run writes:

- `tmp/clickup-history-import/completed-dry-run.json`
- `tmp/clickup-history-import/completed-dry-run.csv`

Review warnings before running any write-mode import. The dry run downloads each newest DOCX attachment, extracts clean menu text, previews dish extraction, infers property/service period, and marks which task is newest for each property and service period.

After importing a batch, run the read-only approved-dish audit:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:audit-approved-dishes
```

The audit writes `tmp/clickup-history-import/dish-extraction-audit.json` and `.csv`. Treat a zero-row audit as the gate before broad ClickUp history imports.

To import only clean rows:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:completed-dry-run -- --status complete --apply --only-clean
```

Apply mode upserts approved submissions by ClickUp task id, deactivates that submission's previous active approved-dish rows, inserts the clean extraction output, and leaves warning rows in the JSON/CSV report.

## Localhost Submission Shortcut

Local form submissions from `http://localhost:3005/form` include a developer-only shortcut. After successful submit, ClickUp task creation is skipped, the generated original DOCX downloads automatically, and the success alert links to `/approval/<submissionId>` for the same record. This shortcut is disabled in production and when the request host is not localhost.
