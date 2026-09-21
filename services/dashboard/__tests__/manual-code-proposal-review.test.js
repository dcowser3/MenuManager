'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectBoundHumanExplanationGroups, selectBoundHumanExplanationGroup, prepareManualCodeProposalReview } = require('../../../scripts/lib/manual-code-proposal-review');

function proposal({ delivery = false } = {}) {
    return {
        id: 'proposal-manual',
        correction_routing: [
            { correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', submission_id: 'submission-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', source: 'human' },
            ...(delivery ? [{ correction_id: 'c2', lane: 'code_recommendation', case_id: 'case-2', submission_id: 'submission-2', original_text: 'Fish', corrected_text: 'FISH', replay_status: 'delivery_mismatch', source: 'human' }] : []),
        ],
        replay_evidence: [
            { correction_id: 'c1', submission_id: 'submission-1', case_id: 'case-1', status: 'replay_mismatch', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' },
            ...(delivery ? [{ correction_id: 'c2', submission_id: 'submission-2', case_id: 'case-2', status: 'delivery_mismatch', original_text: 'Fish', corrected_text: 'FISH' }] : []),
        ],
        eval_summary: { behavior_tests: { records: [
            { correctionId: 'c1', submissionId: 'submission-1', caseId: 'case-1', inputSpan: { text: 'Dish, lemons' }, expectedSpan: { text: 'Dish, lemon' }, expectationAuthority: 'human_explanation' },
            ...(delivery ? [{ correctionId: 'c2', submissionId: 'submission-2', caseId: 'case-2', inputSpan: { text: 'Fish' }, expectedSpan: { text: 'FISH' }, expectationAuthority: 'human_explanation' }] : []),
        ] } },
    };
}

function preparedFixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'manual-code-review-')));
    const candidate = path.join(root, 'candidate');
    fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
    const progress = path.join(candidate, 'progress.json');
    fs.writeFileSync(progress, `${JSON.stringify({ schema_version: 1, attempt_id: 'attempt-manual', phase: 'analysis', state: 'active', updated_at: new Date().toISOString() })}\n`, { mode: 0o600 });
    return { root, prepared: { attemptId: 'attempt-manual', artifactDirectory: root, metadata: { attempt_id: 'attempt-manual' } }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('selects all bound human explanation groups in deterministic order without dropping source text', () => {
    const groups = selectBoundHumanExplanationGroups(proposal({ delivery: true }));
    expect(groups.map((group) => group.correctionId)).toEqual(['c1', 'c2']);
    const group = selectBoundHumanExplanationGroup(proposal({ delivery: true }));
    expect(group.correctionId).toBe('c1');
    expect(group.rawHumanExplanation.original_text).toBe('Dish, lemons');
    expect(group.rawHumanExplanation.corrected_text).toBe('Dish, lemon');
    expect(group.behaviorRecord.expectationAuthority).toBe('human_explanation');
});

test('binds multiple groups to one attempt and passes the unchanged full proposal to lifecycle', async () => {
    const fixture = preparedFixture();
    const fullProposal = proposal({ delivery: true });
    fullProposal.correction_routing[1].replay_status = 'replay_mismatch';
    fullProposal.replay_evidence[1].status = 'replay_mismatch';
    // The selector owns the stable correction_id order, not input ordering.
    [fullProposal.correction_routing[0], fullProposal.correction_routing[1]] = [fullProposal.correction_routing[1], fullProposal.correction_routing[0]];
    [fullProposal.replay_evidence[0], fullProposal.replay_evidence[1]] = [fullProposal.replay_evidence[1], fullProposal.replay_evidence[0]];
    [fullProposal.eval_summary.behavior_tests.records[0], fullProposal.eval_summary.behavior_tests.records[1]] = [fullProposal.eval_summary.behavior_tests.records[1], fullProposal.eval_summary.behavior_tests.records[0]];
    let lifecycleInput;
    let prepareCalls = 0;
    try {
        const result = await prepareManualCodeProposalReview({
            proposal: fullProposal,
            prepareAttempt: async () => { prepareCalls += 1; return fixture.prepared; },
            authorization: { stage: 'code-candidate', status: 'active' },
            validatedDraftResult: { draft: { patch: 'synthetic' } },
            runPreparedLifecycle: async (input) => { lifecycleInput = input; return { status: 'verified' }; },
        });
        expect(prepareCalls).toBe(1);
        expect(result.boundGroups.map((group) => group.correctionId)).toEqual(['c1', 'c2']);
        expect(result.boundGroup.correctionId).toBe('c1');
        expect(result.deliveryHolds).toEqual([]);
        expect(lifecycleInput.proposal).toBe(fullProposal);
        expect(lifecycleInput.originalProposal).toBe(fullProposal);
        expect(lifecycleInput.proposal.correction_routing).toHaveLength(2);
        expect(lifecycleInput.proposal.replay_evidence).toHaveLength(2);
    } finally { fixture.cleanup(); }
});

test('fails closed when a group has non-unique replay or behavior binding before preparing an attempt', async () => {
    const invalid = proposal();
    invalid.replay_evidence.push({ ...invalid.replay_evidence[0] });
    let prepareCalls = 0;
    await expect(prepareManualCodeProposalReview({ proposal: invalid, prepareAttempt: async () => { prepareCalls += 1; return preparedFixture().prepared; } })).rejects.toThrow(/unique replay evidence/);
    expect(prepareCalls).toBe(0);
});

test('missing authorization leaves the owner-bound attempt blocked with zero provider calls', async () => {
    const fixture = preparedFixture();
    try {
        const result = await prepareManualCodeProposalReview({ proposal: proposal(), prepareAttempt: async () => fixture.prepared });
        expect(result.status).toBe('blocked');
        expect(result.reason).toBe('code_candidate_authorization_required');
        expect(result.providerCalls).toBe(0);
        expect(result.deliveryHolds).toHaveLength(0);
        expect(JSON.parse(fs.readFileSync(path.join(fixture.root, 'candidate/progress.json'), 'utf8')).state).toBe('blocked');
        expect(JSON.parse(fs.readFileSync(path.join(fixture.root, 'candidate/progress.json'), 'utf8')).reason).toBe('code_candidate_authorization_required');
    } finally { fixture.cleanup(); }
});

test('a supplied synthetic draft uses the existing prepared lifecycle seam without provider work', async () => {
    const fixture = preparedFixture();
    let called = null;
    try {
        const result = await prepareManualCodeProposalReview({
            proposal: proposal(),
            prepareAttempt: async () => fixture.prepared,
            authorization: { stage: 'code-candidate', status: 'active' },
            validatedDraftResult: { draft: { patch: 'synthetic' } },
            runPreparedLifecycle: async (input) => { called = input; return { status: 'blocked', reason: 'human_approval_required' }; },
        });
        expect(result.status).toBe('ready_for_manual_review');
        expect(result.providerCalls).toBe(0);
        expect(called.validatedDraftResult.draft.patch).toBe('synthetic');
        expect(called.attemptRoot).toBe(fixture.root);
        expect(result.lifecycle.reason).toBe('human_approval_required');
    } finally { fixture.cleanup(); }
});

test('an active authorization dispatches the existing draft boundary once and resumes the same owner', async () => {
    const fixture = preparedFixture();
    let dispatchCalls = 0;
    let lifecycleInput = null;
    try {
        const progressPath = path.join(fixture.root, 'candidate/progress.json');
        fs.writeFileSync(progressPath, `${JSON.stringify({ schema_version: 1, attempt_id: 'attempt-manual', phase: 'analysis', state: 'blocked', reason: 'code_candidate_authorization_required', updated_at: new Date().toISOString() })}\n`, { mode: 0o600 });
        const result = await prepareManualCodeProposalReview({
            proposal: proposal(),
            existingAttempt: fixture.prepared,
            authorization: { stage: 'code-candidate', status: 'active' },
            authorizationFile: path.join(fixture.root, 'authorization.json'),
            stateFile: path.join(fixture.root, 'budget-state.json'),
            messages: [{ role: 'user', content: 'one bounded draft' }],
            trustedRoot: fixture.root,
            repoRoot: fixture.root,
            dispatchDraft: async (input) => { dispatchCalls += 1; expect(input.attemptRoot).toBe(fixture.root); return { draft: { patch: 'synthetic' } }; },
            runPreparedLifecycle: async (input) => { lifecycleInput = input; return { status: 'blocked', reason: 'human_approval_required' }; },
        });
        expect(dispatchCalls).toBe(1);
        expect(result.providerCalls).toBe(1);
        expect(lifecycleInput.resume).toBe(true);
        expect(lifecycleInput.attemptRoot).toBe(fixture.root);
    } finally { fixture.cleanup(); }
});

test('any delivery-held group blocks the aggregate even when another route is selected', async () => {
    const fixture = preparedFixture();
    let dispatchCalls = 0;
    try {
        const result = await prepareManualCodeProposalReview({
            proposal: proposal({ delivery: true }),
            correctionId: 'c1',
            existingAttempt: fixture.prepared,
            authorization: { stage: 'code-candidate', status: 'active' },
            authorizationFile: path.join(fixture.root, 'authorization.json'),
            stateFile: path.join(fixture.root, 'budget-state.json'),
            messages: [{ role: 'user', content: 'must not dispatch' }],
            trustedRoot: fixture.root,
            repoRoot: fixture.root,
            dispatchDraft: async () => { dispatchCalls += 1; return { draft: { patch: 'unexpected' } }; },
        });
        expect(result.reason).toBe('delivery_verification_required');
        expect(result.providerCalls).toBe(0);
        expect(result.boundGroups.map((group) => group.correctionId)).toEqual(['c1', 'c2']);
        expect(result.deliveryHolds.map((hold) => hold.correction_id)).toEqual(['c2']);
        expect(dispatchCalls).toBe(0);
    } finally { fixture.cleanup(); }
});

test('real dispatch refuses a changed live owner before spending', async () => {
    const fixture = preparedFixture();
    let dispatchCalls = 0;
    try {
        await expect(prepareManualCodeProposalReview({
            proposal: proposal(),
            existingAttempt: fixture.prepared,
            authorization: { stage: 'code-candidate', status: 'active' },
            authorizationFile: path.join(fixture.root, 'authorization.json'),
            stateFile: path.join(fixture.root, 'budget-state.json'),
            messages: [{ role: 'user', content: 'one bounded draft' }],
            trustedRoot: fixture.root,
            repoRoot: fixture.root,
            client: {},
            readCurrentProposal: async () => ({ eval_summary: { code_candidate: { attempt_id: 'attempt-manual', status: 'blocked' } } }),
            dispatchDraft: async () => { dispatchCalls += 1; return { draft: { patch: 'unexpected' } }; },
        })).rejects.toThrow(/live owner claim/);
        expect(dispatchCalls).toBe(0);
    } finally { fixture.cleanup(); }
});
