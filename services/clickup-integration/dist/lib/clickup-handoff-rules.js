"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISABELLA_DIRECT_HANDOFF_STATUS = exports.ISABELLA_SUBMITTER_EMAIL = void 0;
exports.normalizeClickUpLabel = normalizeClickUpLabel;
exports.isIsabellaSubmission = isIsabellaSubmission;
exports.isDirectIsabellaMarketingHandoff = isDirectIsabellaMarketingHandoff;
exports.ISABELLA_SUBMITTER_EMAIL = 'isabella@richardsandoval.com';
exports.ISABELLA_DIRECT_HANDOFF_STATUS = 'sent_to_marketing';
function normalizeClickUpLabel(value) {
    return String(value || '').trim().toLowerCase();
}
function isIsabellaSubmission(email) {
    return normalizeClickUpLabel(email) === exports.ISABELLA_SUBMITTER_EMAIL;
}
function isDirectIsabellaMarketingHandoff(submission) {
    const status = normalizeClickUpLabel(submission?.status);
    if (status !== exports.ISABELLA_DIRECT_HANDOFF_STATUS)
        return false;
    const rawPayload = submission?.raw_payload || {};
    return isIsabellaSubmission(submission?.submitter_email) ||
        isIsabellaSubmission(submission?.submitterEmail) ||
        isIsabellaSubmission(rawPayload.submitter_email) ||
        isIsabellaSubmission(rawPayload.submitterEmail);
}
