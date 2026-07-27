"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const canonical_vocabulary_provider_1 = require("../lib/canonical-vocabulary-provider");
const qa_prompt_builder_1 = require("../lib/qa-prompt-builder");
const RULES = [
    { original_text: 'tequileno', corrected_text: 'tequileño' },
    { original_text: 'st. germain', corrected_text: 'St-Germain' },
];
beforeEach(() => (0, canonical_vocabulary_provider_1.invalidateCanonicalVocabulary)());
describe('isCanonicalVocabularyEnabled', () => {
    test('defaults on and is disabled only by an explicit false', () => {
        expect((0, canonical_vocabulary_provider_1.isCanonicalVocabularyEnabled)({})).toBe(true);
        expect((0, canonical_vocabulary_provider_1.isCanonicalVocabularyEnabled)({ CANONICAL_VOCABULARY_ENABLED: 'FALSE' })).toBe(false);
        expect((0, canonical_vocabulary_provider_1.isCanonicalVocabularyEnabled)({ CANONICAL_VOCABULARY_ENABLED: 'true' })).toBe(true);
    });
});
describe('getCanonicalVocabulary', () => {
    test('caches within the TTL and rebuilds after it expires', async () => {
        const fetchAcceptedRules = jest.fn().mockResolvedValue(RULES);
        let now = 1000;
        const params = { fetchAcceptedRules, ttlMs: 500, now: () => now };
        await (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)(params);
        await (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)(params);
        expect(fetchAcceptedRules).toHaveBeenCalledTimes(1);
        now += 600;
        await (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)(params);
        expect(fetchAcceptedRules).toHaveBeenCalledTimes(2);
    });
    test('concurrent callers share one build', async () => {
        const fetchAcceptedRules = jest.fn().mockResolvedValue(RULES);
        await Promise.all([
            (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)({ fetchAcceptedRules }),
            (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)({ fetchAcceptedRules }),
            (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)({ fetchAcceptedRules }),
        ]);
        expect(fetchAcceptedRules).toHaveBeenCalledTimes(1);
    });
    test('a failing fetch resolves to null instead of throwing', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const vocabulary = await (0, canonical_vocabulary_provider_1.getCanonicalVocabulary)({
            fetchAcceptedRules: async () => { throw new Error('db down'); },
        });
        expect(vocabulary).toBeNull();
        warn.mockRestore();
    });
});
describe('buildNearMissBriefing', () => {
    test('produces a briefing naming the canonical form', async () => {
        const briefing = await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('La Chata Paloma, el tequileno blanco, lime', {
            fetchAcceptedRules: async () => RULES,
        });
        expect(briefing).toContain('tequileño');
    });
    test('is empty when the feature is disabled', async () => {
        const briefing = await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('el tequileno blanco', {
            fetchAcceptedRules: async () => RULES,
            env: { CANONICAL_VOCABULARY_ENABLED: 'false' },
        });
        expect(briefing).toBe('');
    });
    test('is empty for a clean menu, for empty input, and when the fetch fails', async () => {
        expect(await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('el tequileño blanco, lime', { fetchAcceptedRules: async () => RULES })).toBe('');
        expect(await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('   ', { fetchAcceptedRules: async () => RULES })).toBe('');
        // Without this the cache from the assertions above would serve the next call and
        // the failing fetch would never run — which is correct behaviour, just not what
        // this case is testing.
        (0, canonical_vocabulary_provider_1.invalidateCanonicalVocabulary)();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => { });
        expect(await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('el tequileno blanco', {
            fetchAcceptedRules: async () => { throw new Error('db down'); },
        })).toBe('');
        warn.mockRestore();
    });
    test('a cached vocabulary keeps serving when a later fetch would fail', async () => {
        const good = await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('el tequileno blanco', { fetchAcceptedRules: async () => RULES });
        expect(good).toContain('tequileño');
        // Cache hit: the review path must not lose findings because the DB blipped.
        const stillGood = await (0, canonical_vocabulary_provider_1.buildNearMissBriefing)('el tequileno blanco', {
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
        const without = (0, qa_prompt_builder_1.buildFinalPrompt)('BASE PROMPT', ctx);
        const empty = (0, qa_prompt_builder_1.buildFinalPrompt)('BASE PROMPT', { ...ctx, nearMissBriefing: '   ' });
        expect(empty.prompt).toBe(without.prompt);
        expect(empty.sections).not.toContain('canonical_vocabulary_near_misses');
    });
    test('a briefing is appended and recorded as a section', () => {
        const out = (0, qa_prompt_builder_1.buildFinalPrompt)('BASE PROMPT', { ...ctx, nearMissBriefing: '## Spelling suspicions\n- check "tequileno"' });
        expect(out.prompt).toContain('Spelling suspicions');
        expect(out.sections).toContain('canonical_vocabulary_near_misses');
    });
    test('the section can be omitted explicitly for replay parity', () => {
        const out = (0, qa_prompt_builder_1.buildFinalPrompt)('BASE PROMPT', { ...ctx, nearMissBriefing: '## Spelling suspicions' }, { omitSections: ['canonical_vocabulary_near_misses'] });
        expect(out.prompt).not.toContain('Spelling suspicions');
        expect(out.sections).not.toContain('canonical_vocabulary_near_misses');
    });
});
