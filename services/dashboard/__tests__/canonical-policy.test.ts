import { canonicalizeFinalTerms, runPreAiDeterministicChecks } from '../lib/pre-ai-deterministic-rules';
import { policyHash, resolveCanonicalPolicies, renderCanonicalPolicyGuidance } from '../lib/canonical-policy';
import { buildNearMissAnalysis, invalidateCanonicalVocabulary } from '../lib/canonical-vocabulary-provider';
import { buildFinalPrompt } from '../lib/qa-prompt-builder';
import { runFullReviewPipeline } from '../lib/review-pipeline';

const globalRule = { id: 'global', status: 'accepted', change_type: 'terminology', original_text: 'house-made', corrected_text: 'housemade' };
const localRule = { ...globalRule, id: 'local', corrected_text: 'house made', is_location_specific: true, location: 'A', applies_to_menu_type: 'food' };

beforeEach(invalidateCanonicalVocabulary);

test.each(['house made', 'house -made', 'house- made', 'house-made', 'house\u00a0made', 'house‐made', 'house‑made', 'HOUSE-MADE'])('one accepted policy handles %s', input => {
    const options = { acceptedCorrectionRules: [globalRule] };
    const expected = input === input.toUpperCase() ? 'HOUSEMADE' : 'housemade';
    expect(canonicalizeFinalTerms(`Bread, ${input} rolls G 12`, options).menuText).toBe(`Bread, ${expected} rolls G 12`);
    expect(runPreAiDeterministicChecks(`Bread, ${input} rolls G 12`, options).menuText).toBe(`Bread, ${expected} rolls G 12`);
});

test('reverse separator policy matches one-word, spaced, and hyphenated forms without crossing boundaries', () => {
    const reverseRule = { ...globalRule, original_text: 'housemade', corrected_text: 'house-made' };
    for (const input of ['housemade', 'house made', 'house-made', 'house\u00a0made', 'house‐made', 'house‑made']) {
        expect(runPreAiDeterministicChecks(`Dish, ${input} G 12`, { acceptedCorrectionRules: [reverseRule] }).menuText)
            .toBe('Dish, house-made G 12');
    }
    const adversarial = 'house\nmade\nhouse G made\nhouse 12 made\nhousemate';
    expect(runPreAiDeterministicChecks(adversarial, { acceptedCorrectionRules: [reverseRule] }).menuText).toBe(adversarial);
});

test('separator equivalence does not cross boundaries or infer semantic equivalence', () => {
    const text = 'house\nmade\nhouse, made\nhouse G made\nhouse 12 made\nhousemate';
    expect(canonicalizeFinalTerms(text, { acceptedCorrectionRules: [globalRule] }).menuText).toBe(text);
    expect(resolveCanonicalPolicies([{ ...globalRule, original_text: 'housemate' }]).policies[0].match.separatorVariants).toBe(false);
});

test('local winner is identical across precheck, final pass, prompt and vocabulary', async () => {
    const rules = [globalRule, localRule];
    const options = { property: 'A', templateType: 'food', acceptedCorrectionRules: rules };
    expect(runPreAiDeterministicChecks('Bread, house-made G 12', options).menuText).toBe('Bread, house made G 12');
    expect(canonicalizeFinalTerms('Bread, house-made G 12', options).menuText).toBe('Bread, house made G 12');
    expect(renderCanonicalPolicyGuidance(rules, options)).toContain('"preferred":"house made"');
    expect(renderCanonicalPolicyGuidance(rules, options)).not.toContain('"preferred":"housemade"');
    const prompt = buildFinalPrompt('RULES', { ...options, precheckEnabled: false, embeddedSetMenuAnalysis: { sections: [], issues: [] } });
    expect(prompt.prompt).toContain('"preferred":"house made"');
    expect(prompt.sections).toContain('accepted_scoped_policy');
    for (const context of [{ property: 'B' }, { property: 'A', templateType: 'beverage' }, {}]) {
        expect(resolveCanonicalPolicies(rules, context).rules.map(rule => rule.id)).toEqual(['global']);
    }
});

test('equal local authority reports conflicts without choosing a winner', () => {
    const rules = [localRule, { ...localRule, id: 'conflicting', corrected_text: 'homemade' }];
    const result = resolveCanonicalPolicies(rules, { property: 'A' });
    expect(result.rules).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(renderCanonicalPolicyGuidance(rules, { property: 'A' })).toContain('Conflicting policy IDs');
});

test('letter variants are contextual candidates, never deterministic edits', async () => {
    const text = 'house-mad rolls\nhouse-mdae rolls\nhousemate burger';
    expect(canonicalizeFinalTerms(text, { acceptedCorrectionRules: [globalRule] }).menuText).toBe(text);
    const analysis = await buildNearMissAnalysis(text, { fetchAcceptedRules: async () => [globalRule] });
    expect(analysis.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ found: 'house-mad', canonical: 'housemade' }),
        expect.objectContaining({ found: 'house-mdae', canonical: 'housemade' }),
    ]));
    expect((await buildNearMissAnalysis('housemade\nhouse\nmade', { fetchAcceptedRules: async () => [globalRule] })).findings).toEqual([]);
});

test('concurrent contexts and changed policy snapshots cannot leak local targets', async () => {
    const load = async () => [localRule];
    const [a, b, beverage] = await Promise.all([
        buildNearMissAnalysis('house-mad', { property: 'A', fetchAcceptedRules: load }),
        buildNearMissAnalysis('house-mad', { property: 'B', fetchAcceptedRules: load }),
        buildNearMissAnalysis('house-mad', { property: 'A', templateType: 'beverage', fetchAcceptedRules: load }),
    ]);
    expect(a.findings.length).toBeGreaterThan(0);
    expect(b.findings).toEqual([]);
    expect(beverage.findings).toEqual([]);
    let rules = [globalRule];
    const fetchAcceptedRules = async () => rules;
    const first = await buildNearMissAnalysis('house-mad', { fetchAcceptedRules, acceptedPolicyFingerprint: policyHash(rules) });
    rules = [];
    const second = await buildNearMissAnalysis('house-mad', { fetchAcceptedRules, acceptedPolicyFingerprint: policyHash(rules) });
    expect(first.findings.length).toBeGreaterThan(0);
    expect(second.findings).toEqual([]);
});

test('offline caller assembles the same scoped policy for finding, prompt, and final behavior', async () => {
    const rules = [globalRule, localRule];
    const aiCaller = async (text: string, prompt: string) => {
        expect(prompt).toContain('ACCEPTED SCOPED TERM POLICY');
        return `=== CORRECTED MENU ===\n${text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`;
    };
    const cases = [
        { property: 'A', templateType: 'food', expected: 'house made' },
        { property: 'B', templateType: 'food', expected: 'housemade' },
        { property: 'A', templateType: 'beverage', expected: 'housemade' },
        {
            property: 'A', templateType: 'food', expected: 'house-made',
            rules: [localRule, { ...localRule, id: 'conflicting', corrected_text: 'homemade' }],
        },
    ];
    for (const item of cases) {
        const result = await runFullReviewPipeline('Dish, house-made G 12', {
            basePrompt: 'BASE QA PROMPT',
            property: item.property,
            templateType: item.templateType,
            menuType: 'standard',
            acceptedCorrectionRules: item.rules || rules,
        }, aiCaller);
        expect(result.finalCorrectedMenu).toContain(item.expected);
        expect(result.promptInfo.prompt).toContain('ACCEPTED SCOPED TERM POLICY');
    }
});
