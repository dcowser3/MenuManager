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
tests run through an injected executor;
the runner derives report hashes and recomputes the before/after verdict. It
does not trust caller pass booleans, uploaded hashes, reduced test inventories,
or candidate reports. Baseline may fail only the named motivating assertions;
candidate must pass the complete identical inventory.

The assembled proof is checked by the repository's real B5-A integrity
verifier, including combined baseline/candidate rules, prompt, vocabulary,
expectation, settings, runtime and surviving-rule evidence. Two fresh paired
replay runs are derived from injected replay results. Every
case and correction must have a complete response contract, no fence error,
fresh report identity, no regression or extra-edit widening, and corrected
candidate output. Delivery-mismatch corrections require injected form-submit
evidence. B6-D1 outcomes are recomputed from the frozen artifact and injected
candidate evaluator output hashes.

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
through the fixed synchronous JavaScript test contract (`module.exports.run`).
TypeScript/Jest inventory is blocked until the image carries approved
transformer wiring; it is never silently downgraded.
`runCodeProposalProofWithDocker` rejects all caller executors and evaluators;
the launcher cannot attach proof or self-attest. Replay and delivery currently
return an explicit blocked protocol result because no fixed repository-owned
drivers exist yet; they never copy expected or corrected text into evidence.
