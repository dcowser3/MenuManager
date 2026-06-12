"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const text_similarity_1 = require("../lib/text-similarity");
describe('text-similarity (lifted from pre-ai-ab-replay)', () => {
    test('identical strings score 1 and empty strings score 0', () => {
        expect((0, text_similarity_1.boundedLevenshteinSimilarity)('abc', 'abc')).toBe(1);
        expect((0, text_similarity_1.boundedLevenshteinSimilarity)('', 'abc')).toBe(0);
    });
    test('single-character edits score proportionally to length', () => {
        const similarity = (0, text_similarity_1.boundedLevenshteinSimilarity)('caesar', 'ceasar');
        expect(similarity).toBeGreaterThan(0.6);
        expect(similarity).toBeLessThan(1);
    });
    test('normalizeComparable trims, collapses whitespace, and caps blank runs', () => {
        expect((0, text_similarity_1.normalizeComparable)('A  B\t C\r\n\n\n\nD ')).toBe('A B C\n\nD');
    });
    test('raw-asterisk style normalization collapses spaced markers', () => {
        expect((0, text_similarity_1.normalizeComparable)('tuna tartare * D 18', { normalizeRawAsteriskStyle: true }))
            .toBe('tuna tartare* D 18');
        const notice = '*CONSUMING RAW OR UNDERCOOKED MEATS may increase risk';
        expect((0, text_similarity_1.normalizeComparable)(notice, { normalizeRawAsteriskStyle: true })).toBe(notice);
    });
    test('token dice similarity tracks shared vocabulary', () => {
        expect((0, text_similarity_1.tokenDiceSimilarity)('guacamole fresh avocado', 'guacamole fresh avocado')).toBe(1);
        expect((0, text_similarity_1.tokenDiceSimilarity)('guacamole', 'tacos')).toBe(0);
    });
});
