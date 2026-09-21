# Review-learning B5-B: ownership-safe proof storage

B5-B adds a database-facing adapter for code-candidate claims and verification
evidence without opening a live database in this slice. It refetches the
pending proposal, rechecks the B5-A fingerprint, and updates only the
`eval_summary` JSON through an optimistic ownership predicate. The CAS keeps
the write body private and bounded: it predicates on the pending proposal id,
the JSON-path owner state, and the frozen behavior-artifact/owner identities
instead of placing the complete `eval_summary` JSON in the request URL.
Existing replay-retirement and behavior-artifact fields are preserved.

Claims are owned by a non-empty `attempt_id` with a valid start time. A fresh
running claim cannot be stolen; an invalid timestamp is never treated as
expired. Terminal writes require the same currently-running attempt and the
same proposal/source/dataset/behavior hashes. Proof attachments require that
owner and pass the B5-A integrity checker; test-only proof can be retained but
cannot authorize approval. The adapter never approves, deploys, sends mail,
or invokes a model.

The queue gate uses the current B6-D2 replay-retirement policy constant and
does not retry an unchanged terminal attempt unless explicitly forced.
Scheduler/worker entrypoints, schema changes, and live DB integration remain
deferred.

The initial owner claim requires an absent `code_candidate` plus an unchanged
behavior-artifact SHA-256 (or an unchanged absent artifact). Subsequent owner
updates require the exact current attempt and status and retain the frozen
owner identities. A competing claim, terminal transition, or stale worker
therefore returns an empty CAS result without overwriting evidence; no full or
private behavior payload is sent as a URL filter.
