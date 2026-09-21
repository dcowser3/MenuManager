# Review-learning B6-D2b: Trusted same-attempt audit binding

This slice connects the existing fail-closed replay-retirement predicate to the
stored Basic AI Check audit stream. It does not add a producer, schema field, or
provider call.

## Binding contract

- The cycle reads the existing submission `form_attempt_id` and full audit
  fields (`ai_request`, `ai_response`, and `final_result`) through an injected,
  read-only lookup.
- Retirement requires exactly one `completed` + `full` audit for that exact
  attempt. Wrong-attempt, missing, legacy, changed-only, incomplete, malformed,
  and duplicate candidates remain ineligible; recency never selects a row.
- The bound `ai_request.text`, `ai_response.rawFeedback`, and
  `final_result.correctedMenu` are replayed through current deterministic guards
  only. The resulting evidence records `model_calls: 0`.
- A successful backend replay remains actionable unless the existing predicate
  also proves the original failed response, unchanged delivery, and a
  deterministic repair. API/submission differences stay `delivery_mismatch`
  with unknown attribution.

## Verification boundary

Pure synthetic tests cover exact binding, no/multiple/wrong-attempt,
incomplete/changed-only/legacy rows, malformed input, deterministic replay,
zero provider/model calls, and the existing delivery-mismatch and human-edit
ambiguity cases. The cycle persists only `status`, `observed_status`, and
`retirement_evidence` in the existing replay/evaluation JSON.

The replay-retirement policy version remains an explicit refresh requirement
for already-persisted proposals; this slice does not silently rewrite pending
proposal artifacts or add a refresh worker.

