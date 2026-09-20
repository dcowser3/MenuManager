const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runCodeProposalProof } = require('../../../scripts/lib/code-proposal-proof-runner');
const { loadVerificationModule, recordCodeVerification } = require('../../../scripts/lib/proposal-verification-store');

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
    const repoRoot = path.resolve(__dirname, '../../..');
    const trustedVerification = loadVerificationModule(repoRoot);
    const behaviorBody = { schemaVersion: 1, frozenAt: new Date().toISOString(), records: [{ correctionId: 'c1', expectationAuthority: 'human_explanation', disposition: 'awaiting_behavior_verification' }], tests: [{ id: 'behavior-1', input: 'behavior input', expected: 'behavior output', context: {} }] };
    const behavior = { ...behaviorBody, sha256: digest(JSON.stringify(behaviorBody)) };
    const baselineHash = HASH('c'); const candidateHash = HASH('d');
    const acceptedRulesHash = trustedVerification.hashAcceptedRules([]); const behaviorHash = behavior.sha256;
    const proposal = { id: 'p1', status: 'pending', parent_campaign_sha256: HASH('3'), current_prompt: 'baseline prompt', code_recommendations: [{ title: 'Fix' }], correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], proposed_prompt: 'prompt', eval_summary: { code_candidate: { status: 'running', attempt_id: 'attempt-one', expected_dataset_sha256: null, expected_case_ids: ['case-1'], behavior_tests_sha256: behaviorHash }, behavior_tests: behavior, replay_retirement_policy_version: trustedVerification.REPLAY_RETIREMENT_POLICY_VERSION } };
    const dataset = `${JSON.stringify({ case_id: 'case-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon', context: {} })}\n`;
    const files = { 'proposal.json': JSON.stringify(proposal), 'prompt.txt': 'prompt', 'rules.json': JSON.stringify({ rules: [] }), 'behavior-tests.json': JSON.stringify(behavior), 'dataset.jsonl': dataset };
    for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(attemptRoot, name), contents, { mode: 0o600 });
    const datasetHash = digest(dataset); const promptHash = digest('prompt');
    proposal.eval_summary.code_candidate.expected_dataset_sha256 = datasetHash;
    fs.writeFileSync(path.join(attemptRoot, 'proposal.json'), JSON.stringify(proposal), { mode: 0o600 });
    const proposalHash = trustedVerification.codeProposalVerificationFingerprint(proposal);
    const trustedSuites = trustedVerification.CODE_PROPOSAL_REGRESSION_TESTS;
    for (const trustedSuite of trustedSuites) {
        for (const armRoot of [baselineRoot, candidateRoot]) {
            const target = path.join(armRoot, trustedSuite); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, `test('trusted', () => {});`);
        }
    }
    const candidateTest = 'services/dashboard/__tests__/code-candidate-fix.test.ts';
    const draftBody = { summary: 'fixture', patch: 'diff --git a/services/dashboard/lib/rule.ts b/services/dashboard/lib/rule.ts\n', test_files: [candidateTest], corrections: [{ correction_id: 'c1', case_id: 'case-1', test_name: 'fix', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }] };
    const responseBodyHash = digest('fixture response body');
    const handoff = { schema_version: 1, attempt_id: 'attempt-one', authorization_hash: HASH('7'), scope_hash: HASH('8'), baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash, draft: { ...draftBody, patch_sha256: digest(draftBody.patch), content_sha256: digest(JSON.stringify(draftBody)), response_sha256: responseBodyHash }, response: { body_sha256: responseBodyHash } };
    const handoffBytes = `${JSON.stringify(handoff)}\n`; fs.writeFileSync(path.join(attemptRoot, 'c2b-handoff.json'), handoffBytes, { mode: 0o600 });
    const metadata = { attempt_id: 'attempt-one', artifact_directory: attemptRoot, proposal_sha256: proposalHash, baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash, parent_campaign_sha256: proposal.parent_campaign_sha256, prompt_sha256: promptHash, accepted_rules_sha256: acceptedRulesHash, rules_file_sha256: digest(files['rules.json']), expected_dataset_sha256: datasetHash, expected_case_ids: ['case-1'], behavior_tests_sha256: behaviorHash, c2b_handoff_sha256: digest(handoffBytes), authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash, draft_patch_sha256: handoff.draft.patch_sha256, draft_content_sha256: handoff.draft.content_sha256, draft_response_sha256: handoff.draft.response_sha256, vocabulary_sha256: HASH('7'), expectations_sha256: HASH('8') };
    Object.assign(proposal.eval_summary.code_candidate, { proposal_sha256: proposalHash, baseline_source_sha256: baselineHash, prompt_sha256: promptHash, accepted_rules_sha256: acceptedRulesHash });
    fs.writeFileSync(path.join(attemptRoot, 'proposal.json'), JSON.stringify(proposal), { mode: 0o600 });
    const corrections = [{ correction_id: 'c1', case_id: 'case-1', test_name: 'fix', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }];
    const report = (status, inventory) => ({ numRuntimeErrorTestSuites: 0, numTotalTests: inventory.length, testResults: inventory.map((file) => ({ name: `/app/${file}`, assertionResults: [{ fullName: file === candidateTest ? 'fix' : `${file}:trusted`, status: file === candidateTest ? status : 'passed' }] })) });
    const verificationOverrides = { hashCodeImplementation: (rootPath) => rootPath === baselineRoot ? baselineHash : candidateHash };
    const state = {
        root, repoRoot, trustedRoot, attemptRoot, baselineRoot, candidateRoot, proposal, metadata, corrections, trustedSuites, candidateTest, handoffFile: path.join(attemptRoot, 'c2b-handoff.json'), c2bHandoffFile: path.join(attemptRoot, 'c2b-handoff.json'), trustedVerification, verificationOverrides, report,
        executor: async ({ arm, inventory }) => ({ exit_code: arm === 'baseline' ? 1 : 0, report: report(arm === 'baseline' ? 'failed' : 'passed', inventory) }),
        replayExecutor: async ({ arm, seed }) => ({ report_id: `${arm}-${seed}`, output: arm === 'baseline' ? 'Dish, lemons' : 'Dish, lemon', contractComplete: true, fenceMissing: false, composite: arm === 'baseline' ? 0.8 : 0.9, extraEdits: 0 }),
        behaviorEvaluator: async () => 'behavior output',
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
    const active = { ...proposal.eval_summary.code_candidate };
    const fakeClient = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: proposal }) }) }), update: () => { const q = { eq: () => q, is: () => q, select: async () => ({ data: [{ id: proposal.id }] }) }; return q; } }) };
    state.client = fakeClient; state.originalProposal = proposal; state.store = { recordCodeVerification };
    return Object.assign(state, overrides);
}

