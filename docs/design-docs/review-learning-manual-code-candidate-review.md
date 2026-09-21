# Manual code-candidate review handoff

The manual outer path selects one `code_recommendation` route and its matching
replay evidence plus `human_explanation` behavior record. It calls the existing
`prepareCodeProposalAttempt` boundary, preserving the attempt owner and raw
explanation fields.

Without a separate active `code-candidate` authorization/ledger, the path
retains the prepared attempt and writes a resumable blocked state with the
explicit reason `code_candidate_authorization_required`. It performs zero
provider calls and never marks the candidate failed, verified, approved,
activated, or deployed.

When tests supply a validated synthetic draft and an active authorization, the
path delegates to the existing `applyValidatedDraftWithHandoff` →
`runPreparedCodeProposalLifecycle` seam. Delivery-mismatch routes are surfaced
as `delivery_verification_required` and remain held without blocking unrelated
non-delivery code recommendations.

Browser delivery certification, broad proof matrices, auto-activation, and
generalized quality proof remain deferred pending a separately approved
browser containment design.
