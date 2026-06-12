"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const menu_footer_1 = require("../lib/menu-footer");
describe('menu-footer (extracted from index.ts)', () => {
    test('normalizeMenuFooter extracts the allergen legend and preserves footer lines', () => {
        const result = (0, menu_footer_1.normalizeMenuFooter)([
            'DINNER MENU',
            '',
            'GUACAMOLE',
            'fresh avocado, lime 12',
            '',
            'G contains gluten | V vegetarian | D contains dairy',
            '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.',
        ].join('\n'));
        expect(result.body).toBe('DINNER MENU\n\nGUACAMOLE\nfresh avocado, lime 12');
        expect(result.normalizedAllergenLine).toBe('G contains gluten | V vegetarian | D contains dairy');
        expect(result.hadRawNotice).toBe(true);
        expect(result.preservedFooterText).toContain('foodborne illness');
    });
    test('normalizeMenuFooter falls back to provided allergens and collapses blank runs', () => {
        const result = (0, menu_footer_1.normalizeMenuFooter)('TACOS\n\n\n\nal pastor 14', 'G gluten | V veg | N nuts');
        expect(result.body).toBe('TACOS\n\nal pastor 14');
        expect(result.normalizedAllergenLine).toBe('G gluten | V veg | N nuts');
        expect(result.hadRawNotice).toBe(false);
    });
    test('stripManagedFooterText returns only the menu body', () => {
        const stripped = (0, menu_footer_1.stripManagedFooterText)('CEVICHE 16\nAll prices are in USD\nWe welcome enquiries for private events');
        expect(stripped).toBe('CEVICHE 16');
    });
    test('raw notice detection matches the canonical warning with and without shellfish', () => {
        expect(menu_footer_1.RAW_NOTICE_PATTERN.test('*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.')).toBe(true);
        expect(menu_footer_1.RAW_NOTICE_PATTERN.test('consuming raw or undercooked meats, poultry, seafood, or eggs may increase your risk of foodborne illness')).toBe(true);
        expect((0, menu_footer_1.isLikelyRawNoticeLine)('Consuming raw or undercooked items may increase your risk of foodborne illness')).toBe(true);
        expect((0, menu_footer_1.isLikelyRawNoticeLine)('GUACAMOLE fresh avocado')).toBe(false);
    });
    test('allergen legend detection requires multiple coded segments', () => {
        expect((0, menu_footer_1.isLikelyAllergenLegendLine)('G contains gluten | V vegetarian | D dairy')).toBe(true);
        expect((0, menu_footer_1.isLikelyAllergenLegendLine)('add chorizo 5 | mushrooms 4')).toBe(false);
    });
});
