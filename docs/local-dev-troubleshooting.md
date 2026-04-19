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

## Service Startup Dependencies

- **typescript devDep:** Every TS service must declare `"typescript"` in its own `devDependencies`, not rely on the hoisted copy. A partial install can leave the hoisted copy broken; workspace-local ones are more resilient.
- **docx-redliner venv:** Node services shell out to `services/docx-redliner/venv/bin/python`. The venv must exist and have `python-docx`, `PyMuPDF`, `openai`, `python-dotenv`, `diff-match-patch` installed. `requirements.txt` is the source of truth.
- **start-services.sh port order:** db (3004), parser (3001), ai-review (3002), dashboard (3005), differ (3008), clickup (3007). Note docx-redliner is NOT started as a service — node invokes its Python scripts as subprocesses.
- **stop-services.sh port coverage:** Fallback kill covers 3000–3008. If you add a service on a new port, update it.
