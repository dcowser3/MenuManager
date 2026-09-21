const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const { runCodeProposalLifecycle } = require('../../../scripts/lib/code-proposal-lifecycle');
const { FIXED_RUNTIME_ID } = require('../../../scripts/lib/code-proposal-docker-launcher');
const { loadVerificationModule } = require('../../../scripts/lib/proposal-verification-store');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha(value);
const HASH = (value) => sha(value);

function makeDockerFixture() {
    const repo = path.resolve(__dirname, '../../..');
    const verification = loadVerificationModule(repo);
    const root = fs.realpathSync(fs.mkdtempSync('/private/tmp/mm-c2c2-e2e-'));
    const trustedRoot = path.join(root, 'tmp', 'code-proposals');
    const attemptRoot = path.join(trustedRoot, 'p-e2e', 'attempt-one');
    const baselineRoot = path.join(attemptRoot, 'baseline');
    const candidateRoot = path.join(attemptRoot, 'candidate');
    const mkdir = (directory) => fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdir(baselineRoot); mkdir(candidateRoot);
    const filter = (source) => !source.endsWith('/node_modules') && !source.includes('/node_modules/') && !source.includes('/.git/');
    for (const arm of [baselineRoot, candidateRoot]) fs.cpSync(repo, arm, { recursive: true, filter });

    const candidateTest = 'services/dashboard/__tests__/code-candidate-e2e.test.js';
    mkdir(path.dirname(path.join(candidateRoot, candidateTest)));
    fs.writeFileSync(path.join(candidateRoot, candidateTest), "const { e2eMarker } = require('../lib/c2c2-e2e');\ntest('e2e candidate repair', () => expect(e2eMarker).toBe('candidate'));\n", { mode: 0o600 });
    fs.writeFileSync(path.join(baselineRoot, 'services/dashboard/lib/c2c2-e2e.js'), "module.exports = { e2eMarker: 'baseline' };\n", { mode: 0o600 });
    fs.writeFileSync(path.join(candidateRoot, 'services/dashboard/lib/c2c2-e2e.js'), "module.exports = { e2eMarker: 'candidate' };\n", { mode: 0o600 });
    const baselineHash = verification.hashCodeImplementation(baselineRoot);
    const candidateHash = verification.hashCodeImplementation(candidateRoot);
    const prompt = 'test-only prompt';
    const dataset = `${JSON.stringify({ case_id: 'case-1', raw_input: 'Dish, lemon', ground_truth: 'Dish, lemon', context: {} })}\n`;
    const rules = JSON.stringify({ rules: [] });
    const behaviorBody = { schemaVersion: 1, frozenAt: new Date().toISOString(), records: [{ correctionId: 'c1', expectationAuthority: 'human_explanation', disposition: 'awaiting_behavior_verification' }], tests: [{ id: 'behavior-1', input: 'Dish, lemons\nDish, lemon', expected: 'Dish, lemons\nDish, lemon', context: {} }] };
    const behavior = { ...behaviorBody, sha256: digest(JSON.stringify(behaviorBody)) };
    const proposal = { id: 'p-e2e', status: 'pending', parent_campaign_sha256: HASH('parent'), current_prompt: prompt, proposed_prompt: prompt, code_recommendations: [{ title: 'Fix' }], correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], eval_summary: { code_candidate: { status: 'running', attempt_id: 'attempt-one', expected_dataset_sha256: digest(dataset), expected_case_ids: ['case-1'], behavior_tests_sha256: behavior.sha256 }, behavior_tests: behavior, replay_retirement_policy_version: verification.REPLAY_RETIREMENT_POLICY_VERSION } };
    mkdir(attemptRoot);
    for (const [name, bytes] of Object.entries({ 'proposal.json': JSON.stringify(proposal), 'prompt.txt': prompt, 'rules.json': rules, 'behavior-tests.json': JSON.stringify(behavior), 'dataset.jsonl': dataset })) fs.writeFileSync(path.join(attemptRoot, name), bytes, { mode: 0o600 });
    const acceptedRulesHash = verification.hashAcceptedRules([]);
    const proposalHash = verification.codeProposalVerificationFingerprint(proposal);
    const responseBodyHash = HASH('e2e response');
    const draftBody = { summary: 'e2e', patch: 'diff --git a/services/dashboard/lib/c2c2-e2e.js b/services/dashboard/lib/c2c2-e2e.js\n', test_files: [candidateTest], corrections: [{ correction_id: 'c1', case_id: 'case-1', test_name: 'e2e candidate repair', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }] };
    const handoff = { schema_version: 1, attempt_id: 'attempt-one', authorization_hash: HASH('auth'), scope_hash: HASH('scope'), baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash, draft: { ...draftBody, patch_sha256: digest(draftBody.patch), content_sha256: digest(JSON.stringify(draftBody)), response_sha256: responseBodyHash }, response: { body_sha256: responseBodyHash } };
    const handoffBytes = `${JSON.stringify(handoff)}\n`;
    const handoffFile = path.join(attemptRoot, 'c2b-handoff.json');
    fs.writeFileSync(handoffFile, handoffBytes, { mode: 0o600 });
    Object.assign(proposal.eval_summary.code_candidate, { proposal_sha256: proposalHash, baseline_source_sha256: baselineHash, prompt_sha256: digest(prompt), accepted_rules_sha256: acceptedRulesHash, authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash, c2b_handoff_sha256: digest(handoffBytes), candidate_source_sha256: candidateHash, draft_patch_sha256: handoff.draft.patch_sha256, draft_content_sha256: handoff.draft.content_sha256, draft_response_sha256: responseBodyHash });
    fs.writeFileSync(path.join(attemptRoot, 'proposal.json'), JSON.stringify(proposal), { mode: 0o600 });
    const metadata = { attempt_id: 'attempt-one', artifact_directory: attemptRoot, deadline_at: new Date(Date.now() + 300000).toISOString(), proposal_sha256: proposalHash, baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash, parent_campaign_sha256: proposal.parent_campaign_sha256, prompt_sha256: digest(prompt), accepted_rules_sha256: acceptedRulesHash, rules_file_sha256: digest(rules), expected_dataset_sha256: digest(dataset), expected_case_ids: ['case-1'], behavior_tests_sha256: behavior.sha256, c2b_handoff_sha256: digest(handoffBytes), authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash, draft_patch_sha256: handoff.draft.patch_sha256, draft_content_sha256: handoff.draft.content_sha256, draft_response_sha256: responseBodyHash, vocabulary_sha256: HASH('vocab'), expectations_sha256: HASH('expect') };
    return { root, trustedRoot, attemptRoot, baselineRoot, candidateRoot, handoffFile, metadata, proposal, verification };
}

