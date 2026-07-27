"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const canonical_vocabulary_1 = require("../lib/canonical-vocabulary");
const rule = (original, corrected) => ({ original_text: original, corrected_text: corrected });
describe('differsOnlyByAccent', () => {
    test('separates accent errors from real spelling differences', () => {
        expect((0, canonical_vocabulary_1.differsOnlyByAccent)('tequileno', 'tequileño')).toBe(true);
        expect((0, canonical_vocabulary_1.differsOnlyByAccent)('rose', 'rosé')).toBe(true);
        expect((0, canonical_vocabulary_1.differsOnlyByAccent)('tequileño', 'tequileño')).toBe(false);
        expect((0, canonical_vocabulary_1.differsOnlyByAccent)('mexcican', 'mexican')).toBe(false);
    });
});
describe('buildCanonicalVocabulary', () => {
    test('records the canonical form with the variants reviewers correct to it', () => {
        const vocab = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
            acceptedRules: [rule('tequileno', 'tequileño'), rule('st. germain', 'St-Germain')],
        });
        const tequilena = vocab.entries.find((e) => e.canonical === 'tequileño');
        expect(tequilena).toMatchObject({ canonical: 'tequileño', ambiguous: false });
        expect(tequilena?.variants).toContain('tequileno');
    });
    test('derives ambiguity from corrections in both directions', () => {
        const vocab = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
            acceptedRules: [rule('rose', 'rosé'), rule('rosé', 'rose')],
        });
        expect(vocab.entries.every((e) => e.ambiguous)).toBe(true);
    });
    test('seed terms mark ambiguity before both directions have been seen', () => {
        const vocab = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
            acceptedRules: [rule('tartare', 'tartar')],
            seedAmbiguousTerms: ['tartare'],
        });
        expect(vocab.entries[0].ambiguous).toBe(true);
    });
    test('legitimacy is accent-sensitive so the wrong form cannot inherit frequency', () => {
        const approved = Array.from({ length: 8 }, () => 'el tequileño blanco');
        const vocab = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
            acceptedRules: [rule('tequileno', 'tequileño')],
            approvedTexts: approved,
        });
        expect(vocab.legitimate.has('tequileño')).toBe(true);
        expect(vocab.legitimate.has('tequileno')).toBe(false);
    });
});
describe('findNearMisses', () => {
    const vocab = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
        acceptedRules: [
            rule('tequileno', 'tequileño'),
            rule('st. germain', 'St-Germain'),
            rule('mexcican', 'mexican'),
            rule('rose', 'rosé'),
            rule('rosé', 'rose'),
        ],
        approvedTexts: [Array.from({ length: 8 }, () => 'ancho reyes chile liqueur el tequileño').join(' ')],
    });
    test('catches an accent error the corpus has never seen in this phrasing', () => {
        const hits = (0, canonical_vocabulary_1.findNearMisses)('La Chata Paloma, el tequileno blanco, lime, agave', vocab);
        expect(hits.some((h) => h.kind === 'diacritic' && h.canonical === 'tequileño')).toBe(true);
    });
    test('catches an unseen brand misspelling via edit distance, not an enumerated rule', () => {
        // "ste. germaine" was never entered as a rule for this vocabulary.
        const hits = (0, canonical_vocabulary_1.findNearMisses)('el tequileño blanco, ste. germaine liqueur, lemon', vocab);
        expect(hits.some((h) => h.kind === 'typo' && h.canonical === 'St-Germain')).toBe(true);
    });
    test('reports a both-directions term as a question, never a correction', () => {
        const hits = (0, canonical_vocabulary_1.findNearMisses)('Honeyed Rose, aperitivo rosato, honey, orange bitters', vocab);
        const rosy = hits.find((h) => /rose/i.test(h.found));
        expect(rosy?.kind).toBe('ambiguous');
        expect(rosy?.message).toContain('both valid depending on context');
    });
    test('does not flag terms that are frequent in approved menus', () => {
        const hits = (0, canonical_vocabulary_1.findNearMisses)('ancho reyes, lime, agave', vocab);
        expect(hits.some((h) => /ancho/i.test(h.found))).toBe(false);
    });
    test('does not flag an article-prefixed form of a canonical term', () => {
        const hits = (0, canonical_vocabulary_1.findNearMisses)('el tequileño reposado', vocab);
        expect(hits).toHaveLength(0);
    });
    test('says nothing about a correctly spelled menu', () => {
        expect((0, canonical_vocabulary_1.findNearMisses)('el tequileño blanco, lime, agave, soda', vocab)).toHaveLength(0);
    });
    test('briefing renders findings and is empty when there is nothing to say', () => {
        expect((0, canonical_vocabulary_1.renderNearMissBriefing)([])).toBe('');
        const briefing = (0, canonical_vocabulary_1.renderNearMissBriefing)((0, canonical_vocabulary_1.findNearMisses)('el tequileno blanco', vocab));
        expect(briefing).toContain('canonical vocabulary');
        expect(briefing).toContain('tequileño');
    });
});
describe('near-miss precision guards', () => {
    const vocab = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
        acceptedRules: [
            rule('tequileno', 'tequileño'),
            rule('st. germain', 'St-Germain'),
            rule('titos', "tito's"),
            rule('tomatoes', 'tomato'),
        ],
    });
    test('punctuation differences are not reported as accent errors', () => {
        expect((0, canonical_vocabulary_1.differsOnlyByAccent)('titos', "tito's")).toBe(false);
        expect((0, canonical_vocabulary_1.differsOnlyByAccent)('st germain', 'St-Germain')).toBe(false);
        const hits = (0, canonical_vocabulary_1.findNearMisses)("titos vodka", vocab);
        expect(hits.every((h) => h.kind !== 'diacritic')).toBe(true);
    });
    test('two edits on a short word is noise and is not flagged', () => {
        // "Lone" (Lone Star) vs "rose", and "rosato" vs "tomato" — both distance 2.
        expect((0, canonical_vocabulary_1.findNearMisses)('Lone Star Margarita', vocab).some((h) => /lone/i.test(h.found))).toBe(false);
        expect((0, canonical_vocabulary_1.findNearMisses)('aperitivo rosato, honey', vocab).some((h) => /rosato/i.test(h.found))).toBe(false);
    });
    test('two edits on a long word is still caught', () => {
        const hits = (0, canonical_vocabulary_1.findNearMisses)('ste. germaine liqueur', vocab);
        expect(hits.some((h) => h.canonical === 'St-Germain')).toBe(true);
    });
    test('a recorded variant is described as such, not with a bogus distance', () => {
        const hits = (0, canonical_vocabulary_1.findNearMisses)('titos vodka', vocab);
        const hit = hits.find((h) => /titos/i.test(h.found));
        expect(hit?.message).toContain('recorded misspelling');
        expect(hit?.message).not.toMatch(/\d+ edit/);
    });
});
