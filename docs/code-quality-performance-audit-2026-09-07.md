# Code quality, performance and verification audit — 2026-09-07

Implemented on `codex/slop-performance-dx`, based on `8d5be1db`, in a separate worktree. Subsequently merged into `main` at `8320f250` at the user's explicit request, preserving existing learning/evaluation work and reconciling five overlapping setup/documentation files. Post-merge verification passed eight focused suites / 111 tests. No shared service restart or deployment was performed. Existing frozen evaluation snapshots were not changed; evidence for those snapshots must not be presented as evidence for the newly merged checkout.

## Changes

| Area | Finding and fix |
| --- | --- |
| Dish-table filtering | Each filter event sorted and re-appended every row. Sorting now happens only during initialization and header clicks. Filtering preserves row order and updates visibility/counts. |
| Notifier | Removed the unused `generateRedlinedDoc` implementation, compiled copy, DOCX declaration and notifier-only dependency/lock entry. `/notify` already attaches the supplied corrected file. Other services retain their DOCX dependencies. |
| Form stages | Removed unused `STAGES`, `stageIndex` and `atLeast`, plus three tests whose only purpose was testing those unused exports. All 18 field/reveal behavior tests remain. |
| Parser | Deleted the obsolete 138-line `validator.ts.backup`; active validation is unchanged. |
| Developer workflow | Added read-only `dev:doctor` and isolated `dev:test`; replaced blanket port-killing instructions with checkout-ownership checks. Dev image includes Git for repository-based tests and the existing mail-disable test setup. |

No deterministic review rule or prompt changed, so no rule-manifest regeneration is needed.

## Measured performance

Chrome 152, 1,000 synthetic rows, ten filter events per run, six measured runs after warmup. Baseline/candidate order alternates; the benchmark checks identical row order, visibility and counts after every event. It includes browser layout work.

| Metric per ten filters | Baseline | Candidate |
| --- | ---: | ---: |
| Median elapsed time | 257.40 ms | 84.35 ms |
| Sort comparisons | 9,990 | 0 |
| Row moves | 10,000 | 0 |

This is approximately **3.1× faster** in a synthetic table, not a production latency guarantee. Reproduce with `npm run benchmark:approved-dishes -- 8d5be1db` after installing project dependencies and Chrome. The script starts no service and blocks browser network requests.

## Verification

- Fresh, separately tagged `menumanager/dev-audit:local` image built successfully, including clean dependency installation.
- Eight focused suites: **110 passed** (table, form stages/views, parser, SMTP configuration, doctor and snapshot runner).
- Tool suites rerun after image/lock checks: **20 passed**, overlapping the 110 above.
- Dashboard, notifier and parser workspace builds passed in a disposable, network-disabled Docker container. Changed browser assets match their `dist/public` copies; removed notifier artifact stays removed.
- Actual `dev:test` entry-point probes prove stale shared `dist` is rebuilt, container writes do not reach the checkout, an intentionally failing test exits 1, and a mismatched dependency lock is rejected.
- Live doctor reports the original checkout as owner of all seven shared ports and exits nonzero from this separate worktree. It does not restart anything or issue HTTP requests to another checkout's services. TCP reachability is explicitly distinct from application health.
- Live Docker fixture: actual `/form` and `/approved-dishes` Express routes, real EJS and changed assets passed browser checks with no JavaScript errors. Verified progressive reveal, brand navigation, natural/descending/numeric sort, combined filters, zero/singular/plural counts, server search and clear. Filtering produced zero table-row child-list mutations; served asset hashes match source. Data retrieval used synthetic fixtures; upload and AI completion state were injected. No actual upload, submission, approval or paid model call was tested or needed for these deletions/filter changes. Temporary fixture containers/networks were removed.

Local evidence is in this worktree's ignored `tmp/slop-audit/`: benchmark JSON, test/build logs, doctor JSON, runner integration results and browser evidence. The durable counts/methodology above are retained in this document.

## Verification tools

Use `npm run dev:doctor` (or `-- --json`) before startup/reset. Default Compose names and ports are fixed, so a different worktree or `-p` alone does not isolate a stack.

Use `DEV_TEST_IMAGE=menumanager/dev-audit:local npm run dev:test -- <source-test-path> [...]` for explicit focused Jest suites. The runner pins the image, checks its lockfile, snapshots current source into disposable storage, rebuilds shared libraries, disables networking and forwards the test exit code. It mounts no checkout or Docker socket and passes no host `.env`. Tests requiring samples or external integration fixtures need a separately isolated setup. See [local development](local-dev-troubleshooting.md#focused-tests-without-changing-a-running-stack).

## Deferred findings

The shared token diff builds a full quadratic LCS matrix even for unchanged text. A fast path is promising, but the module also feeds learning/improvement code. Leave it out of this branch until the current evaluation completes; require exact repeated-token alignment parity and evaluator verification before integrating it. No production speedup is claimed for that unimplemented idea.

Minor parser object wrapping was also identified. Its payoff is too small to justify incidental changes to active validation. This audit prioritizes proven dead code and measured work removal, rather than reducing line count indiscriminately.
