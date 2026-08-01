const {
    classifyMaterialDisagreement,
    summarizeMaterialDisagreements,
    sortMaterialDisagreements,
} = require('../../../scripts/review-eval-helpers');
const { AI_REVIEW_FENCES } = require('../lib/review-response-contract');
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
