# Local Dev Troubleshooting

Known failure modes when starting services locally and how to diagnose them. Everything here comes from real incidents — read it before spending an hour re-discovering the same problem.

## Default: Docker

Use Docker for local service startup, route/API/browser verification, and service-dependent debugging unless you are intentionally testing native startup. The dev stack keeps Python venv and `node_modules` inside a reproducible image, which avoids the OOM / corrupted-venv / broken-tsc-shim failure modes that waste time in native mode.

| Mode | Entry point | When to use |
|------|-------------|-------------|
| **Docker (default)** | `./dev-up.sh` | Normal Codex/local workflow. Reset by rebuilding the image or nuking volumes. |
| **Native (fallback)** | `./start-services.sh` | Only when deliberately testing host-machine startup or Docker Desktop is unavailable. You own dependency hygiene. |

### Docker workflow cheatsheet

```bash
./dev-up.sh                # build image (first run) + start all services, follow logs
./dev-up.sh -d             # detached
./dev-up.sh dashboard      # only dashboard + its deps
./dev-up.sh --down         # stop containers
./dev-up.sh --rebuild      # rebuild image, then start (after dep changes)
./dev-up.sh --reset-venv   # nukes the Python venv inside the image
./dev-up.sh --nuke         # also drops anonymous volumes (node_modules, venv)
```

Compose files: `docker-compose.dev.yml` (this dev setup) vs `docker-compose.yml` (prod-style build, untouched). Image: `docker/Dockerfile.dev`. Service source, `tmp/`, `samples/`, and `.env` are bind-mounted, so edits hot-reload via `ts-node-dev` without rebuilding.

### Docker smoke checks

After `./dev-up.sh -d`, confirm the stack is up:

```bash
docker compose -f docker-compose.dev.yml ps
curl -i http://localhost:3005/
curl -i http://localhost:3005/form
curl -i http://localhost:3007/health
```

Internal services are protected by `INTERNAL_API_TOKEN`. Direct unauthenticated calls to `db`, `parser`, `ai-review`, and `differ` commonly return `401`; that is expected and does not prevent dashboard testing. Use the shared token for direct internal smoke checks:

```bash
TOKEN=$(grep ^INTERNAL_API_TOKEN .env | cut -d= -f2)
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3004/properties
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3006/stats
```

The dashboard and service clients attach this header automatically for service-to-service requests. If a dashboard page returns `500` while the same internal route works with the header, check the caller's `.env` and restart the caller container.

Internal service clients default to a 5-second timeout (`INTERNAL_API_TIMEOUT_MS`) unless a route sets a more specific timeout. Basic AI Check overrides this with `BASIC_AI_CHECK_TIMEOUT_MS` (default `25000`) so slow OpenAI responses fail open to manual review before common proxy gateway timeouts return `502`/`504`. The public form starts Basic AI Check with `/api/form/basic-check/start` and polls `/api/form/basic-check/status/:checkId`; submit remains blocked while the job is pending. If a dashboard route waits indefinitely, first confirm Docker Desktop is responding with `docker version`; a half-stuck Docker engine can hold ports open while no service process can answer.

## Quick Reset (native mode)

If services are in a bad state and you just want to start clean:

```bash
# 1. kill anything still bound to service ports
lsof -ti:3001,3002,3003,3004,3005,3006,3007,3008 | xargs kill -9 2>/dev/null

# 2. if node_modules look corrupted (weird tsc errors, missing modules)
mv node_modules node_modules.old 2>/dev/null
for d in services/*/node_modules; do mv "$d" "$d.old" 2>/dev/null; done
rm -rf node_modules.old services/*/node_modules.old &   # delete in background
npm install

# 3. if Python/redliner is broken (import errors from extract scripts)
cd services/docx-redliner && rm -rf venv && python3 -m venv venv \
  && venv/bin/pip install -r requirements.txt && cd ../..

# 4. start
./start-services.sh
```

