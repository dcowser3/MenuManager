"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const price_integrity_guard_1 = require("../lib/price-integrity-guard");
describe('guardCorrectedMenuPrices', () => {
    it('removes an AI-added trailing price from a submitted no-price item', () => {
        const original = [
            'Ceviches',
            'Tuna Tartare, ponzu macha, radish, habanero aioli, avocado, cilantro, charred corn tlayudas*',
            'Tan Ceviche Trio, signature ceviches, amarillo, tuluminati, tan ceviche* G,S 48',
        ].join('\n');
        const corrected = [
            'Ceviches',
            'Tuna Tartare, ponzu macha, radish, habanero aioli, avocado, cilantro, charred corn tlayudas* D,G,N 24',
            'Tan Ceviche Trio, signature ceviches, amarillo, tuluminati, tan ceviche* G,S 48',
        ].join('\n');
        const result = (0, price_integrity_guard_1.guardCorrectedMenuPrices)(original, corrected, []);
        expect(result.correctedMenu).toContain('Tuna Tartare, ponzu macha, radish, habanero aioli, avocado, cilantro, charred corn tlayudas* D,G,N');
        expect(result.correctedMenu).not.toContain('D,G,N 24');
        expect(result.changes).toEqual([
            expect.objectContaining({
                reason: 'added_price',
                menuItem: 'Tuna Tartare',
                originalPrice: null,
                correctedPrice: '24',
            }),
        ]);
        expect(result.suggestions).toEqual([
            expect.objectContaining({
                type: 'Missing Price',
                severity: 'critical',
                menuItem: 'Tuna Tartare',
            }),
        ]);
    });
    it('keeps an existing missing-price suggestion instead of duplicating it', () => {
        const original = 'Tuna Tartare, ponzu macha, radish*';
        const corrected = 'Tuna Tartare, ponzu macha, radish* 24';
        const existingSuggestion = {
            type: 'Missing Price',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Tuna Tartare',
            description: 'This item lacks a price.',
            recommendation: 'Add the correct price.',
        };
        const result = (0, price_integrity_guard_1.guardCorrectedMenuPrices)(original, corrected, [existingSuggestion]);
        expect(result.correctedMenu).toBe(original);
        expect(result.suggestions).toEqual([existingSuggestion]);
    });
    it('restores the submitted price value when the AI changes it', () => {
        const original = 'Ceviche Amarillo, fluke, aji amarillo, mango* 22';
        const corrected = 'Ceviche Amarillo, fluke, aji amarillo, mango* F 24';
        const result = (0, price_integrity_guard_1.guardCorrectedMenuPrices)(original, corrected, []);
        expect(result.correctedMenu).toBe('Ceviche Amarillo, fluke, aji amarillo, mango* F 22');
        expect(result.suggestions).toEqual([]);
        expect(result.changes).toEqual([
            expect.objectContaining({
                reason: 'changed_price',
                menuItem: 'Ceviche Amarillo',
                originalPrice: '22',
                correctedPrice: '24',
            }),
        ]);
    });
    it('allows price formatting changes that keep the same numeric value', () => {
        const original = 'Guacamole, tortilla chips $12.00';
        const corrected = 'Guacamole, tortilla chips 12';
        const result = (0, price_integrity_guard_1.guardCorrectedMenuPrices)(original, corrected, []);
        expect(result.correctedMenu).toBe(corrected);
        expect(result.changes).toEqual([]);
    });
    it('uses a unique menu-item match when non-empty line counts do not align', () => {
        const original = 'Tuna Tartare, ponzu macha, radish*';
        const corrected = [
            'Ceviches',
            'Tuna Tartare, ponzu macha, radish* 24',
        ].join('\n');
        const result = (0, price_integrity_guard_1.guardCorrectedMenuPrices)(original, corrected, []);
        expect(result.correctedMenu).toBe([
            'Ceviches',
            'Tuna Tartare, ponzu macha, radish*',
        ].join('\n'));
        expect(result.suggestions).toEqual([
            expect.objectContaining({
                type: 'Missing Price',
                severity: 'critical',
                menuItem: 'Tuna Tartare',
            }),
        ]);
        expect(result.changes).toEqual([
            expect.objectContaining({
                reason: 'added_price',
                menuItem: 'Tuna Tartare',
                correctedPrice: '24',
            }),
        ]);
    });
});
