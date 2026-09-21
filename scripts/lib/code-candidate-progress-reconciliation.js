'use strict';

/** Derive local progress from the immutable broker ledger; never mutates it. */
function reconcileProviderProgress(progress, broker, requestId, validationError = null) {
    if (!progress || !broker || !requestId) throw new Error('Progress reconciliation requires progress, broker, and request identity.');
    const status = broker.requestStatus(requestId);
    if (!['completed', 'ambiguous'].includes(status)) return { ...progress };
    const reason = validationError ? 'draft_validation_failed' : status === 'completed' ? 'response_captured' : 'draft_dispatch_ambiguous';
    return {
        ...progress,
        phase: 'draft',
        state: 'blocked',
        reason,
        provider_calls: 1,
        budget: { ...(progress.budget || {}), model_calls: 1 },
        updated_at: new Date().toISOString(),
    };
}

module.exports = { reconcileProviderProgress };
