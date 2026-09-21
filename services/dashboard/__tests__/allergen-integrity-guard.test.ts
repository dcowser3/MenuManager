import { guardCorrectedMenuAllergens } from '../lib/allergen-integrity-guard';

describe('guardCorrectedMenuAllergens', () => {
    const legend = 'D contains dairy | G contains gluten | N contains nuts | S contains shellfish | V vegetarian | VG vegan';

    test('restores every submitted allergen code when the AI removes the cluster', () => {
        const result = guardCorrectedMenuAllergens(
            'Truffle Mac, aged cheddar D,G 24',
            'Truffle Mac, aged cheddar 24',
            [],
            legend
        );

        expect(result.correctedMenu).toBe('Truffle Mac, aged cheddar D,G 24');
        expect(result.changes).toEqual([
            expect.objectContaining({ lineIndex: 0, preservedCodes: ['D', 'G'] }),
        ]);
        expect(result.usedFullMenuFallback).toBe(false);
    });

    test('keeps AI-added codes while restoring any submitted code it removed', () => {
        const result = guardCorrectedMenuAllergens(
            'Prawn Toast, sesame D,G 18',
            'Prawn Toast, sesame G,S 18',
            [],
            legend
        );

        expect(result.correctedMenu).toBe('Prawn Toast, sesame D,G,S 18');
        expect(result.changes[0].preservedCodes).toEqual(['D']);
    });

    test('preserves custom configured allergen codes', () => {
        const result = guardCorrectedMenuAllergens(
            'Miso Soup SY 12',
            'Miso Soup 12',
            [],
            'SY contains soy | D contains dairy'
        );

        expect(result.correctedMenu).toBe('Miso Soup SY 12');
    });

    test('drops an AI recommendation whose explicit change pair removes a code', () => {
        const suggestion = {
            type: 'Allergen Code',
            confidence: 'high',
            menuItem: 'Truffle Mac',
            description: 'The allergen cluster should be changed.',
            recommendation: "Change 'D,G' to 'G'.",
        };
        const result = guardCorrectedMenuAllergens(
            'Truffle Mac, aged cheddar D,G 24',
            'Truffle Mac, aged cheddar D,G 24',
            [suggestion],
            legend
        );

        expect(result.suggestions).toEqual([]);
        expect(result.droppedSuggestions).toEqual([suggestion]);
    });

    test('fails closed to the submitted menu when rows cannot be aligned', () => {
        const original = 'Soup D 12\nSalad G 14';
        const result = guardCorrectedMenuAllergens(original, 'Soup 12', [], legend);

        expect(result.correctedMenu).toBe(original);
        expect(result.usedFullMenuFallback).toBe(true);
    });
});