const dockerE2e = process.env.RUN_C2C2_DOCKER_E2E === '1' ? test : test.skip;

dockerE2e('runs the real Docker proof to pending_store using metadata attempt identity', async () => {
    const fixture = makeDockerFixture();
    try {
        const imageId = childProcess.execFileSync('docker', ['image', 'inspect', 'menumanager/dev:latest', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
        const stored = [];
        let storedProposal = fixture.proposal;
        const store = { recordCodeVerification: async (...args) => { stored.push(args); storedProposal = { ...storedProposal, eval_summary: { ...storedProposal.eval_summary, code_candidate: { ...storedProposal.eval_summary.code_candidate, ...args[2].code_candidate, status: 'verified' }, code_verification: args[2].code_verification } }; }, readCurrentProposal: async () => storedProposal };
        const result = await runCodeProposalLifecycle({ ...fixture, progressRoot: fixture.root, readCurrentProposal: store.readCurrentProposal, c2bHandoffFile: fixture.handoffFile, imageId, runtimeId: FIXED_RUNTIME_ID, replayPolicyVersion: fixture.verification.REPLAY_RETIREMENT_POLICY_VERSION, vocabularySha256: HASH('vocab'), expectationsSha256: HASH('expect'), model: 'test-only', client: {}, originalProposal: fixture.proposal, store, executorTimeoutMs: 150000 });
        expect(result.status).toBe('verified');
        expect(result.proof.runs).toHaveLength(2);
        expect(result.proof.behavior.candidate.passed).toBe(true);
        expect(result.proof.tests.baseline.exit_code).toBe(1);
        expect(result.proof.tests.candidate.exit_code).toBe(0);
        expect(stored).toHaveLength(1);
        const resumed = await runCodeProposalLifecycle({ ...fixture, progressRoot: fixture.root, readCurrentProposal: store.readCurrentProposal, c2bHandoffFile: fixture.handoffFile, imageId, runtimeId: FIXED_RUNTIME_ID, replayPolicyVersion: fixture.verification.REPLAY_RETIREMENT_POLICY_VERSION, vocabularySha256: HASH('vocab'), expectationsSha256: HASH('expect'), model: 'test-only', client: {}, originalProposal: fixture.proposal, store: { ...store, recordCodeVerification: async () => { throw new Error('must not attach twice'); } }, resume: true });
        expect(resumed.status).toBe('verified');
        const progress = require('../../../services/dashboard/dist/lib/code-candidate-progress').readCodeCandidateProgress({ attempt_id: fixture.metadata.attempt_id, artifact_directory: fixture.attemptRoot }, fixture.root);
        expect(progress.state).toBe('verified');
        expect(progress.attemptId).toBe(fixture.metadata.attempt_id);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
}, 180000);
