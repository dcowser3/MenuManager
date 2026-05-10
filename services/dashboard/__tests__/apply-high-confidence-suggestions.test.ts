import {
    applyHighConfidenceSuggestionsToMenu,
    extractChangePair,
} from '../lib/apply-high-confidence-suggestions';

describe('extractChangePair', () => {
    it('parses single-quoted Change ... to ...', () => {
        expect(extractChangePair("Change 'tomats' to 'tomatoes'.")).toEqual({
            from: 'tomats',
            to: 'tomatoes',
        });
    });

    it('parses double-quoted Change ... to ...', () => {
        expect(extractChangePair('Change "BBQ" to "barbecue".')).toEqual({
            from: 'BBQ',
            to: 'barbecue',
        });
    });

    it('returns null when no pattern matches', () => {
        expect(extractChangePair('Consider rewriting this line.')).toBeNull();
    });
});

describe('applyHighConfidenceSuggestionsToMenu', () => {
    it('applies high-confidence spelling when recommendation has Change pairs', () => {
        const menu = [
            'COLD STARTERS',
            'Market Salad, avocado, heirloom tomats, halloumi cheese 70',
        ].join('\n');

        const { menuText, suggestions } = applyHighConfidenceSuggestionsToMenu(menu, [
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
        const { menuText, suggestions } = applyHighConfidenceSuggestionsToMenu(menu, [
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
        const { menuText, suggestions } = applyHighConfidenceSuggestionsToMenu(menu, [
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
});
