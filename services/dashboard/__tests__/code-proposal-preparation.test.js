const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { prepareCodeProposalAttempt } = require('../../../scripts/lib/code-proposal-preparation');
const { hashAcceptedRules } = require('../lib/code-proposal-verification');

const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fakeClient({ submissions = [], audits = [], rules = [{ id: 'rule-1', status: 'accepted' }], updated = [{ id: 'p1' }] } = {}) {
    const calls = [];
    const from = (table) => {
        calls.push(table);
        const query = {
            select() { return query; },
            eq() { return query; },
            order() { return Promise.resolve({ data: rules }); },
            or() { return Promise.resolve({ data: submissions }); },
        };
        if (table === 'basic_ai_check_audits') query.eq = () => query;
        if (table === 'submissions') query.order = undefined;
        return query;
    };
    return { calls, from, submissions, audits, updated };
}

function makeClient(options = {}) {
    const client = fakeClient(options);
    client.from = (table) => {
        client.calls.push(table);
        const query = { select: () => query, eq: () => query, order: () => Promise.resolve({ data: options.rules || [] }), or: () => Promise.resolve({ data: options.submissions || [] }) };
        if (table === 'basic_ai_check_audits') query.eq = () => query;
        if (table === 'submissions') query.or = () => Promise.resolve({ data: options.submissions || [] });
        if (table === 'basic_ai_check_audits') query.eq = () => query;
        return query;
    };
    // The audit query has three chained eq calls; resolve its final call.
    const originalFrom = client.from;
    client.from = (table) => {
        const query = originalFrom(table);
        if (table === 'basic_ai_check_audits') {
            let count = 0;
            const filters = [];
            query.eq = (field, value) => {
                filters.push([field, value]);
                count += 1;
                if (count !== (options.auditEqCount || 3)) return query;
                const data = (options.audits || []).filter((audit) => filters.every(([key, expected]) => `${audit[key] ?? ''}` === `${expected ?? ''}`));
                return Promise.resolve({ data });
            };
        }
        return query;
    };
    return client;
}

function fixture(repoRoot) {
    const behaviorModule = require('../lib/learning-behavior-tests');
    const record = behaviorModule.buildBehaviorTestRecord({ id: 'c1', source: 'human', reviewer_name: 'Reviewer', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', rule: 'Singular' });
    const behavior = behaviorModule.freezeBehaviorTests([record], [], []);
    const proposal = {
        id: 'p1', status: 'pending', fingerprint: 'ignored', proposed_prompt: 'prompt',
        code_recommendations: [{ title: 'Singular' }],
        correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }],
        replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }],
        eval_summary: { replay_retirement_policy_version: 1, behavior_tests: behavior },
    };
    return { proposal, behavior };
}

function setup() {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c1-'));
    fs.mkdirSync(path.join(repoRoot, 'tmp', 'review-eval'), { recursive: true });
    const datasetPath = path.join(repoRoot, 'tmp', 'review-eval', 'dataset.jsonl');
    fs.writeFileSync(datasetPath, `${JSON.stringify({ case_id: 'base', raw_input: 'Base', ground_truth: 'Base', context: {} })}\n`);
    const { proposal, behavior } = fixture(repoRoot);
    const client = makeClient({
        rules: [{ id: 'rule-1', status: 'accepted' }],
        submissions: [{ id: 'submission-1', legacy_id: 'legacy-1', project_name: 'Project', property: 'Property', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1' }],
        audits: [{ id: 'audit-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed', attempt_id: 'attempt-1' }],
    });
    const calls = [];
    const verification = {
        REPLAY_RETIREMENT_POLICY_VERSION: 1,
        hashCodeImplementation: () => HASH_B,
        codeProposalVerificationFingerprint: () => HASH,
        hashAcceptedRules,
    };
    const store = { recordCodeVerification: async (...args) => { calls.push(args); return { replay_retirement_policy_version: 1 }; } };
    return { repoRoot, datasetPath, proposal, behavior, behaviorModule: require('../lib/learning-behavior-tests'), client, calls, verification, store, cleanup: () => fs.rmSync(repoRoot, { recursive: true, force: true }) };
}

test('prepares complete artifacts and claims exactly once after all hashes/files exist', async () => {
    const state = setup();
    try {
        const result = await prepareCodeProposalAttempt({ ...state, outputRoot: path.join(state.repoRoot, 'tmp', 'code-proposals'), attemptId: 'attempt-one' });
        expect(result.status).toBe('claimed');
        expect(state.calls).toHaveLength(1);
        const root = result.artifactDirectory;
        expect(root).toBe(path.join(state.repoRoot, 'tmp', 'code-proposals', 'p1', 'attempt-one'));
        expect(fs.statSync(root).mode & 0o777).toBe(0o700);
        for (const file of ['proposal.json', 'prompt.txt', 'rules.json', 'behavior-tests.json', 'dataset.jsonl', 'candidate/progress.json']) {
            expect(fs.statSync(path.join(root, file)).mode & 0o777).toBe(0o600);
        }
        const claim = state.calls[0][2].code_candidate;
        expect(claim.proposal_sha256).toBe(HASH);
        expect(claim.baseline_source_sha256).toBe(HASH_B);
        expect(claim.prompt_sha256).toBe(digest('prompt'));
        expect(claim.accepted_rules_sha256).toBe(hashAcceptedRules([{ id: 'rule-1', status: 'accepted' }]));
        expect(digest(fs.readFileSync(path.join(root, 'dataset.jsonl')))).toBe(claim.expected_dataset_sha256);
        expect(claim.behavior_tests_sha256).toBe(state.proposal.eval_summary.behavior_tests.sha256);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'candidate/progress.json'))).attempt_id).toBe(claim.attempt_id);
    } finally { state.cleanup(); }
});

