"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const allergen_source_preservation_1 = require("../lib/allergen-source-preservation");
const review_pipeline_1 = require("../lib/review-pipeline");
const legend = 'G contains gluten | D contains dairy | S contains shellfish | N contains nuts | V vegetarian';
describe('submitted allergen source preservation', () => {
    test('restores a removed submitted code without changing the price', () => {
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Cusco Chicken, marinade S 22', 'Cusco Chicken, marinade 22', legend).menuText)
            .toBe('Cusco Chicken, marinade S 22');
    });
    test.each(['€22', '£22', 'MKT', 'MP', 'market price', '$ 22'])('preserves supported price bytes for %s', price => {
        const source = `Cusco Chicken, marinade S ${price}`;
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)(source, `Cusco Chicken, marinade ${price}`, legend).menuText).toBe(source);
    });
    test('strips a model-only code and candidate row code', () => {
        const result = (0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Cusco Chicken, marinade S 22', 'Cusco Chicken, marinade S,N 22\nNew Dish N 18', legend);
        expect(result.menuText).toBe('Cusco Chicken, marinade S 22\nNew Dish 18');
    });
    test('strips a code the legend does not define instead of duplicating the submitted code (tan dinner 2026-09-21)', () => {
        const rsLegend = 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan';
        const result = (0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Seabass & Shrimp Ceviche, cilantro, avocado* S 23\nTán Ceviche Trio, tán ceviche* S 48', 'Seabass & Shrimp Ceviche, cilantro, avocado F,S 23\nTán Ceviche Trio, tán ceviche* F,S 48', rsLegend);
        expect(result.menuText).toBe('Seabass & Shrimp Ceviche, cilantro, avocado S 23\nTán Ceviche Trio, tán ceviche* S 48');
    });
    test('keeps no-legend menus unchanged (no allergen program to protect)', () => {
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Soup 12', 'Soup F 12', '').menuText).toBe('Soup F 12');
    });
    // Incident err-20261009T205923Z-9699af86: the AI added V to dishes and the chef
    // wrote some clusters space-separated ("D G").
    const defaultKey = 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts';
    test('removes an AI-added V under the default key', () => {
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Breakfast Tacos, three tacos, pico de gallo, house salsa, avocado, scrambled eggs GF 22', 'Breakfast Tacos, three tacos, pico de gallo, house salsa, avocado, scrambled eggs GF,V 22', defaultKey).menuText).toBe('Breakfast Tacos, three tacos, pico de gallo, house salsa, avocado, scrambled eggs GF 22');
    });
    test('restores every space-separated submitted code, not just the last one', () => {
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('French Toast, vanilla custard, banana, mixed berries, mint, powdered sugar D G 24', 'French Toast, vanilla custard, banana, mixed berries, mint, powdered sugar D,G,V 24', defaultKey).menuText).toBe('French Toast, vanilla custard, banana, mixed berries, mint, powdered sugar D,G 24');
    });
    test('keeps codes the AI only reformatted', () => {
        const delivered = 'Churro Waffles, macerated strawberry, candied pecan, cinnamon D,G,N 22';
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Churro Waffles, macerated strawberry, candied pecan, cinnamon G, D, N 22', delivered, defaultKey).menuText).toBe(delivered);
    });
    test('fails closed for ambiguous duplicate source rows', () => {
        const source = 'Chicken, soy S 10\nChicken, soy D 11';
        const result = (0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)(source, 'Chicken, soy 10\nChicken, soy 11', legend);
        expect(result.menuText).toBe(source);
        expect(result.diagnostics).toContain('allergen_row_mapping_ambiguous:0');
    });
    test('latest explicit removal is authoritative', () => {
        expect((0, allergen_source_preservation_1.preserveSubmittedAllergenCodes)('Cusco Chicken, marinade 22', 'Cusco Chicken, marinade S 22', legend).menuText)
            .toBe('Cusco Chicken, marinade 22');
    });
    test('no-provider full pipeline preserves submitted S and rejects model-only N', async () => {
        const result = await (0, review_pipeline_1.runFullReviewPipeline)('Cusco Chicken, marinade S 22\nSteak, fries D 30', { basePrompt: 'RULES', templateType: 'food', allergens: legend, acceptedCorrectionRules: [] }, async () => '=== CORRECTED MENU ===\nCusco Chicken, marinade N 22\nSteak, fries D 30\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===');
        expect(result.finalCorrectedMenu).toContain('Cusco Chicken, marinade S 22');
        expect(result.finalCorrectedMenu).not.toContain('N 22');
        expect(result.finalCorrectedMenu).toContain('Steak, fries D 30');
    });
    test('no-provider full pipeline keeps an explicit latest removal removed', async () => {
        const result = await (0, review_pipeline_1.runFullReviewPipeline)('Cusco Chicken, marinade 22\nSteak, fries D 30', { basePrompt: 'RULES', templateType: 'food', allergens: legend, acceptedCorrectionRules: [] }, async () => '=== CORRECTED MENU ===\nCusco Chicken, marinade N 22\nSteak, fries D 30\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===');
        expect(result.finalCorrectedMenu).toContain('Cusco Chicken, marinade 22');
        expect(result.finalCorrectedMenu).not.toContain('Cusco Chicken, marinade S 22');
        expect(result.finalCorrectedMenu).not.toContain('N 22');
        expect(result.finalCorrectedMenu).toContain('Steak, fries D 30');
    });
    test('offline full pipeline defaults canonical raw-notice provenance like Basic', async () => {
        const rawNotice = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';
        const result = await (0, review_pipeline_1.runFullReviewPipeline)(`Cusco Chicken, marinade S 22\n${rawNotice}`, { basePrompt: 'RULES', templateType: 'food', allergens: legend, acceptedCorrectionRules: [] }, async () => '=== CORRECTED MENU ===\nCusco Chicken, marinade S 22\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[{"type":"Raw Food Notice","confidence":"high","severity":"normal","menuItem":"Entire menu","description":"The standard raw-food warning is missing.","recommendation":"Add the standard raw-food notice."}]\n=== END SUGGESTIONS ===');
        expect(result.finalSuggestions.some(suggestion => suggestion.type === 'Raw Food Notice')).toBe(false);
    });
});
