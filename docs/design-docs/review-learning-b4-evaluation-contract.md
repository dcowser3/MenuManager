# B4-A evaluation contract integration

B4-A adds a fail-closed contract around retrospective and holdout evaluation without changing production review behavior.

The evaluator now:

- uses raw human expectations by default; the compatibility flag `--raw-ground-truth` no longer enables a different scoring path;
- supports explicit `retrospective` and `holdout` modes;
- requires a separately frozen holdout vocabulary and provenance, with no answer-key-derived vocabulary;
- validates frozen membership, lineage/near-duplicate signatures, optional chronology, and split hashes;
- records input, expectation, vocabulary, split, prompt, and rules hashes plus deterministic/fresh/cached freshness;
- rejects missing holdout artifacts and live dataset/rule fallback; and
- retires exposed holdout groups without mutating the original split.

The evaluation entrypoint delegates through the current B3 review-context/pipeline adapter, so evaluator prompts use the same coordinator context assembly. The added synthetic entrypoint smoke uses a stubbed response and asserts zero provider, database, and network calls.

Authoritative historical source was read from the immutable R4 packet source manifest. The copied contract and focused contract test match their packet SHA-256 values:

- `scripts/lib/evaluation-contract.js`: `2afc50f36fb13107a90642f714f61eacd396f5c06b69e8c5fe0b3f7e164160b3`
- `services/dashboard/__tests__/evaluation-contract.test.js`: `b76ff2c30a23ba2ca2a95a26e42e7b7184419680282b9caf0feb54ae00469d6a`

Verification in this slice was credential-free and network-disabled:

- B4 contract/helper suites: 2 suites, 20/20 tests passed;
- synthetic entrypoint smoke: passed, 8 assertions, provider/database/network calls 0;
- actual `review-eval.js` holdout CLI smoke: one frozen case, deterministic freshness, provider `none`, one report;
- B3 coordinator regression suites: 3 suites, 107/107 tests passed;
- dashboard TypeScript check passed in host and network-disabled Docker.

This is contract and orchestration evidence only. No paid/provider evaluation, clean chronological holdout quality claim, production write, deployment, activation, or shared-stack change was performed. B5/B6/B7/B8 source and approval flows remain outside this slice.
