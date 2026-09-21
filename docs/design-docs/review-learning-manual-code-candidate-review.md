# Manual code-candidate review handoff

The outer preparation queue snapshots every routed explanation group beneath one
proposal-owned attempt. `scripts/lib/code-proposal-preparation-queue.js` sorts
groups by `correction_id`, records the proposal/cycle/supersession lineage,
replay/submission/case/audit/attempt bindings, human explanation and behavior
hashes, and writes a canonical private inventory before claiming the existing
`code_candidate` owner. The inventory also freezes the behavior, dataset,
source, prompt, and accepted-rule hashes. Pending-proposal enumeration is
bounded and paginated; an incomplete page chain fails closed. The queue is preparation-only: it never dispatches a
provider draft, even when authorization or dispatch callbacks are supplied by a
caller.

The queue requires complete pagination of the pending-proposal inventory and
processes proposals in a stable `(created_at, id)` order; one blocked proposal
does not abort unrelated proposals. It requires one unique replay binding plus a
human-bound behavior record for each routed group. It re-reads the durable
proposal owner before recovery and fails closed on status, routing, authority,
source-binding, or inventory drift, and recovers a missing local summary only
after reconciling the durable owner, inventory, dataset, submission, and full
audit bindings. Existing `recordCodeVerification` remains
the optimistic pending-row compare-and-swap boundary; no new database table or
migration is used.

The pending inventory is cutoff-bound and written under its content hash so
history is retained rather than overwritten. Resume requires the owner-bound
inventory digest, exact summary and progress ownership/disposition, zero model
calls, and all five frozen preparation hashes. A repeated correction across
pending proposals is rejected unless the newer proposal explicitly names the
older cycle as its supersession source.

Without a separate active `code-candidate` authorization/ledger, the path
retains the prepared attempt and writes a resumable blocked state with the
explicit reason `code_candidate_authorization_required`. It performs zero
provider calls and never marks the candidate failed, verified, approved,
activated, or deployed.

When an explicitly authorized handoff resumes a prepared attempt, C2b may
populate the existing candidate directory only when it contains exactly the
owner-bound 0600 progress artifact for that attempt. Baseline files are copied
around that progress file; conflicting entries, symlinks, mode changes, or
missing attempt identity remain fail-closed. This bridge is test-only evidence
for the handoff boundary and does not broaden the delivery certification scope.

The blocked marker is local progress evidence; the persisted owner claim stays
`running` so the same attempt can be resumed after an authorized ledger is
supplied. Before any real dispatch, the path re-reads that live owner claim and
rejects a changed or non-running attempt.

The legacy manual helper remains available for an explicitly authorized,
human-driven handoff, but the scheduled outer cycle now stops at the queue's
`code_candidate_authorization_required` boundary. Delivery-mismatch routes are
surfaced as `delivery_verification_required` and remain held without blocking
unrelated non-delivery groups.

Operators can run `node scripts/improvement-cycle.js --prepare-only` to consume
the existing pending backlog through this same preparation-only queue even when
the normal cadence gate would skip. This mode performs no proposal generation,
model/provider dispatch, email, approval, activation, or deployment.

Browser delivery certification, broad proof matrices, auto-activation, and
generalized quality proof remain deferred pending a separately approved
browser containment design.

The opt-in Docker integration fixture exercises two independent synthetic
post-handoff cycles with distinct attempt/artifact paths and test-only proof
labels. It is offline evidence only: it does not certify the real producer's
supersession wiring or permit approval, activation, deployment, or provider
dispatch.

Milestone 1 also has an opt-in coordinator integration fixture. It exercises
one pending proposal through the real preparation queue, manual review bridge,
C2b handoff, and network-none C2c2 proof using an in-memory PostgREST-shaped
store with exact pending-row compare-and-swap. Run it with
`RUN_REVIEW_LEARNING_COORDINATOR_INTEGRATION=1 npx jest --runInBand services/dashboard/__tests__/code-proposal-coordinator-integration.test.js`.
The fixture supplies a synthetic validated draft and a fatal draft-dispatch
callback, so it proves zero provider calls, exact submission/full-audit/rule
reads, verified store readback, and idempotent post-handoff resume. The source
snapshot scanner permits only the repository's documented non-secret provider
placeholders; key-shaped values and configured secret bytes remain rejected in
all scanned source and fixture files.
