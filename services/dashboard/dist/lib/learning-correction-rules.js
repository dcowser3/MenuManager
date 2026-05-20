"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorrectionRuleValidationError = exports.GLOBAL_CORRECTION_RULE_LOCATION = void 0;
exports.buildCorrectionRuleRecord = buildCorrectionRuleRecord;
exports.isCorrectionRuleValidationError = isCorrectionRuleValidationError;
exports.GLOBAL_CORRECTION_RULE_LOCATION = 'All properties (global rule)';
class CorrectionRuleValidationError extends Error {
    constructor() {
        super(...arguments);
        this.statusCode = 400;
    }
}
exports.CorrectionRuleValidationError = CorrectionRuleValidationError;
function text(value) {
    return `${value || ''}`.trim();
}
function locationKey(value) {
    return value.trim().toLowerCase();
}
function isGlobalLocationPlaceholder(value) {
    const key = locationKey(value);
    return !key || key === locationKey(exports.GLOBAL_CORRECTION_RULE_LOCATION);
}
function getConfiguredPropertyNames(catalog) {
    return new Set((catalog || [])
        .map((item) => locationKey(`${item?.name || ''}`))
        .filter(Boolean));
}
function buildCorrectionRuleRecord(payload, catalog) {
    const propertyNames = getConfiguredPropertyNames(catalog);
    const rawLocation = text(payload.location);
    const isLocationSpecific = !!payload.is_location_specific;
    const otherLocations = Array.isArray(payload.other_applicable_locations)
        ? payload.other_applicable_locations.map((s) => text(s)).filter(Boolean)
        : [];
    if (isLocationSpecific) {
        if (!rawLocation || isGlobalLocationPlaceholder(rawLocation) || !propertyNames.has(locationKey(rawLocation))) {
            throw new CorrectionRuleValidationError('location must be one of the configured properties');
        }
        const invalidShared = otherLocations.find((item) => !propertyNames.has(locationKey(item)));
        if (invalidShared) {
            throw new CorrectionRuleValidationError(`shared location "${invalidShared}" is not in configured properties`);
        }
    }
    const record = {
        submission_id: text(payload.submission_id),
        correction_id: text(payload.correction_id),
        original_text: text(payload.original_text || payload.before_line),
        corrected_text: text(payload.corrected_text || payload.after_line),
        change_type: text(payload.change_type) || null,
        rule: text(payload.rule),
        is_location_specific: isLocationSpecific,
        project_name: text(payload.project_name) || null,
        restaurant_name: text(payload.restaurant_name),
        location: isLocationSpecific ? rawLocation : exports.GLOBAL_CORRECTION_RULE_LOCATION,
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
function isCorrectionRuleValidationError(error) {
    return error instanceof CorrectionRuleValidationError;
}
