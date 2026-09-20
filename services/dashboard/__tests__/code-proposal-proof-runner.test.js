const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runCodeProposalProof } = require('../../../scripts/lib/code-proposal-proof-runner');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const HASH = (letter) => letter.repeat(64);

function setup(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c2c1-proof-'));
    const trustedRoot = path.join(root, 'tmp', 'code-proposals');
    const attemptRoot = path.join(trustedRoot, 'p1', 'attempt-one');
    const baselineRoot = path.join(attemptRoot, 'baseline');
    const candidateRoot = path.join(attemptRoot, 'candidate');
    fs.mkdirSync(path.join(attemptRoot), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(baselineRoot, 'services/dashboard/lib'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(candidateRoot, 'services/dashboard/lib'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(candidateRoot, 'services/dashboard/__tests__'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(baselineRoot, 'services/dashboard/lib/rule.ts'), 'export const rule = 1;');
    fs.writeFileSync(path.join(candidateRoot, 'services/dashboard/lib/rule.ts'), 'export const rule = 2;');
    fs.writeFileSync(path.join(candidateRoot, 'services/dashboard/__tests__/code-candidate-fix.test.ts'), 'test("fix", () => {});');
    const behavior = { schemaVersion: 1, frozenAt: new Date().toISOString(), records: [], tests: [], sha256: HASH('b') };
    const proposalHash = HASH('a'); const baselineHash = HASH('c'); const candidateHash = HASH('d');
    const acceptedRulesHash = HASH('2'); const behaviorHash = behavior.sha256;
    const proposal = { id: 'p1', parent_campaign_sha256: HASH('3'), code_recommendations: [{ title: 'Fix' }], correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], proposed_prompt: 'prompt', eval_summary: { code_candidate: { status: 'running', attempt_id: 'attempt-one', expected_dataset_sha256: null, expected_case_ids: ['case-1'], behavior_tests_sha256: behaviorHash }, behavior_tests: behavior, replay_retirement_policy_version: 1 } };
    const dataset = `${JSON.stringify({ case_id: 'case-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon', context: {} })}\n`;
    const files = { 'proposal.json': JSON.stringify(proposal), 'prompt.txt': 'prompt', 'rules.json': JSON.stringify({ rules: [] }), 'behavior-tests.json': JSON.stringify(behavior), 'dataset.jsonl': dataset };
    for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(attemptRoot, name), contents, { mode: 0o600 });
    const datasetHash = digest(dataset); const promptHash = digest('prompt');
    proposal.eval_summary.code_candidate.expected_dataset_sha256 = datasetHash;
    const metadata = { attempt_id: 'attempt-one', artifact_directory: attemptRoot, proposal_sha256: proposalHash, baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash, parent_campaign_sha256: proposal.parent_campaign_sha256, prompt_sha256: promptHash, accepted_rules_sha256: acceptedRulesHash, rules_file_sha256: digest(files['rules.json']), expected_dataset_sha256: datasetHash, expected_case_ids: ['case-1'], behavior_tests_sha256: behaviorHash };
    const trustedSuite = 'services/dashboard/__tests__/trusted.test.ts';
    const corrections = [{ correction_id: 'c1', case_id: 'case-1', test_name: 'fix', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }];
    const report = (status) => ({ numRuntimeErrorTestSuites: 0, numTotalTests: 2, testResults: [
        { name: `/app/${trustedSuite}`, assertionResults: [{ fullName: 'trusted', status: 'passed' }] },
        { name: '/app/services/dashboard/__tests__/code-candidate-fix.test.ts', assertionResults: [{ fullName: 'fix', status }] },
    ] });
    const verification = {
        CODE_PROPOSAL_REGRESSION_TESTS: [trustedSuite],
        codeProposalVerificationFingerprint: () => proposalHash,
        hashAcceptedRules: () => acceptedRulesHash,
        hashCodeImplementation: (rootPath) => rootPath === baselineRoot ? baselineHash : candidateHash,
        codeVerificationCorrectionPresent: (output, correction) => output.split('\n').map((line) => line.trim()).includes(correction.corrected_text),
        assessCodeVerificationTests: (tests, mapped) => {
            if (tests.baseline.exit_code !== 1 || tests.candidate.exit_code !== 0) return 'before/after exit contract failed';
            if (tests.baseline.report.testResults.some((result) => result.assertionResults.some((entry) => entry.status === 'failed' && entry.fullName !== 'fix'))) return 'unrelated baseline failure';
            if (tests.baseline.report.testResults[1].assertionResults[0].status !== 'failed' || tests.candidate.report.testResults[1].assertionResults[0].status !== 'passed') return 'motivating assertion contract failed';
            return null;
        },
        assessCodeProposalVerificationIntegrity: (candidateProposal) => candidateProposal.eval_summary.code_verification?.status === 'passed' ? null : { error: 'proof missing' },
    };
    const behaviorModule = { validateBehaviorArtifact: () => behavior, executeBehaviorTests: async (artifact, evaluator) => ({ artifactHash: artifact.sha256, passed: true, outcomes: [], explanations: [] }) };
    const state = {
        root, trustedRoot, attemptRoot, baselineRoot, candidateRoot, proposal, metadata, corrections, trustedSuite, report, verification, behaviorModule,
        executor: async ({ arm }) => ({ exit_code: arm === 'baseline' ? 1 : 0, report: report(arm === 'baseline' ? 'failed' : 'passed') }),
        replayExecutor: async ({ arm, seed }) => ({ report_id: `${arm}-${seed}`, output: arm === 'baseline' ? 'Dish, lemons' : 'Dish, lemon', contractComplete: true, fenceMissing: false, composite: arm === 'baseline' ? 0.8 : 0.9, extraEdits: 0 }),
        behaviorEvaluator: async () => '',
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
    return Object.assign(state, overrides);
}

function run(state, overrides = {}) {
    return runCodeProposalProof({ ...state, imageId: 'sha256:test-image', runtimeId: 'node-test', replayPolicyVersion: 1, ...overrides });
}

test('runs independent baseline/candidate proof and writes owner-only plan, progress, reports and proof', async () => {
    const state = setup();
    try {
        const result = await run(state);
        expect(result.status).toBe('verified');
        expect(result.proof.test_only).toBe(true);
        expect(result.proof.baseline.source_sha256).toBe(HASH('c'));
        expect(result.proof.candidate.source_sha256).toBe(HASH('d'));
        expect(fs.statSync(result.paths.plan).mode & 0o777).toBe(0o600);
        expect(JSON.parse(fs.readFileSync(path.join(state.candidateRoot, 'progress.json'))).state).toBe('verified');
        expect(result.proof.runs).toHaveLength(2);
    } finally { state.cleanup(); }
});

test.each([
    ['owner mismatch', { proposal: { ...setup().proposal, eval_summary: { code_candidate: { status: 'running', attempt_id: 'other' } } } }, /owner/],
    ['candidate hash mismatch', { metadata: { candidate_source_sha256: HASH('9') } }, /differs from the frozen plan/],
    ['baseline and candidate reuse', { candidateRoot: null }, /distinct/],
])('rejects %s before execution', async (_label, override, error) => {
    const state = setup();
    try {
        if (_label === 'owner mismatch') state.proposal = override.proposal;
        else if (_label === 'candidate hash mismatch') state.metadata = { ...state.metadata, ...override.metadata };
        else state.candidateRoot = state.baselineRoot;
        await expect(run(state)).rejects.toThrow(error);
    } finally { state.cleanup(); }
});

test('candidate cannot omit trusted suites or forge caller-supplied pass booleans', async () => {
    const state = setup({ executor: async ({ arm }) => ({ exit_code: arm === 'baseline' ? 0 : 0, passed: true, report: { numRuntimeErrorTestSuites: 0, numTotalTests: 1, testResults: [{ name: '/app/services/dashboard/__tests__/code-candidate-fix.test.ts', assertionResults: [{ fullName: 'fix', status: 'passed' }] }] } }) });
    try { await expect(run(state)).rejects.toThrow(/trusted tests|inventory|before\/after/); } finally { state.cleanup(); }
});

test('baseline unexpected pass, candidate skip/failure, and replay regression fail closed', async () => {
    for (const mutate of [
        (state) => { state.executor = async ({ arm }) => ({ exit_code: 0, report: state.report('passed') }); },
        (state) => { state.executor = async ({ arm }) => ({ exit_code: arm === 'baseline' ? 1 : 0, report: state.report(arm === 'baseline' ? 'failed' : 'skipped') }); },
        (state) => { state.replayExecutor = async ({ arm, seed }) => ({ report_id: `${arm}-${seed}`, output: arm === 'baseline' ? 'Dish, lemons' : 'Dish, lemons', contractComplete: true, fenceMissing: false, composite: arm === 'baseline' ? 0.9 : 0.5, extraEdits: arm === 'baseline' ? 0 : 1 }); },
    ]) {
        const state = setup();
        try { mutate(state); await expect(run(state)).rejects.toThrow(); } finally { state.cleanup(); }
    }
});

test('unrelated baseline failures are not accepted as the motivating failure', async () => {
    const state = setup();
    try {
        state.executor = async ({ arm }) => {
            const report = state.report(arm === 'baseline' ? 'failed' : 'passed');
            if (arm === 'baseline') report.testResults[0].assertionResults[0].status = 'failed';
            return { exit_code: arm === 'baseline' ? 1 : 0, report };
        };
        await expect(run(state)).rejects.toThrow(/unrelated baseline|motivating assertion/);
    } finally { state.cleanup(); }
});

test('reused replay report identities are rejected across repeats', async () => {
    const state = setup({ replayExecutor: async ({ arm }) => ({ report_id: arm, output: arm === 'baseline' ? 'Dish, lemons' : 'Dish, lemon', contractComplete: true, fenceMissing: false, composite: arm === 'baseline' ? 0.8 : 0.9, extraEdits: 0 }) });
    try { await expect(run(state)).rejects.toThrow(/reused/); } finally { state.cleanup(); }
});

test('replay freshness, response contracts, and delivery-required omission are enforced', async () => {
    const state = setup({ proposal: { ...setup().proposal } });
    try {
        state.proposal.correction_routing[0].replay_status = 'delivery_mismatch';
        await expect(run(state)).rejects.toThrow(/delivery/);
    } finally { state.cleanup(); }
});

test('behavior outcomes must be derived from the injected evaluator and frozen artifact', async () => {
    const state = setup({ behaviorEvaluator: undefined, behaviorModule: { ...setup().behaviorModule } });
    try { await expect(run(state)).rejects.toThrow(/behavior evaluation/); } finally { state.cleanup(); }
});

test('failed or timed-out injected executors become terminal failed progress without proof', async () => {
    for (const executor of [
        async () => { throw new Error('executor timeout'); },
        async ({ arm }) => ({ exit_code: arm === 'baseline' ? 1 : 0, report: { numRuntimeErrorTestSuites: 1, numTotalTests: 2, testResults: [] } }),
    ]) {
        const state = setup({ executor });
        try {
            await expect(run(state)).rejects.toThrow();
            const progress = JSON.parse(fs.readFileSync(path.join(state.candidateRoot, 'progress.json')));
            expect(progress.state).toBe('failed');
            expect(fs.existsSync(path.join(state.attemptRoot, 'verifier', 'proof.json'))).toBe(false);
        } finally { state.cleanup(); }
    }
});

test('stale dataset identity and false behavior outcomes fail before attachment', async () => {
    const stale = setup();
    try {
        stale.metadata = { ...stale.metadata, expected_case_ids: ['other-case'] };
        await expect(run(stale)).rejects.toThrow(/Dataset|dataset/);
    } finally { stale.cleanup(); }
    const behavior = setup({ behaviorModule: { validateBehaviorArtifact: () => {}, executeBehaviorTests: async () => ({ artifactHash: HASH('b'), passed: false, outcomes: [{ passed: false, outputHash: HASH('9'), expectedHash: HASH('8') }] }) } });
    try { await expect(run(behavior)).rejects.toThrow(/behavior outcomes/); } finally { behavior.cleanup(); }
});

test('store rejection leaves a failed owner-bound progress record and no passing proof attachment', async () => {
    const state = setup({ client: {}, originalProposal: {}, store: { recordCodeVerification: async (_client, _original, patch) => { if (patch.code_verification) throw new Error('store rejected'); } } });
    try {
        await expect(run(state)).rejects.toThrow('store rejected');
        expect(JSON.parse(fs.readFileSync(path.join(state.candidateRoot, 'progress.json'))).state).toBe('failed');
    } finally { state.cleanup(); }
});

test('root reuse is rejected before any executor call', async () => {
    const state = setup();
    try {
        await run(state);
        await expect(run(state)).rejects.toThrow(/reuse/);
    } finally { state.cleanup(); }
});
