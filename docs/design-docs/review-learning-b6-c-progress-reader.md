# Review-learning B6-C: Attempt-bound progress reader

This slice adds a standalone reader for automatic code-candidate progress artifacts. It is not wired into the worker, improvement cycle, proposal routes, or proposal view.

## Contract and intentional packet delta

The reader accepts on-disk progress only when the resolved file is below the trusted `tmp/code-proposals` root, no larger than 64 KiB, valid JSON, and bound to the candidate attempt. A readable trusted-root record bound to another attempt is a positive identity conflict and returns `null`; it never falls back to another attempt's state. Outside-root, symlink-outside, oversized, malformed, or unreadable files are unavailable/untrusted and may fall back to the owner-bound stored record.

Phases and states are allowlisted. Invalid values fail closed to `analysis` and `blocked`. Only an active or model-waiting record whose deadline has elapsed transitions to `failed` with `attempt_deadline_exceeded`; already-terminal `failed` and `verified` records remain terminal and preserve only a bounded stored reason (maximum 256 characters). The reader is display-only and does not mutate proof, ownership, persistence, or candidate state.

This is an intentional minimal deviation from the packet source: this slice makes the positive trusted-root attempt conflict an explicit early `null` outcome and assigns the deadline reason only when an active or model-waiting record actually transitions to failed, while preserving and bounding an existing terminal reason. The packet already retained owner-bound stored progress for failed/untrusted file reads; no other packet phase/state/deadline semantics were changed.

## Verification boundary

The focused current-branch suite has 10 filesystem and state tests using mkdtemp-owned fixtures and safe cleanup. It covers trusted-root acceptance, positive attempt conflicts, outside-root/symlink/oversize/malformed fallback, phase/state allowlists, deadline transitions, terminal states, bounded reasons, counters, and non-mutation. Worker integration, proposal UI/status, B5/B7/B8, provider, production, deployment, and paid quality remain deferred.
