# Review-learning B6-A: Behavior-artifact core

This slice adds the offline behavior-artifact core that turns a human correction explanation into bounded, hash-frozen expectations before any proposal worker runs. It is additive and intentionally does not change the improvement cycle, replay retirement, candidate worker, proposal status UI, or runtime review behavior.

## Scope

- `services/dashboard/lib/learning-behavior-tests.ts` records human versus unverified authority, preserves the four-stage provenance references, excludes menu-content updates, and marks browser-repair support only when edit history or a no-human reproduction proves it.
- Accepted deterministic policies generate separator/case/quantity and wrong-scope families plus reviewer-supplied negative controls. Context-dependent and semantic variants remain abstention/contextual cases.
- Frozen artifacts carry a deterministic SHA-256 and reject post-freeze tampering or more than 5,000 generated tests.
- Deterministic execution reports per-variant hashes and a per-explanation disposition without claiming paired historical proof.

## Verification boundary

The focused current-branch suite has 7 tests covering authority, four-stage known/unknown handling, browser-repair evidence, menu-update exclusion, scoped families and semantic abstention, canonical scope resolution, deterministic execution, tamper rejection, and the test-count bound. Dashboard TypeScript compilation and emitted source/test parity are required for this slice.

This is synthetic engineering evidence only. The module is not wired into `improvement-cycle.js`, replay retirement, candidate drafting, approval, deployment, provider calls, production writes, or paid/quality evaluation. Those remain later B6 slices and must preserve the current accepted B2–B4 seams.
