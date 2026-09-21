'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectBoundHumanExplanationGroup, prepareManualCodeProposalReview } = require('../../../scripts/lib/manual-code-proposal-review');

function proposal({ delivery = false } = {}) {
    return {
        id: 'proposal-manual',
        correction_routing: [
            { correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', source: 'human' },
            ...(delivery ? [{ correction_id: 'c2', lane: 'code_recommendation', case_id: 'case-2', original_text: 'Fish', corrected_text: 'FISH', replay_status: 'delivery_mismatch', source: 'human' }] : []),
        ],
        replay_evidence: [
            { correction_id: 'c1', status: 'replay_mismatch', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' },
            ...(delivery ? [{ correction_id: 'c2', status: 'delivery_mismatch', original_text: 'Fish', corrected_text: 'FISH' }] : []),
        ],
        eval_summary: { behavior_tests: { records: [{ correctionId: 'c1', expectationAuthority: 'human_explanation' }, ...(delivery ? [{ correctionId: 'c2', expectationAuthority: 'human_explanation' }] : [])] } },
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

test('selects one bound human explanation group without dropping source text', () => {
    const group = selectBoundHumanExplanationGroup(proposal({ delivery: true }));
    expect(group.correctionId).toBe('c1');
    expect(group.rawHumanExplanation.original_text).toBe('Dish, lemons');
    expect(group.rawHumanExplanation.corrected_text).toBe('Dish, lemon');
    expect(group.behaviorRecord.expectationAuthority).toBe('human_explanation');
});

test('missing authorization leaves the owner-bound attempt blocked with zero provider calls', async () => {
    const fixture = preparedFixture();
    try {
        const result = await prepareManualCodeProposalReview({ proposal: proposal({ delivery: true }), prepareAttempt: async () => fixture.prepared });
        expect(result.status).toBe('blocked');
        expect(result.reason).toBe('code_candidate_authorization_required');
        expect(result.providerCalls).toBe(0);
        expect(result.deliveryHolds).toHaveLength(1);
        expect(result.deliveryHolds[0].status).toBe('delivery_verification_required');
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