test('pre-claim failures clean only the new attempt directory and never call the store', async () => {
    const state = setup();
    state.proposal.eval_summary.behavior_tests = {};
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-fail' })).rejects.toThrow('behavior');
        expect(state.calls).toHaveLength(0);
        expect(fs.existsSync(path.join(state.repoRoot, 'tmp', 'code-proposals', 'p1', 'attempt-fail'))).toBe(false);
    } finally { state.cleanup(); }
});

test('claim conflicts retain only a failed local progress record and no second owner', async () => {
    const state = setup();
    state.store.recordCodeVerification = async () => { throw new Error('Another code-proposal attempt is already running.'); };
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-conflict' })).rejects.toThrow('already running');
        const progress = JSON.parse(fs.readFileSync(path.join(state.repoRoot, 'tmp', 'code-proposals', 'p1', 'attempt-conflict', 'candidate', 'progress.json'), 'utf8'));
        expect(progress.state).toBe('failed');
        expect(progress.attempt_id).toBe('attempt-conflict');
    } finally { state.cleanup(); }
});

test('ambiguous replay mapping and duplicate audit evidence fail closed before claim', async () => {
    const state = setup();
    state.proposal.replay_evidence.push({ ...state.proposal.replay_evidence[0], submission_id: 'submission-2' });
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-ambiguous' })).rejects.toThrow('unique replay submission mapping');
        expect(state.calls).toHaveLength(0);
    } finally { state.cleanup(); }
    const duplicate = setup();
    duplicate.client = makeClient({
        rules: [{ id: 'rule-1', status: 'accepted' }],
        submissions: [{ id: 'submission-1', approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1' }],
        audits: [{ id: 'audit-1', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' }, { id: 'audit-2', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' }],
    });
    try { await expect(prepareCodeProposalAttempt({ ...duplicate, attemptId: 'attempt-duplicate' })).rejects.toThrow('Exactly one complete'); expect(duplicate.calls).toHaveLength(0); } finally { duplicate.cleanup(); }
});

test('traversal, symlink, and existing attempt directories are rejected', async () => {
    const state = setup();
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: '../escape' })).rejects.toThrow('Invalid attempt id');
        const root = path.join(state.repoRoot, 'tmp', 'code-proposals');
        fs.mkdirSync(path.join(root, 'p1', 'existing'), { recursive: true });
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'existing' })).rejects.toThrow('already exists');
        await expect(prepareCodeProposalAttempt({ ...state, outputRoot: path.join(root, 'p1') })).rejects.toThrow('Output root');
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c1-outside-'));
        fs.rmSync(root, { recursive: true, force: true });
        fs.symlinkSync(outside, root);
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-symlink' })).rejects.toThrow('Unsafe artifact directory');
        fs.rmSync(outside, { recursive: true, force: true });
    } finally { state.cleanup(); }
});

test('claim failures retain prepared artifacts and mark progress, while pre-claim errors clean', async () => {
    const state = setup();
    state.store.recordCodeVerification = async () => { throw new Error('generic store failure'); };
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-store-error' })).rejects.toThrow('generic store failure');
        expect(fs.existsSync(path.join(state.repoRoot, 'tmp', 'code-proposals', 'p1', 'attempt-store-error', 'proposal.json'))).toBe(true);
        const progress = JSON.parse(fs.readFileSync(path.join(state.repoRoot, 'tmp', 'code-proposals', 'p1', 'attempt-store-error', 'candidate', 'progress.json'), 'utf8'));
        expect(progress.reason).toBe('claim_failed');
    } finally { state.cleanup(); }
});

