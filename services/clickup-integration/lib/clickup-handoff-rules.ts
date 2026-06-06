export const ISABELLA_SUBMITTER_EMAIL = 'isabella@richardsandoval.com';
export const ISABELLA_DIRECT_HANDOFF_STATUS = 'sent_to_marketing';

export type ClickUpHandoffSubmissionLike = {
    status?: any;
    submitter_email?: any;
    submitterEmail?: any;
    raw_payload?: Record<string, any>;
};

export function normalizeClickUpLabel(value: any): string {
    return String(value || '').trim().toLowerCase();
}

export function isIsabellaSubmission(email: any): boolean {
    return normalizeClickUpLabel(email) === ISABELLA_SUBMITTER_EMAIL;
}

export function isDirectIsabellaMarketingHandoff(submission: ClickUpHandoffSubmissionLike): boolean {
    const status = normalizeClickUpLabel(submission?.status);
    if (status !== ISABELLA_DIRECT_HANDOFF_STATUS) return false;

    const rawPayload = submission?.raw_payload || {};
    return isIsabellaSubmission(submission?.submitter_email) ||
        isIsabellaSubmission(submission?.submitterEmail) ||
        isIsabellaSubmission(rawPayload.submitter_email) ||
        isIsabellaSubmission(rawPayload.submitterEmail);
}
