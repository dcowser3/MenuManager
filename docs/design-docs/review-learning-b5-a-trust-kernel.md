# Review-learning B5-A: code-proof trust kernel

B5-A adds a model-free trust boundary for code recommendations. The dashboard
recomputes a proposal-bound verification fingerprint and rejects declarations
that are missing, stale, incomplete, test-only, or inconsistent with trusted
before/after evidence. The fingerprint binds proposal identity, prompts,
rules, recommendations, correction routing, and immutable replay evidence;
mutable replay/approval status fields are intentionally excluded.

Frozen B6-D1 behavior expectations remain a required proof input, and the
B6-D2 replay-retirement policy must be present at the current version before
any code proof is eligible; stale or missing policy evidence fails closed.
Candidate-authored
tests are supplemental regression evidence only: they cannot replace trusted
regression suites, raw human ground truth, paired replays, or delivery proof.

The backend approval gate is applied by `promptProposalApprovalBlock`, which is
used by both the review page and the approval mutation route. Synthetic proof
may be retained for diagnostics, but cannot authorize approval. Worker
orchestration, browser delivery, database writers, Docker image/socket wiring,
deployment, and model execution are later B5 slices and are not part of B5-A.