In Docker mode, the equivalent is `./dev-up.sh --nuke && ./dev-up.sh --rebuild`.

## Failure Modes

### `npm start` / build hangs or services killed with code 137 (SIGKILL)

**Cause:** macOS OOM killer. Running all 6 services plus parallel builds plus Python DOCX extraction can exceed available RAM.

**Symptoms:**
- `zsh: killed npm start --workspace=...`
- `Killed: 9 node dist/index.js` in logs
- Python subprocess returns `killed: true, signal: 'SIGTERM', stderr: ''` (empty stderr is the giveaway — nothing *crashed*, the process was terminated)

**Fix:** Close other memory-hungry apps (Chrome, Docker, simulators), or start services one at a time instead of via `start-services.sh`.

### `EADDRINUSE: address already in use :::NNNN`

**Cause:** Previous run of that service is still alive. Happens when `stop-services.sh` runs without a valid PID file, or a service was backgrounded from a terminal that died.

**Fix:**
```bash
lsof -ti:NNNN | xargs kill -9
```
`stop-services.sh` covers ports 3000–3008 in its fallback path. If you see this on a port outside that range, check and extend the script.

### `tsc: line 2: syntax error near unexpected token '../lib/tsc.js''`

**Cause:** bash is executing the TypeScript shim as a shell script because either the `node_modules` install got corrupted mid-way or the workspace doesn't declare `typescript` as a devDep (and the hoisted copy is broken). Usually a side-effect of an earlier OOM kill interrupting `npm install`.

**Fix:** Quick-reset flow above. All services now declare `"typescript"` as a devDep, so a clean `npm install` will place a working `tsc` in each workspace's `.bin`.

### Dashboard pages 500, db log says `Rejected internal request because INTERNAL_API_TOKEN is not configured`

**Cause:** Your local `.env` doesn't define `INTERNAL_API_TOKEN`. Since the May 2026 security hardening ([commit `2d7d47d`](../docs/security-hardening-2026-05-05.md)), every cross-service HTTP call must carry a shared `x-menumanager-internal-token` header. The db service rejects unauthenticated callers with 503 (token unset on db) or 401 (token mismatch between caller and db). Most dashboard pages that read submissions then surface a generic 500 to the browser. `.env.example` has the variable, but a stale local `.env` carried over from before the hardening doesn't.

**Symptom:**
- `curl http://localhost:3004/submissions/<id>` → `503 {"error":"Internal service auth token not configured"}`
- Dashboard approval / approved-menus / training pages return 500
- `logs/db.log` shows `Rejected internal request because INTERNAL_API_TOKEN is not configured` on every request

**Fix:**
```bash
# generate a random secret and append to .env (any caller and db just need to share it)
printf '\nINTERNAL_API_TOKEN=%s\n' "$(openssl rand -hex 24)" >> .env

# Docker default: restart db AND callers so they re-read .env
./dev-up.sh --down && ./dev-up.sh -d

# Native fallback:
./stop-services.sh && ./start-services.sh
```

Verify with:
```bash
TOKEN=$(grep ^INTERNAL_API_TOKEN .env | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" -H "x-menumanager-internal-token: $TOKEN" http://localhost:3004/properties
# expect 200
```

### Docker on macOS says `Resource deadlock avoided` or `Cannot read file '/app/services/.../tsconfig.json'`

**Cause:** Docker Desktop's macOS file-sharing layer can race when bind-mounting from TCC-protected folders such as `~/Documents`, `~/Desktop`, and `~/Downloads`. The service process then sees intermittent `UNKNOWN: unknown error, read`, `Unknown system error -35`, or `Resource deadlock avoided` while reading normal source files.

**Fixes, in order:**
- Grant Docker Desktop access to the folder in System Settings > Privacy & Security > Files and Folders, then quit and relaunch Docker Desktop.
- Switch Docker Desktop's file-sharing implementation in Settings > General, then restart Docker Desktop.
- Move the repo out of the protected folder, for example to `~/code/MenuManager`, which avoids this whole class of file-sharing failure.

