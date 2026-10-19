import { guardCorrectedMenuPrices } from '../lib/price-integrity-guard';

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

        const result = guardCorrectedMenuPrices(original, corrected, []);

        expect(result.correctedMenu).toContain(
            'Tuna Tartare, ponzu macha, radish, habanero aioli, avocado, cilantro, charred corn tlayudas* D,G,N'
        );
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

        const result = guardCorrectedMenuPrices(original, corrected, [existingSuggestion]);

        expect(result.correctedMenu).toBe(original);
        expect(result.suggestions).toEqual([existingSuggestion]);
    });

    it('restores the submitted price value when the AI changes it', () => {
        const original = 'Ceviche Amarillo, fluke, aji amarillo, mango* 22';
        const corrected = 'Ceviche Amarillo, fluke, aji amarillo, mango* F 24';

        const result = guardCorrectedMenuPrices(original, corrected, []);

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

        const result = guardCorrectedMenuPrices(original, corrected, []);

        expect(result.correctedMenu).toBe(corrected);
        expect(result.changes).toEqual([]);
    });

    it('uses a unique menu-item match when non-empty line counts do not align', () => {
        const original = 'Tuna Tartare, ponzu macha, radish*';
        const corrected = [
            'Ceviches',
            'Tuna Tartare, ponzu macha, radish* 24',
        ].join('\n');

        const result = guardCorrectedMenuPrices(original, corrected, []);

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

    // Incident err-20261009T205923Z-9699af86: the chef's price sat behind a raw
    // marker ("Chimichurri *29"); the guard read the line as price-less and
    // stripped the 29 as "AI-added".
    describe('prices next to a raw marker', () => {
        const corrected = 'Steak & Eggs, 4 oz Colorado hanger steak, Eggs any style, house potatoes, Chimichurri* 29';

        it.each([
            ['marker before the price', 'Steak & Eggs, 4 oz Colorado hanger steak, Eggs any style, house potatoes, Chimichurri *29'],
            ['marker after the price', 'Steak & Eggs, 4 oz Colorado hanger steak, Eggs any style, house potatoes, Chimichurri 29*'],
            ['price glued to the last word', 'Steak & Eggs, 4 oz Colorado hanger steak, Eggs any style, house potatoes, Chimichurri29*'],
        ])('keeps the submitted price when the %s', (_label, original) => {
            const result = guardCorrectedMenuPrices(original, corrected, []);

            expect(result.correctedMenu).toBe(corrected);
            expect(result.changes).toEqual([]);
            expect(result.suggestions).toEqual([]);
        });

        it('still restores a changed price written behind a raw marker', () => {
            const original = 'Steak & Eggs, 4 oz hanger steak, Chimichurri *29';
            const result = guardCorrectedMenuPrices(original, 'Steak & Eggs, 4 oz hanger steak, Chimichurri* 32', []);

            expect(result.correctedMenu).toBe('Steak & Eggs, 4 oz hanger steak, Chimichurri* 29');
            expect(result.changes).toEqual([expect.objectContaining({ reason: 'changed_price', originalPrice: '29' })]);
        });
    });

    // Maya Dubai cocktail menu, 2026-10-19 (attempt a906ed74): glass/bottle
    // prices typed as "76/326" or "80-345" were not recognized as prices, so the
    // AI's "76 | 326" reformat was stripped as "AI-added" and every margarita got
    // a blocking Missing Price critical. The chef retried three formats.
    describe('multi-price lines in formats the parser does not know', () => {
        it.each([
            ['slash', 'Mercado 76/326', 'Mercado 76 | 326'],
            ['hyphen', 'Avocado 80-345', 'Avocado 80 | 345'],
            ['spaced slash', 'Clarita 80 / 345', 'Clarita 80 | 345'],
            ['en dash', 'Clarita 80\u2013345', 'Clarita 80 | 345'],
            ['glued with hyphen', 'Clarita-80/345', 'Clarita 80 | 345'],
            ['spaced leading hyphen', 'Mercado -76/326', 'Mercado 76 | 326'],
        ])('keeps the chef\'s price written with a %s', (_label, original, corrected) => {
            const result = guardCorrectedMenuPrices(original, corrected, []);

            expect(result.correctedMenu).toBe(corrected);
            expect(result.changes).toEqual([]);
            expect(result.suggestions).toEqual([]);
        });

        it('keeps the full Maya margarita section intact', () => {
            const original = [
                'Margaritas',
                'Mercado 76/326',
                'blanco tequila, passion fruit, lime, spicy tincture',
                'Avocado 80-345',
                'silver tequila, avocado, lime, agave, orange liqueur',
                'Margarita Flight 240',
            ].join('\n');
            const corrected = original
                .replace('76/326', '76 | 326')
                .replace('80-345', '80 | 345');

            const result = guardCorrectedMenuPrices(original, corrected, []);

            expect(result.correctedMenu).toBe(corrected);
            expect(result.suggestions).toEqual([]);
        });

        it('still restores the chef\'s value when the AI changes a slash price', () => {
            const result = guardCorrectedMenuPrices('Mercado 76/326', 'Mercado 76 | 330', []);

            expect(result.correctedMenu).toBe('Mercado 76/326');
            expect(result.changes).toEqual([expect.objectContaining({ reason: 'changed_price' })]);
            expect(result.suggestions).toEqual([]);
        });

        it('restores an unparseable submitted price instead of deleting it and blocking', () => {
            const result = guardCorrectedMenuPrices('Clarita-80/345', 'Clarita 85 | 345', []);

            expect(result.correctedMenu).toBe('Clarita 80/345');
            expect(result.suggestions).toEqual([]);
        });

        it('still strips a price whose numbers appear nowhere in the submission', () => {
            const result = guardCorrectedMenuPrices('Mercado, blanco tequila, lime', 'Mercado, blanco tequila, lime 76 | 326', []);

            expect(result.correctedMenu).toBe('Mercado, blanco tequila, lime');
            expect(result.suggestions).toEqual([
                expect.objectContaining({ type: 'Missing Price', severity: 'critical' }),
            ]);
        });
    });
});
