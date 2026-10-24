# Repo hygiene pass 2, 2026-10-22

Follow-up to the 2026-10-20 pass (draft PR #16, `docs/repo-hygiene-2026-10-20.md` on `claude/hygiene-2026-10-20`). This branch starts from `main`, not from that branch, and is independent of it. Same rules: remove only provably unused code and dependencies. No change to review behavior, prompts, rulebooks, `sop-processor/`, `config/`, `services/diff-core/`, learning or improvement-loop code, price checks, or `archive/`. No dependency upgrades.

## Method

- CI reproduced locally from `.github/workflows/ci.yml` on Node 24.22: `npm ci`, shared libraries built first, `npm run build --workspaces --if-present`, `npx jest --ci`, `npm run test:business`, and docx-redliner `pytest` (Python 3.13 here, CI uses 3.11).
- Candidates came from `knip` and from a name-based grep of the whole repo (excluding `node_modules`, `dist`, `archive`, `.git`, `package-lock.json`) covering source imports, dynamic `require` strings, EJS views, `package.json` scripts, Dockerfiles, compose files, the CI workflow, shell scripts, tests and docs.
- A baseline was recorded on `main` before any edit, and the full suite was rerun after a clean `npm ci` from the edited lockfile.

## Removed

| Item | Evidence it is safe |
|------|---------------------|
| `services/ai-review/src/docx-builder.ts`, `docx-generator.ts`, `docx-modifier.ts` and their tracked `services/ai-review/dist/src/*.js` | No importer or filename/class-name reference anywhere (`ai-review/index.ts` imports nothing from `./src`; no tests, scripts, views, Docker or CI references; no doc mentions them). `tsc` for ai-review passes without them. |
| `diff`, `docx`, `pizzip` dependencies of `@menumanager/ai-review` | Their only importers were the three files above. No other workspace or script imports `diff` or `pizzip`. The `docx` that notifier and parser declare is a separate nested copy (v8) and is untouched. |
| Root `express` dependency | No root-level code uses it: nothing under `scripts/`, `demos/`, `deploy/`, `docker/`, `.github/`, or the root jest, cucumber and tsconfig files imports `express`. All 7 services that use it declare their own `express ^4` and resolve their own nested copy (`npm ls express` shows 4.22.1 for each). `npm ci` from the edited lockfile and the full suite pass. The lockfile change is deletions of the hoisted express 5 tree (21 packages) plus `"dev": true` on `debug`, `once`, `wrappy`, which are now reachable only from dev tooling; no Dockerfile or workflow uses `--omit=dev`. |

## Test results

| Check | Baseline (`main`, 0c2046d) | After this branch |
|-------|----------------------------|-------------------|
| Build, all workspaces | pass | pass |
| Jest | 147 suites passed, 2 skipped; 1845 tests passed, 8 skipped | identical |
| Cucumber | 6 scenarios, 29 steps passed | identical |
| docx-redliner pytest | 30 passed | identical |

The 2 skipped suites are env-gated (`RUN_C2C2_DOCKER_E2E=1`, `RUN_REVIEW_LEARNING_COORDINATOR_INTEGRATION=1`) and skipped in CI as well. Not verified: a live service start (Docker dev stack); the removals touch no route or runtime path that imports them, and the build, typecheck and Jest suites cover every remaining service.

## Tracked `dist/` drift (report only, nothing committed)

`docs/feature-delivery-workflow.md` calls `dist/` an artifact and does not require committing rebuilt output with source changes, so no rebuilt `dist/` is in this branch. A fresh build on `main` (before and after this branch, identically) changes 16 tracked files and adds 8 untracked ones:

- Modified, `services/dashboard/dist/`: `index.js`, `lib/apply-high-confidence-suggestions.js`, `lib/human-explanation-source-binding.js`, `lib/pre-ai-deterministic-rules.js`, `lib/price-integrity-guard.js`, `lib/raw-marker-integrity-guard.js`, `lib/review-pipeline.js`, `lib/review-rules-manifest.js`, `public/js/form-helpers.js`, `views/form.ejs`, `views/form-legacy.ejs`, `__tests__/human-explanation-source-binding.test.js`, `__tests__/price-integrity-guard.test.js`, `__tests__/review-pipeline.test.js`.
- Modified, `services/differ/dist/`: `index.js`, `lib/learning-source-revision.js`.
- Untracked, dashboard: `lib/price-shapes.js`, `lib/learning-comparison-loader.js`, `__tests__/learning-comparison-loader.test.js`, `__tests__/line-price-detection.test.js`, `__tests__/price-shapes.test.js`, `public/vendor/` (quill).
- Untracked, differ: `lib/comparison-source.js`, `__tests__/comparison-source.test.js`.

Suggestion: untrack `dist/` (242 tracked files) or rebuild it in a dedicated change.

## Candidates not touched

- **Unused exports (knip: 122 values, 48 types).** Almost all are in restricted areas (`review-pipeline.ts`, `pre-ai-deterministic-rules.ts`, `canonical-vocabulary.ts`, `price-shapes.ts`, `improvement-cycle-core.ts`, `learning-*`, `human-explanation-source-binding.ts`, `menu-footer.ts`, which `review-rules-manifest.ts` parses). Outside those areas, every flagged function is still used inside its own file or by a test, so only an un-export would be possible, which removes nothing. Entirely dead functions (defined, no caller anywhere): `containsCanonicalRawNotice` (`menu-footer.ts`), `reviewGlobalContextHash` (`review-context.ts`), `deriveCandidateEnvelope` (`expectation-versioning.ts`). All three are in review or improvement-loop code, so they were left.
- **Operator scripts with no code reference.** `canonical-vocabulary-report.js`, `extract-atomic-rules.js`, `reconcile-contextual-descriptors.js`, `test-review-learning-evaluation-entrypoint.js` are unreferenced but sit in review vocabulary, the improvement loop and learning evaluation (restricted). `cleanup-draft-sessions.js` is unreferenced by name, but `docs/draft-concurrency-lineage-implementation-spec.md` mentions "cleanup script keeps newest", so it was left.
- **Other knip "unused file" hits that are false positives**, all in use: `services/docx-redliner/clean-menu-extraction.js` (required by dashboard and clickup-integration), `services/dashboard/public/js/*` and `public/vendor/quill` (script tags and tests), `services/db/dish-allergens.ts` (documented CLI), and the scripts that docs or `package.json` reference.
- **`@types/express` at the repo root.** Likely removable the same way as root `express`, but the line sits directly next to `@types/isomorphic-fetch`, which PR #16 removes, so editing it here would create a merge conflict between the two PRs. Do it after PR #16 merges. Both PRs edit `package.json` and `package-lock.json` on different lines: PR #16's diff was applied on top of this branch with `git apply --3way` and applied cleanly. If a future merge does conflict, rerun `npm install` to regenerate the lockfile.
- **`@types/axios` in `services/ai-review`.** axios ships its own types; not tied to the docx files, so left for a separate decision.
- **Dead untouched `archive/services/inbound-email`**: out of scope by rule.

Update Oct 24: the removal of `scripts/backfill-sharepoint-all.js` and `scripts/backfill-sharepoint-imports.js` was reverted before merge. They are hand-run operator tools, so they stay until Derian confirms they are unused.
