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
    it('drops stale suggestions when the misspelled text is the menu item itself', () => {
        // The model applied the fix in === CORRECTED MENU === but still listed
        // the suggestion. Its menuItem carries the OLD spelling, which no longer
        // matches any corrected line — the dedup must still find and drop it.
        const menu = [
            'SIDES',
            'Parker House Rolls, whipped butter 12',
            'Loaded Baked Potato, cheddar, chives 14',
        ].join('\n');
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Spelling',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Paker House Rolls',
                description: 'The dish name appears to misspell a well-known dish.',
                recommendation: "Change 'Paker House Rolls' to 'Parker House Rolls'.",
            },
            {
                type: 'Spelling',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Load Baked Potato',
                description: 'The dish name appears to misspell a well-known dish.',
                recommendation: "Change 'Load Baked Potato' to 'Loaded Baked Potato'.",
            },
        ]);
        expect(menuText).toBe(menu);
        expect(suggestions).toHaveLength(0);
    });
    it('drops already-applied suggestions even for non-auto-apply types', () => {
        const menu = 'Prawns, grilled prawns, macha sauce C,D,E,G,M,PN,TN,S,SS 95';
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Allergen Code',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Prawns',
                description: 'Allergen separator should be a comma.',
                recommendation: "Change 'PN.TN' to 'PN,TN'.",
            },
        ]);
        expect(menuText).toBe(menu);
        expect(suggestions).toHaveLength(0);
    });
    it('keeps unapplied suggestions whose menu item is absent from the menu', () => {
        const menu = 'Dinner Rolls, whipped butter 12';
        const { menuText, suggestions } = (0, apply_high_confidence_suggestions_1.applyHighConfidenceSuggestionsToMenu)(menu, [
            {
                type: 'Spelling',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Paker House Rolls',
                description: 'The dish name appears to misspell a well-known dish.',
                recommendation: "Change 'Paker House Rolls' to 'Parker House Rolls'.",
            },
        ]);
        expect(menuText).toBe(menu);
        expect(suggestions).toHaveLength(1);
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
