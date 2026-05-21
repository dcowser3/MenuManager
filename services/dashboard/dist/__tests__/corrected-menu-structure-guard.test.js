"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const corrected_menu_structure_guard_1 = require("../lib/corrected-menu-structure-guard");
describe('assessCorrectedMenuStructure', () => {
    it('allows normal high-confidence inline corrections', () => {
        const original = [
            'Saturday Brunch',
            'Tuna Tiradito, coconut leche de tigre, mango chipotle reduction C,F,G,S,SY,SS',
            'Conchas, scallops, aji mirasol, mango chalaquita, salmon roe C,G,S,SS',
            'Tres Leches, passionfruit sorbet, whipped mango, almonds D,E,G,TN',
        ].join('\n');
        const corrected = [
            'Saturday Brunch',
            'Tuna Tiradito, coconut leche de tigre, mango chipotle reduction * C,F,G,S,SY,SS',
            'Conchas, scallops, ají mirasol, mango chalaquita, salmon roe * C,G,S,SS',
            'Tres Leches, passion fruit sorbet, whipped mango, almonds D,E,G,TN',
        ].join('\n');
        const result = (0, corrected_menu_structure_guard_1.assessCorrectedMenuStructure)(original, corrected);
        expect(result.safe).toBe(true);
        expect(result.reasons).toEqual([]);
    });
    it('rejects a corrected menu that drops most menu lines', () => {
        const original = Array.from({ length: 18 }, (_, i) => `Dish ${i + 1}, roasted ingredient ${i + 1}, citrus salsa, herb garnish, crispy tortilla G,V ${18 + i}`).join('\n');
        const corrected = [
            'Dish 1, roasted ingredient 1, citrus salsa, herb garnish, crispy tortilla G,V 18',
            'Dish 2, roasted ingredient 2, citrus salsa, herb garnish, crispy tortilla G,V 19',
            'Dish 3, roasted ingredient 3, citrus salsa, herb garnish, crispy tortilla G,V 20',
        ].join('\n');
        const result = (0, corrected_menu_structure_guard_1.assessCorrectedMenuStructure)(original, corrected);
        expect(result.safe).toBe(false);
        expect(result.reasons).toContain('low_token_coverage');
        expect(result.reasons).toContain('too_few_lines');
    });
    it('rejects a condensed wall-of-text response that omits most submitted words', () => {
        const original = Array.from({ length: 40 }, (_, i) => `Dish ${i + 1} description with avocado corn poblano chili sesame mango coconut allergen code G,V price ${20 + i}`).join(' ');
        const corrected = Array.from({ length: 8 }, (_, i) => `Dish ${i + 1} description with avocado corn poblano chili sesame mango coconut allergen code G,V price ${20 + i}`).join('\n');
        const result = (0, corrected_menu_structure_guard_1.assessCorrectedMenuStructure)(original, corrected);
        expect(result.safe).toBe(false);
        expect(result.reasons).toContain('low_token_coverage');
        expect(result.reasons).toContain('corrected_text_much_shorter');
    });
    it('does not block very short menus where coverage metrics are noisy', () => {
        const result = (0, corrected_menu_structure_guard_1.assessCorrectedMenuStructure)('Guacamole, avocado, tortilla chips V', 'Guacamole, avocado, tortilla chips V');
        expect(result.safe).toBe(true);
    });
});
