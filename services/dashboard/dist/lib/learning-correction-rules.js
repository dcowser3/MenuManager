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
function optionalText(value) {
    const normalized = text(value);
    return normalized || null;
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
function normalizeMenuRuleScope(value) {
    const normalized = text(value).toLowerCase();
    if (!normalized || normalized === 'all') {
        return 'all';
    }
    if (normalized === 'food' || normalized === 'beverage') {
        return normalized;
    }
    throw new CorrectionRuleValidationError('applies_to_menu_type must be all, food, or beverage');
}
function manualRuleId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now()}-${random}`;
}
function buildCorrectionRuleRecord(payload, catalog) {
    const propertyNames = getConfiguredPropertyNames(catalog);
    const rawLocation = text(payload.location);
    const isLocationSpecific = !!payload.is_location_specific;
    const originalText = optionalText(payload.original_text || payload.before_line);
    const correctedText = optionalText(payload.corrected_text || payload.after_line);
    const otherLocations = Array.isArray(payload.other_applicable_locations)
        ? payload.other_applicable_locations.map((s) => text(s)).filter(Boolean)
        : [];
    if ((originalText && !correctedText) || (!originalText && correctedText)) {
        throw new CorrectionRuleValidationError('original_text and corrected_text must be provided together');
    }
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
        submission_id: text(payload.submission_id) || manualRuleId('manual-submission'),
        correction_id: text(payload.correction_id) || manualRuleId('manual-rule'),
        original_text: originalText,
        corrected_text: correctedText,
        change_type: text(payload.change_type) || null,
        rule: text(payload.rule),
        applies_to_menu_type: normalizeMenuRuleScope(payload.applies_to_menu_type),
        is_location_specific: isLocationSpecific,
        project_name: text(payload.project_name) || null,
        restaurant_name: text(payload.restaurant_name),
        location: isLocationSpecific ? rawLocation : exports.GLOBAL_CORRECTION_RULE_LOCATION,
        other_applicable_locations: isLocationSpecific ? otherLocations : [],
        reviewer_name: text(payload.reviewer_name) || null,
        source: payload.source || 'human',
        status: payload.source === 'system' ? 'pending' : 'accepted',
    };
    if (!record.submission_id || !record.correction_id || !record.rule) {
        throw new CorrectionRuleValidationError('rule is required');
    }
    return record;
}
function isCorrectionRuleValidationError(error) {
    return error instanceof CorrectionRuleValidationError;
}
