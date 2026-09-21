# Review-learning B5-C2c1: independent proof runner

B5-C2c1 consumes an already prepared and applied C2b candidate. It never
generates a candidate, accepts candidate-authored proof, invokes a provider, or
starts a worker. The runner revalidates the C1/C2a artifact topology and all
frozen proposal, parent-campaign, source, dataset, prompt, rules, and behavior
identities before creating a new owner-only verifier plan.

The C2b apply boundary atomically writes an owner-only handoff from the actual
validated draft and applied candidate bytes. It records recomputed patch,
draft-content, response, baseline, candidate, authorization, and scope hashes;
the next phase rejects hash-only or caller-invented handoffs. B5-B permits that
post-draft identity set to be added once to the still-running owner claim and
requires it for verified completion, then freezes it.

The plan binds the test-only image/runtime digests, current replay policy,
ordered dataset cases, two distinct replay seeds, the trusted B5-A regression
allowlist, supplemental candidate tests (new versus the baseline; historical
candidate tests remain paired only when byte-identical), exact C2b handoff/response/scope
hashes, frozen test bytes, and verifier output paths. Baseline and candidate
tests run through a fixed executor;
the runner derives report hashes and recomputes the before/after verdict. It
does not trust caller pass booleans, uploaded hashes, reduced test inventories,
or candidate reports. Baseline may fail only the named motivating assertions;
candidate must pass the complete identical inventory.

The assembled proof is checked by the repository's real B5-A integrity
verifier, including combined baseline/candidate rules, prompt, vocabulary,
expectation, settings, runtime and surviving-rule evidence. Under C2c2, two
fresh paired replay seeds execute the selected arm's actual dashboard review
pipeline in the fixed image with a test-only echo adapter; the host parses and
recomputes the response contract, fence, similarity, correction score, extra
edits, and run identity. Any missing corrected-menu fence or incomplete parsed
contract blocks before scoring; `run.cases` preserves the validated contract
flags rather than asserting success. The worker never receives ground truth or
expected outcomes and returns only delivered response/output bytes and bounded
diagnostics. A Docker end-to-end fixture reaches `pending_store` with paired
Jest, both replay seeds, and behavior outcomes using only `metadata.attempt_id`.
Every
case and correction must have a complete response contract, no fence error,
fresh report identity, no regression or extra-edit widening, and corrected
candidate output. Delivery-mismatch corrections remain blocked unless the fixed
delivery driver is available. B6-D1 outcomes execute every frozen behavior case
through the same candidate review pipeline and compare only host-derived output
hashes to the frozen artifact; mixed-rule proofs block when no trustworthy
activations are produced.

The repository verifier is always loaded from the trusted checkout. An
implementation-hash seam is accepted only from explicit test-mode callers;
rule, inventory, configuration, and integrity methods cannot be replaced by a
caller.

Only an integrity-valid schema-v2 `test_only` proof with a real or injected
B5-B attachment path is eligible for `verified`. Without a store it remains a
nonterminal `pending_store` staged diagnostic; the final proof is not written.
Passing proof is written only after that attachment succeeds. Any timeout, executor/replay error, stale identity,
tamper, integrity block, or store rejection records only failed owner-bound
progress and removes the passing proof artifact. The runner is credential-free
and offline-testable.

B5-C2c2 is implemented by `scripts/lib/code-proposal-docker-launcher.js` and
`scripts/code-proposal-c2c2-worker.js`. The launcher pins the inspected image
ID and a runtime identity derived from the checked-in launcher/worker, fixed
command, owner-contained read-only source/test mounts, per-run immutable request
file, container tmpfs output, network-none/no-new-privileges/cap-drop-all/pid
limits, allowlisted environment, bounded JSON, deadlines, labels, and
ownership-checked cleanup. Unit workers materialize a fresh arm workspace and
verify the frozen test-bundle manifest before running the identical inventory
through the image-owned Jest runner and pinned `ts-jest` transformer. The
worker is mounted as one exact file and receives only a hashed support bundle
(the reviewed Jest setup and TypeScript configs); the repository, `.git`, env
files, docs, and artifacts are never mounted. `/app/node_modules` remains the
immutable image dependency tree. A root staging phase chowns the materialized
workspace to root and locks it 0555/0444, then launches Jest and candidate code
under uid/gid 65532 with only SETUID/SETGID retained for that drop. Both
JavaScript and TypeScript inventories produce real Jest JSON reports; no custom
same-process test contract or caller-provided transformer is accepted.
`runCodeProposalProofWithDocker` rejects all caller executors and evaluators;
the launcher cannot attach proof or self-attest. Replay and behavior use the
repository-owned review-pipeline driver; delivery still returns an explicit
blocked protocol result because no fixed repository-owned delivery driver
exists. Support manifests reject unexpected files and the runtime identity is
re-derived before every invocation.

The owner-bound lifecycle coordinator is `scripts/lib/code-proposal-lifecycle.js`.
Its post-handoff phase revalidates the live owner/frozen identities, uses the
accepted B6-C progress reader, runs `runCodeProposalProofWithDocker`, and calls
B5-B storage before writing verified progress. `runPreparedCodeProposalLifecycle`
is the offline composition seam for an already validated C2a draft: it applies
the draft, persists the C2b handoff, then enters the same proof/attachment
phase. Resume accepts only an exact owner-bound verified proof or staged proof;
store rejection, deadline, delivery-driver absence, stale ownership, malformed
progress, and proof-integrity failures remain blocked/failed and cannot be
silently retried as verified. C1 preparation and model drafting remain an
upstream accepted component; this slice's default path begins at the validated
draft/handoff boundary and never invokes the model broker.
If storage is already verified while local progress is active or blocked, the
coordinator recovers only from an exact integrity-valid staged proof and never
reruns Docker or reattaches.
