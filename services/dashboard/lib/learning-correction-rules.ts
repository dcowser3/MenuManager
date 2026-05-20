export const GLOBAL_CORRECTION_RULE_LOCATION = 'All properties (global rule)';

export class CorrectionRuleValidationError extends Error {
    statusCode = 400;
}

export interface CorrectionRuleRecord {
    submission_id: string;
    correction_id: string;
    original_text: string;
    corrected_text: string;
    change_type: string | null;
    rule: string;
    is_location_specific: boolean;
    project_name: string | null;
    restaurant_name: string;
    location: string;
    other_applicable_locations: string[];
    reviewer_name: string | null;
    source: string;
    status: string;
}

function text(value: any): string {
    return `${value || ''}`.trim();
}

function locationKey(value: string): string {
    return value.trim().toLowerCase();
}

function isGlobalLocationPlaceholder(value: string): boolean {
    const key = locationKey(value);
    return !key || key === locationKey(GLOBAL_CORRECTION_RULE_LOCATION);
}

function getConfiguredPropertyNames(catalog: Array<{ name?: string }>): Set<string> {
    return new Set(
        (catalog || [])
            .map((item) => locationKey(`${item?.name || ''}`))
            .filter(Boolean)
    );
}

export function buildCorrectionRuleRecord(payload: any, catalog: Array<{ name?: string }>): CorrectionRuleRecord {
    const propertyNames = getConfiguredPropertyNames(catalog);
    const rawLocation = text(payload.location);
    const isLocationSpecific = !!payload.is_location_specific;
    const otherLocations = Array.isArray(payload.other_applicable_locations)
        ? payload.other_applicable_locations.map((s: any) => text(s)).filter(Boolean)
        : [];

    if (isLocationSpecific) {
        if (!rawLocation || isGlobalLocationPlaceholder(rawLocation) || !propertyNames.has(locationKey(rawLocation))) {
            throw new CorrectionRuleValidationError('location must be one of the configured properties');
        }

        const invalidShared = otherLocations.find((item: string) => !propertyNames.has(locationKey(item)));
        if (invalidShared) {
            throw new CorrectionRuleValidationError(`shared location "${invalidShared}" is not in configured properties`);
        }
    }

    const record: CorrectionRuleRecord = {
        submission_id: text(payload.submission_id),
        correction_id: text(payload.correction_id),
        original_text: text(payload.original_text || payload.before_line),
        corrected_text: text(payload.corrected_text || payload.after_line),
        change_type: text(payload.change_type) || null,
        rule: text(payload.rule),
        is_location_specific: isLocationSpecific,
        project_name: text(payload.project_name) || null,
        restaurant_name: text(payload.restaurant_name),
        location: isLocationSpecific ? rawLocation : GLOBAL_CORRECTION_RULE_LOCATION,
        other_applicable_locations: isLocationSpecific ? otherLocations : [],
        reviewer_name: text(payload.reviewer_name) || null,
        source: payload.source || 'human',
        status: payload.source === 'system' ? 'pending' : 'accepted',
    };

    if (!record.submission_id || !record.correction_id || !record.original_text || !record.corrected_text || !record.rule) {
        throw new CorrectionRuleValidationError('submission_id, correction_id, original_text, corrected_text, and rule are required');
    }

    return record;
}

export function isCorrectionRuleValidationError(error: any): error is CorrectionRuleValidationError {
    return error instanceof CorrectionRuleValidationError;
}
