import {
    classifyExpectation,
    evaluateAgainstFrozenExpectations,
    freezeExpectationEnvelope,
    validateExpectationEnvelope,
} from '../lib/expectation-versioning';

test('classifies missed, approved superseding, and ambiguous corrections conservatively', () => {
    expect(classifyExpectation({ change_type: 'missed_review_correction' })).toBe('missed_existing_rule');
    expect(classifyExpectation({ change_type: 'superseding_policy', status: 'accepted' })).toBe('explicit_superseding_policy');
    expect(classifyExpectation({ change_type: 'superseding_policy', status: 'pending' })).toBe('ambiguous');
    expect(classifyExpectation({ change_type: 'terminology' })).toBe('ambiguous');
});

test('Restaurant A candidate preserves history, leaves Restaurant B unchanged, and cannot activate early', () => {
    const envelope = freezeExpectationEnvelope({
        policyVersion: 'policy-1',
        expectations: [
            { id: 'a-v1', classification: 'missed_existing_rule', policyRuleId: 'house-made-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
            { id: 'a-v2', classification: 'explicit_superseding_policy', policyRuleId: 'house-made-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
            { id: 'b-v1', classification: 'missed_existing_rule', policyRuleId: 'house-made-b', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'housemade', approvalState: 'approved' },
        ],
        supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }],
    });
    expect(() => validateExpectationEnvelope(envelope)).not.toThrow();
    expect(envelope.expectations.find((row) => row.id === 'a-v1')?.expected).toBe('house-made');
    expect(envelope.expectations.find((row) => row.id === 'b-v1')?.expected).toBe('housemade');
    expect(envelope.expectations.find((row) => row.id === 'a-v2')?.status).toBe('candidate');
    const results = evaluateAgainstFrozenExpectations(envelope, { 'a-v1': 'house-made', 'a-v2': 'housemade', 'b-v1': 'housemade' }, 'candidate-unapproved');
    expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ expectationId: 'a-v2', policyVersion: 'policy-1', classification: 'pass' }),
        expect.objectContaining({ expectationId: 'b-v1', restaurant: 'Restaurant B', classification: 'pass' }),
    ]));
});

test('failed candidate cannot rewrite grading and missing output is uncertainty', () => {
    const envelope = freezeExpectationEnvelope({
        policyVersion: 'policy-1',
        expectations: [{ id: 'a-v1', classification: 'missed_existing_rule', restaurant: 'Restaurant A', input: 'house-made', expected: 'house-made', approvalState: 'approved' }],
    });
    const result = evaluateAgainstFrozenExpectations(envelope, {}, 'failed-candidate');
    expect(result[0]).toMatchObject({ classification: 'uncertainty', expectedHash: expect.any(String) });
    expect(() => validateExpectationEnvelope({ ...envelope, expectations: [{ ...envelope.expectations[0], expected: 'housemade' }] })).toThrow('changed after freezing');
});

