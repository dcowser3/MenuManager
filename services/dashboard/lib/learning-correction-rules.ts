export const GLOBAL_CORRECTION_RULE_LOCATION = 'All properties (global rule)';

export class CorrectionRuleValidationError extends Error {
    statusCode = 400;
}

export interface CorrectionRuleRecord {
    submission_id: string;
    correction_id: string;
    original_text: string | null;
    corrected_text: string | null;
    change_type: string | null;
    rule: string;
    applies_to_menu_type: string;
    is_location_specific: boolean;
    project_name: string | null;
    restaurant_name: string;
    location: string;
    other_applicable_locations: string[];
    reviewer_name: string | null;
    source: string;
    status: string;
    // C4b: optional example pair for a freeform rule (no exact before/after of its own), so the
    // replay harness can verify the rule applies and the improvement LLM can ground its synthesis
    // in the human's exact strings. Null for exact rules (their original/corrected already serve).
    example_original: string | null;
    example_corrected: string | null;
}

function text(value: any): string {
    return `${value || ''}`.trim();
}

function optionalText(value: any): string | null {
    const normalized = text(value);
    return normalized || null;
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

function normalizeMenuRuleScope(value: any): string {
    const normalized = text(value).toLowerCase();
    if (!normalized || normalized === 'all') {
        return 'all';
    }
    if (normalized === 'food' || normalized === 'beverage') {
        return normalized;
    }
    throw new CorrectionRuleValidationError('applies_to_menu_type must be all, food, or beverage');
}

function manualRuleId(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now()}-${random}`;
}

export function buildCorrectionRuleRecord(payload: any, catalog: Array<{ name?: string }>): CorrectionRuleRecord {
    const propertyNames = getConfiguredPropertyNames(catalog);
    const rawLocation = text(payload.location);
    const isLocationSpecific = !!payload.is_location_specific;
    const originalText = optionalText(payload.original_text || payload.before_line);
    const correctedText = optionalText(payload.corrected_text || payload.after_line);
    const otherLocations = Array.isArray(payload.other_applicable_locations)
        ? payload.other_applicable_locations.map((s: any) => text(s)).filter(Boolean)
        : [];

    if ((originalText && !correctedText) || (!originalText && correctedText)) {
        throw new CorrectionRuleValidationError('original_text and corrected_text must be provided together');
    }

    // C4b: an optional example pair lets a freeform rule be replay-verified. An exact rule already
    // carries its own before/after, so its example columns stay null (the pair is the ground truth).
    const exampleOriginal = optionalText(payload.example_original);
    const exampleCorrected = optionalText(payload.example_corrected);
    if ((exampleOriginal && !exampleCorrected) || (!exampleOriginal && exampleCorrected)) {
        throw new CorrectionRuleValidationError('example_original and example_corrected must be provided together');
    }

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
        location: isLocationSpecific ? rawLocation : GLOBAL_CORRECTION_RULE_LOCATION,
        other_applicable_locations: isLocationSpecific ? otherLocations : [],
        reviewer_name: text(payload.reviewer_name) || null,
        source: payload.source || 'human',
        example_original: originalText ? null : exampleOriginal,
        example_corrected: correctedText ? null : exampleCorrected,
        // Saved corrections are PROPOSALS, not live rules. They stay 'pending'
        // until the improvement cycle routes them by explanation (replacement
        // rule vs prompt reasoning vs code change) and a reviewer approves the
        // resulting proposal. This is the single gate: only cycle-approved rules
        // (inserted directly as source 'system') reach the deterministic pre-AI
        // pass, so a context-dependent fix can no longer go live as a blind
        // find/replace the moment it is saved.
        status: 'pending',
    };

    if (!record.submission_id || !record.correction_id || !record.rule) {
        throw new CorrectionRuleValidationError('rule is required');
    }

    // Human-saved rules must be attributed. System-generated rows (cycle
    // approvals, detected-pattern scans) legitimately have no reviewer.
    if (record.source !== 'system' && !record.reviewer_name) {
        throw new CorrectionRuleValidationError('reviewer_name is required');
    }

    return record;
}

export function isCorrectionRuleValidationError(error: any): error is CorrectionRuleValidationError {
    return error instanceof CorrectionRuleValidationError;
}
