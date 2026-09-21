# Allergen Preservation Guard

## Invariant

The AI review may add allergen codes, but it must never remove a code that was
present in the deterministic pre-AI menu text. This is enforced in code and does
not depend on prompt compliance.

## Enforcement

The final post-AI guard compares each corrected row with the same submitted row.
If the model or any auto-applied suggestion removed one or more trailing allergen
codes, the guard restores those codes. Codes newly added by the review are kept,
so the output uses the union of the submitted and corrected code sets.

Explicit AI suggestions that recommend changing an allergen cluster to a smaller
set are removed. If row alignment is no longer safe, the guard fails closed by
returning the complete pre-AI menu rather than risking an allergen deletion.

The guard runs after model corrections, high-confidence suggestion application,
accepted-term canonicalization, set-menu handling, and price protection. Its
output is the source used for the final corrected menu and suggestion
reconciliation.

## Verification

Automated coverage verifies full-cluster removal, partial removal with an AI-added
code, custom configured codes, removal suggestions, unsafe row alignment, and the
complete post-AI pipeline.
