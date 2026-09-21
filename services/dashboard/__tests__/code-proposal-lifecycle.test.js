const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../scripts/lib/code-proposal-proof-runner', () => ({
    runCodeProposalProofWithDocker: jest.fn(),
    readC2bHandoff: jest.fn(),
}));
jest.mock('../../../scripts/auto-code-proposal', () => ({
    applyValidatedDraftWithHandoff: jest.fn(async (_draft, _proposal, candidateRoot, options) => { if (options?.store?.recordCodeVerification) await options.store.recordCodeVerification(options.client, options.originalProposal, { code_candidate: { status: 'running' } }); return { candidateRoot, handoff: { attempt_id: 'attempt-one' } }; }),
}));

const proofRunner = require('../../../scripts/lib/code-proposal-proof-runner');
const { runCodeProposalLifecycle, runPreparedCodeProposalLifecycle, writeProgress } = require('../../../scripts/lib/code-proposal-lifecycle');
const { applyValidatedDraftWithHandoff } = require('../../../scripts/auto-code-proposal');

const HASH = 'a'.repeat(64);
function fixture(overrides = {}) {
    const root = fs.realpathSync(fs.mkdtempSync('/private/tmp/mm-lifecycle-'));
    const attemptRoot = path.join(root, 'tmp', 'code-proposals', 'p1', 'attempt-one');
    fs.mkdirSync(path.join(attemptRoot, 'candidate'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(attemptRoot, 'verifier'), { recursive: true, mode: 0o700 });
    const fields = ['proposal_sha256', 'baseline_source_sha256', 'candidate_source_sha256', 'prompt_sha256', 'accepted_rules_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256', 'authorization_hash', 'scope_hash', 'c2b_handoff_sha256', 'draft_patch_sha256', 'draft_content_sha256', 'draft_response_sha256'];
    const metadata = Object.fromEntries(fields.map((field) => [field, HASH]));
    Object.assign(metadata, { attempt_id: 'attempt-one', expected_case_ids: ['case-1'], deadline_at: new Date(Date.now() + 300000).toISOString() });
    const proposal = { id: 'p1', correction_routing: [], eval_summary: { code_candidate: { status: 'running', attempt_id: 'attempt-one', ...metadata } } };
    const verification = { codeProposalVerificationFingerprint: () => HASH, assessCodeProposalVerificationIntegrity: () => null };
    proofRunner.readC2bHandoff.mockReturnValue({ handoffHash: HASH, handoff: { attempt_id: 'attempt-one', baseline_source_sha256: HASH, candidate_source_sha256: HASH } });
    return { root, attemptRoot, metadata, proposal, verification, progressRoot: root, trustedRoot: root, baselineRoot: path.join(attemptRoot, 'baseline'), candidateRoot: path.join(attemptRoot, 'candidate'), c2bHandoffFile: path.join(attemptRoot, 'c2b-handoff.json'), imageId: HASH, runtimeId: HASH, replayPolicyVersion: 1, ...overrides };
}

afterEach(() => { jest.clearAllMocks(); });

test('stale owner and delivery mismatch fail closed before Docker', async () => {
    const stale = fixture({ proposal: { id: 'p1', correction_routing: [], eval_summary: { code_candidate: { status: 'running', attempt_id: 'other', ...Object.fromEntries(['proposal_sha256', 'baseline_source_sha256', 'candidate_source_sha256', 'prompt_sha256', 'accepted_rules_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256', 'authorization_hash', 'scope_hash', 'c2b_handoff_sha256', 'draft_patch_sha256', 'draft_content_sha256', 'draft_response_sha256'].map((field) => [field, HASH])) } } } });
    await expect(runCodeProposalLifecycle(stale)).rejects.toThrow(/owner/);
    const delivery = fixture({ proposal: { id: 'p1', correction_routing: [{ correction_id: 'c1', replay_status: 'delivery_mismatch' }], eval_summary: fixture().proposal.eval_summary } });
    delivery.proposal.eval_summary.code_candidate = { ...delivery.proposal.eval_summary.code_candidate, attempt_id: 'attempt-one', ...delivery.metadata };
    await expect(runCodeProposalLifecycle(delivery)).resolves.toMatchObject({ status: 'blocked', reason: 'delivery_driver_unavailable' });
    expect(proofRunner.runCodeProposalProofWithDocker).not.toHaveBeenCalled();
});

test('store rejection leaves durable blocked progress and never claims verified', async () => {
    const state = fixture();
    proofRunner.runCodeProposalProofWithDocker.mockResolvedValue({ status: 'pending_store', proof: { status: 'passed', proposal_sha256: HASH }, paths: { proof: path.join(state.attemptRoot, 'verifier', 'proof.json') } });
    await expect(runCodeProposalLifecycle({ ...state, client: {}, originalProposal: state.proposal, readCurrentProposal: async () => state.proposal, store: { recordCodeVerification: async () => { throw new Error('store rejected'); } } })).rejects.toThrow('store rejected');
    const progress = JSON.parse(fs.readFileSync(path.join(state.attemptRoot, 'candidate', 'progress.json')));
    expect(progress.state).toBe('blocked');
    expect(progress.reason).toBe('store_rejected');
    expect(fs.existsSync(path.join(state.attemptRoot, 'verifier', 'proof.json'))).toBe(false);
});

test('prepared lifecycle composes validated draft application before proof attachment', async () => {
    const state = fixture();
    proofRunner.runCodeProposalProofWithDocker.mockResolvedValue({ status: 'pending_store', proof: { status: 'passed', proposal_sha256: HASH }, paths: { proof: path.join(state.attemptRoot, 'verifier', 'proof.json') } });
    const stored = [];
    let live = state.proposal;
    const result = await runPreparedCodeProposalLifecycle({ ...state, repoRoot: state.root, handoffPath: state.c2bHandoffFile, validatedDraftResult: { draft: { patch: 'diff', test_files: [], corrections: [] }, baselineRoot: state.baselineRoot, checked: { cases: [] } }, client: {}, originalProposal: state.proposal, readCurrentProposal: async () => live, store: { recordCodeVerification: async (...args) => { stored.push(args); live = { ...live, eval_summary: { ...live.eval_summary, code_candidate: { ...live.eval_summary.code_candidate, status: args[2].code_verification ? 'verified' : 'running' }, ...(args[2].code_verification ? { code_verification: args[2].code_verification } : {}) } }; } } });
    expect(result.status).toBe('verified');
    expect(applyValidatedDraftWithHandoff).toHaveBeenCalledWith(expect.anything(), state.proposal, state.candidateRoot, expect.objectContaining({ client: {}, attemptId: 'attempt-one' }));
    expect(stored).toHaveLength(2);
});

test('missing live reader blocks attachment, blocked attempts require resume, and deadlines remain visible', async () => {
    const state = fixture();
    proofRunner.runCodeProposalProofWithDocker.mockResolvedValue({ status: 'pending_store', proof: { status: 'passed', proposal_sha256: HASH }, paths: { proof: path.join(state.attemptRoot, 'verifier', 'proof.json') } });
    const blocked = await runCodeProposalLifecycle({ ...state, client: {}, originalProposal: state.proposal, store: { recordCodeVerification: jest.fn() } });
    expect(blocked).toMatchObject({ status: 'blocked', reason: 'live_store_read_required' });
    expect(JSON.parse(fs.readFileSync(path.join(state.attemptRoot, 'candidate', 'progress.json'))).deadline_at).toBe(state.metadata.deadline_at);
    await expect(runCodeProposalLifecycle({ ...state, client: {}, originalProposal: state.proposal, store: { recordCodeVerification: jest.fn() } })).rejects.toThrow(/blocked; explicit resume/);
});

test('verified progress without a live stored proof cannot resume', async () => {
    const state = fixture();
    fs.mkdirSync(path.join(state.attemptRoot, 'verifier'), { recursive: true });
    fs.writeFileSync(path.join(state.attemptRoot, 'verifier', 'proof.json'), JSON.stringify({ status: 'passed', proposal_sha256: HASH }));
    writeProgress(state.attemptRoot, state.metadata, 'verification', 'verified');
    const live = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary, code_candidate: { ...state.proposal.eval_summary.code_candidate, status: 'verified' } } };
    await expect(runCodeProposalLifecycle({ ...state, progressRoot: state.root, readCurrentProposal: async () => live, client: {}, originalProposal: state.proposal, store: { recordCodeVerification: jest.fn() } })).rejects.toThrow(/proof is not verified/);
});

test('successful store transport without exact proof readback cannot become verified', async () => {
    const state = fixture();
    proofRunner.runCodeProposalProofWithDocker.mockResolvedValue({ status: 'pending_store', proof: { status: 'passed', proposal_sha256: HASH }, paths: { proof: path.join(state.attemptRoot, 'verifier', 'proof.json') } });
    const live = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary, code_candidate: { ...state.proposal.eval_summary.code_candidate, status: 'running' } } };
    await expect(runCodeProposalLifecycle({ ...state, client: {}, originalProposal: state.proposal, readCurrentProposal: async () => live, store: { recordCodeVerification: async () => { live.eval_summary.code_candidate.status = 'verified'; } } })).rejects.toThrow(/readback/);
    expect(JSON.parse(fs.readFileSync(path.join(state.attemptRoot, 'candidate', 'progress.json'))).reason).toBe('attached_but_local_finalization_failed');
});