Quick sanity check:

```bash
for i in $(seq 1 5); do
  docker run --rm -v "$PWD/services/db/tsconfig.json:/test.json" alpine:3.20 cat /test.json >/dev/null || exit 1
done
echo "bind-mount reads ok"
```

### `FileNotFoundError: ...venv/lib/python3.12/site-packages/<pkg>/__init__.py`

**Cause:** The docx-redliner venv is corrupted. Happens when an earlier OOM kill or force-close hit during `pip install`.

**Symptom in the dashboard log:** `Error extracting unapproved document: ... killed: true, signal: 'SIGTERM', stderr: ''`. Python crashes before it can flush stderr, so node's `exec` wrapper reports it as a kill.

**Fix:**
```bash
cd services/docx-redliner
rm -rf venv
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python -c "import docx, fitz, openai, dotenv, diff_match_patch; print('ok')"
cd ../..
```

### `rm -rf node_modules` takes minutes or appears to hang

**Not broken.** A monorepo `node_modules` has 100k+ tiny files; Spotlight/TimeMachine indexing compounds it. Use the background-rename trick in the Quick Reset above instead of waiting.

### VSCode terminal dies mid-install ("Lost connection to process")

**Not a system crash** — just the VSCode shell helper exiting. Services you backgrounded with `&` in `start-services.sh` usually survive because they're detached. Verify with:

```bash
lsof -ti:3001,3002,3004,3005,3006,3007,3008
```

If PIDs print, the services are alive — just open a new terminal and continue.

## Approved-Dish Extraction Checks

## Local Submission DOCX / Approval Editor Testing

When testing the chef form from `http://localhost:3005/form`, a successful submit skips ClickUp task creation and returns developer-only links to the dashboard. The browser uses them to automatically download the generated original DOCX and keep an `Open approval editor` link visible in the success alert for the same submission.

This shortcut only appears for localhost requests while `NODE_ENV` is not `production`. If it does not appear:

- confirm you are using `http://localhost:3005/form` rather than a tunneled or production hostname
- confirm the dashboard process is not running with `NODE_ENV=production`
- rebuild/restart the dashboard if you are running native `npm start`, because that serves `services/dashboard/dist/`
- test the generated file directly with `curl -I http://localhost:3005/download/original/<submissionId>`

The approval editor route remains `/approval/<submissionId>`. In local mode, submitting that approval can finalize locally through the clickup-integration service when no ClickUp task or token is configured, so the editor can be exercised without sending anything to ClickUp.

## 413 On Chef Submission

**Symptom:** `/api/form/submit` returns `413 Payload Too Large`, often after pasting a formatted menu or submitting a modification with a large persistent redline preview.

**Likely cause:** Rich HTML fields can exceed Express's default 100 KB JSON parser limit before the submit handler runs, or the dashboard can pass the public route but hit the same limit when saving the submission/raw payload to the DB service.

**Checks and fixes:**

- Dashboard and DB default to 5 MB JSON bodies. If production still returns 413, confirm the running services include the configured parser limits and were restarted/redeployed.
- For larger deployment-specific payloads, set `JSON_BODY_LIMIT`, or use `DASHBOARD_JSON_BODY_LIMIT` and `DB_JSON_BODY_LIMIT` separately.
- If the app logs do not show the request reaching dashboard, check the fronting proxy/load balancer request-body limit as well.
- Check Supabase `form_attempt_logs` by `attempt_id`, submitter, property/project, or recent `event_type` values such as `basic_check_client_received`, `submit_failed`, `submit_client_exception`, and `payload_too_large`. These rows can exist even when no final `submissions` row was created.
- `system_alerts` also records `form_payload_too_large` when the dashboard JSON parser rejects a submit before route handlers run.
- In production only, these public-form failure events send an email to `FORM_ATTEMPT_ALERT_EMAIL` (default `dcowser@richardsandoval.com`) through the dashboard SMTP settings. If no email arrives, check SMTP credentials and the dashboard logs for `Failed to send form attempt alert email`.
- Submitters also see `PUBLIC_FORM_SUPPORT_EMAIL` in blocking/red form errors so they have a direct fallback while SMTP alerting is being configured.

