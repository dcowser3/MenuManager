# Review-learning B3-A: shared coordinator and immutable envelope

B3-A consolidates the Basic full-review and offline adapters around one pure
dashboard coordinator. The adapters supply only the model callback; scope
selection, deterministic precheck, scoped vocabulary, prompt assembly, guarded
delivery, final reconciliation, and source-preserving merge are shared.

## Envelope contract

Each prepared review freezes a versioned envelope containing the original body
and hash, baseline provenance/hash, editable row spans, marked read-only
context, property/template/menu/allergen/footer context, prompt hash,
accepted-policy hash, vocabulary snapshot hash, model/settings identity, and
engine version. Unknown baseline provenance remains explicitly unknown.

Model edits are validated against the immutable prechecked source before any
replacement is applied. Unknown, duplicate, read-only, overlapping, or
ambiguous anchors fail closed. Non-overlapping edits are applied against the
original offsets, so an earlier length change cannot move a later edit.

Diagnostics are bounded and contain stages, reasons, source positions, hashes,
and unknown confidence; ordinary logs do not copy menu bodies. Existing Basic
response fields and four response markers remain unchanged.

Submission-boundary migration, document preparation, B7 active review units,
B8 receipt reuse, provider/model/settings changes, and deployment are outside
this slice.

## Verification

Focused tests cover adapter byte parity, frozen envelope/hash identity,
source-anchor mismatch, duplicate/unknown/read-only rejection, offset-safe
length changes, ambiguous whole-block fallback, managed raw/footer context,
and exactly one model callback per adapter run. The Basic route continues to
return its existing browser response shape.
