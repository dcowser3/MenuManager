import { preserveSubmittedAllergenCodes } from '../lib/allergen-source-preservation';
import { runFullReviewPipeline } from '../lib/review-pipeline';

const legend = 'G contains gluten | D contains dairy | S contains shellfish | N contains nuts | V vegetarian';

describe('submitted allergen source preservation', () => {
    test('restores a removed submitted code without changing the price', () => {
        expect(preserveSubmittedAllergenCodes('Cusco Chicken, marinade S 22', 'Cusco Chicken, marinade 22', legend).menuText)
            .toBe('Cusco Chicken, marinade S 22');
    });

    test.each(['€22', '£22', 'MKT', 'MP', 'market price', '$ 22'])('preserves supported price bytes for %s', price => {
        const source = `Cusco Chicken, marinade S ${price}`;
        expect(preserveSubmittedAllergenCodes(source, `Cusco Chicken, marinade ${price}`, legend).menuText).toBe(source);
    });

    test('strips a model-only code and candidate row code', () => {
        const result = preserveSubmittedAllergenCodes('Cusco Chicken, marinade S 22', 'Cusco Chicken, marinade S,N 22\nNew Dish N 18', legend);
        expect(result.menuText).toBe('Cusco Chicken, marinade S 22\nNew Dish 18');
    });

    test('fails closed for ambiguous duplicate source rows', () => {
        const source = 'Chicken, soy S 10\nChicken, soy D 11';
        const result = preserveSubmittedAllergenCodes(source, 'Chicken, soy 10\nChicken, soy 11', legend);
        expect(result.menuText).toBe(source);
        expect(result.diagnostics).toContain('allergen_row_mapping_ambiguous:0');
    });

    test('latest explicit removal is authoritative', () => {
        expect(preserveSubmittedAllergenCodes('Cusco Chicken, marinade 22', 'Cusco Chicken, marinade S 22', legend).menuText)
            .toBe('Cusco Chicken, marinade 22');
    });

    test('no-provider full pipeline preserves submitted S and rejects model-only N', async () => {
        const result = await runFullReviewPipeline(
            'Cusco Chicken, marinade S 22\nSteak, fries D 30',
            { basePrompt: 'RULES', templateType: 'food', allergens: legend, acceptedCorrectionRules: [] },
            async () => '=== CORRECTED MENU ===\nCusco Chicken, marinade N 22\nSteak, fries D 30\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===',
        );
        expect(result.finalCorrectedMenu).toContain('Cusco Chicken, marinade S 22');
        expect(result.finalCorrectedMenu).not.toContain('N 22');
        expect(result.finalCorrectedMenu).toContain('Steak, fries D 30');
    });

    test('no-provider full pipeline keeps an explicit latest removal removed', async () => {
        const result = await runFullReviewPipeline(
            'Cusco Chicken, marinade 22\nSteak, fries D 30',
            { basePrompt: 'RULES', templateType: 'food', allergens: legend, acceptedCorrectionRules: [] },
            async () => '=== CORRECTED MENU ===\nCusco Chicken, marinade N 22\nSteak, fries D 30\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===',
        );
        expect(result.finalCorrectedMenu).toContain('Cusco Chicken, marinade 22');
        expect(result.finalCorrectedMenu).not.toContain('Cusco Chicken, marinade S 22');
        expect(result.finalCorrectedMenu).not.toContain('N 22');
        expect(result.finalCorrectedMenu).toContain('Steak, fries D 30');
    });

    test('offline full pipeline defaults canonical raw-notice provenance like Basic', async () => {
        const rawNotice = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';
        const result = await runFullReviewPipeline(
            `Cusco Chicken, marinade S 22\n${rawNotice}`,
            { basePrompt: 'RULES', templateType: 'food', allergens: legend, acceptedCorrectionRules: [] },
            async () => '=== CORRECTED MENU ===\nCusco Chicken, marinade S 22\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[{"type":"Raw Food Notice","confidence":"high","severity":"normal","menuItem":"Entire menu","description":"The standard raw-food warning is missing.","recommendation":"Add the standard raw-food notice."}]\n=== END SUGGESTIONS ===',
        );
        expect(result.finalSuggestions.some(suggestion => suggestion.type === 'Raw Food Notice')).toBe(false);
    });
});
