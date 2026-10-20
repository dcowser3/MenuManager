# Repo hygiene pass, 2026-10-20

Scope: remove only provably unused code and dependencies. No change to review behavior, prompts, rulebooks, `sop-processor/`, `config/`, `services/diff-core/`, AI review, learning or improvement-loop code, price checks, or `archive/`. No dependency version changes.

## Method

- CI reproduced locally from `.github/workflows/ci.yml`: Node 24.22 (the container ships Node 22, so Node 24 was installed from npm), `npm ci`, shared libraries built first, then `npm run build --workspaces --if-present`, `npx jest --ci`, `npm run test:business`, and docx-redliner `pytest` (Python 3.13 here, CI uses 3.11).
- Candidates found with `knip` and `depcheck`, then confirmed by grepping the whole repo (excluding `node_modules`, `dist`, `archive`) for source imports, dynamic `require` strings, EJS views, `package.json` scripts, Dockerfiles, docker-compose files, workflows and tests.
- A package only counted as unused when nothing imported it, and a file only counted as dead when nothing referenced it by name.

## Removed

| Item | Why it is safe |
|------|----------------|
| `services/parser/src/validator.ts.backup` | Pre-tenant-config copy of `validator.ts`. `tsc` ignores the extension and nothing references it. |
| `services/notifier/src/doc-generator.ts` and tracked `services/notifier/dist/src/doc-generator.js` | No importer anywhere (notifier index, other services, scripts, tests, docs, Docker files). |
| `docx` dependency of `@menumanager/notifier` | Only used by the removed `doc-generator.ts`. |
| `docx` dependency of `@menumanager/parser` | Parser uses `mammoth`; `docx` is never imported. |
| `axios` dependency of `@menumanager/differ` | Never imported by differ. The hoisted axios used by other workspaces is untouched. |
| `@types/isomorphic-fetch` (root devDependency) | Nothing imports `isomorphic-fetch`; `fetch` types come from the Node/DOM libs. Verified by a clean full build and a full Jest run (ts-jest type-checks the tests). |
| (added) `coverage/` in `.gitignore` | Jest writes it locally; it was not ignored. |

Lockfile changes are deletions only (`npm uninstall`), and `npm ci` from the edited lockfile succeeds.

## Test results

| Check | Baseline (main, 0c2046d) | After this branch |
|-------|--------------------------|-------------------|
| Build, all workspaces | pass | pass |
| Jest | 147 suites passed, 2 skipped; 1845 tests passed, 8 skipped | identical |
| Cucumber | 6 scenarios, 29 steps passed | identical |
| docx-redliner pytest | 30 passed | identical |

No test failed or was flaky at baseline, so there was nothing to re-run. The 2 skipped suites are env-gated (`RUN_C2C2_DOCKER_E2E=1` and `RUN_REVIEW_LEARNING_COORDINATOR_INTEGRATION=1`), so they are skipped in CI as well.

## Candidates not touched (need a decision from the owner)

Dead or unused, but inside a restricted area or a human-run tool, so left alone:

- `services/ai-review/src/docx-builder.ts`, `docx-generator.ts`, `docx-modifier.ts` (and their `dist/src/*.js`): no importers. They are the only users of ai-review's `diff`, `docx` and `pizzip` dependencies, so those three could go with them. Left because they live in the AI review service.
- `@types/axios` in `services/ai-review` (axios ships its own types). Same reason.
- Root `express` and `@types/express`: knip flags them as unused at root, but other workspaces may resolve express through hoisting. Needs a per-workspace check before removal.
- Unused exports (47 values, 55 types) are concentrated in `review-pipeline.ts`, `pre-ai-deterministic-rules.ts`, `price-shapes.ts`, `improvement-cycle-core.ts` and similar. Un-exporting does not change behavior but touches restricted files.
- Operator scripts with no reference in code or docs: `scripts/backfill-sharepoint-all.js`, `backfill-sharepoint-imports.js`, `canonical-vocabulary-report.js`, `cleanup-draft-sessions.js`, `extract-atomic-rules.js`, `reconcile-contextual-descriptors.js`, `test-review-learning-evaluation-entrypoint.js`. They may be run by hand, so they were kept.
- `services/db/dish-allergens.ts` is flagged unused but documents itself as a CLI (`npx ts-node dish-allergens.ts add ...`).
- Committed `dist/` drift: on `main`, a fresh build changes 16 tracked files under `services/dashboard/dist/` and `services/differ/dist/` and adds 8 untracked ones (for example `price-shapes.js`). The committed `dist/` is behind source. This branch does not commit those build outputs. Consider untracking `dist/` or rebuilding it in a dedicated change.
- Working-copy tip: macOS/iCloud duplicate files named `* 2.*` keep appearing in checkouts. A `.gitignore` pattern such as `* 2.*` would stop them showing as untracked; not added here.
