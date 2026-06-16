"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeApprovals = normalizeApprovals;
exports.normalizeSubmissionBody = normalizeSubmissionBody;
exports.normalizeDesignApprovalRequestBody = normalizeDesignApprovalRequestBody;
const upload_security_1 = require("./upload-security");
// Sanitize the chef-supplied approval entries. Each entry is stored as JSON and
// also drives the post-submit confirmation email, so trim/cap the strings and
// coerce `approved` to a boolean rather than trusting the raw client payload.
function normalizeApprovals(rawApprovals) {
    if (!Array.isArray(rawApprovals))
        return [];
    return rawApprovals
        .map((entry) => ({
        approved: entry?.approved === true || `${entry?.approved}`.toLowerCase() === 'true' || `${entry?.approved}`.toLowerCase() === 'yes',
        name: (0, upload_security_1.sanitizePlainTextInput)(entry?.name, { maxLength: 120 }),
        position: (0, upload_security_1.sanitizePlainTextInput)(entry?.position, { maxLength: 120 }),
        email: (0, upload_security_1.sanitizePlainTextInput)(entry?.email, { maxLength: 240 }).toLowerCase(),
    }))
        .filter((entry) => entry.name || entry.position || entry.email);
}
function normalizeSubmissionBody(body, tempUploadsDir) {
    const safeRevisionBaselineDocPath = body?.revisionBaselineDocPath
        ? (0, upload_security_1.assertPathInRoot)(`${body.revisionBaselineDocPath}`, tempUploadsDir, 'Baseline upload')
        : '';
    const safeMenuImagePath = body?.menuImagePath
        ? (0, upload_security_1.assertPathInRoot)(`${body.menuImagePath}`, tempUploadsDir, 'Menu image upload')
        : '';
    return {
        safeSubmitterName: (0, upload_security_1.sanitizePlainTextInput)(body?.submitterName, { maxLength: 120 }),
        safeSubmitterEmail: (0, upload_security_1.sanitizePlainTextInput)(body?.submitterEmail, { maxLength: 240 }).toLowerCase(),
        safeSubmitterJobTitle: (0, upload_security_1.sanitizePlainTextInput)(body?.submitterJobTitle, { maxLength: 120 }),
        safeProjectName: (0, upload_security_1.sanitizePlainTextInput)(body?.projectName, { maxLength: 180 }),
        safeProperty: (0, upload_security_1.sanitizePlainTextInput)(body?.property, { maxLength: 180 }),
        safeOrientation: (0, upload_security_1.sanitizePlainTextInput)(body?.orientation, { maxLength: 64 }),
        safeMenuType: (0, upload_security_1.sanitizePlainTextInput)(body?.menuType, { maxLength: 64 }),
        safeServicePeriod: (0, upload_security_1.sanitizePlainTextInput)(body?.servicePeriod, { maxLength: 64 }),
        safeTemplateType: (0, upload_security_1.sanitizePlainTextInput)(body?.templateType, { maxLength: 64 }) || 'food',
        safeDateNeeded: (0, upload_security_1.sanitizePlainTextInput)(body?.dateNeeded, { maxLength: 32 }),
        safeAssetType: (0, upload_security_1.sanitizePlainTextInput)(body?.assetType, { maxLength: 32 }),
        safeHotelName: (0, upload_security_1.sanitizePlainTextInput)(body?.hotelName, { maxLength: 180 }),
        safeCityCountryInput: (0, upload_security_1.sanitizePlainTextInput)(body?.cityCountry, { maxLength: 180 }),
        safeAllergens: (0, upload_security_1.sanitizePlainTextInput)(body?.allergens, { multiline: true, maxLength: 2000 }),
        safeMenuContent: (0, upload_security_1.sanitizePlainTextInput)(body?.menuContent, { multiline: true, maxLength: upload_security_1.MAX_LONG_TEXT_LENGTH }),
        safeMenuContentHtml: (0, upload_security_1.sanitizeRichTextHtml)(body?.menuContentHtml || ''),
        safePersistentDiffHtml: (0, upload_security_1.sanitizeRichTextHtml)(body?.persistentDiffHtml || ''),
        safePreservedFooterText: (0, upload_security_1.sanitizePlainTextInput)(body?.preservedFooterText, { multiline: true, maxLength: 4000 }),
        safeFileDeliveryNotes: (0, upload_security_1.sanitizePlainTextInput)(body?.fileDeliveryNotes, { multiline: true, maxLength: 2000 }),
        safeSubmissionMode: (0, upload_security_1.sanitizePlainTextInput)(body?.submissionMode, { maxLength: 32 }) || 'new',
        safeRevisionBaseSubmissionId: (0, upload_security_1.sanitizePlainTextInput)(body?.revisionBaseSubmissionId, { maxLength: 128 }),
        safeRevisionSource: (0, upload_security_1.sanitizePlainTextInput)(body?.revisionSource, { maxLength: 64 }),
        safeRevisionBaselineFileName: (0, upload_security_1.sanitizeStoredFileName)(body?.revisionBaselineFileName, 'baseline.docx'),
        safeBaseApprovedMenuContent: (0, upload_security_1.sanitizePlainTextInput)(body?.baseApprovedMenuContent, { multiline: true, maxLength: upload_security_1.MAX_LONG_TEXT_LENGTH }),
        safeMenuImageFileName: (0, upload_security_1.sanitizeStoredFileName)(body?.menuImageFileName, 'menu-upload'),
        normalizedApprovals: normalizeApprovals(body?.approvals),
        normalizedCriticalOverrides: Array.isArray(body?.criticalOverrides) ? body.criticalOverrides : [],
        safeRevisionBaselineDocPath,
        safeMenuImagePath,
    };
}
function normalizeDesignApprovalRequestBody(body) {
    const submitterName = (0, upload_security_1.sanitizePlainTextInput)(body?.submitterName, { maxLength: 120 });
    const submitterEmail = (0, upload_security_1.sanitizePlainTextInput)(body?.submitterEmail, { maxLength: 240 }).toLowerCase();
    const submitterJobTitle = (0, upload_security_1.sanitizePlainTextInput)(body?.submitterJobTitle, { maxLength: 120 });
    const existingDocxSubmissionId = (0, upload_security_1.sanitizePlainTextInput)(body?.existingDocxSubmissionId, { maxLength: 128 });
    const requiredApprovalsRaw = (0, upload_security_1.sanitizePlainTextInput)(body?.requiredApprovals, {
        multiline: true,
        maxLength: upload_security_1.MAX_JSON_FIELD_LENGTH,
        trim: false,
    }) || '[]';
    let requiredApprovals = [];
    try {
        requiredApprovals = JSON.parse(requiredApprovalsRaw);
        if (!Array.isArray(requiredApprovals)) {
            requiredApprovals = [];
        }
    }
    catch {
        requiredApprovals = [];
    }
    return {
        submitterName,
        submitterEmail,
        submitterJobTitle,
        existingDocxSubmissionId,
        requiredApprovals,
    };
}
