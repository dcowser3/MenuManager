import { canonicalizeFinalTerms, runPreAiDeterministicChecks } from '../lib/pre-ai-deterministic-rules';
import { policyHash, resolveCanonicalPolicies, renderCanonicalPolicyGuidance } from '../lib/canonical-policy';
import { buildNearMissAnalysis, invalidateCanonicalVocabulary } from '../lib/canonical-vocabulary-provider';
import { buildFinalPrompt } from '../lib/qa-prompt-builder';

const globalRule = { id: 'global', status: 'accepted', change_type: 'terminology', original_text: 'house-made', corrected_text: 'housemade' };
const localRule = { ...globalRule, id: 'local', corrected_text: 'house made', is_location_specific: true, location: 'A', applies_to_menu_type: 'food' };

beforeEach(invalidateCanonicalVocabulary);

test.each(['house made', 'house -made', 'house- made', 'house-made', 'house\u00a0made', 'house‐made', 'house‑made', 'HOUSE-MADE'])('one accepted policy handles %s', input => {
    const options = { acceptedCorrectionRules: [globalRule] };
    const expected = input === input.toUpperCase() ? 'HOUSEMADE' : 'housemade';
    expect(canonicalizeFinalTerms(`Bread, ${input} rolls G 12`, options).menuText).toBe(`Bread, ${expected} rolls G 12`);
    expect(runPreAiDeterministicChecks(`Bread, ${input} rolls G 12`, options).menuText).toBe(`Bread, ${expected} rolls G 12`);
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
