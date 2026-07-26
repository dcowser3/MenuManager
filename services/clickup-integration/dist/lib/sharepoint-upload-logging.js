"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSharePointUploadLogLine = buildSharePointUploadLogLine;
exports.logSharePointUploadEvent = logSharePointUploadEvent;
exports.describeSharePointSkip = describeSharePointSkip;
function compactLogDetails(details) {
    return Object.fromEntries(Object.entries(details)
        .filter(([, value]) => value !== undefined && value !== null && value !== ''));
}
function buildSharePointUploadLogLine(event, details = {}) {
    return `[sharepoint-upload] ${event} ${JSON.stringify(compactLogDetails(details))}`;
}
function logSharePointUploadEvent(event, details = {}) {
    console.log(buildSharePointUploadLogLine(event, details));
}
/**
 * Maps a SharePoint upload skip reason to the admin alert it deserves, or null
 * when the skip needs no alert.
 *
 * Both skip reasons used to be console-only for the routing case, so approvals
 * for the 41-of-52 properties with no SharePoint routing completed looking
 * healthy while the approved DOCX never left the box.
 */
function describeSharePointSkip(skipped, context) {
    const project = `${context.projectName || 'Untitled menu'}`;
    const property = `${context.property || 'unknown'}`;
    switch (`${skipped || ''}`) {
        case 'graph credentials not configured':
            return {
                alert_type: 'sharepoint_upload_skipped',
                severity: 'warning',
                message: `Skipped SharePoint upload for "${project}" because Graph credentials are not configured`,
                cooldownKey: 'sharepoint_upload_skipped',
            };
        case 'property has no sharepoint routing config':
            return {
                alert_type: 'sharepoint_property_unconfigured',
                severity: 'warning',
                message: `Approved DOCX for "${project}" was NOT uploaded: property "${property}" has no SharePoint routing config `
                    + '(needs sharepoint_base_folder_path plus either sharepoint_drive_id or site URL + library name). '
                    + 'Set it with scripts/sync-sharepoint-property.js.',
                cooldownKey: `sharepoint_property_unconfigured:${property}`,
            };
        default:
            return null;
    }
}
