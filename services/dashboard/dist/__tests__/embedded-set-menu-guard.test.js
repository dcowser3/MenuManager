"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const embedded_set_menu_guard_1 = require("../lib/embedded-set-menu-guard");
function quickLunchMenu(overrides = []) {
    return [
        'Ice Cream D,V & Sorbets VG 12',
        '',
        'Quick Lunch Menu $38',
        'choice of one appetizer & one entree',
        'Appetizer',
        'Guacamole, tomato, red onion, queso fresco, cilantro, tortilla & plantain chips D,VG',
        'Sword Fish Dip, homemade pickled chilis, tortilla & plantain chips D',
        'Specialties',
        ...overrides,
        'Sushi Poke Bowl, ponzu, red onion, edamame, mango, shimeji pickled, cucumber, radish, seaweed, avocado, furikake',
        'On the go',
        'Chocolate Palmiers',
    ].join('\n');
}
describe('analyzeEmbeddedSetMenus', () => {
    it('detects embedded set sections and bare included-item prices without touching normal menu prices above', () => {
        const menu = quickLunchMenu([
            'Carne Asada Tacos, grilled skirt steak, costar-style cheese, red onion, cilantro, scallion D * 24',
        ]);
        const analysis = (0, embedded_set_menu_guard_1.analyzeEmbeddedSetMenus)(menu);
        expect(analysis.sections).toHaveLength(1);
        expect(analysis.sections[0]).toMatchObject({
            title: 'Quick Lunch Menu $38',
            choiceInstruction: 'choice of one appetizer & one entree',
        });
        expect(analysis.issues).toEqual([
            expect.objectContaining({
                menuItem: 'Carne Asada Tacos',
                price: '24',
                sectionTitle: 'Quick Lunch Menu $38',
            }),
        ]);
    });
    it('allows explicit plus-price premium upcharges inside embedded set sections', () => {
        const menu = quickLunchMenu([
            'Carne Asada Tacos, grilled skirt steak, costar-style cheese D +5',
            'Huachinango Ceviche, sea bass, leche de tigre C,F + AED 50',
        ]);
        const analysis = (0, embedded_set_menu_guard_1.analyzeEmbeddedSetMenus)(menu);
        expect(analysis.sections).toHaveLength(1);
        expect(analysis.issues).toHaveLength(0);
    });
    it('does not detect a normal priced menu as an embedded set section without a choice instruction', () => {
        const menu = [
            'Lunch',
            'Guacamole, tomato, red onion, queso fresco D,VG 18',
            'Carne Asada Tacos, grilled skirt steak D 24',
        ].join('\n');
        const analysis = (0, embedded_set_menu_guard_1.analyzeEmbeddedSetMenus)(menu);
        expect(analysis.sections).toHaveLength(0);
        expect(analysis.issues).toHaveLength(0);
    });
});
describe('buildEmbeddedSetMenuPromptSection', () => {
    it('describes the detected set section and plus-price rule', () => {
        const analysis = (0, embedded_set_menu_guard_1.analyzeEmbeddedSetMenus)(quickLunchMenu([
            'Carne Asada Tacos, grilled skirt steak, costar-style cheese D 24',
        ]));
        const promptSection = (0, embedded_set_menu_guard_1.buildEmbeddedSetMenuPromptSection)(analysis);
        expect(promptSection).toContain('Quick Lunch Menu $38');
        expect(promptSection).toContain('Set Menu Item Price');
        expect(promptSection).toContain('+ AED 50');
    });
});
describe('guardEmbeddedSetMenuPrices', () => {
    it('synthesizes a critical set-menu price suggestion and restores a deleted bare price', () => {
        const original = quickLunchMenu([
            'Carne Asada Tacos, grilled skirt steak, costar-style cheese, red onion, cilantro, scallion D 24',
        ]);
        const corrected = quickLunchMenu([
            'Carne Asada Tacos, grilled skirt steak, costa-style cheese, red onion, cilantro, scallion D',
        ]);
        const result = (0, embedded_set_menu_guard_1.guardEmbeddedSetMenuPrices)(original, corrected, []);
        expect(result.correctedMenu).toContain('Carne Asada Tacos, grilled skirt steak, costa-style cheese, red onion, cilantro, scallion D 24');
        expect(result.restoredPrices).toHaveLength(1);
        expect(result.synthesizedSuggestions).toHaveLength(1);
        expect(result.suggestions).toEqual([
            expect.objectContaining({
                type: 'Set Menu Item Price',
                severity: 'critical',
                menuItem: 'Carne Asada Tacos',
            }),
        ]);
    });
    it('drops missing-price suggestions for included unpriced set-menu items', () => {
        const original = quickLunchMenu([]);
        const result = (0, embedded_set_menu_guard_1.guardEmbeddedSetMenuPrices)(original, original, [
            {
                type: 'Missing Price',
                confidence: 'medium',
                severity: 'critical',
                menuItem: 'Sushi Poke Bowl',
                description: 'Sushi Poke Bowl is missing a price.',
                recommendation: 'Add a price.',
            },
        ]);
        expect(result.suggestions).toHaveLength(0);
        expect(result.droppedSuggestions).toEqual([
            expect.objectContaining({
                reason: 'included_set_menu_item_does_not_require_individual_price',
                matchedLine: expect.stringContaining('Sushi Poke Bowl'),
            }),
        ]);
    });
    it('does not synthesize issues for premium plus prices', () => {
        const original = quickLunchMenu([
            'Huachinango Ceviche, sea bass, leche de tigre C,F + AED 50',
        ]);
        const result = (0, embedded_set_menu_guard_1.guardEmbeddedSetMenuPrices)(original, original, []);
        expect(result.correctedMenu).toBe(original);
        expect(result.suggestions).toHaveLength(0);
        expect(result.restoredPrices).toHaveLength(0);
    });
    it('keeps and promotes existing AI set-menu item price suggestions', () => {
        const original = quickLunchMenu([
            'Carne Asada Tacos, grilled skirt steak, costar-style cheese D 24',
        ]);
        const result = (0, embedded_set_menu_guard_1.guardEmbeddedSetMenuPrices)(original, original, [
            {
                type: 'Formatting',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Carne Asada Tacos',
                description: 'This included set-menu item has an individual price.',
                recommendation: 'Remove the bare price.',
            },
        ]);
        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0]).toMatchObject({
            type: 'Set Menu Item Price',
            severity: 'critical',
            menuItem: 'Carne Asada Tacos',
        });
        expect(result.synthesizedSuggestions).toHaveLength(0);
    });
});
