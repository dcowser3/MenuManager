# Review-learning B5-C2b: bounded draft broker boundary

B5-C2b adds a callable, offline-testable boundary between a prepared B5-C1
attempt and a future model worker. It requires an explicit `code-candidate`
authorization whose scope hashes the attempt, parent campaign, proposal,
prompt, accepted rules, frozen dataset, source snapshot, behavior artifact,
and exact output root. The authorization names one canonical mutable ledger;
the broker validates that ledger before credentials or transport are used.

The broker reserves a request durably before transport, binds the exact model,
endpoint, bounded JSON request body, request identity, token sizing, and scope
hash, then settles only complete in-reservation usage. Transport, capture,
deadline, malformed-usage, model-identity, or over-reservation failures retain
the full reservation as `ambiguous`; request identities cannot be redispatched.
Every authorization carries an explicit finite request schedule, including the
single-request case; each entry pins its request identity, body hash, and token
reservation. Additional drafts or transport attempts require additional
explicit entries in that same authorization. Real runs select only the
code-candidate authorization environment and must use the pinned pricing
floor; synthetic runs reject provider credentials and accept only an injected
test transport. Terminal fixed-candidate/Stage-1 authority is never reused.

The orchestration binds `parentCampaignSha256` to the frozen proposal lineage
before dispatch and revalidates C1 artifacts through the C2a trusted-topology,
baseline-hash, behavior-validator, mapping, and patch boundary before a draft
request is dispatched. Responses must be bounded JSON, use the authorized
model, finish with `stop`, include complete usage, and have completed broker
accounting. Returned drafts can only be passed to C2a validation/application;
the boundary never runs tests or a verifier, writes `code_verification`, marks
a claim complete, approves, deploys, or activates.

B5-C2c remains responsible for the independent fresh baseline/candidate test
runner, behavior/replay/holdout proof, proof integrity, and bounded evidence
attachment. C2b has no provider/model activity in its credential-free tests.
