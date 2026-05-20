import { guardAllergenAlphabetizationSuggestions } from '../lib/allergen-suggestion-guard';

describe('guardAllergenAlphabetizationSuggestions', () => {
    it('drops false D,G to G,D alphabetization suggestions and restores corrected menu text', () => {
        const correctedMenu = [
            'Tacos, tortillas G,D 19',
            'Smoked BBQ Pulled Pork Sliders, coleslaw G,D 1',
        ].join('\n');

        const result = guardAllergenAlphabetizationSuggestions(correctedMenu, [
            {
                type: 'Allergen Code',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Smoked BBQ Pulled Pork Sliders',
                description: 'The allergen codes for the Smoked BBQ Pulled Pork Sliders should be alphabetized.',
                recommendation: "Change 'D,G' to 'G,D' for the allergen codes of the Smoked BBQ Pulled Pork Sliders.",
            },
        ]);

        expect(result.suggestions).toEqual([]);
        expect(result.droppedSuggestions).toHaveLength(1);
        expect(result.correctedMenu).toContain('Tacos, tortillas G,D 19');
        expect(result.correctedMenu).toContain('Smoked BBQ Pulled Pork Sliders, coleslaw D,G 1');
    });

    it('keeps valid G,D to D,G alphabetization suggestions', () => {
        const correctedMenu = 'Tacos, tortillas G,D 19';

        const suggestion = {
            type: 'Allergen Code',
            confidence: 'medium',
            severity: 'normal',
            menuItem: 'Tacos',
            description: 'The allergen codes should be alphabetized.',
            recommendation: "Change 'G,D' to 'D,G' for the allergen codes.",
        };

        const result = guardAllergenAlphabetizationSuggestions(correctedMenu, [suggestion]);

        expect(result.suggestions).toEqual([suggestion]);
        expect(result.droppedSuggestions).toEqual([]);
        expect(result.correctedMenu).toBe(correctedMenu);
    });
});
