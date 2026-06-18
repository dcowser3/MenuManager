"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const learning_correction_rules_1 = require("../lib/learning-correction-rules");
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
        const record = (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            is_location_specific: false,
            location: learning_correction_rules_1.GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog);
        expect(record.is_location_specific).toBe(false);
        expect(record.location).toBe(learning_correction_rules_1.GLOBAL_CORRECTION_RULE_LOCATION);
        expect(record.applies_to_menu_type).toBe('all');
    });
    test('saves blank non-location-specific submissions as global rules', () => {
        const record = (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            is_location_specific: false,
            location: '',
        }, catalog);
        expect(record.location).toBe(learning_correction_rules_1.GLOBAL_CORRECTION_RULE_LOCATION);
    });
    test('treats non-location-specific submissions as global even if a stale client posts a location', () => {
        const record = (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            is_location_specific: false,
            location: 'Not In The Catalog',
            other_applicable_locations: ['Also Not In The Catalog'],
        }, catalog);
        expect(record.location).toBe(learning_correction_rules_1.GLOBAL_CORRECTION_RULE_LOCATION);
        expect(record.other_applicable_locations).toEqual([]);
    });
    test('requires a configured property for location-specific rules', () => {
        expect(() => (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            is_location_specific: true,
            location: learning_correction_rules_1.GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog)).toThrow('location must be one of the configured properties');
    });
    test('preserves configured property scope for location-specific rules', () => {
        const record = (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            is_location_specific: true,
            location: 'Toro Toro - Grosvenor House - Dubai',
            other_applicable_locations: ['Maya - New York'],
        }, catalog);
        expect(record.location).toBe('Toro Toro - Grosvenor House - Dubai');
        expect(record.other_applicable_locations).toEqual(['Maya - New York']);
    });
    test('supports freeform manual rules without before and after text', () => {
        const record = (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
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
        const record = (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            is_location_specific: false,
            location: learning_correction_rules_1.GLOBAL_CORRECTION_RULE_LOCATION,
        }, catalog);
        // The improvement cycle is the single gate that promotes a correction to
        // a live rule; saving one must NOT make it accepted (and therefore
        // immediately applied by the deterministic pre-AI pass).
        expect(record.source).toBe('human');
        expect(record.status).toBe('pending');
    });
    test('requires optional exact replacement fields to be paired', () => {
        expect(() => (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            rule: 'Use relish for this preparation.',
            original_text: 'habanero salsa',
        }, catalog)).toThrow('original_text and corrected_text must be provided together');
    });
    test('rejects unknown menu rule scopes', () => {
        expect(() => (0, learning_correction_rules_1.buildCorrectionRuleRecord)({
            ...basePayload,
            applies_to_menu_type: 'dessert',
        }, catalog)).toThrow('applies_to_menu_type must be all, food, or beverage');
    });
});
