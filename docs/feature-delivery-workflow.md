# Feature Delivery Workflow

Use this when adding or changing a feature in Menu Manager. It is the minimum process for getting from source edits to a real verified result.

Read this together with [Local Dev Troubleshooting](./local-dev-troubleshooting.md) when startup or build behavior is acting strange.

## Why `dist/` Exists

Most services in this repo are written in TypeScript, but local runtime uses built JavaScript:

- source files live in `services/<service>/index.ts`, `lib/`, `views/`, and `public/`
- `npm run build --workspace=@menumanager/<service>` compiles `.ts` into `services/<service>/dist/`
- `npm start --workspace=@menumanager/<service>` runs the built output, not the `.ts` files

Important implications:

- if source changes are not rebuilt, the running service will still serve old code from `dist/`
- dashboard builds also copy `views/` and `public/` into `services/dashboard/dist/`, so template or frontend changes can look “ignored” if the workspace was not rebuilt
- `dist/` is an artifact, not the source of truth; fix source first, then rebuild

## Required Feature Flow

1. Change the source files you actually mean to maintain.
2. Add or update automated tests for the new behavior.
3. Build every affected workspace.
4. Restart every affected service from the repo root.
5. Verify the changed behavior with a live request or browser check.
6. Update docs in the same change set.

Do not stop after static inspection, type-level confidence, or “the route exists in source.”

## Build Rules

Build only the workspaces you touched unless you need a full-stack reset:

```bash
npm run build --workspace=@menumanager/supabase-client --silent
npm run build --workspace=@menumanager/dashboard --silent
npm run build --workspace=@menumanager/db --silent
```

Good rule of thumb:

- changed shared library: rebuild the library and every service that consumes it
- changed dashboard EJS or public assets: rebuild `@menumanager/dashboard`
- changed DB route or persistence behavior: rebuild `@menumanager/db`

## Restart Rules

Start services from the repo root, not from inside `services/<service>/`, unless you are intentionally testing that exact cwd behavior.

Preferred commands:

```bash
npm start --workspace=@menumanager/dashboard
npm start --workspace=@menumanager/db
```

For a clean dashboard restart on port `3005`:

```bash
kill $(lsof -tiTCP:3005 -sTCP:LISTEN)
npm start --workspace=@menumanager/dashboard
```

For a broader stack restart:

```bash
./stop-services.sh
./start-services.sh
```

Use this only when you already know `dist/` is current:

```bash
SKIP_BUILD=1 ./start-services.sh
```

## Env Loading Nuance

Do not assume `.env` loads correctly just because a service starts.

What we learned from the approved-menu dashboard incident:

- a shared package was using `dotenv.config()` without an explicit path
- when the process cwd changed, Supabase credentials were not loaded
- the page still rendered, but it silently fell back to local JSON and showed the wrong result

Takeaway:

- shared libraries should resolve the repo-root `.env` explicitly when they depend on it
- if runtime behavior does not match a direct shell test, inspect the actual process environment

Useful check:

```bash
ps eww -p $(lsof -tiTCP:3005 -sTCP:LISTEN)
```

## Verification Requirements

Every feature change needs both automated coverage and a live check.

Automated verification examples:

- route/helper/unit test for new behavior
- focused Jest file for the changed module
- targeted build of the changed workspaces

Manual verification examples:

- `curl -i http://localhost:3005/approved-menus`
- open the page in the browser and confirm the changed UI
- test the actual download route for a real submission id

For route and page work, the minimum bar is:

1. build the affected workspace
2. restart the affected service
3. hit the real route
4. confirm expected status code and behavior

## When a Change Looks Missing

If a route or UI change is “not there,” check these in order:

1. Did the affected workspace rebuild successfully?
2. Does `dist/` contain the new code?
3. Did the old process get restarted off the port?
4. Is the running process using the env you expect?
5. Is the page failing because a downstream service is stale or missing?

Helpful commands:

```bash
rg -n "approved-menus" services/dashboard/index.ts services/dashboard/dist/index.js
lsof -iTCP:3005 -sTCP:LISTEN -n -P
curl -i http://localhost:3005/approved-menus
tail -n 80 logs/dashboard.log
```

## When Downloads Fail

Check all three layers:

1. the route exists and returns something other than `404 Cannot GET`
2. the submission/asset metadata points at a real approved file
3. the file actually exists on this machine inside the allowed `tmp/` storage roots

Remember:

- some historical records may store container paths like `/app/tmp/...`
- those may need translation to the local repo `tmp/` directory
- if the file is truly absent locally, the correct behavior is a clean `404`, not a fake successful download

## Final Checklist Before Reporting Done

- source changes are complete
- affected workspaces rebuilt successfully
- affected services restarted successfully
- automated tests were added or updated
- focused tests were run, or the failure to run them is called out clearly
- live route or UI verification was completed
- docs were updated in `docs/`
- `README.md` was updated when user-facing behavior or setup changed
