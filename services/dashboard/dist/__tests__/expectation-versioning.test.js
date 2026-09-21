"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const expectation_versioning_1 = require("../lib/expectation-versioning");
test('classifies missed, approved superseding, and ambiguous corrections conservatively', () => {
    expect((0, expectation_versioning_1.classifyExpectation)({ change_type: 'missed_review_correction' })).toBe('missed_existing_rule');
    expect((0, expectation_versioning_1.classifyExpectation)({ change_type: 'superseding_policy', status: 'accepted' })).toBe('explicit_superseding_policy');
    expect((0, expectation_versioning_1.classifyExpectation)({ change_type: 'superseding_policy', status: 'pending' })).toBe('ambiguous');
    expect((0, expectation_versioning_1.classifyExpectation)({ change_type: 'terminology' })).toBe('ambiguous');
});
test('Restaurant A candidate preserves history, leaves Restaurant B unchanged, and cannot activate early', () => {
    const envelope = (0, expectation_versioning_1.freezeExpectationEnvelope)({
        policyVersion: 'policy-1',
        expectations: [
            { id: 'a-v1', classification: 'missed_existing_rule', policyRuleId: 'house-made-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
            { id: 'a-v2', classification: 'explicit_superseding_policy', policyRuleId: 'house-made-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
            { id: 'b-v1', classification: 'missed_existing_rule', policyRuleId: 'house-made-b', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'housemade', approvalState: 'approved' },
        ],
        supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }],
    });
    expect(() => (0, expectation_versioning_1.validateExpectationEnvelope)(envelope)).not.toThrow();
    expect(envelope.expectations.find((row) => row.id === 'a-v1')?.expected).toBe('house-made');
    expect(envelope.expectations.find((row) => row.id === 'b-v1')?.expected).toBe('housemade');
    expect(envelope.expectations.find((row) => row.id === 'a-v2')?.status).toBe('candidate');
    const results = (0, expectation_versioning_1.evaluateAgainstFrozenExpectations)(envelope, { 'a-v1': 'house-made', 'a-v2': 'housemade', 'b-v1': 'housemade' }, 'candidate-unapproved');
    expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ expectationId: 'a-v2', policyVersion: 'policy-1', classification: 'pass' }),
        expect.objectContaining({ expectationId: 'b-v1', restaurant: 'Restaurant B', classification: 'pass' }),
    ]));
});
test('failed candidate cannot rewrite grading and missing output is uncertainty', () => {
    const envelope = (0, expectation_versioning_1.freezeExpectationEnvelope)({
        policyVersion: 'policy-1',
        expectations: [{ id: 'a-v1', classification: 'missed_existing_rule', restaurant: 'Restaurant A', input: 'house-made', expected: 'house-made', approvalState: 'approved' }],
    });
    const result = (0, expectation_versioning_1.evaluateAgainstFrozenExpectations)(envelope, {}, 'failed-candidate');
    expect(result[0]).toMatchObject({ classification: 'uncertainty', expectedHash: expect.any(String) });
    expect(() => (0, expectation_versioning_1.validateExpectationEnvelope)({ ...envelope, expectations: [{ ...envelope.expectations[0], expected: 'housemade' }] })).toThrow('changed after freezing');
});
test('baseline-first arm comparison separates policy gap, no-change, regression, and existing failure', () => {
    const envelope = (0, expectation_versioning_1.freezeExpectationEnvelope)({ policyVersion: 'p1', expectations: [
            { id: 'gap', classification: 'explicit_superseding_policy', input: 'house-made', expected: 'housemade', approvalState: 'approved' },
            { id: 'same', classification: 'missed_existing_rule', input: 'x', expected: 'x', approvalState: 'approved' },
            { id: 'reg', classification: 'missed_existing_rule', input: 'y', expected: 'y', approvalState: 'approved' },
            { id: 'fail', classification: 'missed_existing_rule', input: 'z', expected: 'z', approvalState: 'approved' },
        ] });
    const rows = (0, expectation_versioning_1.evaluateExpectationArms)({ envelope, baselineRunId: 'baseline-1', candidateRunId: 'candidate-1',
        baselineOutputs: { gap: 'house-made', same: 'x', reg: 'y', fail: 'wrong' },
        candidateOutputs: { gap: 'housemade', same: 'x', reg: 'wrong', fail: 'wrong' } });
    expect(Object.fromEntries(rows.map((row) => [row.expectationId, row.classification]))).toEqual({
        gap: 'expected_policy_gap', same: 'already_passing/no_change_needed', reg: 'genuine_regression', fail: 'existing_failure',
    });
    expect(rows[0]).toMatchObject({ baselineRunId: 'baseline-1', candidateRunId: 'candidate-1', policyVersion: 'p1', expectationHash: expect.any(String) });
    expect((0, expectation_versioning_1.evaluateExpectationArms)({ envelope, baselineRunId: 'legacy-without-output', candidateRunId: 'candidate-1', baselineOutputs: {}, candidateOutputs: { gap: 'housemade' } })[0].classification).toBe('uncertainty');
});
test('only exact accepted linked approval activates Restaurant A successor', () => {
    const envelope = (0, expectation_versioning_1.freezeExpectationEnvelope)({ policyVersion: 'p1', expectations: [
            { id: 'a-v1', classification: 'missed_existing_rule', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
            { id: 'a-v2', classification: 'explicit_superseding_policy', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
            { id: 'b-v1', classification: 'missed_existing_rule', policyRuleId: 'r-b', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'housemade', approvalState: 'approved' },
        ], supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }] });
    const pending = (0, expectation_versioning_1.activateApprovedSuccessor)(envelope, { ruleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', policyVersion: 'p1', status: 'accepted', supersedesId: 'a-v1', successorId: 'a-v2' });
    expect(pending.expectations.find((row) => row.id === 'a-v1')?.status).toBe('superseded');
    expect(pending.expectations.find((row) => row.id === 'a-v2')).toMatchObject({ status: 'active', approvalState: 'approved' });
    expect(pending.expectations.find((row) => row.id === 'b-v1')).toEqual(envelope.expectations.find((row) => row.id === 'b-v1'));
    const mismatch = (0, expectation_versioning_1.activateApprovedSuccessor)(envelope, { ruleId: 'r-a', restaurant: 'Restaurant B', menuScope: 'food', policyVersion: 'p1', status: 'accepted', supersedesId: 'a-v1', successorId: 'a-v2' });
    expect(mismatch.sha256).toBe(envelope.sha256);
});
