const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { activateApprovedSuccessor } = require('../../services/dashboard/dist/lib/expectation-versioning');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('review-eval consumes external versioned artifact before both arms and excludes superseded history', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-expectation-eval-'));
    const dataset = [
        { case_id: 'a-v2', source: 'fixture', label: 'Restaurant A', raw_input: 'house-made', ground_truth: 'housemade', context: { property: 'Restaurant A', templateType: 'food' } },
        { case_id: 'b-v1', source: 'fixture', label: 'Restaurant B', raw_input: 'house-made', ground_truth: 'house-made', context: { property: 'Restaurant B', templateType: 'food' } },
    ];
    const body = {
        schemaVersion: 1,
        activePolicyVersion: 'fixture-policy-v1',
        candidatePolicyVersion: 'fixture-policy-v2',
        expectations: [
            { id: 'a-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'house-made-a', policyVersion: 'fixture-policy-v1', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'house-made', sourceExpectationId: null, approvalState: 'approved' },
            { id: 'a-v2', version: 2, status: 'candidate', classification: 'explicit_superseding_policy', policyRuleId: 'house-made-a', policyVersion: 'fixture-policy-v2', restaurant: 'Restaurant A', menuScope: 'food', input: 'house-made', expected: 'housemade', sourceExpectationId: 'a-v1', approvalState: 'unapproved' },
            { id: 'b-v1', version: 1, status: 'active', classification: 'missed_existing_rule', policyRuleId: 'house-made-b', policyVersion: 'fixture-policy-v1', restaurant: 'Restaurant B', menuScope: 'food', input: 'house-made', expected: 'house-made', sourceExpectationId: null, approvalState: 'approved' },
        ],
        supersedes: [{ priorId: 'a-v1', successorId: 'a-v2' }],
    };
    const envelope = { ...body, sha256: hash(body) };
    const datasetPath = path.join(dir, 'dataset.jsonl');
    const expectationPath = path.join(dir, 'expectations.json');
    const candidateRulesPath = path.join(dir, 'candidate-rules.json');
    fs.writeFileSync(datasetPath, dataset.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(expectationPath, JSON.stringify(envelope));
    fs.writeFileSync(candidateRulesPath, JSON.stringify([{ id: 'house-made-a', status: 'accepted', original_text: 'house-made', corrected_text: 'housemade', location: 'Restaurant A', is_location_specific: true, applies_to_menu_type: 'food', source: 'human', reviewer_name: 'Reviewer' }]));
    const script = path.resolve(__dirname, '..', 'review-eval.js');
    const first = spawnSync(process.execPath, [script, '--dataset', datasetPath, '--expectations', expectationPath, '--no-ai', '--label', `fixture-${Date.now()}`], { encoding: 'utf8' });
    expect(first.status).toBe(0);
    const reportPath = first.stdout.match(/Report: (.+\/report\.json)/)?.[1]?.trim();
    expect(reportPath).toBeTruthy();
    const second = spawnSync(process.execPath, [script, '--dataset', datasetPath, '--expectations', expectationPath, '--baseline', reportPath, '--rules', `candidate:${candidateRulesPath}`, '--no-ai', '--label', `fixture-candidate-${Date.now()}`], { encoding: 'utf8' });
    expect(second.status).toBe(0);
    const secondReportPath = second.stdout.match(/Report: (.+\/report\.json)/)?.[1]?.trim();
    const report = JSON.parse(fs.readFileSync(secondReportPath, 'utf8'));
    expect(report.evaluation).toMatchObject({ policyVersion: 'fixture-policy-v1', expectationEnvelopeHash: envelope.sha256, policyChangeEvaluation: true });
    expect(report.evaluation.expectationArmComparison).toEqual(expect.arrayContaining([
        expect.objectContaining({ expectationId: 'a-v2', policyVersion: 'fixture-policy-v2' }),
        expect.objectContaining({ expectationId: 'b-v1', policyVersion: 'fixture-policy-v1', classification: 'already_passing/no_change_needed' }),
    ]));
    expect(report.evaluation.expectationArmComparison.some(row => row.expectationId === 'a-v1')).toBe(false);
    expect(report.evaluation.expectationArmComparison).toEqual(expect.arrayContaining([
        expect.objectContaining({ expectationId: 'a-v2', classification: 'expected_policy_gap' }),
        expect.objectContaining({ expectationId: 'b-v1', classification: 'already_passing/no_change_needed' }),
    ]));
    const activated = activateApprovedSuccessor(envelope, { ruleId: 'house-made-a', restaurant: 'Restaurant A', menuScope: 'food', policyVersion: 'fixture-policy-v1', status: 'accepted', supersedesId: 'a-v1', successorId: 'a-v2' });
    expect(activated.activePolicyVersion).toBe('fixture-policy-v2');
    expect(activated.expectations.find(row => row.id === 'a-v2')).toMatchObject({ status: 'active', approvalState: 'approved' });
    expect(activateApprovedSuccessor(envelope, { ruleId: 'house-made-a', restaurant: 'Restaurant A', menuScope: 'food', policyVersion: 'wrong', status: 'accepted', supersedesId: 'a-v1', successorId: 'a-v2' }).sha256).toBe(envelope.sha256);
    const mutated = { ...envelope, activePolicyVersion: 'attacker-policy' };
    const mutatedExpectationPath = path.join(dir, 'mutated-expectations.json');
    fs.writeFileSync(mutatedExpectationPath, JSON.stringify(mutated));
    const rejectedEnvelope = spawnSync(process.execPath, [script, '--dataset', datasetPath, '--expectations', mutatedExpectationPath, '--no-ai'], { encoding: 'utf8' });
    expect(rejectedEnvelope.status).not.toBe(0);
    expect(`${rejectedEnvelope.stderr}${rejectedEnvelope.stdout}`).toContain('Expectation version envelope changed after freezing');
    const mutatedDatasetPath = path.join(dir, 'mutated-dataset.jsonl');
    fs.writeFileSync(mutatedDatasetPath, JSON.stringify({ ...dataset[0], raw_input: 'attacker-input' }) + '\n' + JSON.stringify(dataset[1]) + '\n');
    const rejected = spawnSync(process.execPath, [script, '--dataset', mutatedDatasetPath, '--expectations', expectationPath, '--no-ai'], { encoding: 'utf8' });
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stderr}${rejected.stdout}`).toContain('Dataset input differs from frozen expectation');
    const legacyPath = path.join(dir, 'legacy-expectations.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ schemaVersion: 1, approvedBy: 'reviewer', revision: 'legacy-1', expectations: { 'a-v2': 'housemade', 'b-v1': 'housemade' } }));
    const legacy = spawnSync(process.execPath, [script, '--dataset', datasetPath, '--expectations', legacyPath, '--no-ai'], { encoding: 'utf8' });
    expect(legacy.status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
});
