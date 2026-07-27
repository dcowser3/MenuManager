import {
    buildCanonicalVocabulary,
    findNearMisses,
    differsOnlyByAccent,
    renderNearMissBriefing,
} from '../lib/canonical-vocabulary';

const rule = (original: string, corrected: string) => ({ original_text: original, corrected_text: corrected });

describe('differsOnlyByAccent', () => {
    test('separates accent errors from real spelling differences', () => {
        expect(differsOnlyByAccent('tequileno', 'tequileño')).toBe(true);
        expect(differsOnlyByAccent('rose', 'rosé')).toBe(true);
        expect(differsOnlyByAccent('tequileño', 'tequileño')).toBe(false);
        expect(differsOnlyByAccent('mexcican', 'mexican')).toBe(false);
    });
});

describe('buildCanonicalVocabulary', () => {
    test('records the canonical form with the variants reviewers correct to it', () => {
        const vocab = buildCanonicalVocabulary({
            acceptedRules: [rule('tequileno', 'tequileño'), rule('st. germain', 'St-Germain')],
        });
        const tequilena = vocab.entries.find((e) => e.canonical === 'tequileño');
        expect(tequilena).toMatchObject({ canonical: 'tequileño', ambiguous: false });
        expect(tequilena?.variants).toContain('tequileno');
    });

    test('derives ambiguity from corrections in both directions', () => {
        const vocab = buildCanonicalVocabulary({
            acceptedRules: [rule('rose', 'rosé'), rule('rosé', 'rose')],
        });
        expect(vocab.entries.every((e) => e.ambiguous)).toBe(true);
    });

    test('seed terms mark ambiguity before both directions have been seen', () => {
        const vocab = buildCanonicalVocabulary({
            acceptedRules: [rule('tartare', 'tartar')],
            seedAmbiguousTerms: ['tartare'],
        });
        expect(vocab.entries[0].ambiguous).toBe(true);
    });

    test('legitimacy is accent-sensitive so the wrong form cannot inherit frequency', () => {
        const approved = Array.from({ length: 8 }, () => 'el tequileño blanco');
        const vocab = buildCanonicalVocabulary({
            acceptedRules: [rule('tequileno', 'tequileño')],
            approvedTexts: approved,
        });
        expect(vocab.legitimate.has('tequileño')).toBe(true);
        expect(vocab.legitimate.has('tequileno')).toBe(false);
    });
});

describe('findNearMisses', () => {
    const vocab = buildCanonicalVocabulary({
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
        const hits = findNearMisses('La Chata Paloma, el tequileno blanco, lime, agave', vocab);
        expect(hits.some((h) => h.kind === 'diacritic' && h.canonical === 'tequileño')).toBe(true);
    });

    test('catches an unseen brand misspelling via edit distance, not an enumerated rule', () => {
        // "ste. germaine" was never entered as a rule for this vocabulary.
        const hits = findNearMisses('el tequileño blanco, ste. germaine liqueur, lemon', vocab);
        expect(hits.some((h) => h.kind === 'typo' && h.canonical === 'St-Germain')).toBe(true);
    });

    test('reports a both-directions term as a question, never a correction', () => {
        const hits = findNearMisses('Honeyed Rose, aperitivo rosato, honey, orange bitters', vocab);
        const rosy = hits.find((h) => /rose/i.test(h.found));
        expect(rosy?.kind).toBe('ambiguous');
        expect(rosy?.message).toContain('both valid depending on context');
    });

    test('does not flag terms that are frequent in approved menus', () => {
        const hits = findNearMisses('ancho reyes, lime, agave', vocab);
        expect(hits.some((h) => /ancho/i.test(h.found))).toBe(false);
    });

    test('does not flag an article-prefixed form of a canonical term', () => {
        const hits = findNearMisses('el tequileño reposado', vocab);
        expect(hits).toHaveLength(0);
    });

    test('says nothing about a correctly spelled menu', () => {
        expect(findNearMisses('el tequileño blanco, lime, agave, soda', vocab)).toHaveLength(0);
    });

    test('briefing renders findings and is empty when there is nothing to say', () => {
        expect(renderNearMissBriefing([])).toBe('');
        const briefing = renderNearMissBriefing(findNearMisses('el tequileno blanco', vocab));
        expect(briefing).toContain('canonical vocabulary');
        expect(briefing).toContain('tequileño');
    });
});

describe('near-miss precision guards', () => {
    const vocab = buildCanonicalVocabulary({
        acceptedRules: [
            rule('tequileno', 'tequileño'),
            rule('st. germain', 'St-Germain'),
            rule('titos', "tito's"),
            rule('tomatoes', 'tomato'),
        ],
    });

    test('punctuation differences are not reported as accent errors', () => {
        expect(differsOnlyByAccent('titos', "tito's")).toBe(false);
        expect(differsOnlyByAccent('st germain', 'St-Germain')).toBe(false);
        const hits = findNearMisses("titos vodka", vocab);
        expect(hits.every((h) => h.kind !== 'diacritic')).toBe(true);
    });

    test('two edits on a short word is noise and is not flagged', () => {
        // "Lone" (Lone Star) vs "rose", and "rosato" vs "tomato" — both distance 2.
        expect(findNearMisses('Lone Star Margarita', vocab).some((h) => /lone/i.test(h.found))).toBe(false);
        expect(findNearMisses('aperitivo rosato, honey', vocab).some((h) => /rosato/i.test(h.found))).toBe(false);
    });

    test('two edits on a long word is still caught', () => {
        const hits = findNearMisses('ste. germaine liqueur', vocab);
        expect(hits.some((h) => h.canonical === 'St-Germain')).toBe(true);
    });

    test('a recorded variant is described as such, not with a bogus distance', () => {
        const hits = findNearMisses('titos vodka', vocab);
        const hit = hits.find((h) => /titos/i.test(h.found));
        expect(hit?.message).toContain('recorded misspelling');
        expect(hit?.message).not.toMatch(/\d+ edit/);
    });
});
