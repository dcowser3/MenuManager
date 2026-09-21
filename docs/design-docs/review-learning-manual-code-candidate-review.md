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
`code_candidate_authorization_required` boundary. The manual helper binds every
`code_recommendation` route in one proposal in deterministic `correction_id`
order to exactly one replay-evidence row and exactly one human-explanation
behavior record. Submission, case, original-text, corrected-text, and behavior
span authority must agree; duplicate or incomplete bindings fail closed before
drafting. All groups share the one proposal-level owner attempt and the
unchanged full proposal is passed to C2b/C2c verification. A delivery-mismatch
member is surfaced in `deliveryHolds` as
`delivery_verification_required` and holds the aggregate, even when a caller
selects another member; no group is silently omitted or dispatched separately.

Operators can run `node scripts/improvement-cycle.js --prepare-only` to consume
the existing pending backlog through this same preparation-only queue even when
the normal cadence gate would skip. This mode performs no proposal generation,
model/provider dispatch, email, approval, activation, or deployment.

Browser delivery certification, broad proof matrices, auto-activation, and
generalized quality proof remain deferred pending a separately approved
browser containment design.

The opt-in Docker integration fixture exercises one synthetic post-handoff
cycle with test-only proof labels. It is offline evidence only: it does not
certify the real producer's supersession wiring or permit approval, activation,
deployment, or provider dispatch.

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

Milestone 2 extends the same opt-in suite with one preconstructed outer test
snapshot containing a carried, explicitly superseding second cycle, a
delivery-held code proposal, and a non-code prompt proposal. The fixture does
not claim to exercise the live pagination/enumeration reader; its independent
in-memory historical lookup test covers the exact `id`/`legacy_id` alias
semantics, including absent and ambiguous rows. The two authorized cycles each
use distinct attempts, patches, and baseline-fail/candidate-pass test mappings
whose input/output text is the frozen motivating production evidence. The
patches exercise the real pre-AI singular-ingredient normalizer, while the
approval/proof gate also rejects an `ineffective_proof_control` whose replay
evidence was tampered to leave the correction unresolved. Docker reports,
proof, and exact CAS/readback evidence remain distinct. Each run writes a
0600, independently reopened and hash-checked evidence summary during the run
beneath the repository `tmp/` directory; held delivery work stops before
handoff/proof and prompt-lane work receives no code-candidate owner. The
evidence remains test-only and does not authorize provider dispatch, approval,
activation, deployment, or production writes.

The opt-in suite also has one bounded real-Docker ineffective-patch control.
It applies an unrelated context-only patch whose mapped unit test passes only
in the candidate arm while the frozen motivating plural remains unresolved in
replay. The real paired-test/replay gate must fail before verified proof or
store attachment; the fixture records a failed verification progress state,
zero draft-dispatch calls, and no production write. This gate remains
unclaimed when Docker is unavailable.

Milestone 3 extends that fixture's in-memory boundary checks without another
Docker run. It consumes the actual staged proof generated by the proof runner
before any negative mutation to prove that a
store rejection leaves the local verification progress blocked and the live
owner running, that a crash after exact attachment can reconstruct the final
proof with zero verifier/attachment calls, and that a tampered or cross-cycle
staged proof fails closed. It also checks the real verification-store CAS
rejects an older attempt after a newer owner claim. The fixture restores the
successful cycle's live row, progress, final proof, and staged-proof bytes
before reopening the 0600 evidence summary; all mutations are confined to the
test-only in-memory client and temporary attempt roots. Each integrity-valid
proof is explicitly marked `test_only` and the approval gate reports the
specific synthetic-verification policy block.
