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

The queue requires complete enumeration and one unique replay binding plus a
human-bound behavior record for each routed group. It re-reads the durable
proposal owner before recovery and fails closed on status, routing, authority,
source-binding, or inventory drift, and recovers a missing local summary only
after reconciling the durable owner, inventory, dataset, submission, and full
audit bindings. Existing `recordCodeVerification` remains
the optimistic pending-row compare-and-swap boundary; no new database table or
migration is used.

Without a separate active `code-candidate` authorization/ledger, the path
retains the prepared attempt and writes a resumable blocked state with the
explicit reason `code_candidate_authorization_required`. It performs zero
provider calls and never marks the candidate failed, verified, approved,
activated, or deployed.

The blocked marker is local progress evidence; the persisted owner claim stays
`running` so the same attempt can be resumed after an authorized ledger is
supplied. Before any real dispatch, the path re-reads that live owner claim and
rejects a changed or non-running attempt.

The legacy manual helper remains available for an explicitly authorized,
human-driven handoff, but the scheduled outer cycle now stops at the queue's
`code_candidate_authorization_required` boundary. Delivery-mismatch routes are
surfaced as `delivery_verification_required` and remain held without blocking
unrelated non-delivery groups.

Browser delivery certification, broad proof matrices, auto-activation, and
generalized quality proof remain deferred pending a separately approved
browser containment design.
