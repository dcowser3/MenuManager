"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pre_ai_deterministic_rules_1 = require("../lib/pre-ai-deterministic-rules");
const canonical_policy_1 = require("../lib/canonical-policy");
const canonical_vocabulary_provider_1 = require("../lib/canonical-vocabulary-provider");
const qa_prompt_builder_1 = require("../lib/qa-prompt-builder");
const review_pipeline_1 = require("../lib/review-pipeline");
const globalRule = { id: 'global', status: 'accepted', change_type: 'terminology', original_text: 'house-made', corrected_text: 'housemade' };
const localRule = { ...globalRule, id: 'local', corrected_text: 'house made', is_location_specific: true, location: 'A', applies_to_menu_type: 'food' };
beforeEach(canonical_vocabulary_provider_1.invalidateCanonicalVocabulary);
test.each(['house made', 'house -made', 'house- made', 'house-made', 'house\u00a0made', 'house‐made', 'house‑made', 'HOUSE-MADE'])('one accepted policy handles %s', input => {
    const options = { acceptedCorrectionRules: [globalRule] };
    const expected = input === input.toUpperCase() ? 'HOUSEMADE' : 'housemade';
    expect((0, pre_ai_deterministic_rules_1.canonicalizeFinalTerms)(`Bread, ${input} rolls G 12`, options).menuText).toBe(`Bread, ${expected} rolls G 12`);
    expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)(`Bread, ${input} rolls G 12`, options).menuText).toBe(`Bread, ${expected} rolls G 12`);
});
test('reverse separator policy matches one-word, spaced, and hyphenated forms without crossing boundaries', () => {
    const reverseRule = { ...globalRule, original_text: 'housemade', corrected_text: 'house-made' };
    for (const input of ['housemade', 'house made', 'house-made', 'house\u00a0made', 'house‐made', 'house‑made']) {
        expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)(`Dish, ${input} G 12`, { acceptedCorrectionRules: [reverseRule] }).menuText)
            .toBe('Dish, house-made G 12');
    }
    const adversarial = 'house\nmade\nhouse G made\nhouse 12 made\nhousemate';
    expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)(adversarial, { acceptedCorrectionRules: [reverseRule] }).menuText).toBe(adversarial);
});
test('separator equivalence does not cross boundaries or infer semantic equivalence', () => {
    const text = 'house\nmade\nhouse, made\nhouse G made\nhouse 12 made\nhousemate';
    expect((0, pre_ai_deterministic_rules_1.canonicalizeFinalTerms)(text, { acceptedCorrectionRules: [globalRule] }).menuText).toBe(text);
    expect((0, canonical_policy_1.resolveCanonicalPolicies)([{ ...globalRule, original_text: 'housemate' }]).policies[0].match.separatorVariants).toBe(false);
});
test('local winner is identical across precheck, final pass, prompt and vocabulary', async () => {
    const rules = [globalRule, localRule];
    const options = { property: 'A', templateType: 'food', acceptedCorrectionRules: rules };
    expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Bread, house-made G 12', options).menuText).toBe('Bread, house made G 12');
    expect((0, pre_ai_deterministic_rules_1.canonicalizeFinalTerms)('Bread, house-made G 12', options).menuText).toBe('Bread, house made G 12');
    expect((0, canonical_policy_1.renderCanonicalPolicyGuidance)(rules, options)).toContain('"preferred":"house made"');
    expect((0, canonical_policy_1.renderCanonicalPolicyGuidance)(rules, options)).not.toContain('"preferred":"housemade"');
    const prompt = (0, qa_prompt_builder_1.buildFinalPrompt)('RULES', { ...options, precheckEnabled: false, embeddedSetMenuAnalysis: { sections: [], issues: [] } });
    expect(prompt.prompt).toContain('"preferred":"house made"');
    expect(prompt.sections).toContain('accepted_scoped_policy');
    for (const context of [{ property: 'B' }, { property: 'A', templateType: 'beverage' }, {}]) {
        expect((0, canonical_policy_1.resolveCanonicalPolicies)(rules, context).rules.map(rule => rule.id)).toEqual(['global']);
    }
});
test('equal local authority reports conflicts without choosing a winner', () => {
    const rules = [localRule, { ...localRule, id: 'conflicting', corrected_text: 'homemade' }];
    const result = (0, canonical_policy_1.resolveCanonicalPolicies)(rules, { property: 'A' });
    expect(result.rules).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect((0, canonical_policy_1.renderCanonicalPolicyGuidance)(rules, { property: 'A' })).toContain('Conflicting policy IDs');
});
test('letter variants are contextual candidates, never deterministic edits', async () => {
    const text = 'house-mad rolls\nhouse-mdae rolls\nhousemate burger';
    expect((0, pre_ai_deterministic_rules_1.canonicalizeFinalTerms)(text, { acceptedCorrectionRules: [globalRule] }).menuText).toBe(text);
    const analysis = await (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)(text, { fetchAcceptedRules: async () => [globalRule] });
    expect(analysis.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ found: 'house-mad', canonical: 'housemade' }),
        expect.objectContaining({ found: 'house-mdae', canonical: 'housemade' }),
    ]));
    expect((await (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)('housemade\nhouse\nmade', { fetchAcceptedRules: async () => [globalRule] })).findings).toEqual([]);
});
test('concurrent contexts and changed policy snapshots cannot leak local targets', async () => {
    const load = async () => [localRule];
    const [a, b, beverage] = await Promise.all([
        (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)('house-mad', { property: 'A', fetchAcceptedRules: load }),
        (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)('house-mad', { property: 'B', fetchAcceptedRules: load }),
        (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)('house-mad', { property: 'A', templateType: 'beverage', fetchAcceptedRules: load }),
    ]);
    expect(a.findings.length).toBeGreaterThan(0);
    expect(b.findings).toEqual([]);
    expect(beverage.findings).toEqual([]);
    let rules = [globalRule];
    const fetchAcceptedRules = async () => rules;
    const first = await (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)('house-mad', { fetchAcceptedRules, acceptedPolicyFingerprint: (0, canonical_policy_1.policyHash)(rules) });
    rules = [];
    const second = await (0, canonical_vocabulary_provider_1.buildNearMissAnalysis)('house-mad', { fetchAcceptedRules, acceptedPolicyFingerprint: (0, canonical_policy_1.policyHash)(rules) });
    expect(first.findings.length).toBeGreaterThan(0);
    expect(second.findings).toEqual([]);
});
test('offline caller assembles the same scoped policy for finding, prompt, and final behavior', async () => {
    const rules = [globalRule, localRule];
    const aiCaller = async (text, prompt) => {
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
        const result = await (0, review_pipeline_1.runFullReviewPipeline)('Dish, house-made G 12', {
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
