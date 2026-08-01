const NEAR_ZERO_GROUND_TRUTH_CORRECTIONS = 1;

function correctionCount(caseReport) {
    if (Number.isFinite(caseReport?.groundTruthCorrectionCount)) {
        return caseReport.groundTruthCorrectionCount;
    }
    const corrections = caseReport?.corrections || {};
    return (corrections.truePositives || 0) + (corrections.falseNegatives || 0);
}

function falsePositiveCount(caseReport) {
    return Number(caseReport?.corrections?.falsePositives || 0);
}

function classifyMaterialDisagreement(baseline, current, noiseEpsilon = 0.02) {
    const delta = Number(current?.composite || 0) - Number(baseline?.composite || 0);
    if (Math.abs(delta) <= noiseEpsilon) return null;

    const baselineFalsePositives = falsePositiveCount(baseline);
    const currentFalsePositives = falsePositiveCount(current);
    const crossesSpuriousEditBoundary = (baselineFalsePositives === 0) !== (currentFalsePositives === 0);
    const groundTruthCorrectionCount = Math.max(correctionCount(baseline), correctionCount(current));

    if (groundTruthCorrectionCount <= NEAR_ZERO_GROUND_TRUTH_CORRECTIONS && crossesSpuriousEditBoundary) {
        return 'clean_menu_spurious_edit';
    }
    return 'substantive';
}

function summarizeMaterialDisagreements(comparisons) {
    const material = (comparisons || []).filter((comparison) => comparison.disagreementClass);
    return ['substantive', 'clean_menu_spurious_edit'].map((disagreementClass) => {
        const matches = material.filter((comparison) => comparison.disagreementClass === disagreementClass);
        return {
            class: disagreementClass,
            count: matches.length,
            meanDelta: matches.length
                ? matches.reduce((sum, comparison) => sum + comparison.delta, 0) / matches.length
                : 0,
        };
    });
}

function sortMaterialDisagreements(comparisons) {
    const rank = { substantive: 0, clean_menu_spurious_edit: 1 };
    return [...(comparisons || [])]
        .filter((comparison) => comparison.disagreementClass)
        .sort((a, b) => {
            const classDelta = (rank[a.disagreementClass] ?? 99) - (rank[b.disagreementClass] ?? 99);
            if (classDelta !== 0) return classDelta;
            return Math.abs(b.delta) - Math.abs(a.delta);
        });
}

module.exports = {
    NEAR_ZERO_GROUND_TRUTH_CORRECTIONS,
    classifyMaterialDisagreement,
    summarizeMaterialDisagreements,
    sortMaterialDisagreements,
};
