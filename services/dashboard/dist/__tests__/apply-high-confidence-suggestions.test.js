"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const apply_high_confidence_suggestions_1 = require("../lib/apply-high-confidence-suggestions");
describe('extractChangePair', () => {
    it('parses single-quoted Change ... to ...', () => {
        expect((0, apply_high_confidence_suggestions_1.extractChangePair)("Change 'tomats' to 'tomatoes'.")).toEqual({
            from: 'tomats',
            to: 'tomatoes',
        });
    });
    it('parses double-quoted Change ... to ...', () => {
        expect((0, apply_high_confidence_suggestions_1.extractChangePair)('Change "BBQ" to "barbecue".')).toEqual({
            from: 'BBQ',
            to: 'barbecue',
        });
    });
    it('returns null when no pattern matches', () => {
        expect((0, apply_high_confidence_suggestions_1.extractChangePair)('Consider rewriting this line.')).toBeNull();
    });
});
describe('applyHighConfidenceSuggestionsToMenu', () => {
    it('applies high-confidence spelling when recommendation has Change pairs', () => {
        const menu = [
            'COLD STARTERS',
            'Market Salad, avocado, heirloom tomats, halloumi cheese 70',
        ].join('\n');
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Spelling',
                confidence: 'high',
                severity: 'normal',
                menuItem: 'Market Salad',
                description: "The word 'tomats' is a misspelling.",
                recommendation: "Change 'tomats' to 'tomatoes'.",
            },
        ]);
        expect(menuText).toContain('tomatoes');
        expect(menuText).not.toContain('tomats');
        expect(suggestions).toHaveLength(0);
    });
    it('leaves non-high or non-auto-apply types untouched', () => {
        const menu = 'Dish, description 24';
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Spelling',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Dish',
                description: 'Typo',
                recommendation: "Change '24' to '25'.",
            },
        ]);
        expect(menuText).toBe(menu);
        expect(suggestions).toHaveLength(1);
    });
    it('does not auto-apply missing price suggestions', () => {
        const menu = 'Some Dish, no price shown';
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Missing Price',
                confidence: 'high',
                severity: 'critical',
                menuItem: 'Some Dish',
                description: 'No price',
                recommendation: "Add price '24'.",
            },
        ]);
        expect(menuText).toBe(menu);
        expect(suggestions).toHaveLength(1);
    });
    it('auto-applies exact spelling replacements even when the model mislabeled severity as critical', () => {
        const menu = [
            'COLD STARTERS',
            'Ceviche de pescado, catch of the day, green aguachile, avocad, wakame 105',
        ].join('\n');
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Spelling',
                confidence: 'medium',
                severity: 'critical',
                menuItem: 'Ceviche de pescado',
                description: "Correct the spelling of 'avocad' to 'avocado'.",
                recommendation: "Change 'avocad' to 'avocado'.",
            },
        ]);
        expect(menuText).toContain('green aguachile, avocado, wakame');
        expect(menuText).not.toContain('avocad, wakame');
        expect(suggestions).toHaveLength(0);
    });
    it('drops stale spelling suggestions when the corrected menu already has the replacement', () => {
        const menu = [
            'COLD STARTERS',
            'Ceviche de pescado, catch of the day, green aguachile, avocado, wakame 105',
        ].join('\n');
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Spelling',
                confidence: 'medium',
                severity: 'critical',
                menuItem: 'Ceviche de pescado',
                description: "Correct the spelling of 'avocad' to 'avocado'.",
                recommendation: "Change 'avocad' to 'avocado'.",
            },
        ]);
        expect(menuText).toBe(menu);
        expect(suggestions).toHaveLength(0);
    });
    it('auto-applies high-confidence raw item asterisks before allergens and price', () => {
        const menu = [
            'COLD STARTERS',
            'Ceviche de pescado, catch of the day, green aguachile, avocado, wakame C,D,E,F,G,M,PN,SL,SS,SY,TN 105',
        ].join('\n');
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Raw Item',
                confidence: 'high',
                severity: 'normal',
                menuItem: 'Ceviche de pescado',
                description: 'Add asterisk to indicate the raw preparation of fish.',
                recommendation: 'Add asterisk (*) after description.',
            },
        ]);
        expect(menuText).toContain('avocado, wakame * C,D,E,F,G,M,PN,SL,SS,SY,TN 105');
        expect(suggestions).toHaveLength(0);
    });
});
