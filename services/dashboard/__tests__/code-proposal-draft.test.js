const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashAcceptedRules, hashCodeImplementation } = require('../lib/code-proposal-verification');
const { snapshotBaseline, validateDraft, validateDraftPatch, applyDraft, revalidateAttemptArtifacts } = require('../../../scripts/lib/code-proposal-draft');

const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const digest = (value) => require('crypto').createHash('sha256').update(value).digest('hex');
const verification = { codeProposalVerificationFingerprint: () => HASH, hashAcceptedRules, hashCodeImplementation: () => HASH_B };
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c2a-'));
    fs.mkdirSync(path.join(root, 'services/dashboard/lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'services/dashboard/lib/rule.ts'), 'export const value = 1;');
    const attempt = path.join(root, 'attempt'); fs.mkdirSync(attempt, { recursive: true, mode: 0o700 });
    const behavior = { schemaVersion: 1, sha256: HASH, records: [], tests: [], contextualTests: [] };
    const rules = [{ id: 'r1', status: 'accepted' }];
    const proposal = { id: 'p1', proposed_prompt: 'prompt', code_recommendations: [{ title: 'Fix' }], correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], replay_evidence: [{ correction_id: 'c1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], eval_summary: { behavior_tests: behavior } };
    const dataset = `${JSON.stringify({ case_id: 'case-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon', context: {} })}\n`;
    for (const [name, bytes] of [['proposal.json', JSON.stringify(proposal)], ['prompt.txt', 'prompt'], ['rules.json', JSON.stringify({ rules })], ['behavior-tests.json', JSON.stringify(behavior)], ['dataset.jsonl', dataset]]) fs.writeFileSync(path.join(attempt, name), bytes, { mode: 0o600 });
    const metadata = { attempt_id: 'attempt', artifact_directory: attempt, proposal_sha256: HASH, baseline_source_sha256: HASH_B, prompt_sha256: digest('prompt'), accepted_rules_sha256: hashAcceptedRules(rules), expected_dataset_sha256: digest(Buffer.from(dataset)), expected_case_ids: ['case-1'], behavior_tests_sha256: HASH };
    return { root, attempt, proposal, metadata, rules, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const patch = `diff --git a/services/dashboard/lib/rule.ts b/services/dashboard/lib/rule.ts
index 0000000..1111111 100644
--- a/services/dashboard/lib/rule.ts
+++ b/services/dashboard/lib/rule.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
diff --git a/services/dashboard/__tests__/code-candidate-fix.test.ts b/services/dashboard/__tests__/code-candidate-fix.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-fix.test.ts
@@ -0,0 +1 @@
+test('fix', () => {});
`;
const draft = (p = patch) => ({ summary: 'fix', patch: p, test_files: ['services/dashboard/__tests__/code-candidate-fix.test.ts'], corrections: [{ correction_id: 'c1', case_id: 'case-1', test_name: 'fix', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }] });

test('revalidates bounded artifacts, snapshots baseline, and applies only a safe fresh candidate', () => {
    const state = fixture();
    try {
        const baseline = path.join(state.attempt, 'baseline');
        const snapshot = snapshotBaseline(state.root, baseline, verification);
        expect(snapshot.sha256).toBe(HASH_B);
        const checked = revalidateAttemptArtifacts({ attemptRoot: state.attempt, metadata: state.metadata, proposal: state.proposal, verification, baselineRoot: baseline });
        expect(checked.cases[0].case_id).toBe('case-1');
        expect(validateDraft(draft(), state.proposal, checked.cases, baseline).test_files).toHaveLength(1);
        const candidate = path.join(state.attempt, 'candidate');
        const fakeGit = (_command, args, options) => {
            if (args.includes('apply') && !args.includes('--check')) fs.writeFileSync(path.join(candidate, 'services/dashboard/lib/rule.ts'), 'export const value = 2;');
            return { status: 0, stderr: '' };
        };
        applyDraft(patch, baseline, candidate, state.proposal, fakeGit);
        expect(fs.readFileSync(path.join(candidate, 'services/dashboard/lib/rule.ts'), 'utf8')).toContain('value = 2');
        expect(fs.readFileSync(path.join(state.root, 'services/dashboard/lib/rule.ts'), 'utf8')).toContain('value = 1');
    } finally { state.cleanup(); }
});

test.each([
    ['protected verifier path', patch.replace('services/dashboard/lib/rule.ts', 'services/dashboard/lib/code-proposal-verification.ts')],
    ['command-like diff', `${patch}\nrun: rm -rf /`],
    ['delivery without route', patch.replace('services/dashboard/lib/rule.ts', 'services/dashboard/views/form.ejs')],
])('rejects unsafe draft form: %s', (_name, value) => {
    const state = fixture();
    try { expect(() => validateDraftPatch(value, state.root, state.proposal)).toThrow(); } finally { state.cleanup(); }
});

test('rejects mappings outside frozen cases or with altered source text', () => {
    const state = fixture();
    try {
        expect(() => validateDraft({ ...draft(), corrections: [{ ...draft().corrections[0], case_id: 'other' }] }, state.proposal, [{ case_id: 'case-1' }], state.root)).toThrow();
        expect(() => validateDraft({ ...draft(), corrections: [{ ...draft().corrections[0], corrected_text: 'Dish, Café' }] }, state.proposal, [{ case_id: 'case-1' }], state.root)).toThrow();
    } finally { state.cleanup(); }
});

test('rejects source symlinks, credential-like content, and oversized files', () => {
    const state = fixture();
    try {
        fs.writeFileSync(path.join(state.root, 'services/dashboard/lib/notes.txt'), 'sk-proj-12345678901234567890');
        expect(() => snapshotBaseline(state.root, path.join(state.attempt, 'bad-secret'), verification)).toThrow('Credential-like');
        fs.rmSync(path.join(state.root, 'services/dashboard/lib/notes.txt'));
        fs.symlinkSync(path.join(state.root, 'services/dashboard/lib/rule.ts'), path.join(state.root, 'services/dashboard/lib/link.ts'));
        expect(() => snapshotBaseline(state.root, path.join(state.attempt, 'bad-link'), verification)).toThrow('symlinks');
    } finally { state.cleanup(); }
});

test('artifact identity and candidate test restrictions fail closed', () => {
    const state = fixture();
    try {
        expect(() => revalidateAttemptArtifacts({ attemptRoot: state.attempt, metadata: { ...state.metadata, prompt_sha256: HASH }, proposal: state.proposal, verification })).toThrow('Prompt artifact');
        const existing = path.join(state.root, 'services/dashboard/__tests__'); fs.mkdirSync(existing, { recursive: true }); fs.writeFileSync(path.join(existing, 'code-candidate-fix.test.ts'), 'old');
        expect(() => validateDraftPatch(patch, state.root, state.proposal)).toThrow('new files');
    } finally { state.cleanup(); }
});