If ClickUp approval is updating the `submissions` row but you are not seeing rows in `approved_dishes`, test the extractor directly before debugging webhook delivery:

```bash
npm run test:approved-dishes -- --legacy-id <local-or-clickup-linked-legacy-id>
```

That dry-run shows:
- whether the submission exists in Supabase
- whether `approved_menu_content` or fallback `menu_content` is present
- how many dishes the parser finds
- the current `approved_dishes` count for that submission
- whether inline `Dish Name - description` rows are being split correctly without turning the allergen legend or raw-food warning into fake dishes
- whether ClickUp-style comma-delimited rows with leading words like `Chicken` remain dishes instead of category headers, including extended allergen codes like `SS`, `SL`, `SY`, `PN`, and `TN`
- whether menu-title section headers such as `Ladies Night Menu` are captured as `menu_category` when they precede dish rows

To verify the write path too:

```bash
npm run test:approved-dishes -- --legacy-id <legacy-id> --write
```

Useful flag:
- `--approved-only` reproduces the strict "approved text only" case if you suspect DOCX extraction never populated `approved_menu_content`.

Expected parser behavior:
- menu rows like `Guacamole - fresh avocado / lime / cilantro D,G 12` should preview as `dish_name=Guacamole`, `description=fresh avocado / lime / cilantro`, `allergens=["D","G"]`, `price=12`
- comma-delimited rows like `Punta Mita, prawns, tomato, onion C,F,S 95` should preview as `dish_name=Punta Mita`, `description=prawns, tomato, onion`, `allergens=["C","F","S"]`, `price=95`
- footer blocks such as `ALLERGEN KEY`, pipe-delimited allergen legends, and the `consuming raw or undercooked...` warning should not appear in `preview`

## Service Startup Dependencies

- **typescript devDep:** Every TS service must declare `"typescript"` in its own `devDependencies`, not rely on the hoisted copy. A partial install can leave the hoisted copy broken; workspace-local ones are more resilient.
- **Jest dependency alignment:** Root Jest is pinned to the 29.x runner line. Keep `@types/jest` and `jest-util` on 29.x too; `@types/jest@30` pulls Jest 30 `expect`/`jest-util` packages into the root and can make the Jest 29 runner crash before test discovery.
- **Docker test config:** The dev image copies root `jest.config.js` during build. After changing root test dependencies or Jest config, run `./dev-up.sh --rebuild` so `npm test` inside containers uses the updated package graph and config.
- **docx-redliner venv:** Node services shell out to `services/docx-redliner/venv/bin/python`. The venv must exist and have `python-docx`, `PyMuPDF`, `openai`, `python-dotenv`, `diff-match-patch` installed. `requirements.txt` is the source of truth.
- **start-services.sh port order:** db (3004), parser (3001), ai-review (3002), dashboard (3005), differ (3006), clickup (3007). Note docx-redliner is NOT started as a service — node invokes its Python scripts as subprocesses.
- **Shared workspace packages in Docker:** new shared packages such as `diff-core` must be included in `docker/Dockerfile.dev` before `npm ci`; otherwise dev containers may fail to resolve `@menumanager/*` imports or browser-served helper files until `./dev-up.sh --rebuild`.
- **Workspace builds:** shared JavaScript-only packages such as `diff-core` do not have a `build` script. Use `npm run build --workspaces --if-present` in native scripts and production Docker builds so npm skips packages that do not need compilation.
- **stop-services.sh port coverage:** Fallback kill covers 3000–3008. If you add a service on a new port, update it.
