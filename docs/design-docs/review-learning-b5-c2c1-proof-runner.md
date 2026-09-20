# Review-learning B5-C2c1: independent proof runner

B5-C2c1 consumes an already prepared and applied C2b candidate. It never
generates a candidate, accepts candidate-authored proof, invokes a provider, or
starts a worker. The runner revalidates the C1/C2a artifact topology and all
frozen proposal, parent-campaign, source, dataset, prompt, rules, and behavior
identities before creating a new owner-only verifier plan.

The plan binds the test-only image/runtime identity, current replay policy,
ordered dataset cases, two distinct replay seeds, the trusted B5-A regression
allowlist, supplemental candidate tests, correction mappings, and verifier
output paths. Baseline and candidate tests run through an injected executor;
the runner derives report hashes and recomputes the before/after verdict. It
does not trust caller pass booleans, uploaded hashes, reduced test inventories,
or candidate reports. Baseline may fail only the named motivating assertions;
candidate must pass the complete identical inventory.

Two fresh paired replay runs are derived from injected replay results. Every
case and correction must have a complete response contract, no fence error,
fresh report identity, no regression or extra-edit widening, and corrected
candidate output. Delivery-mismatch corrections require injected form-submit
evidence. B6-D1 outcomes are recomputed from the frozen artifact and injected
candidate evaluator output hashes.

Only an integrity-valid schema-v2 `test_only` proof is eligible for attachment
through the owner-bound B5-B store. Passing proof is written only after that
attachment succeeds. Any timeout, executor/replay error, stale identity,
tamper, integrity block, or store rejection records only failed owner-bound
progress and removes the passing proof artifact. The runner is credential-free
and offline-testable.

B5-C2c2 remains responsible for the fixed Docker launcher and external process
boundary. C2c1 does not open a Docker socket, call a provider, write the live
database, approve, deploy, or activate anything.
