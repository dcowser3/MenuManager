import {
    buildNearMissBriefing,
    getCanonicalVocabulary,
    invalidateCanonicalVocabulary,
    isCanonicalVocabularyEnabled,
} from '../lib/canonical-vocabulary-provider';
import { buildFinalPrompt } from '../lib/qa-prompt-builder';

const RULES = [
    { original_text: 'tequileno', corrected_text: 'tequileño' },
    { original_text: 'st. germain', corrected_text: 'St-Germain' },
];

beforeEach(() => invalidateCanonicalVocabulary());

describe('isCanonicalVocabularyEnabled', () => {
    test('defaults on and is disabled only by an explicit false', () => {
        expect(isCanonicalVocabularyEnabled({} as NodeJS.ProcessEnv)).toBe(true);
        expect(isCanonicalVocabularyEnabled({ CANONICAL_VOCABULARY_ENABLED: 'FALSE' } as any)).toBe(false);
        expect(isCanonicalVocabularyEnabled({ CANONICAL_VOCABULARY_ENABLED: 'true' } as any)).toBe(true);
    });
});

describe('getCanonicalVocabulary', () => {
    test('caches within the TTL and rebuilds after it expires', async () => {
        const fetchAcceptedRules = jest.fn().mockResolvedValue(RULES);
        let now = 1_000;
        const params = { fetchAcceptedRules, ttlMs: 500, now: () => now };

        await getCanonicalVocabulary(params);
        await getCanonicalVocabulary(params);
        expect(fetchAcceptedRules).toHaveBeenCalledTimes(1);

        now += 600;
        await getCanonicalVocabulary(params);
        expect(fetchAcceptedRules).toHaveBeenCalledTimes(2);
    });

    test('concurrent callers share one build', async () => {
        const fetchAcceptedRules = jest.fn().mockResolvedValue(RULES);
        await Promise.all([
            getCanonicalVocabulary({ fetchAcceptedRules }),
            getCanonicalVocabulary({ fetchAcceptedRules }),
            getCanonicalVocabulary({ fetchAcceptedRules }),
        ]);
        expect(fetchAcceptedRules).toHaveBeenCalledTimes(1);
    });

    test('a failing fetch resolves to null instead of throwing', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const vocabulary = await getCanonicalVocabulary({
            fetchAcceptedRules: async () => { throw new Error('db down'); },
        });
        expect(vocabulary).toBeNull();
        warn.mockRestore();
    });
});

describe('buildNearMissBriefing', () => {
    test('produces a briefing naming the canonical form', async () => {
        const briefing = await buildNearMissBriefing('La Chata Paloma, el tequileno blanco, lime', {
            fetchAcceptedRules: async () => RULES,
        });
        expect(briefing).toContain('tequileño');
    });

    test('is empty when the feature is disabled', async () => {
        const briefing = await buildNearMissBriefing('el tequileno blanco', {
            fetchAcceptedRules: async () => RULES,
            env: { CANONICAL_VOCABULARY_ENABLED: 'false' } as any,
        });
        expect(briefing).toBe('');
    });

    test('is empty for a clean menu, for empty input, and when the fetch fails', async () => {
        expect(await buildNearMissBriefing('el tequileño blanco, lime', { fetchAcceptedRules: async () => RULES })).toBe('');
        expect(await buildNearMissBriefing('   ', { fetchAcceptedRules: async () => RULES })).toBe('');

        // Without this the cache from the assertions above would serve the next call and
        // the failing fetch would never run — which is correct behaviour, just not what
        // this case is testing.
        invalidateCanonicalVocabulary();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await buildNearMissBriefing('el tequileno blanco', {
            fetchAcceptedRules: async () => { throw new Error('db down'); },
        })).toBe('');
        warn.mockRestore();
    });

    test('a cached vocabulary keeps serving when a later fetch would fail', async () => {
        const good = await buildNearMissBriefing('el tequileno blanco', { fetchAcceptedRules: async () => RULES });
        expect(good).toContain('tequileño');
        // Cache hit: the review path must not lose findings because the DB blipped.
        const stillGood = await buildNearMissBriefing('el tequileno blanco', {
            fetchAcceptedRules: async () => { throw new Error('db down'); },
        });
        expect(stillGood).toBe(good);
    });
});

describe('buildFinalPrompt near-miss section', () => {
    const ctx = {
        precheckEnabled: false,
        embeddedSetMenuAnalysis: { sections: [], issues: [] },
    };

    test('omitting the briefing leaves the prompt byte-identical', () => {
        const without = buildFinalPrompt('BASE PROMPT', ctx);
        const empty = buildFinalPrompt('BASE PROMPT', { ...ctx, nearMissBriefing: '   ' });
        expect(empty.prompt).toBe(without.prompt);
        expect(empty.sections).not.toContain('canonical_vocabulary_near_misses');
    });

    test('a briefing is appended and recorded as a section', () => {
        const out = buildFinalPrompt('BASE PROMPT', { ...ctx, nearMissBriefing: '## Spelling suspicions\n- check "tequileno"' });
        expect(out.prompt).toContain('Spelling suspicions');
        expect(out.sections).toContain('canonical_vocabulary_near_misses');
    });

    test('the section can be omitted explicitly for replay parity', () => {
        const out = buildFinalPrompt('BASE PROMPT', { ...ctx, nearMissBriefing: '## Spelling suspicions' },
            { omitSections: ['canonical_vocabulary_near_misses'] });
        expect(out.prompt).not.toContain('Spelling suspicions');
        expect(out.sections).not.toContain('canonical_vocabulary_near_misses');
    });
});
