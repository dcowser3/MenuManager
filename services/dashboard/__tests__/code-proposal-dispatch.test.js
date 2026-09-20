const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { hashAcceptedRules } = require('../lib/code-proposal-verification');
const behaviorModule = require('../lib/learning-behavior-tests');
const { dispatchCodeDraft, loadPreparedDraft, applyValidatedDraft } = require('../../../scripts/auto-code-proposal');
const { canonicalHash } = require('../../../scripts/lib/code-proposal-broker');

const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const runtime = 'services/dashboard/lib/rule.ts';
const testFile = 'services/dashboard/__tests__/code-candidate-fix.test.ts';
const patch = `diff --git a/${runtime} b/${runtime}
index 0000000..1111111 100644
--- a/${runtime}
+++ b/${runtime}
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
diff --git a/${testFile} b/${testFile}
new file mode 100644
--- /dev/null
+++ b/${testFile}
@@ -0,0 +1 @@
+test('fix', () => {});
`;

function setup(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c2b-dispatch-'));
    const sourceRoot = path.join(root, 'repo');
    fs.mkdirSync(path.join(sourceRoot, 'services/dashboard/lib'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, runtime), 'export const value = 1;');
    const trustedRoot = path.join(sourceRoot, 'tmp/code-proposals');
    const attemptRoot = path.join(trustedRoot, 'p1', 'attempt-one'); fs.mkdirSync(attemptRoot, { recursive: true, mode: 0o700 });
    const behavior = behaviorModule.freezeBehaviorTests([], [], []);
    const rules = [{ id: 'rule-1', status: 'accepted' }];
    const parentCampaignSha256 = 'c'.repeat(64);
    const proposal = { id: 'p1', status: 'pending', proposed_prompt: 'prompt', parent_campaign_sha256: parentCampaignSha256, code_recommendations: [{ title: 'Fix' }], correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], replay_evidence: [{ correction_id: 'c1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], eval_summary: { behavior_tests: behavior } };
    const dataset = `${JSON.stringify({ case_id: 'case-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon', context: {} })}\n`;
    for (const [name, bytes] of [['proposal.json', JSON.stringify(proposal)], ['prompt.txt', 'prompt'], ['rules.json', JSON.stringify({ rules })], ['behavior-tests.json', JSON.stringify(behavior)], ['dataset.jsonl', dataset]]) fs.writeFileSync(path.join(attemptRoot, name), bytes, { mode: 0o600 });
    const metadata = { attempt_id: 'attempt-one', artifact_directory: attemptRoot, proposal_sha256: HASH, baseline_source_sha256: HASH_B, prompt_sha256: digest('prompt'), accepted_rules_sha256: hashAcceptedRules(rules), expected_dataset_sha256: digest(Buffer.from(dataset)), expected_case_ids: ['case-1'], behavior_tests_sha256: behavior.sha256 };
    const scope = { attemptId: metadata.attempt_id, runId: metadata.attempt_id, parentCampaignSha256, proposalSha256: HASH, promptSha256: metadata.prompt_sha256, rulesSha256: metadata.accepted_rules_sha256, datasetSha256: metadata.expected_dataset_sha256, sourceSha256: HASH_B, behaviorSha256: behavior.sha256, outputRoot: attemptRoot };
    const authorization = { schemaVersion: 1, authorizationId: 'code-auth', ledgerId: 'code-ledger', stage: 'code-candidate', status: 'active', provider: 'openai', mode: 'synthetic', model: 'gpt-5.6-sol', issuedAt: new Date(Date.now() - 1000).toISOString(), runDeadline: new Date(Date.now() + 3600000).toISOString(), expiresAt: new Date(Date.now() + 7200000).toISOString(), runRoot: attemptRoot, ledgerRelativePath: 'budget-state.json', scope, stageLimits: { usd: 1, requests: 1, inputTokens: 1000, completionTokens: 100 }, cumulativeLimits: { usd: 1, requests: 1, inputTokens: 1000, completionTokens: 100 }, requestLimits: { inputTokens: 1000, completionTokens: 100, timeoutMs: 1000 }, pricing: { inputUsdPerMillion: 4, outputUsdPerMillion: 20 }, requestSchedule: [{ requestId: 'attempt-one:draft:1:transport:1', bodySha256: digest(JSON.stringify({ model: 'gpt-5.6-sol', messages, response_format: { type: 'json_object' }, max_completion_tokens: 100 })), inputTokens: 10, completionTokens: 100 }], ...overrides };
    const authorizationFile = path.join(attemptRoot, 'authorization.json'); const stateFile = path.join(attemptRoot, 'budget-state.json');
    fs.writeFileSync(authorizationFile, `${JSON.stringify(authorization)}\n`, { mode: 0o600 });
    fs.writeFileSync(stateFile, `${JSON.stringify({ schemaVersion: 1, authorizationId: authorization.authorizationId, authorizationHash: digest(fs.readFileSync(authorizationFile)), scopeHash: canonicalHash(scope), requests: {}, totals: { usd: 0, requests: 0, inputTokens: 0, completionTokens: 0 } })}\n`, { mode: 0o600 });
    return { root, sourceRoot, trustedRoot, attemptRoot, proposal, metadata, behaviorModule, parentCampaignSha256, authorization, authorizationFile, stateFile, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const messages = [{ role: 'system', content: 'Return only a bounded JSON draft.' }, { role: 'user', content: 'Apply the frozen correction.' }];
const draft = { summary: 'fix', patch, test_files: [testFile], corrections: [{ correction_id: 'c1', case_id: 'case-1', test_name: 'fix', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }] };
const response = (state, overrides = {}) => ({ status: 200, body: JSON.stringify({ model: state.authorization.model, choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 }, ...overrides }) });

test('constructs and dispatches one authorized draft without self-attesting proof', async () => {
    const state = setup(); let calls = 0;
    try {
        const prepared = loadPreparedDraft({ ...state, verification: { codeProposalVerificationFingerprint: () => HASH, hashAcceptedRules, hashCodeImplementation: () => HASH_B }, transport: () => { calls += 1; } });
        expect(calls).toBe(0);
        const result = await dispatchCodeDraft({ ...state, baselineRoot: prepared.baselineRoot, verification: { codeProposalVerificationFingerprint: () => HASH, hashAcceptedRules, hashCodeImplementation: () => HASH_B }, messages, countInputTokens: () => 10, transport: async () => { calls += 1; return response(state); } });
        expect(calls).toBe(1); expect(result.draft).toEqual(draft); expect(result.response.accountingStatus).toBe('completed');
        expect(result).not.toHaveProperty('proof'); expect(result).not.toHaveProperty('code_verification'); expect(result).not.toHaveProperty('verification');
        expect(result.response).not.toHaveProperty('body'); expect(fs.readFileSync(path.join(state.sourceRoot, runtime), 'utf8')).toContain('value = 1');
        expect(prepared.scope.outputRoot).toBe(state.attemptRoot);
    } finally { state.cleanup(); }
});

test.each([
    ['wrong model', { model: 'gpt-5.6-luna' }, /model identity/],
    ['non-stop finish', { choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: 'length' }] }, /finish_reason/],
])('rejects %s after transport without creating verification evidence', async (_label, body, error) => {
    const state = setup();
    try {
        await expect(dispatchCodeDraft({ ...state, verification: { codeProposalVerificationFingerprint: () => HASH, hashAcceptedRules, hashCodeImplementation: () => HASH_B }, messages, countInputTokens: () => 10, transport: async () => response(state, body) })).rejects.toThrow(error);
    } finally { state.cleanup(); }
});

test('mismatched prepared scope fails before the injectable transport and terminal auth is rejected', async () => {
    const state = setup();
    try {
        const alteredScope = { ...state.authorization.scope, proposalSha256: '9'.repeat(64) };
        const altered = { ...state.authorization, scope: alteredScope };
        fs.writeFileSync(state.authorizationFile, `${JSON.stringify(altered)}\n`, { mode: 0o600 });
        fs.writeFileSync(state.stateFile, `${JSON.stringify({ schemaVersion: 1, authorizationId: altered.authorizationId, authorizationHash: digest(fs.readFileSync(state.authorizationFile)), scopeHash: canonicalHash(alteredScope), requests: {}, totals: { usd: 0, requests: 0, inputTokens: 0, completionTokens: 0 } })}\n`, { mode: 0o600 });
        await expect(dispatchCodeDraft({ ...state, verification: { codeProposalVerificationFingerprint: () => HASH, hashAcceptedRules, hashCodeImplementation: () => HASH_B }, messages, transport: async () => { throw new Error('must not call'); } })).rejects.toThrow(/scope differs/);
    } finally { state.cleanup(); }
});

test('caller cannot replace the frozen parent campaign lineage', async () => {
    const state = setup();
    try {
        const alteredProposal = { ...state.proposal }; delete alteredProposal.parent_campaign_sha256;
        await expect(dispatchCodeDraft({ ...state, proposal: alteredProposal, verification: { codeProposalVerificationFingerprint: () => HASH, hashAcceptedRules, hashCodeImplementation: () => HASH_B }, messages, transport: async () => { throw new Error('must not call'); } })).rejects.toThrow(/Parent campaign lineage/);
    } finally { state.cleanup(); }
});

test('apply boundary delegates only to C2a and rejects any proof-shaped result', () => {
    const state = setup();
    try {
        expect(() => applyValidatedDraft({ draft, baselineRoot: state.attemptRoot, proof: { status: 'passed' } }, state.proposal, path.join(state.attemptRoot, 'candidate'))).toThrow('cannot apply or carry');
    } finally { state.cleanup(); }
});
