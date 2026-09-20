import {
    buildAcceptedPolicyTestFamily,
    buildBehaviorTestRecord,
    executeBehaviorTests,
    freezeBehaviorTests,
    validateBehaviorArtifact,
} from '../lib/learning-behavior-tests';
import { canonicalizeFinalTerms } from '../lib/pre-ai-deterministic-rules';

const acceptedRule = {
    id: 'rule-house-made',
    status: 'accepted',
    change_type: 'terminology',
    original_text: 'house-made',
    corrected_text: 'housemade',
    rule: 'Use the accepted housemade spelling.',
};

function humanCorrection(overrides: Record<string, unknown> = {}) {
    return {
        id: 'correction-1',
        submission_id: 'submission-1',
        source: 'human',
        reviewer_name: 'Reviewer',
        status: 'accepted',
        learning_intent: 'missed_review_correction',
        example_original: 'house-made',
        example_corrected: 'housemade',
        rule: 'Use the accepted housemade spelling.',
        ...overrides,
    };
}

describe('B6-A behavior artifact core', () => {
    test('records human authority and preserves known and unknown four-stage provenance', () => {
        const record = buildBehaviorTestRecord(humanCorrection(), {
            stages: {
                chef_input: { source: 'submission:1:input', text: 'house-made' },
                human_approved: { source: 'approval:1', text: 'housemade' },
            },
        });

        expect(record.expectationAuthority).toBe('human_explanation');
        expect(record.classification).toBe('missed_review_correction');
        expect(record.classificationStatus).toBe('reviewed');
        expect(record.stages.chef_input).toMatchObject({ status: 'known', source: 'submission:1:input' });
        expect(record.stages.human_approved).toMatchObject({ status: 'known', source: 'approval:1' });
        expect(record.stages.ai_delivered).toEqual({ status: 'unknown', reference: 'submission:submission-1:ai_delivered' });
        expect(record.stages.chef_submitted).toEqual({ status: 'unknown', reference: 'submission:submission-1:chef_submitted' });
    });

    test('keeps browser repair unsupported unless a no-human reproduction or edit history proves it', () => {
        expect(buildBehaviorTestRecord(humanCorrection()).browserRepairSupported).toBe(false);
        expect(buildBehaviorTestRecord(humanCorrection(), { reproduced_without_human: true }).browserRepairSupported).toBe(true);
        expect(buildBehaviorTestRecord(humanCorrection(), { edit_history_proves_failure: true }).browserRepairSupported).toBe(true);
    });

    test('classifies menu content updates and excludes them from policy learning', () => {
        const record = buildBehaviorTestRecord(humanCorrection({
            id: 'menu-update',
            learning_intent: 'menu_content_update',
        }));
        expect(record.classification).toBe('menu_content_update');
        expect(record.disposition).toBe('excluded_from_policy_learning');
        const artifact = freezeBehaviorTests([record], [{ ...acceptedRule, id: 'menu-update', change_type: 'menu_content_update' }]);
        expect(artifact.tests).toEqual([]);
        expect(artifact.contextualTests).toEqual([]);
    });

    test('generates bounded accepted-policy families with abstention and reviewed negatives', () => {
        const rule = {
            ...acceptedRule,
            is_location_specific: true,
            location: 'Property A',
            reviewed_negative_examples: [
                { text: 'House Made Brand', kind: 'brand', reviewer: 'Reviewer' },
                { text: 'maison faite', kind: 'multilingual', reviewer: 'Reviewer' },
                { text: 'house-made rolls', kind: 'valid_neighbor', reviewer: 'Reviewer' },
            ],
        };
        const family = buildAcceptedPolicyTestFamily(rule);
        expect(family.map(test => test.kind)).toEqual(expect.arrayContaining([
            'accepted_separator_equivalence',
            'accepted_case_convention',
            'quantity_preservation',
            'wrong_scope_abstention',
            'brand',
            'multilingual',
            'valid_neighbor',
            'deterministic_abstention_context_required',
        ]));
        expect(family.length).toBe(17);
        expect(buildAcceptedPolicyTestFamily({
            ...acceptedRule,
            original_text: 'berry',
            corrected_text: 'berries',
        })).toEqual([]);
    });

    test('freezes current canonical scope and produces an immutable artifact', () => {
        const rule = { ...acceptedRule, is_location_specific: true, location: 'Property A' };
        const record = buildBehaviorTestRecord(humanCorrection({ id: rule.id, location: 'Property A' }));
        const artifact = freezeBehaviorTests([record], [rule], [rule]);
        expect(artifact.tests.length).toBeGreaterThan(0);
        expect(artifact.tests.every(test => test.context.property === 'Property A' || test.context.property === '__outside_approved_scope__')).toBe(true);
        expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(validateBehaviorArtifact(artifact)).toBe(artifact);
    });

    test('executes deterministic variants against the current pre-AI canonicalizer', async () => {
        const artifact = freezeBehaviorTests(
            [buildBehaviorTestRecord(humanCorrection({ id: acceptedRule.id }))],
            [acceptedRule],
            [acceptedRule],
        );
        const result = await executeBehaviorTests(artifact, (input, context) => canonicalizeFinalTerms(input, {
            ...context,
            acceptedCorrectionRules: [acceptedRule],
        }).menuText);
        expect(result.passed).toBe(true);
        expect(result.outcomes).toHaveLength(13);
        expect(result.explanations).toEqual([{ correctionId: acceptedRule.id, disposition: 'variants_passed_pending_paired_proof' }]);
    });

    test('rejects tampered artifacts and artifacts over the bounded test limit', () => {
        const artifact = freezeBehaviorTests(
            [buildBehaviorTestRecord(humanCorrection({ id: acceptedRule.id }))],
            [acceptedRule],
            [acceptedRule],
        );
        expect(() => validateBehaviorArtifact({ ...artifact, records: [] })).toThrow('Trusted behavior expectations changed');
        expect(() => validateBehaviorArtifact({ ...artifact, tests: Array.from({ length: 5001 }, (_, index) => ({ id: index })) })).toThrow('Missing trusted pre-draft behavior tests');
    });
});
