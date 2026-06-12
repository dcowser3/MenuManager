import {
    boundedLevenshteinSimilarity,
    normalizeComparable,
    tokenDiceSimilarity,
} from '../lib/text-similarity';

describe('text-similarity (lifted from pre-ai-ab-replay)', () => {
    test('identical strings score 1 and empty strings score 0', () => {
        expect(boundedLevenshteinSimilarity('abc', 'abc')).toBe(1);
        expect(boundedLevenshteinSimilarity('', 'abc')).toBe(0);
    });

    test('single-character edits score proportionally to length', () => {
        const similarity = boundedLevenshteinSimilarity('caesar', 'ceasar');
        expect(similarity).toBeGreaterThan(0.6);
        expect(similarity).toBeLessThan(1);
    });

    test('normalizeComparable trims, collapses whitespace, and caps blank runs', () => {
        expect(normalizeComparable('A  B\t C\r\n\n\n\nD ')).toBe('A B C\n\nD');
    });

    test('raw-asterisk style normalization collapses spaced markers', () => {
        expect(normalizeComparable('tuna tartare * D 18', { normalizeRawAsteriskStyle: true }))
            .toBe('tuna tartare* D 18');
        const notice = '*CONSUMING RAW OR UNDERCOOKED MEATS may increase risk';
        expect(normalizeComparable(notice, { normalizeRawAsteriskStyle: true })).toBe(notice);
    });

    test('token dice similarity tracks shared vocabulary', () => {
        expect(tokenDiceSimilarity('guacamole fresh avocado', 'guacamole fresh avocado')).toBe(1);
        expect(tokenDiceSimilarity('guacamole', 'tacos')).toBe(0);
    });
});
