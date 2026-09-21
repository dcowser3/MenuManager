# Review-learning B3: shared coordinator, immutable envelope, and submission boundary

B3-A consolidates the Basic full-review and offline adapters around one pure
dashboard coordinator. The adapters supply only the model callback; scope
selection, deterministic precheck, scoped vocabulary, prompt assembly, guarded
delivery, final reconciliation, and source-preserving merge are shared.

## Envelope contract

Each prepared review freezes a versioned envelope containing the original body
and hash, an explicit raw-input snapshot/hash, the normalized/prechecked model
input snapshot/hash, baseline provenance/hash, editable row spans, marked
read-only context, property/template/menu/allergen/footer context, prompt
hash, accepted-policy hash, vocabulary snapshot hash, model/settings identity,
and engine version. Editable coordinates are explicitly based on the
`prechecked_review_body` snapshot, never on raw input offsets. Unknown baseline
provenance remains explicitly unknown.

The prepared object fields consumed at completion (prechecked body, scoped
near-miss findings, prompt, embedded analysis, context, and options) are
deep-frozen and hash-bound. Completion verifies those bindings and fails closed
to the immutable source if any field or nested value drifts after preparation.
Completion consumes the frozen integrity snapshot—not mutable caller-facing
siblings—and validates the whole envelope plus managed-footer, allergen,
sanitized-body, and deterministic-precheck identities. Missing or malformed
integrity metadata is also a rejected review, never an exception path.

Model edits are validated against the immutable prechecked source before any
replacement is applied. Unknown, duplicate, read-only, overlapping, malformed,
or ambiguous anchors fail closed, including duplicate span identities,
overlapping editable spans, and multiple zero-length insertions at one offset.
Non-overlapping edits are applied against the original offsets, so an earlier
length change cannot move a later edit. Final suggestions, critical flags,
guards, status, and diagnostics are reconciled from the delivered bytes; a
rejected model mutation cannot leak its candidate state into the result.

Diagnostics are bounded and contain stages, reasons, source positions, hashes,
and unknown confidence; ordinary logs do not copy menu bodies. Existing Basic
response fields and four response markers remain unchanged. The HTTP adapter
keeps legacy attempt diagnostics but exposes a bounded `delivered` diagnostic
section and review status sourced from the authoritative delivered state. The
offline adapter and HTTP handler therefore share exact delivered bytes,
suggestions, critical state, guard/reconciliation decisions, footer policy, and
rejection semantics. Genuine unresolved critical findings are rederived from
the immutable delivered source after a rejected candidate merge; rejected
candidate-only findings are discarded. Existing Basic response fields and four
response markers remain unchanged.

Canonical spelling warnings and adjudications follow the same rule: when a
candidate merge is rejected, they are rederived from the exact delivered bytes
using the frozen near-miss findings, so a restored token remains an
unresolved/advisory warning rather than being marked corrected by the rejected
candidate. Attempt structure and spelling diagnostics remain separately labeled
in form-attempt audit details.

## B3-B submission boundary

New form submissions use an additive `/v1/coordinator-review` adapter. The
dashboard prepares the frozen B3 envelope, sends one model request containing
only the prechecked body and frozen prompt identities, then completes the
review through `completePreparedReview`. The shared
`@menumanager/review-contract` binds actual text/prompt hashes, schema/engine,
caller-attested source/context/policy/vocabulary identities, effective
provider/model/temperature/seed semantics, and a one-run replay identity into
one canonical digest. AI review recomputes the hashes and digest before any
provider call and rejects version, replay, hash, or execution-identity
mismatches. Caller attestations are explicitly bound claims, not independently
verified facts. The legacy `/ai-review` endpoint and `/run-qa-check` route
remain available for existing clients.

The execution identity is resolved once before preparation and records both the
configured options and adapter-effective wire options. Reasoning models that
omit temperature or seed retain those omissions in the bound identity, so
non-default temperature and disabled-seed settings remain auditable without
inventing wire values. The coordinator response is intentionally minimal
(hashes, digest, attestations, effective identity, feedback, requested/observed
model, and finish reason) and never echoes raw menu text or prompt. Only
`finish_reason: "stop"` can produce a reviewed draft; null, missing, length,
content-filter, truncated, or unknown finishes remain incomplete/manual review.

Replay protection is process-local and bounded to 1,024 identities with a
15-minute expiry; duplicate and capacity claims fail closed. The legacy routes
are exercised by focused validation tests, including a mocked successful
`/ai-review` call that asserts the configured seed wire, while the versioned
route uses the shared contract. Requested and observed model identifiers must
match exactly; snapshot/alias drift is rejected.

Completed and rejected coordinator results carry bounded output/policy/context
hashes, engine identity, complete/transport/reusable status, reason, and
artifact provenance into the existing form-attempt audit surface. Known
terminal success is required for a reviewed draft; incomplete, rejected,
transport-failed, malformed, or mismatched output remains manual review and
gets an `unreviewed_fallback` provenance with no `ai_draft_path`. Successful
draft generation receives only authoritative delivered coordinator bytes,
while the original submitted document is preserved separately.

B3-B submission-boundary migration and document preparation are complete;
B7 active review units,
B8 receipt reuse, provider/model/settings changes, and deployment are outside
this slice.

## Verification

Focused tests cover adapter byte parity (successful and rejected merges),
frozen envelope/hash identity and prepared-state drift, raw/prechecked
provenance, source-anchor mismatch, duplicate/unknown/read-only rejection,
malformed and overlapping spans, zero-length insertion ambiguity, offset-safe
length changes, ambiguous whole-block fallback, managed raw/footer context,
and exactly one model callback per adapter run. HTTP-vs-offline parity covers a
successful edit, a rejected merge, managed-footer removal, an earlier
length-changing deterministic precheck, a later model edit, and delivered
spelling evidence. The Basic
route continues to return its existing browser response shape with additive
status/delivered diagnostics.

B3-B verification: 4 focused suites, 37 tests passed (shared contract,
ai-review adapter, and actual dashboard submit-handler → exported dashboard
coordinator → mocked transport, plus the legacy route). Coverage includes accepted and rejected
delivery, late/malformed/version/hash/digest/settings/replay negatives,
known-terminal-status enforcement for every non-stop finish, one provider call
for valid input and zero provider calls for invalid envelopes, legacy
compatibility, exact bytes passed into draft generation, persisted
original-versus-authoritative-DOCX parity using the real template/generator and
Mammoth parser in the isolated Docker venv, failed-review no-draft publication,
source-derived late-rejection findings, and bounded replay capacity/expiry.
Dashboard, ai-review, and shared-contract typechecks/builds passed; source/dist
diffs are included. The host-only run skips the real-template test when its
Python DOCX venv is absent. No live provider or production/activation writes
were used.
