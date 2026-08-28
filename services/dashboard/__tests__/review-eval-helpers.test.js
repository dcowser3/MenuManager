const {
    activateCandidateRulesForEval,
    buildCandidateRuleActivationEvidence,
    classifyMaterialDisagreement,
    summarizeMaterialDisagreements,
    sortMaterialDisagreements,
} = require('../../../scripts/review-eval-helpers');
const { AI_REVIEW_FENCES } = require('../lib/review-response-contract');
const { runPreAiDeterministicChecks } = require('../lib/pre-ai-deterministic-rules');
const fs = require('fs');
const path = require('path');

function caseReport({ composite, groundTruthCorrectionCount = 0, falsePositives = 0 }) {
    return {
        composite,
        groundTruthCorrectionCount,
        corrections: {
            falsePositives,
            truePositives: 0,
            falseNegatives: groundTruthCorrectionCount,
        },
    };
}

describe('review eval material disagreement helpers', () => {
    test('transiently activates proposal-shaped candidate rules for deterministic eval', () => {
        const proposalRules = [{ original_text: 'homemade', corrected_text: 'housemade', change_type: 'terminology' }];
        const activated = activateCandidateRulesForEval(proposalRules);

        expect(activated).toEqual([expect.objectContaining({
            id: 'eval-candidate-rule-0',
            status: 'accepted',
            original_text: 'homemade',
            corrected_text: 'housemade',
        })]);
        expect(proposalRules[0]).not.toHaveProperty('status');

        const result = runPreAiDeterministicChecks('homemade furikake', {
            acceptedCorrectionRules: activated,
        });
        expect(result.menuText).toBe('housemade furikake');
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: 'eval-candidate-rule-0', source: 'accepted_correction_rule' }),
        ]));
    });

    test('aggregates pre- and post-AI activation evidence for every candidate rule', () => {
        const rules = activateCandidateRulesForEval([
            { original_text: 'homemade', corrected_text: 'housemade' },
            { original_text: 'house -made', corrected_text: 'housemade' },
            { original_text: 'unused', corrected_text: 'replacement' },
        ]);
        const evidence = buildCandidateRuleActivationEvidence(rules, [
            {
                case_id: 'case-1',
                deterministicRuleActivations: [
                    { rule_id: 'eval-candidate-rule-0', phase: 'pre_ai' },
                    { rule_id: 'eval-candidate-rule-1', phase: 'post_ai' },
                ],
            },
            {
                case_id: 'case-2',
                deterministicRuleActivations: [
                    { rule_id: 'eval-candidate-rule-0', phase: 'pre_ai' },
                ],
            },
        ]);

        expect(evidence[0]).toMatchObject({ pre_ai_activations: 2, post_ai_activations: 0, total_activations: 2, case_ids: ['case-1', 'case-2'] });
        expect(evidence[1]).toMatchObject({ pre_ai_activations: 0, post_ai_activations: 1, total_activations: 1, case_ids: ['case-1'] });
        expect(evidence[2]).toMatchObject({ total_activations: 0, case_ids: [] });
    });

    test('classifies a clean menu spurious edit when false positives cross zero', () => {
        expect(classifyMaterialDisagreement(
            caseReport({ composite: 1, falsePositives: 0 }),
            caseReport({ composite: 0.6, falsePositives: 1 }),
            0.02
        )).toBe('clean_menu_spurious_edit');
    });

    test('allows one ground-truth correction as near-zero', () => {
        expect(classifyMaterialDisagreement(
            caseReport({ composite: 0.6, groundTruthCorrectionCount: 1, falsePositives: 1 }),
            caseReport({ composite: 1, groundTruthCorrectionCount: 1, falsePositives: 0 }),
            0.02
        )).toBe('clean_menu_spurious_edit');
    });

    test('classifies non-clean or non-FP-crossing deltas as substantive', () => {
        expect(classifyMaterialDisagreement(
            caseReport({ composite: 1, groundTruthCorrectionCount: 2, falsePositives: 0 }),
            caseReport({ composite: 0.6, groundTruthCorrectionCount: 2, falsePositives: 1 }),
            0.02
        )).toBe('substantive');
        expect(classifyMaterialDisagreement(
            caseReport({ composite: 0.7, falsePositives: 1 }),
            caseReport({ composite: 0.9, falsePositives: 2 }),
            0.02
        )).toBe('substantive');
    });

    test('ignores deltas inside the materiality noise floor', () => {
        expect(classifyMaterialDisagreement(
            caseReport({ composite: 0.8 }),
            caseReport({ composite: 0.81, falsePositives: 1 }),
            0.02
        )).toBeNull();
    });

    test('summarizes classes and orders substantive cases first', () => {
        const comparisons = [
            { label: 'clean', disagreementClass: 'clean_menu_spurious_edit', delta: -0.4 },
            { label: 'substantive one', disagreementClass: 'substantive', delta: -0.2 },
            { label: 'substantive two', disagreementClass: 'substantive', delta: 0.1 },
            { label: 'same', disagreementClass: null, delta: 0.001 },
        ];

        expect(summarizeMaterialDisagreements(comparisons)).toEqual([
            { class: 'substantive', count: 2, meanDelta: -0.05 },
            { class: 'clean_menu_spurious_edit', count: 1, meanDelta: -0.4 },
        ]);
        expect(sortMaterialDisagreements(comparisons).map((entry) => entry.label)).toEqual([
            'substantive one',
            'substantive two',
            'clean',
        ]);
    });

    test('minimal Stage 3 prompt contains the shared response-fence contract', () => {
        const prompt = fs.readFileSync(path.join(__dirname, '../../../sop-processor/qa_prompt_minimal.txt'), 'utf8');
        for (const marker of Object.values(AI_REVIEW_FENCES)) expect(prompt).toContain(marker);
        expect(prompt).toContain('G=gluten');
        expect(prompt.length).toBeLessThan(1200);
    });
});
