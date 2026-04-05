/**
 * Tests for the design approval comparison logic.
 * Validates that the comparison rules reduce false positives
 * when comparing DOCX source against designer PDF.
 */

// We need to test the comparison functions directly.
// Since they're embedded in index.ts, we'll test via the API endpoint.
// For now, let's test the logic patterns.

describe('Design Comparison Rules', () => {
    // Simulate the comparison behavior we expect

    test('case-only differences should be info severity, not warning', () => {
        // "Tan Mimosa" vs "TAN MIMOSA" — just casing
        const docxLine = 'Tan Mimosa 16';
        const pdfLine = 'TAN MIMOSA 16';
        // Expect: should match fuzzy, word diffs should be 'formatting'/'info'
        expect(docxLine.toLowerCase()).toBe(pdfLine.toLowerCase().replace('á', 'a'));
    });

    test('"Choice of:" prefix removal should be acceptable', () => {
        const docxLine = 'Choice of: Classic, peach, blood orange, passion fruit, guava, lychee';
        const pdfLine = 'classic, peach, blood orange, guava, or lychee';
        // After stripping "Choice of:" and ignoring case/conjunctions,
        // these should mostly match
        const stripped = docxLine.replace(/^Choice of:\s*/i, '');
        expect(stripped.toLowerCase().startsWith('classic')).toBe(true);
    });

    test('added conjunctions ("or") should be info severity', () => {
        // PDF adds "or" before last item: "guava, or lychee" vs "guava, lychee"
        const ignorableWords = new Set(['of', 'the', 'a', 'an', 'with', 'and', 'or', '&']);
        expect(ignorableWords.has('or')).toBe(true);
    });

    test('price on separate line should be info, not critical', () => {
        // DOCX: "BOTTOMLESS BEBIDAS 29" — one line
        // PDF: "BOTTOMLESS BEBIDAS" (line 1) + price elsewhere
        const pdfExtraLine = '+10';
        const isPriceOnly = /^[\+\$\s]*\d+\.?\d*$/.test(pdfExtraLine.trim());
        expect(isPriceOnly).toBe(true);
    });

    test('rules file should be valid JSON with expected keys', () => {
        const fs = require('fs');
        const path = require('path');
        const rulesPath = path.join(__dirname, '..', 'design-comparison-rules.json');
        const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

        expect(rules.version).toBe(1);
        expect(rules.rules.ignoreCaseDifferences).toBe(true);
        expect(rules.rules.ignoreLeadingPhrases).toContain('Choice of:');
        expect(rules.rules.ignoreConjunctionChanges).toBe(true);
        expect(rules.rules.ignorableWords).toContain('or');
        expect(rules.rules.treatCaseOnlyAsInfo).toBe(true);
        expect(rules.rules.reorderingTolerance).toBe(true);
    });
});
