import {
    MAX_LONG_TEXT_LENGTH,
    MAX_JSON_FIELD_LENGTH,
    assertPathInRoot,
    sanitizePlainTextInput,
    sanitizeRichTextHtml,
    sanitizeStoredFileName,
} from './upload-security';

export type NormalizedSubmissionBody = {
    safeSubmitterName: string;
    safeSubmitterEmail: string;
    safeSubmitterJobTitle: string;
    safeProjectName: string;
    safeProperty: string;
    safeOrientation: string;
    safeMenuType: string;
    safeServicePeriod: string;
    safeTemplateType: string;
    safeDateNeeded: string;
    safeAssetType: string;
    safeHotelName: string;
    safeCityCountryInput: string;
    safeAllergens: string;
    safeMenuContent: string;
    safeMenuContentHtml: string;
    safePersistentDiffHtml: string;
    safePreservedFooterText: string;
    safeFileDeliveryNotes: string;
    safeSubmissionMode: string;
    safeRevisionBaseSubmissionId: string;
    safeRevisionSource: string;
    safeRevisionBaselineFileName: string;
    safeBaseApprovedMenuContent: string;
    safeMenuImageFileName: string;
    normalizedApprovals: NormalizedApproval[];
    normalizedCriticalOverrides: any[];
    safeRevisionBaselineDocPath: string;
    safeMenuImagePath: string;
};

export type NormalizedApproval = {
    approved: boolean;
    name: string;
    position: string;
    email: string;
};

// Sanitize the chef-supplied approval entries. Each entry is stored as JSON and
// also drives the post-submit confirmation email, so trim/cap the strings and
// coerce `approved` to a boolean rather than trusting the raw client payload.
export function normalizeApprovals(rawApprovals: unknown): NormalizedApproval[] {
    if (!Array.isArray(rawApprovals)) return [];
    return rawApprovals
        .map((entry: any) => ({
            approved: entry?.approved === true || `${entry?.approved}`.toLowerCase() === 'true' || `${entry?.approved}`.toLowerCase() === 'yes',
            name: sanitizePlainTextInput(entry?.name, { maxLength: 120 }),
            position: sanitizePlainTextInput(entry?.position, { maxLength: 120 }),
            email: sanitizePlainTextInput(entry?.email, { maxLength: 240 }).toLowerCase(),
        }))
        .filter((entry) => entry.name || entry.position || entry.email);
}

export function normalizeSubmissionBody(body: any, tempUploadsDir: string): NormalizedSubmissionBody {
    const safeRevisionBaselineDocPath = body?.revisionBaselineDocPath
        ? assertPathInRoot(`${body.revisionBaselineDocPath}`, tempUploadsDir, 'Baseline upload')
        : '';
    const safeMenuImagePath = body?.menuImagePath
        ? assertPathInRoot(`${body.menuImagePath}`, tempUploadsDir, 'Menu image upload')
        : '';

    return {
        safeSubmitterName: sanitizePlainTextInput(body?.submitterName, { maxLength: 120 }),
        safeSubmitterEmail: sanitizePlainTextInput(body?.submitterEmail, { maxLength: 240 }).toLowerCase(),
        safeSubmitterJobTitle: sanitizePlainTextInput(body?.submitterJobTitle, { maxLength: 120 }),
        safeProjectName: sanitizePlainTextInput(body?.projectName, { maxLength: 180 }),
        safeProperty: sanitizePlainTextInput(body?.property, { maxLength: 180 }),
        safeOrientation: sanitizePlainTextInput(body?.orientation, { maxLength: 64 }),
        safeMenuType: sanitizePlainTextInput(body?.menuType, { maxLength: 64 }),
        safeServicePeriod: sanitizePlainTextInput(body?.servicePeriod, { maxLength: 64 }),
        safeTemplateType: sanitizePlainTextInput(body?.templateType, { maxLength: 64 }) || 'food',
        safeDateNeeded: sanitizePlainTextInput(body?.dateNeeded, { maxLength: 32 }),
        safeAssetType: sanitizePlainTextInput(body?.assetType, { maxLength: 32 }),
        safeHotelName: sanitizePlainTextInput(body?.hotelName, { maxLength: 180 }),
        safeCityCountryInput: sanitizePlainTextInput(body?.cityCountry, { maxLength: 180 }),
        safeAllergens: sanitizePlainTextInput(body?.allergens, { multiline: true, maxLength: 2000 }),
        safeMenuContent: sanitizePlainTextInput(body?.menuContent, { multiline: true, maxLength: MAX_LONG_TEXT_LENGTH }),
        safeMenuContentHtml: sanitizeRichTextHtml(body?.menuContentHtml || ''),
        safePersistentDiffHtml: sanitizeRichTextHtml(body?.persistentDiffHtml || ''),
        safePreservedFooterText: sanitizePlainTextInput(body?.preservedFooterText, { multiline: true, maxLength: 4000 }),
        safeFileDeliveryNotes: sanitizePlainTextInput(body?.fileDeliveryNotes, { multiline: true, maxLength: 2000 }),
        safeSubmissionMode: sanitizePlainTextInput(body?.submissionMode, { maxLength: 32 }) || 'new',
        safeRevisionBaseSubmissionId: sanitizePlainTextInput(body?.revisionBaseSubmissionId, { maxLength: 128 }),
        safeRevisionSource: sanitizePlainTextInput(body?.revisionSource, { maxLength: 64 }),
        safeRevisionBaselineFileName: sanitizeStoredFileName(body?.revisionBaselineFileName, 'baseline.docx'),
        safeBaseApprovedMenuContent: sanitizePlainTextInput(body?.baseApprovedMenuContent, { multiline: true, maxLength: MAX_LONG_TEXT_LENGTH }),
        safeMenuImageFileName: sanitizeStoredFileName(body?.menuImageFileName, 'menu-upload'),
        normalizedApprovals: normalizeApprovals(body?.approvals),
        normalizedCriticalOverrides: Array.isArray(body?.criticalOverrides) ? body.criticalOverrides : [],
        safeRevisionBaselineDocPath,
        safeMenuImagePath,
    };
}

export type NormalizedDesignApprovalRequest = {
    submitterName: string;
    submitterEmail: string;
    submitterJobTitle: string;
    existingDocxSubmissionId: string;
    requiredApprovals: any[];
};

export function normalizeDesignApprovalRequestBody(body: any): NormalizedDesignApprovalRequest {
    const submitterName = sanitizePlainTextInput(body?.submitterName, { maxLength: 120 });
    const submitterEmail = sanitizePlainTextInput(body?.submitterEmail, { maxLength: 240 }).toLowerCase();
    const submitterJobTitle = sanitizePlainTextInput(body?.submitterJobTitle, { maxLength: 120 });
    const existingDocxSubmissionId = sanitizePlainTextInput(body?.existingDocxSubmissionId, { maxLength: 128 });
    const requiredApprovalsRaw = sanitizePlainTextInput(body?.requiredApprovals, {
        multiline: true,
        maxLength: MAX_JSON_FIELD_LENGTH,
        trim: false,
    }) || '[]';

    let requiredApprovals: any[] = [];
    try {
        requiredApprovals = JSON.parse(requiredApprovalsRaw);
        if (!Array.isArray(requiredApprovals)) {
            requiredApprovals = [];
        }
    } catch {
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