function run(state, overrides = {}) {
    return runCodeProposalProof({ ...state, allowTestDouble: true, c2bHandoffFile: state.c2bHandoffFile, imageId: HASH('5'), runtimeId: HASH('6'), replayPolicyVersion: state.trustedVerification.REPLAY_RETIREMENT_POLICY_VERSION, vocabularySha256: HASH('7'), expectationsSha256: HASH('8'), ...overrides });
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

test('the complete positive proof passes the real integrity gate and combined drift is rejected', async () => {
    const state = setup();
    try {
        const result = await run(state);
        const candidate = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary, code_verification: result.proof } };
        expect(state.trustedVerification.assessCodeProposalVerificationIntegrity(candidate)).toBeNull();
        candidate.eval_summary.code_verification.combined = null;
        expect(state.trustedVerification.assessCodeProposalVerificationIntegrity(candidate)).not.toBeNull();
    } finally { state.cleanup(); }
});

test('mixed code and replacement-rule proof carries motivating rule activations through the real verifier', async () => {
    const state = setup();
    try {
        state.proposal.proposed_rules = [{ id: 'rule-new', original_text: 'foo', corrected_text: 'bar' }];
        state.proposal.correction_routing = [...state.proposal.correction_routing, { correction_id: 'r1', lane: 'replacement_rule', case_id: 'case-1', original_text: 'foo', corrected_text: 'bar' }];
        state.proposal.replay_evidence = [...(state.proposal.replay_evidence || []), { correction_id: 'r1', case_id: 'case-1', original_text: 'foo', corrected_text: 'bar' }];
        const { sha256: _oldBehaviorHash, ...frozenBehaviorBody } = state.proposal.eval_summary.behavior_tests;
        const behaviorBody = { ...frozenBehaviorBody, records: [...state.proposal.eval_summary.behavior_tests.records, { correctionId: 'r1', expectationAuthority: 'human_explanation', disposition: 'awaiting_behavior_verification' }] };
        const behavior = { ...behaviorBody, sha256: digest(JSON.stringify(behaviorBody)) };
        state.proposal.eval_summary.behavior_tests = behavior;
        state.metadata.behavior_tests_sha256 = behavior.sha256;
        state.proposal.eval_summary.code_candidate.behavior_tests_sha256 = behavior.sha256;
        state.metadata.proposal_sha256 = state.trustedVerification.codeProposalVerificationFingerprint(state.proposal);
        state.proposal.eval_summary.code_candidate.proposal_sha256 = state.metadata.proposal_sha256;
        fs.writeFileSync(path.join(state.attemptRoot, 'behavior-tests.json'), JSON.stringify(behavior), { mode: 0o600 });
        fs.writeFileSync(path.join(state.attemptRoot, 'proposal.json'), JSON.stringify(state.proposal), { mode: 0o600 });
        state.replayExecutor = async ({ arm, seed }) => ({ report_id: `${arm}-${seed}`, output: arm === 'baseline' ? 'Dish, lemons\nfoo' : 'Dish, lemon\nbar', contractComplete: true, fenceMissing: false, composite: arm === 'baseline' ? 0.8 : 0.9, extraEdits: 0, rule_activations: arm === 'candidate' ? [{ rule_id: 'eval-candidate-rule-0', final_survives: true, total_activations: 1, case_ids: ['case-1'] }] : [] });
        const result = await run(state);
        expect(result.proof.combined.corrections.map((row) => row.correction_id)).toEqual(['c1', 'r1']);
        expect(result.proof.combined.runs.every((run) => run.rule_activations.some((row) => row.rule_id === 'eval-candidate-rule-0'))).toBe(true);
        const candidate = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary, code_verification: result.proof } };
        expect(state.trustedVerification.assessCodeProposalVerificationIntegrity(candidate)).toBeNull();
    } finally { state.cleanup(); }
});

