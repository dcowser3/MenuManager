"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatSharePointDateSegment = formatSharePointDateSegment;
exports.sanitizeSharePointFilenameSegment = sanitizeSharePointFilenameSegment;
exports.buildSharePointApprovedFilename = buildSharePointApprovedFilename;
function formatSharePointDateSegment(value) {
    const candidate = `${value || ''}`.trim();
    const isoDate = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDate) {
        const month = Number.parseInt(isoDate[2], 10);
        const day = Number.parseInt(isoDate[3], 10);
        const year = isoDate[1].slice(-2);
        return `${month}.${day}.${year}`;
    }
    const parsed = candidate ? new Date(candidate) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = String(date.getFullYear()).slice(-2);
    return `${month}.${day}.${year}`;
}
function sanitizeSharePointFilenameSegment(value) {
    return String(value || '')
        .trim()
        .replace(/[\\/:*?"<>|#%]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function toFilenameTitleCase(value) {
    return value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}
function buildSharePointApprovedFilename(submission) {
    const propertyLabel = sanitizeSharePointFilenameSegment(String(submission?.property || '').split(' - ')[0] || submission?.property || 'Menu');
    const rawService = submission?.service_period || submission?.raw_payload?.servicePeriod || 'Other';
    const serviceLabel = sanitizeSharePointFilenameSegment(toFilenameTitleCase(String(rawService).replace(/_/g, ' '))) || 'Other';
    const dateLabel = formatSharePointDateSegment(submission?.date_needed);
    return `${propertyLabel}_${serviceLabel}_${dateLabel}.docx`;
}
