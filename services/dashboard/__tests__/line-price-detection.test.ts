import { looksLikePriceOnLine, enforceAllergenProgramCheck } from '../lib/review-pipeline';

// looksLikePriceOnLine decides whether an AI "Missing Price" critical is
// already resolved. Every price shape below is one a chef has really typed
// (Maya Dubai, tán, Aqimero, Tamayo submissions); missing one leaves a false
// blocking critical on a priced line.
describe('looksLikePriceOnLine', () => {
    it.each([
        'Mercado 76/326',
        'Mercado 76 | 326',
        'Avocado 80-345',
        'Dom Perignon 2450',
        'Dom Perignon 1,450',
        'Saffron Sour 78 AED',
        'Saffron Sour 78AED',
        'Saffron Sour AED 78',
        'Guacamole $12',
        'Guacamole 12.50',
        'Mercado 76/326*',
        'Truffle Fries 16 D,V',
        'Oysters MP',
        'Oysters Market Price',
        "Chateau Margaux '99 450",
    ])('reads "%s" as priced', (line) => {
        expect(looksLikePriceOnLine(line)).toBe(true);
    });

    it.each([
        'Mercado',
        '4 oz hanger steak',
        'corn masa - shredded chicken',
        'Chateau Margaux 2015',
        "Chateau Margaux '99",
        'Chateau Margaux \u201999',
    ])('reads "%s" as unpriced', (line) => {
        expect(looksLikePriceOnLine(line)).toBe(false);
    });
});

describe('enforceAllergenProgramCheck price shapes', () => {
    it.each([
        'Mercado G,D 76/326',
        'Mercado G,D 80 AED',
    ])('counts "%s" as a coded line', (line) => {
        expect(enforceAllergenProgramCheck(line, [], 'G gluten | D dairy')).toEqual([]);
    });
});
