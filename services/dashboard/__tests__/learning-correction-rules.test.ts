import {
    GLOBAL_CORRECTION_RULE_LOCATION,
    buildCorrectionRuleRecord,
    requiresHumanExplanationSourceBinding,
} from '../lib/learning-correction-rules';

const catalog = [
    { name: 'Toro Toro - Grosvenor House - Dubai' },
    { name: 'Maya - New York' },
];

const basePayload = {
    submission_id: '726ddc2e-fb34-4ad3-892e-6b1658795e93',
    correction_id: 'dish-1',
    original_text: 'Jalapeno tartare',
    corrected_text: 'Jalapeño tartare',
    rule: 'Use the correct diacritic for jalapeño.',
    restaurant_name: 'Noche De Fiesta',
    reviewer_name: 'Isabella',
};

describe('buildCorrectionRuleRecord', () => {
    test('requires exact source binding only for comparison-card identities', () => {
        expect(requiresHumanExplanationSourceBinding({ rule: 'manual rule', source: 'human' })).toBe(false);
        expect(requiresHumanExplanationSourceBinding({ original_text: 'old', corrected_text: 'new' })).toBe(false);
        expect(requiresHumanExplanationSourceBinding({ submission_id: 'submission-1' })).toBe(true);
        expect(requiresHumanExplanationSourceBinding({ correction_id: 'dish-1' })).toBe(true);
        expect(requiresHumanExplanationSourceBinding({ comparison_revision: 'comparison-1' })).toBe(true);
    });

    it('defaults force_target_case to false and preserves an explicit true value', () => {
        const base = {
            submission_id: 'submission-case',
            correction_id: 'correction-case',
            original_text: 'maldon',
            corrected_text: 'Maldon',
            change_type: 'capitalization',
            rule: 'Use Maldon.',
            source: 'system',
        };

        expect(buildCorrectionRuleRecord(base, [])).toMatchObject({ force_target_case: false });
        expect(buildCorrectionRuleRecord({ ...base, force_target_case: true }, []))
            .toMatchObject({ force_target_case: true });
    });
    test('accepts the legacy global placeholder for non-location-specific rules', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog);

        expect(record.is_location_specific).toBe(false);
        expect(record.location).toBe(GLOBAL_CORRECTION_RULE_LOCATION);
        expect(record.applies_to_menu_type).toBe('all');
    });

    test('saves blank non-location-specific submissions as global rules', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: false,
            location: '',
        }, catalog);

        expect(record.location).toBe(GLOBAL_CORRECTION_RULE_LOCATION);
    });

    test('treats non-location-specific submissions as global even if a stale client posts a location', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: false,
            location: 'Not In The Catalog',
            other_applicable_locations: ['Also Not In The Catalog'],
        }, catalog);

        expect(record.location).toBe(GLOBAL_CORRECTION_RULE_LOCATION);
        expect(record.other_applicable_locations).toEqual([]);
    });

    test('requires a configured property for location-specific rules', () => {
        expect(() => buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: true,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog)).toThrow('location must be one of the configured properties');
    });

    test('preserves configured property scope for location-specific rules', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: true,
            location: 'Toro Toro - Grosvenor House - Dubai',
            other_applicable_locations: ['Maya - New York'],
        }, catalog);

        expect(record.location).toBe('Toro Toro - Grosvenor House - Dubai');
        expect(record.other_applicable_locations).toEqual(['Maya - New York']);
    });

    test('supports freeform manual rules without before and after text', () => {
        const record = buildCorrectionRuleRecord({
            rule: 'Beverage menus should preserve zero-proof cocktail section names.',
            applies_to_menu_type: 'beverage',
            is_location_specific: true,
            location: 'Maya - New York',
            reviewer_name: 'Isabella',
        }, catalog);

        expect(record.submission_id).toMatch(/^manual-submission-/);
        expect(record.correction_id).toMatch(/^manual-rule-/);
        expect(record.original_text).toBeNull();
        expect(record.corrected_text).toBeNull();
        expect(record.applies_to_menu_type).toBe('beverage');
        // Saved corrections are proposals: born pending, never live on save.
        expect(record.status).toBe('pending');
    });

    test('saves human corrections as pending proposals, not live accepted rules', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog);

        // The improvement cycle is the single gate that promotes a correction to
        // a live rule; saving one must NOT make it accepted (and therefore
        // immediately applied by the deterministic pre-AI pass).
        expect(record.source).toBe('human');
        expect(record.status).toBe('pending');
    });

    test('carries the server-assembled source binding without allowing the builder to invent one', () => {
        const sourceBinding = { version: 'human-explanation-source-binding-v1', source_revision_id: 'SER-test' };
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            source_binding: sourceBinding,
        }, catalog);
        expect(record.source_binding).toBe(sourceBinding);
        expect(buildCorrectionRuleRecord(basePayload, catalog).source_binding).toBeNull();
    });

    test('stores only the reviewer-scoped replacement for a mixed dish-line edit', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            original_text: 'Salmon, macha salsa, crispy potato',
            corrected_text: 'Salmon, salsa macha, crispy potato, marigold',
            learning_original_text: 'macha salsa',
            learning_corrected_text: 'salsa macha',
            rule: 'Salsa macha is the correct order.',
        }, catalog);

        expect(record).toMatchObject({
            original_text: 'macha salsa',
            corrected_text: 'salsa macha',
            status: 'pending',
        });
    });

    test('requires both fields for an exact mixed-edit learning scope', () => {
        expect(() => buildCorrectionRuleRecord({
            ...basePayload,
            learning_original_text: 'macha salsa',
        }, catalog)).toThrow('learning_original_text and learning_corrected_text must be provided together');
    });

    test('saves menu-only updates as rejected audit rows without requiring an explanation', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            rule: '',
            learning_intent: 'menu_update_only',
        }, catalog);

        expect(record).toMatchObject({
            status: 'rejected',
            change_type: 'menu_update_only',
            rule: 'Menu/content update only — excluded from learning.',
        });
    });

    test('requires optional exact replacement fields to be paired', () => {
        expect(() => buildCorrectionRuleRecord({
            rule: 'Use relish for this preparation.',
            original_text: 'habanero salsa',
        }, catalog)).toThrow('original_text and corrected_text must be provided together');
    });

    test('rejects unknown menu rule scopes', () => {
        expect(() => buildCorrectionRuleRecord({
            ...basePayload,
            applies_to_menu_type: 'dessert',
        }, catalog)).toThrow('applies_to_menu_type must be all, food, or beverage');
    });

    test('requires a reviewer name for human-saved rules', () => {
        const { reviewer_name, ...withoutReviewer } = basePayload;
        expect(() => buildCorrectionRuleRecord({
            ...withoutReviewer,
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog)).toThrow('reviewer_name is required');

        expect(() => buildCorrectionRuleRecord({
            ...withoutReviewer,
            reviewer_name: '   ',
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog)).toThrow('reviewer_name is required');
    });

    test('C4b: captures an example pair for a freeform rule (replay ground truth)', () => {
        const record = buildCorrectionRuleRecord({
            rule: 'We always accent jalapeño.',
            is_location_specific: false,
            reviewer_name: 'Isabella',
            example_original: 'jalapeno',
            example_corrected: 'jalapeño',
        }, catalog);

        expect(record.original_text).toBeNull();
        expect(record.example_original).toBe('jalapeno');
        expect(record.example_corrected).toBe('jalapeño');
    });

    test('C4b: an exact rule keeps its own before/after and leaves example columns null', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
            example_original: 'ignored',
            example_corrected: 'ignored-too',
        }, catalog);

        expect(record.original_text).toBe('Jalapeno tartare');
        expect(record.example_original).toBeNull();
        expect(record.example_corrected).toBeNull();
    });

    test('C4b: example fields must be provided together', () => {
        expect(() => buildCorrectionRuleRecord({
            rule: 'Freeform.',
            reviewer_name: 'Isabella',
            example_original: 'only original',
        }, catalog)).toThrow('example_original and example_corrected must be provided together');
    });

    test('does not require a reviewer name for system-generated rules', () => {
        const { reviewer_name, ...withoutReviewer } = basePayload;
        const record = buildCorrectionRuleRecord({
            ...withoutReviewer,
            source: 'system',
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog);

        expect(record.source).toBe('system');
        expect(record.reviewer_name).toBeNull();
    });
});
