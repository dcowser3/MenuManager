import { isStandalonePrice, lineHasPrice, matchTrailingPrice, splitTrailingPrice } from '../lib/price-shapes';
import { detectTopLevelPrixFixePrice } from '../lib/review-pipeline';
import { guardCorrectedMenuPrices } from '../lib/price-integrity-guard';
import { guardCorrectedMenuRawMarkers } from '../lib/raw-marker-integrity-guard';

// One price grammar for every check. Each shape below is one a chef has typed;
// a check that misses it strips the chef's price or raises a false critical.
describe('price-shapes', () => {
    it.each([
        ['Mercado 76/326', '76/326'],
        ['Mercado 76 | 326', '76 | 326'],
        ['Avocado 80-345', '80-345'],
        ['Clarita 80–345', '80–345'],
        ['Glass 16 | 80', '16 | 80'],
        ['Dom Perignon 2450', '2450'],
        ['Dom Perignon 1,450', '1,450'],
        ['Saffron Sour AED 80', 'AED 80'],
        ['Saffron Sour 80AED', '80AED'],
        ['Saffron Sour 78 AED', '78 AED'],
        ['Oysters MP', 'MP'],
        ['Oysters Market Price', 'Market Price'],
        ['Guacamole $12', '$12'],
        ['Guacamole 12.50', '12.50'],
        ['Brunch 68 pp', '68 pp'],
        ["Chateau Margaux '99 450", '450'],
    ])('reads the trailing price of "%s"', (line, price) => {
        expect(matchTrailingPrice(line)?.price).toBe(price);
        expect(lineHasPrice(line)).toBe(true);
    });

    it.each([
        'Truffle Fries 16 D,V',
        'Mercado 76/326*',
        'Clarita-80/345',
    ])('sees a price on "%s" despite codes, marker or glue', (line) => {
        expect(lineHasPrice(line)).toBe(true);
    });

    it.each([
        'Chateau Margaux 2015',
        "Chateau Margaux '99",
        'Chateau Margaux ’99',
        'HEINEKEN 0.0',
        'Mercado',
        '4 oz hanger steak',
    ])('reads "%s" as unpriced', (line) => {
        expect(matchTrailingPrice(line)).toBeNull();
        expect(lineHasPrice(line)).toBe(false);
    });

    it('reads a vintage as a price only when the caller restores values', () => {
        expect(matchTrailingPrice('Chateau Margaux 2015', { allowYear: true })?.price).toBe('2015');
    });

    it('splits the price off with its leading space', () => {
        expect(splitTrailingPrice('Mercado G,D 76/326')).toEqual({ body: 'Mercado G,D', price: ' 76/326' });
        expect(splitTrailingPrice('Mercado G,D')).toEqual({ body: 'Mercado G,D', price: '' });
    });

    it.each(['68 pp', '$60', '95/145', '50.00PP'])('treats "%s" as a standalone price', (line) => {
        expect(isStandalonePrice(line)).toBe(true);
    });

    it.each(['2026', 'MP', '3 Courses', '0'])('does not treat "%s" as a standalone price', (line) => {
        expect(isStandalonePrice(line)).toBe(false);
    });
});

describe('checks that use price-shapes', () => {
    it.each([
        '95/145 with pairing',
        '95 | 145 with wine pairing',
        '95 with beverage pairing',
    ])('finds the prix fixe package price in "%s"', (line) => {
        expect(detectTopLevelPrixFixePrice(`Tasting Menu\n${line}\n1\nFirst Course`)).toMatchObject({ found: true, matchedLine: line });
    });

    it('never strips an AI-added vintage year or blocks on it', () => {
        const result = guardCorrectedMenuPrices('Chateau Margaux', 'Chateau Margaux 2015', []);

        expect(result.correctedMenu).toBe('Chateau Margaux 2015');
        expect(result.suggestions).toEqual([]);
    });

    it('keeps a currency-coded price the AI only reformatted', () => {
        const result = guardCorrectedMenuPrices('Saffron Sour 80AED', 'Saffron Sour AED 80', []);

        expect(result.changes).toEqual([]);
        expect(result.suggestions).toEqual([]);
    });

    it('reinserts a lost raw marker before a slash price', () => {
        const result = guardCorrectedMenuRawMarkers('Tuna Crudo, citrus* 76/326', 'Tuna Crudo, citrus 76/326');

        expect(result.correctedMenu).toBe('Tuna Crudo, citrus* 76/326');
    });
});
