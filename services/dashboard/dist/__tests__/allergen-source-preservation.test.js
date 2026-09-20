"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const allergen_source_preservation_1 = require("../lib/allergen-source-preservation");
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
});
