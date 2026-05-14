export type ClickUpHandoffError = {
    message?: string;
    code?: string;
    status?: number;
    statusText?: string;
    response?: any;
};

function compactObject(value: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    );
}

export function describeServiceError(error: any): ClickUpHandoffError {
    return compactObject({
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        response: error?.response?.data,
    }) as ClickUpHandoffError;
}

export function withSubmissionReference(message: string, submissionId?: string): string {
    return submissionId ? `${message} Reference: ${submissionId}.` : message;
}

export function parseJsonLike(value: any, fallback: any = undefined): any {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback === undefined ? value : fallback;
    }
}

export function normalizeRawPayload(value: any): Record<string, any> {
    const parsed = parseJsonLike(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function firstNonEmpty(...values: any[]): any {
    for (const value of values) {
        if (value !== undefined && value !== null && `${value}`.trim() !== '') {
            return value;
        }
    }
    return undefined;
}

function coalesceBoolean(...values: any[]): any {
    for (const value of values) {
        if (typeof value === 'boolean') return value ? 'yes' : 'no';
        if (value === 'yes') return 'yes';
        if (value === 'no') return 'no';
        if (value !== undefined && value !== null && `${value}`.trim() !== '') return value;
    }
    return undefined;
}

export function buildClickUpTaskPayloadFromStoredSubmission(
    submission: Record<string, any>,
    assets: Array<Record<string, any>> = []
): Record<string, any> {
    const raw = normalizeRawPayload(submission.raw_payload);
    const source = { ...raw, ...submission };
    const findAsset = (assetType: string) => assets.find((asset) => asset.asset_type === assetType);
    const menuImageAsset = findAsset('menu_image');

    return compactObject({
        submissionId: firstNonEmpty(submission.id, submission.legacy_id, raw.submissionId),
        submitterName: firstNonEmpty(raw.submitterName, source.submitter_name),
        submitterEmail: firstNonEmpty(raw.submitterEmail, source.submitter_email),
        submitterJobTitle: firstNonEmpty(raw.submitterJobTitle, source.submitter_job_title),
        projectName: firstNonEmpty(raw.projectName, source.project_name),
        property: firstNonEmpty(raw.property, source.property),
        width: firstNonEmpty(raw.width, source.width),
        height: firstNonEmpty(raw.height, source.height),
        printWidth: firstNonEmpty(raw.printWidth, raw.print_width, source.print_width),
        printHeight: firstNonEmpty(raw.printHeight, raw.print_height, source.print_height),
        printRegion: firstNonEmpty(raw.printRegion, raw.print_region, source.print_region),
        printSize: firstNonEmpty(raw.printSize, raw.print_size, source.print_size),
        folded: coalesceBoolean(raw.folded, source.folded),
        digitalWidth: firstNonEmpty(raw.digitalWidth, raw.digital_width, source.digital_width),
        digitalHeight: firstNonEmpty(raw.digitalHeight, raw.digital_height, source.digital_height),
        cropMarks: coalesceBoolean(raw.cropMarks, raw.crop_marks, source.crop_marks),
        bleedMarks: coalesceBoolean(raw.bleedMarks, raw.bleed_marks, source.bleed_marks),
        fileSizeLimit: coalesceBoolean(raw.fileSizeLimit, raw.file_size_limit, source.file_size_limit),
        fileSizeLimitMb: firstNonEmpty(raw.fileSizeLimitMb, raw.file_size_limit_mb, source.file_size_limit_mb),
        fileDeliveryNotes: firstNonEmpty(raw.fileDeliveryNotes, raw.file_delivery_notes, source.file_delivery_notes),
        orientation: firstNonEmpty(raw.orientation, source.orientation),
        menuType: firstNonEmpty(raw.menuType, raw.menu_type, source.menu_type),
        servicePeriod: firstNonEmpty(raw.servicePeriod, raw.service_period, source.service_period),
        templateType: firstNonEmpty(raw.templateType, raw.template_type, source.template_type),
        turnaroundDays: firstNonEmpty(raw.turnaroundDays, raw.turnaround_days, source.turnaround_days),
        dateNeeded: firstNonEmpty(raw.dateNeeded, raw.date_needed, source.date_needed),
        hotelName: firstNonEmpty(raw.hotelName, raw.hotel_name, source.hotel_name),
        cityCountry: firstNonEmpty(raw.cityCountry, raw.city_country, source.city_country),
        assetType: firstNonEmpty(raw.assetType, raw.asset_type, source.asset_type),
        docxPath: firstNonEmpty(raw.docxPath, raw.original_path, source.original_path),
        menuImagePath: firstNonEmpty(raw.menuImagePath, menuImageAsset?.storage_path),
        menuImageFileName: firstNonEmpty(raw.menuImageFileName, menuImageAsset?.file_name),
        filename: firstNonEmpty(raw.filename, source.filename),
        submissionMode: firstNonEmpty(raw.submissionMode, raw.submission_mode, source.submission_mode),
        revisionSource: firstNonEmpty(raw.revisionSource, raw.revision_source, source.revision_source),
        revisionBaseSubmissionId: firstNonEmpty(raw.revisionBaseSubmissionId, raw.revision_base_submission_id, source.revision_base_submission_id),
        chefPersistentDiff: parseJsonLike(firstNonEmpty(raw.chefPersistentDiff, raw.chef_persistent_diff, source.chef_persistent_diff), undefined),
        criticalOverrides: parseJsonLike(firstNonEmpty(raw.criticalOverrides, raw.critical_overrides, source.critical_overrides), []),
        approvals: parseJsonLike(firstNonEmpty(raw.approvals, source.approvals), []),
    });
}

export function mergeClickUpHandoffMetadata(
    rawPayload: any,
    metadata: Record<string, any>
): Record<string, any> {
    const raw = normalizeRawPayload(rawPayload);
    const previous = normalizeRawPayload(raw.clickup_handoff);
    return {
        ...raw,
        clickup_handoff: compactObject({
            ...previous,
            ...metadata,
        }),
    };
}