test.each([
    ['wrong attempt', [{ id: 'audit-1', attempt_id: 'other', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' }], 'Exactly one complete'],
    ['legacy audit', [{ id: 'audit-1', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'legacy', event_type: 'completed' }], 'Exactly one complete'],
    ['incomplete audit', [{ id: 'audit-1', attempt_id: 'attempt-1', menu_content_raw: '', review_mode: 'full', event_type: 'completed' }], 'Exactly one complete'],
])('audit identity is rechecked explicitly: %s', async (_name, audits, message) => {
    const state = setup();
    state.client = makeClient({ rules: [{ id: 'rule-1', status: 'accepted' }], submissions: [{ id: 'submission-1', approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1' }], audits });
    try { await expect(prepareCodeProposalAttempt({ ...state, attemptId: `attempt-${_name.replace(/\s+/g, '-')}` })).rejects.toThrow(message); expect(state.calls).toHaveLength(0); } finally { state.cleanup(); }
});

test('an explicit audit binding selects exactly one matching completed/full raw audit', async () => {
    const state = setup();
    state.proposal.replay_evidence[0].audit_id = 'audit-2';
    state.client = makeClient({
        auditEqCount: 4,
        rules: [{ id: 'rule-1', status: 'accepted' }],
        submissions: [{ id: 'submission-1', approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1' }],
        audits: [
            { id: 'audit-1', attempt_id: 'attempt-1', menu_content_raw: 'Dish, old', review_mode: 'full', event_type: 'completed' },
            { id: 'audit-2', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' },
        ],
    });
    try {
        const result = await prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-explicit-audit' });
        const row = result.dataset.rows.find((entry) => entry.case_id === 'production:submission-1');
        expect(row).toMatchObject({ audit_id: 'audit-2', attempt_id: 'attempt-1', raw_input: 'Dish, lemons' });
    } finally { state.cleanup(); }
});

test.each([
    ['wrong id', 'audit-missing', [{ id: 'audit-1', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' }]],
    ['stale other-attempt id', 'audit-stale', [{ id: 'audit-stale', attempt_id: 'other-attempt', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' }]],
    ['ambiguous duplicate id', 'audit-duplicate', [
        { id: 'audit-duplicate', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' },
        { id: 'audit-duplicate', attempt_id: 'attempt-1', menu_content_raw: 'Dish, lemons', review_mode: 'full', event_type: 'completed' },
    ]],
])('explicit audit binding rejects %s', async (_name, auditId, audits) => {
    const state = setup();
    state.proposal.replay_evidence[0].audit_id = auditId;
    state.client = makeClient({ auditEqCount: 4, rules: [{ id: 'rule-1', status: 'accepted' }], submissions: [{ id: 'submission-1', approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1' }], audits });
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: `attempt-explicit-${_name.replace(/\s+/g, '-')}` })).rejects.toThrow('Exactly one complete');
        expect(state.calls).toHaveLength(0);
    } finally { state.cleanup(); }
});

test('an explicit audit binding rejects an empty identifier and changed persisted raw bytes', async () => {
    const empty = setup();
    empty.proposal.replay_evidence[0].audit_id = '   ';
    try {
        await expect(prepareCodeProposalAttempt({ ...empty, attemptId: 'attempt-empty-audit' })).rejects.toThrow('invalid explicit audit');
        expect(empty.calls).toHaveLength(0);
    } finally { empty.cleanup(); }

    const changed = setup();
    changed.proposal.replay_evidence[0].audit_id = 'audit-1';
    changed.client = makeClient({ auditEqCount: 4, rules: [{ id: 'rule-1', status: 'accepted' }], submissions: [{ id: 'submission-1', approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1' }], audits: [{ id: 'audit-1', attempt_id: 'attempt-1', menu_content_raw: 'Dish, changed', review_mode: 'full', event_type: 'completed' }] });
    const datasetPath = changed.datasetPath;
    fs.writeFileSync(datasetPath, `${JSON.stringify({ case_id: 'production:submission-1', submission_id: 'submission-1', attempt_id: 'attempt-1', audit_id: 'audit-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon', context: {} })}\n`);
    try {
        await expect(prepareCodeProposalAttempt({ ...changed, attemptId: 'attempt-changed-audit' })).rejects.toThrow('evidence changed');
        expect(changed.calls).toHaveLength(0);
    } finally { changed.cleanup(); }
});

test('malformed frozen datasets fail before ownership claim', async () => {
    const state = setup();
    fs.writeFileSync(state.datasetPath, `${JSON.stringify({ case_id: 'duplicate', raw_input: 'A', ground_truth: 'A', context: {} })}\n${JSON.stringify({ case_id: 'duplicate', raw_input: 'B', ground_truth: 'B', context: {} })}\n`);
    try {
        await expect(prepareCodeProposalAttempt({ ...state, attemptId: 'attempt-bad-dataset' })).rejects.toThrow('unique case ids');
        expect(state.calls).toHaveLength(0);
    } finally { state.cleanup(); }
});
