import type { OriginalReviewAudit } from './replay-retirement';

/**
 * Read-only binding result for the one audit that can establish original
 * response provenance.  The improvement cycle must never pick an audit by
 * recency when an attempt has more than one candidate.
 */
export type ReplayAuditBindingReason =
    | 'missing_submission_attempt'
    | 'wrong_attempt'
    | 'no_completed_full_audit'
    | 'ambiguous_completed_full_audit'
    | 'incomplete_audit'
    | 'malformed_audit';

export type ReplayAuditBinding =
    | { eligible: true; audit: OriginalReviewAudit; exact_candidate_count: 1 }
    | {
        eligible: false;
        reason: ReplayAuditBindingReason;
        exact_candidate_count: number;
      };

function objectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function requiredText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

/** Normalize only the exact persisted fields used by the retirement predicate. */
export function normalizeReplayAudit(row: unknown): OriginalReviewAudit | null {
    const source = objectRecord(row);
    if (!source) return null;
    const id = requiredText(source.id);
    const attemptId = requiredText(source.attempt_id);
    const createdAt = requiredText(source.created_at);
    const eventType = requiredText(source.event_type);
    const reviewMode = requiredText(source.review_mode);
    const request = objectRecord(source.ai_request);
    const response = objectRecord(source.ai_response);
    const finalResult = objectRecord(source.final_result);
    const requestText = requiredText(request?.text);
    const rawFeedback = requiredText(response?.rawFeedback);
    const correctedMenu = requiredText(finalResult?.correctedMenu);
    if (!id || !attemptId || !createdAt || !eventType || !reviewMode
        || !requestText || !rawFeedback || !correctedMenu) return null;
    return {
        id,
        attempt_id: attemptId,
        created_at: createdAt,
        event_type: eventType,
        review_mode: reviewMode,
        model: requiredText(source.model) || undefined,
        ai_request: { text: requestText },
        ai_response: { rawFeedback },
        final_result: { correctedMenu },
    };
}

/**
 * Bind exactly one completed/full audit to a submission attempt.  Wrong
 * attempts, legacy/changed-only rows, incomplete rows, and duplicate
 * completed/full rows are deliberately ineligible.
 */
export function bindReplayAudit(
    rows: unknown,
    submissionAttemptId: unknown,
): ReplayAuditBinding {
    const attemptId = requiredText(submissionAttemptId);
    if (!attemptId) return { eligible: false, reason: 'missing_submission_attempt', exact_candidate_count: 0 };
    if (!Array.isArray(rows)) return { eligible: false, reason: 'malformed_audit', exact_candidate_count: 0 };

    const exactRows = rows.filter((row) => objectRecord(row)?.attempt_id === attemptId);
    if (!exactRows.length) {
        return {
            eligible: false,
            reason: rows.length ? 'wrong_attempt' : 'no_completed_full_audit',
            exact_candidate_count: 0,
        };
    }
    const completedFullRows = exactRows.filter((row) => {
        const source = objectRecord(row);
        return source?.event_type === 'completed' && source?.review_mode === 'full';
    });
    if (!completedFullRows.length) {
        const hasChangedOnly = exactRows.some((row) => objectRecord(row)?.review_mode === 'changed_only');
        return {
            eligible: false,
            reason: hasChangedOnly ? 'no_completed_full_audit' : 'incomplete_audit',
            exact_candidate_count: 0,
        };
    }
    if (completedFullRows.length !== 1) {
        return {
            eligible: false,
            reason: 'ambiguous_completed_full_audit',
            exact_candidate_count: completedFullRows.length,
        };
    }
    const audit = normalizeReplayAudit(completedFullRows[0]);
    if (!audit) return { eligible: false, reason: 'incomplete_audit', exact_candidate_count: 1 };
    return { eligible: true, audit, exact_candidate_count: 1 };
}
