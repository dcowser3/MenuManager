# Review-learning B6-D2a: Fail-closed replay-retirement routing

This slice carries the accepted B6-B retirement predicate into the existing
improvement-cycle routing boundary without adding an audit producer.

## Contract

- `now_correct` is an observation unless `isReplayRetirementVerified(...)`
  proves a completed same-attempt original audit, unchanged delivery, a failed
  original response, and a zero-model-call deterministic repair.
- The cycle stores backend observations as `observed_status`; unverified
  `now_correct` observations are persisted and routed as
  `verification_required`, remaining actionable.
- Only verified evidence can leave the proposal context or receive an
  `already_correct`/retired route. Missing, malformed, changed-only,
  wrong-attempt, lost-delivery, human-edit-ambiguous, legacy, and non-success
  evidence fail closed.

No new audit producer, database column, provider call, worker/UI/approval path,
or B6-C/B5/B7/B8 wiring is included. The next D2b slice must bind a real
completed audit producer to the existing predicate before any production
retirement can occur.

## Verification boundary

Focused core and replay-retirement tests cover verified retirement, bare and
malformed legacy `now_correct`, missing/wrong-attempt/changed-only provenance,
delivery mismatch, human-edit ambiguity, and non-now-correct actionability. A
source-level cycle assertion rejects any status-only local resolved-ID filter.
