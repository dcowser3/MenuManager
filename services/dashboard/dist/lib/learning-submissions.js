"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortSubmissionId = shortSubmissionId;
exports.formatLearningSubmissionDisplay = formatLearningSubmissionDisplay;
exports.decorateLearningSubmissionsWithMenuNames = decorateLearningSubmissionsWithMenuNames;
function text(value) {
    return `${value ?? ''}`.trim();
}
function parseRawPayload(rawPayload) {
    if (!rawPayload)
        return {};
    if (typeof rawPayload === 'object')
        return rawPayload;
    if (typeof rawPayload !== 'string')
        return {};
    try {
        const parsed = JSON.parse(rawPayload);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function stripDocxExtension(value) {
    return value.replace(/\.docx$/i, '').trim();
}
function basenameFromPath(value) {
    const normalized = text(value);
    if (!normalized)
        return '';
    return normalized.split(/[\\/]/).pop() || '';
}
function filenameLabel(value) {
    const filename = basenameFromPath(value);
    if (!filename)
        return '';
    if (/^(form-\d+|[0-9a-f-]{20,})(?:-(?:approved|draft|final|corrected))?\.docx$/i.test(filename)) {
        return '';
    }
    return stripDocxExtension(filename).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function firstNonEmpty(...values) {
    return values.find((value) => text(value)) || '';
}
function shortSubmissionId(submissionId) {
    const normalized = text(submissionId);
    if (!normalized)
        return '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
        return normalized.split('-')[0];
    }
    return normalized.slice(0, 12);
}
function formatLearningSubmissionDisplay(item, metadata) {
    const submissionId = text(item.submission_id);
    const rawPayload = parseRawPayload(metadata?.raw_payload);
    const menuName = firstNonEmpty(text(metadata?.project_name), text(rawPayload.projectName), text(rawPayload.project_name), filenameLabel(metadata?.filename), filenameLabel(rawPayload.filename), filenameLabel(item.final_path), filenameLabel(item.ai_draft_path), submissionId);
    const property = firstNonEmpty(text(metadata?.property), text(rawPayload.property));
    const servicePeriod = firstNonEmpty(text(metadata?.service_period), text(rawPayload.servicePeriod), text(rawPayload.service_period));
    const filename = firstNonEmpty(filenameLabel(metadata?.filename), filenameLabel(rawPayload.filename));
    const shortId = shortSubmissionId(submissionId);
    const detailParts = [property, servicePeriod, filename]
        .map((part) => part.trim())
        .filter((part, index, parts) => part && parts.indexOf(part) === index && part !== menuName);
    if (shortId) {
        detailParts.push(shortId);
    }
    return {
        ...item,
        submission_display_name: menuName || submissionId || 'Unknown menu',
        submission_display_detail: detailParts.join(' | '),
        submission_short_id: shortId,
    };
}
async function decorateLearningSubmissionsWithMenuNames(items, fetchSubmissionMetadata) {
    const metadataById = new Map();
    const submissionIds = Array.from(new Set((items || [])
        .map((item) => text(item.submission_id))
        .filter(Boolean)));
    await Promise.all(submissionIds.map(async (submissionId) => {
        try {
            metadataById.set(submissionId, await fetchSubmissionMetadata(submissionId) || null);
        }
        catch {
            metadataById.set(submissionId, null);
        }
    }));
    return (items || []).map((item) => {
        const submissionId = text(item.submission_id);
        return formatLearningSubmissionDisplay(item, metadataById.get(submissionId));
    });
}
