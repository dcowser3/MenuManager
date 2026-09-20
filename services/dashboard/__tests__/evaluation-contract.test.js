const { inputSignature, createEvaluationContract, validateSplit, reportFreshness, retireExposedCases } = require('../../../scripts/lib/evaluation-contract');
const { runFullReviewPipeline } = require('../lib/review-pipeline');
const rows = [{ case_id: 'h1', raw_input: 'Soup D 8', ground_truth: 'Soup D 8', context: {}, reviewed_at: '2026-08-01' }];
const vocabulary = { schemaVersion: 1, texts: ['Bread G 12'], terms: [], provenance: { source: 'frozen-training-artifact', frozenAt: '2026-01-01', caseIds: ['t1'] } };
const split = { schemaVersion: 1, frozenAt: '2026-07-01', cutoff: '2026-06-01', groups: { t1: 'training-menu', h1: 'held-menu', h2: 'held-menu' }, membership: { training: ['t1'], holdout: ['h1', 'h2'], lockbox: [] } };
split.separationMethod = 'lineage-and-near-duplicate-v1';
split.inputSignatures = { h1: inputSignature(rows[0]), h2: inputSignature({ ...rows[0], case_id: 'h2' }), t1: inputSignature({ raw_input: 'Bread G 12', reviewed_at: '2025-01-01' }) };
const contract = dataset => createEvaluationContract({ mode: 'holdout', dataset, vocabularySnapshot: vocabulary, split });
test('changing a held-out answer changes no model input, candidates, or output', async () => {
    const changedAnswer = [{ ...rows[0], ground_truth: 'Entirely different answer D 9' }];
    const first = contract(rows), second = contract(changedAnswer);
    expect(first.vocabularyHash).toBe(second.vocabularyHash);
    expect(first.inputHashes).toEqual(second.inputHashes);
    expect(first.expectationHash).not.toBe(second.expectationHash);
    const requests = [];
    const run = c => runFullReviewPipeline(rows[0].raw_input, { basePrompt: 'RULES', approvedVocabularyTexts: c.vocabulary.texts }, async (text, prompt) => {
        requests.push({ text, prompt });
        return `=== CORRECTED MENU ===\n${text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`;
    });
    expect((await run(first)).finalCorrectedMenu).toBe((await run(second)).finalCorrectedMenu);
    expect(requests[0]).toEqual(requests[1]);
});
test('missing or leaking vocabulary provenance blocks holdout labeling', () => {
    expect(() => createEvaluationContract({ mode: 'holdout', dataset: rows, split })).toThrow(/vocabulary/);
    expect(() => createEvaluationContract({ mode: 'holdout', dataset: rows, split, vocabularySnapshot: { ...vocabulary, provenance: { ...vocabulary.provenance, caseIds: ['h1'] } } })).toThrow(/answers/);
});
test('related groups, duplicate membership and missing chronological provenance fail closed', () => {
    expect(() => validateSplit(rows, { ...split, groups: { ...split.groups, t1: 'held-menu' } })).toThrow(/Related/);
    expect(() => validateSplit(rows, { ...split, membership: { ...split.membership, training: ['h1'] } })).toThrow();
    expect(() => validateSplit([{ ...rows[0], reviewed_at: undefined }], split)).toThrow(/provenance|signature/);
});
test('expectations remain raw, immutable and independent of candidate policies', () => {
    const c = contract(rows);
    expect(c.expectations.h1).toBe(rows[0].ground_truth);
    expect(Object.isFrozen(c.expectations)).toBe(true);
    expect(() => createEvaluationContract({ dataset: rows, expectationArtifact: { expectations: { h1: 'changed' } } })).toThrow(/reviewer-approved/);
});
test('cached reruns cannot claim freshness and exposed groups leave the lockbox', () => {
    expect(reportFreshness({ cacheHits: 1, apiCalls: 1 })).toBe('cached_or_mixed');
    expect(reportFreshness({ cacheHits: 0, apiCalls: 2 })).toBe('fresh');
    const retired = retireExposedCases(split, ['h1'], 'debugging');
    expect(retired.membership.holdout).toEqual([]);
    expect(retired.membership.retired).toEqual(['h1', 'h2']);
    expect(split.membership.holdout).toEqual(['h1', 'h2']);
});

test('near-duplicates cannot be split even when the evaluation file contains only held cases', () => {
    const input = 'Soup tomato basil cream D 12 Bread butter G 8 Salad leaves cucumber V 14';
    const held = { ...rows[0], raw_input: input };
    const leaking = { ...split, inputSignatures: { ...split.inputSignatures, h1: inputSignature(held), t1: inputSignature({ raw_input: input.replace('14', '15'), reviewed_at: '2025-01-01' }) } };
    expect(() => createEvaluationContract({ mode: 'holdout', dataset: [held], vocabularySnapshot: vocabulary, split: leaking })).toThrow(/near-duplicate/);
});
test.each(['not-a-date', '2027-01-01'])('invalid/future cutoff cannot establish chronology: %s', cutoff => {
 expect(() => createEvaluationContract({ mode:'holdout', dataset:rows, vocabularySnapshot:vocabulary, split:{...split,cutoff} })).toThrow(/cutoff|Cutoff/);
});
test.each(['2026-09-01', null, 'bad-date'])('training chronology is checked even in a held-only file: %s', reviewedAt => {
 const changed = {...split, frozenAt:'2026-07-01', inputSignatures:{...split.inputSignatures,t1:{...split.inputSignatures.t1,reviewedAt}}};
 expect(() => createEvaluationContract({mode:'holdout',dataset:rows,vocabularySnapshot:vocabulary,split:changed})).toThrow(/Training|provenance/);
});