test('historical code-candidate tests stay in the paired inventory while only new tests come from C2b', async () => {
    const state = setup();
    try {
        const historical = 'services/dashboard/__tests__/code-candidate-history.test.ts';
        fs.mkdirSync(path.dirname(path.join(state.baselineRoot, historical)), { recursive: true });
        fs.mkdirSync(path.dirname(path.join(state.candidateRoot, historical)), { recursive: true });
        fs.writeFileSync(path.join(state.baselineRoot, historical), 'test("history", () => {});');
        fs.writeFileSync(path.join(state.candidateRoot, historical), 'test("history", () => {});');
        const result = await run(state);
        expect(result.plan.test_inventory).toContain(historical);
        expect(result.plan.test_inventory).toContain(state.candidateTest);
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
        state.executor = async ({ arm, inventory }) => {
            const report = state.report(arm === 'baseline' ? 'failed' : 'passed', inventory);
            if (arm === 'baseline') report.testResults.find((result) => !result.name.includes('code-candidate')).assertionResults[0].status = 'failed';
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
    const state = setup();
    try {
        state.proposal.correction_routing[0].replay_status = 'delivery_mismatch';
        fs.writeFileSync(path.join(state.attemptRoot, 'proposal.json'), JSON.stringify(state.proposal), { mode: 0o600 });
        state.metadata.proposal_sha256 = state.trustedVerification.codeProposalVerificationFingerprint(state.proposal);
        state.proposal.eval_summary.code_candidate.proposal_sha256 = state.metadata.proposal_sha256;
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

test('a genuinely never-resolving executor times out and cannot produce proof', async () => {
    const state = setup({ client: null, originalProposal: null, store: null, executor: () => new Promise(() => {}), executorTimeoutMs: 10 });
    try {
        await expect(run(state)).rejects.toThrow(/timed out/);
        expect(fs.existsSync(path.join(state.attemptRoot, 'verifier', 'proof.json'))).toBe(false);
    } finally { state.cleanup(); }
});

test('no-store runs remain pending with staged non-passing evidence', async () => {
    const state = setup({ client: null, originalProposal: null, store: null });
    try {
        const result = await run(state);
        expect(result.status).toBe('pending_store');
        expect(fs.existsSync(result.paths.proof)).toBe(false);
        expect(fs.existsSync(result.paths.stagedProof)).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(state.candidateRoot, 'progress.json'))).state).toBe('blocked');
    } finally { state.cleanup(); }
});

test('trusted test bytes are rechecked between baseline and candidate execution', async () => {
    const state = setup({ executor: async ({ arm, inventory }) => {
        if (arm === 'baseline') fs.appendFileSync(path.join(state.candidateRoot, state.trustedSuites[0]), '\nmutated');
        return { exit_code: arm === 'baseline' ? 1 : 0, report: state.report(arm === 'baseline' ? 'failed' : 'passed', inventory) };
    } });
    try { await expect(run(state)).rejects.toThrow(/Test bytes changed/); } finally { state.cleanup(); }
});

test('failure reasons are redacted before owner-bound progress', async () => {
    const state = setup({ client: null, originalProposal: null, store: null, secrets: ['token-secret'], executor: async () => { throw new Error('token-secret leaked'); } });
    try {
        await expect(run(state)).rejects.toThrow(/token-secret/);
        const progress = JSON.parse(fs.readFileSync(path.join(state.candidateRoot, 'progress.json')));
        expect(progress.reason).not.toContain('token-secret');
        expect(progress.reason).toContain('[REDACTED]');
    } finally { state.cleanup(); }
});

test('stale dataset identity and false behavior outcomes fail before attachment', async () => {
    const stale = setup();
    try {
        stale.metadata = { ...stale.metadata, expected_case_ids: ['other-case'] };
        await expect(run(stale)).rejects.toThrow(/Dataset|dataset/);
    } finally { stale.cleanup(); }
    const behavior = setup({ behaviorEvaluator: async () => { throw new Error('behavior outcome failure'); } });
    try { await expect(run(behavior)).rejects.toThrow(/behavior outcome failure|behavior outcomes/); } finally { behavior.cleanup(); }
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
