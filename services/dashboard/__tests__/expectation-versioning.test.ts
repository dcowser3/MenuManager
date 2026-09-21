import {
    classifyExpectation,
    evaluateAgainstFrozenExpectations,
    evaluateExpectationArms,
    freezeExpectationEnvelope,
    activateApprovedSuccessor,
    planApprovedExpectationActivation,
    attachApprovedActivationMetadata,
    deriveProposalBoundEnvelope, validateApprovedExpectationAuthority,
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

test('baseline-first arm comparison separates policy gap, no-change, regression, and existing failure', () => {
    const envelope = freezeExpectationEnvelope({ policyVersion: 'p1', expectations: [
        { id: 'gap', classification: 'explicit_superseding_policy', input: 'house-made', expected: 'housemade', approvalState: 'approved' },
        { id: 'same', classification: 'missed_existing_rule', input: 'x', expected: 'x', approvalState: 'approved' },
        { id: 'reg', classification: 'missed_existing_rule', input: 'y', expected: 'y', approvalState: 'approved' },
        { id: 'fail', classification: 'missed_existing_rule', input: 'z', expected: 'z', approvalState: 'approved' },
    ]});
    const rows = evaluateExpectationArms({ envelope, baselineRunId: 'baseline-1', candidateRunId: 'candidate-1',
        baselineOutputs: { gap: 'house-made', same: 'x', reg: 'y', fail: 'wrong' },
        candidateOutputs: { gap: 'housemade', same: 'x', reg: 'wrong', fail: 'wrong' } });
    expect(Object.fromEntries(rows.map((row) => [row.expectationId, row.classification]))).toEqual({
        gap: 'expected_policy_gap', same: 'already_passing/no_change_needed', reg: 'genuine_regression', fail: 'existing_failure',
    });
    expect(rows[0]).toMatchObject({ baselineRunId: 'baseline-1', candidateRunId: 'candidate-1', policyVersion: 'p1', expectationHash: expect.any(String) });
    expect(evaluateExpectationArms({ envelope, baselineRunId: 'legacy-without-output', candidateRunId: 'candidate-1', baselineOutputs: {}, candidateOutputs: { gap: 'housemade' } })[0].classification).toBe('uncertainty');
});

test('only exact accepted linked approval activates Restaurant A successor', () => {
    const envelope = freezeExpectationEnvelope({ policyVersion: 'p1', expectations: [
        { id: 'a-v1', classification: 'missed_existing_rule', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
        { id: 'a-v2', classification: 'explicit_superseding_policy', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
        { id: 'b-v1', classification: 'missed_existing_rule', policyRuleId: 'r-b', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'housemade', approvalState: 'approved' },
    ], supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }] });
    const pending = activateApprovedSuccessor(envelope, { ruleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', policyVersion: 'p1', status: 'accepted', supersedesId: 'a-v1', successorId: 'a-v2' });
    expect(pending.expectations.find((row) => row.id === 'a-v1')?.status).toBe('superseded');
    expect(pending.expectations.find((row) => row.id === 'a-v2')).toMatchObject({ status: 'active', approvalState: 'approved' });
    expect(pending.expectations.find((row) => row.id === 'b-v1')).toEqual(envelope.expectations.find((row) => row.id === 'b-v1'));
    const mismatch = activateApprovedSuccessor(envelope, { ruleId: 'r-a', restaurant: 'Restaurant B', menuScope: 'food', policyVersion: 'p1', status: 'accepted', supersedesId: 'a-v1', successorId: 'a-v2' });
    expect(mismatch.sha256).toBe(envelope.sha256);
});

test('activation planner requires the exact selected rule to have been written first', () => {
    const envelope = freezeExpectationEnvelope({ policyVersion: 'p1', expectations: [
        { id: 'a-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
        { id: 'a-v2', version: 2, status: 'candidate', classification: 'explicit_superseding_policy', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
        { id: 'b-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'r-b', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
    ], supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }] });
    const rule = { expectation_activation: { ruleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', isLocationSpecific: true, policyVersion: 'p1', supersedesId: 'a-v1', successorId: 'a-v2' } };
    expect(planApprovedExpectationActivation(envelope, [rule], [{ index: 4, ok: false }], [4])).toBeNull();
    expect(planApprovedExpectationActivation(envelope, [rule], [{ index: 4, ok: true, correctionId: 'r-a', location: 'Restaurant A', menuScope: 'food', isLocationSpecific: true }], [4])).toBeNull();
    expect(planApprovedExpectationActivation(envelope, [{ expectation_activation: rule.expectation_activation }], [{ index: 4, ok: true, correctionId: 'r-b', location: 'Restaurant B', menuScope: 'food', isLocationSpecific: true }], [4])).toBeNull();
});

test('producer attaches only exact approved artifact activation metadata', () => {
    const envelope = freezeExpectationEnvelope({ policyVersion: 'p1', expectations: [
        { id: 'a-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
        { id: 'a-v2', version: 2, status: 'candidate', classification: 'explicit_superseding_policy', policyRuleId: 'r-a', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
    ], supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }] });
    const attached = attachApprovedActivationMetadata([{ change_type: 'terminology', original_text: 'house-made', corrected_text: 'housemade', is_location_specific: true, location: 'Restaurant A', applies_to_menu_type: 'food' }], envelope)[0];
    expect(attached.expectation_activation).toMatchObject({ source: 'approved_expectation_artifact', successorId: 'a-v2', artifactHash: envelope.sha256 });
    expect(attachApprovedActivationMetadata([{ change_type: 'terminology', original_text: 'house-made', corrected_text: 'housemade' }], envelope)[0].expectation_activation).toBeUndefined();
});

test('approved authority derives proposal envelope and activation preserves provenance', () => {
    const authority = freezeExpectationEnvelope({ policyVersion: 'p1', candidatePolicyVersion: 'p2', expectations: [
        { id: 'a-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'authority-rule', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
        { id: 'a-v2', version: 2, status: 'candidate', classification: 'explicit_superseding_policy', policyRuleId: 'authority-rule', policyVersion: 'p2', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
        { id: 'b-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'b', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'house-made', approvalState: 'approved' },
    ], supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }], policyChangeApprovals: [{ priorId: 'a-v1', successorId: 'a-v2', caseId: 'a-v2', sourceRevisionId: 'rev-7', status: 'approved', reviewer: 'Reviewer', approvedAt: '2026-09-20T00:00:00Z' }] });
    expect(() => validateApprovedExpectationAuthority(authority)).not.toThrow();
    const derived = deriveProposalBoundEnvelope([{ change_type: 'terminology', original_text: 'house-made', corrected_text: 'housemade', is_location_specific: true, location: 'Restaurant A', applies_to_menu_type: 'food', expectation_activation: { source: 'model', ruleId: 'bad' } }], authority, 'cycle-1');
    expect(derived.envelope).toBeTruthy();
    expect(derived.rules[0].expectation_activation).toMatchObject({ source: 'approved_expectation_artifact', derivedEnvelopeHash: derived.envelope!.sha256, parentArtifactHash: authority.sha256, caseId: 'a-v2', sourceRevisionId: 'rev-7' });
    expect(derived.envelope!.expectations.find((row) => row.id === 'b-v1')).toEqual(authority.expectations.find((row) => row.id === 'b-v1'));
    const result = planApprovedExpectationActivation(derived.envelope!, derived.rules, [{ index: 0, ok: true, correctionId: 'proposal-cycle-1-rule-0', location: 'Restaurant A', menuScope: 'food', isLocationSpecific: true }], [0]);
    expect(result?.policyChangeApprovals).toEqual(authority.policyChangeApprovals);
    expect(result?.parentArtifactHash).toBe(authority.sha256);
    const { mapProposedRuleToCorrectionRulePayload } = require('../lib/improvement-cycle-core');
    expect(mapProposedRuleToCorrectionRulePayload(derived.rules[0], 'cycle-1', 0, 'Reviewer').correction_id).toBe('proposal-cycle-1-rule-0');
    expect(planApprovedExpectationActivation(derived.envelope!, derived.rules, [{ index: 0, ok: true, correctionId: 'proposal-db-999-rule-0', location: 'Restaurant A', menuScope: 'food', isLocationSpecific: true }], [0])).toBeNull();
    const bad = { ...authority, policyChangeApprovals: [{ ...authority.policyChangeApprovals![0], caseId: 'wrong' }] };
    expect(() => validateApprovedExpectationAuthority({ ...bad, sha256: 'tampered' } as any)).toThrow();
});
