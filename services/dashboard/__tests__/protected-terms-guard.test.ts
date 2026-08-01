import { restoreProtectedTerms } from '../lib/protected-terms-guard';

describe('restoreProtectedTerms', () => {
    test.each([
        ['Twice Baked', 'Twice-Baked'],
        ['Twice Baked', 'Twice -Baked'],
        ['Twice-Baked', 'Twice Baked'],
    ])('protects source "%s" against "%s"', (sourcePhrase, rewrittenPhrase) => {
        const original = `Truffled ${sourcePhrase} Potato 14`;
        const corrected = `Truffled ${rewrittenPhrase} Potato 14`;

        expect(restoreProtectedTerms(original, corrected).correctedMenu).toBe(original);
    });

    test('continues protecting picked herbs', () => {
        const original = 'Chicken, picked herbs, potatoes 24';
        const corrected = 'Chicken, pickled herbs, potatoes 24';

        expect(restoreProtectedTerms(original, corrected).correctedMenu).toBe(original);
    });

    test('protects menu voice in marinated 24 hours', () => {
        const original = 'Chicken, half bird marinated 24 hours, lemon jus 32';
        const corrected = 'Chicken, half bird marinated for 24 hours, lemon jus 32';

        expect(restoreProtectedTerms(original, corrected).correctedMenu).toBe(original);
    });
});
