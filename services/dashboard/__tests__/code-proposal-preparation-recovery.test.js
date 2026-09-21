'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { prepareCodeProposalAttempt } = require('../../../scripts/lib/code-proposal-preparation');
const { buildPreparationInventory, prepareCodeProposalQueue } = require('../../../scripts/lib/code-proposal-preparation-queue');
const { recordCodeVerification } = require('../../../scripts/lib/proposal-verification-store');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function clientState() {
    const state = { proposal: null, writes: 0 };
    const client = { from(table) {
        const query = {
            select: () => query,
            update: (patch) => { query.patch = patch; return query; },
            eq: () => query,
            is: () => query,
            order: () => query,
            or: () => query,
            then(resolve) {
                if (table === 'correction_rules') return Promise.resolve({ data: [] }).then(resolve);
                if (table === 'submissions') return Promise.resolve({ data: [{ id: 'submission-1', legacy_id: 'legacy-1', project_name: 'Project', property: 'Property', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'after', form_attempt_id: 'attempt-1' }] }).then(resolve);
                if (table === 'basic_ai_check_audits') return Promise.resolve({ data: [{ id: 'audit-1', menu_content_raw: 'before', attempt_id: 'attempt-1', event_type: 'completed', review_mode: 'full' }] }).then(resolve);
                if (query.patch) {
                    if (state.proposal?.status !== 'pending') return Promise.resolve({ data: [] }).then(resolve);
                    state.proposal = { ...state.proposal, eval_summary: query.patch.eval_summary };
                    state.writes += 1;
                    return Promise.resolve({ data: [{ id: state.proposal.id }] }).then(resolve);
                }
                return Promise.resolve({ data: [] }).then(resolve);
            },
            single: async () => ({ data: state.proposal }),
        };
        return query;
    } };
    return { client, state };
}

test('durable claim crash before summary converges to blocked zero-dispatch recovery', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prep-recovery-')));
    fs.mkdirSync(path.join(root, 'tmp', 'review-eval'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp', 'review-eval', 'dataset.jsonl'), `${JSON.stringify({ case_id: 'base', raw_input: 'Base', ground_truth: 'Base', context: {} })}\n`);
    const behaviorBody = { schemaVersion: 1, frozenAt: new Date().toISOString(), records: [{ correctionId: 'c1', submissionId: 'submission-1', inputSpan: { text: 'before' }, expectedSpan: { text: 'after' }, reason: 'reason', expectationAuthority: 'human_explanation', provenance: { reviewer: 'Reviewer' }, disposition: 'awaiting_behavior_verification' }], tests: [], contextualTests: [] };
    const behavior = { ...behaviorBody, sha256: digest(JSON.stringify(behaviorBody)) };
    const proposal = { id: 'p-recovery', status: 'pending', cycle_id: 'cycle-recovery', proposed_prompt: 'prompt', correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'before', corrected_text: 'after', source: 'human' }], replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', case_id: 'case-1', original_text: 'before', corrected_text: 'after', status: 'replay_mismatch' }], eval_summary: { replay_retirement_policy_version: 1, behavior_tests: behavior }, code_recommendations: [{ title: 'fix' }] };
    const { client, state } = clientState();
    const verification = { REPLAY_RETIREMENT_POLICY_VERSION: 1, codeProposalVerificationFingerprint: (value) => digest(JSON.stringify({ id: value.id, cycle_id: value.cycle_id, proposed_prompt: value.proposed_prompt, correction_routing: value.correction_routing, replay_evidence: value.replay_evidence, code_recommendations: value.code_recommendations })), hashCodeImplementation: () => digest('source'), hashAcceptedRules: () => digest('rules') };
    state.proposal = proposal;
    const store = { recordCodeVerification };
    const behaviorModule = { validateBehaviorArtifact: () => {} };
    try {
        const inventory = buildPreparationInventory(proposal, { proposalFingerprint: verification.codeProposalVerificationFingerprint(proposal) });
        const prepared = await prepareCodeProposalAttempt({ client, proposal, repoRoot: root, datasetPath: path.join(root, 'tmp/review-eval/dataset.jsonl'), verification, store, behaviorModule, inventory, attemptId: 'attempt-recovery' });
        expect(state.writes).toBe(1);
        fs.rmSync(path.join(prepared.artifactDirectory, 'preparation-summary.json'), { force: true });
        const result = await prepareCodeProposalQueue({ client, proposal: state.proposal, repoRoot: root, datasetPath: path.join(root, 'tmp/review-eval/dataset.jsonl'), verification, store, readCurrentProposal: async () => state.proposal });
        expect(result.reason).toBe('code_candidate_authorization_required');
        expect(fs.existsSync(path.join(prepared.artifactDirectory, 'preparation-summary.json'))).toBe(true);
        expect(state.writes).toBe(1);
        state.proposal = { ...state.proposal, status: 'approved' };
        await expect(recordCodeVerification(client, { ...state.proposal, status: 'pending' }, { code_candidate: { attempt_id: 'newer', status: 'running', proposal_sha256: verification.codeProposalVerificationFingerprint(state.proposal) } }, verification)).rejects.toThrow(/changed|pending/);
        await expect(recordCodeVerification(client, { ...proposal, status: 'pending' }, { code_candidate: { attempt_id: 'late-old', status: 'running', proposal_sha256: verification.codeProposalVerificationFingerprint(proposal) } }, verification)).rejects.toThrow(/pending/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
