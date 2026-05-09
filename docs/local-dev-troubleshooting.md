# Local Dev Troubleshooting

Known failure modes when starting services locally and how to diagnose them. Everything here comes from real incidents — read it before spending an hour re-discovering the same problem.

## Quick Reset

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

# restart db AND any caller (dashboard, ai-review, clickup-integration, differ, notifier) so they re-read .env
./stop-services.sh && ./start-services.sh
```

Verify with:
```bash
TOKEN=$(grep ^INTERNAL_API_TOKEN .env | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" -H "x-menumanager-internal-token: $TOKEN" http://localhost:3004/submissions
# expect 200
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

To verify the write path too:

```bash
npm run test:approved-dishes -- --legacy-id <legacy-id> --write
```

Useful flag:
- `--approved-only` reproduces the strict "approved text only" case if you suspect DOCX extraction never populated `approved_menu_content`.

Expected parser behavior:
- menu rows like `Guacamole - fresh avocado / lime / cilantro D,G 12` should preview as `dish_name=Guacamole`, `description=fresh avocado / lime / cilantro`, `allergens=["D","G"]`, `price=12`
- footer blocks such as `ALLERGEN KEY`, pipe-delimited allergen legends, and the `consuming raw or undercooked...` warning should not appear in `preview`

## Service Startup Dependencies

- **typescript devDep:** Every TS service must declare `"typescript"` in its own `devDependencies`, not rely on the hoisted copy. A partial install can leave the hoisted copy broken; workspace-local ones are more resilient.
- **docx-redliner venv:** Node services shell out to `services/docx-redliner/venv/bin/python`. The venv must exist and have `python-docx`, `PyMuPDF`, `openai`, `python-dotenv`, `diff-match-patch` installed. `requirements.txt` is the source of truth.
- **start-services.sh port order:** db (3004), parser (3001), ai-review (3002), dashboard (3005), differ (3006), clickup (3007). Note docx-redliner is NOT started as a service — node invokes its Python scripts as subprocesses.
- **stop-services.sh port coverage:** Fallback kill covers 3000–3008. If you add a service on a new port, update it.
