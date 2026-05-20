import {
    GLOBAL_CORRECTION_RULE_LOCATION,
    buildCorrectionRuleRecord,
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
};

describe('buildCorrectionRuleRecord', () => {
    test('accepts the legacy global placeholder for non-location-specific rules', () => {
        const record = buildCorrectionRuleRecord({
            ...basePayload,
            is_location_specific: false,
            location: GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog);

        expect(record.is_location_specific).toBe(false);
        expect(record.location).toBe(GLOBAL_CORRECTION_RULE_LOCATION);
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
});
