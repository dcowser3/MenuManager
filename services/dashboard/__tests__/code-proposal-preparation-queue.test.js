'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('../../../scripts/lib/code-proposal-preparation', () => ({
    prepareCodeProposalAttempt: jest.fn(),
}));

const { prepareCodeProposalAttempt } = require('../../../scripts/lib/code-proposal-preparation');
const { buildPreparationInventory, finalizePreparationInventory, prepareCodeProposalQueue, preparePendingCodeProposalQueue, enumerateCompletePages, loadPendingProposalRows } = require('../../../scripts/lib/code-proposal-preparation-queue');

const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const behaviorRecord = (id) => ({ correctionId: id, inputSpan: { text: 'before' }, expectedSpan: { text: 'after' }, reason: 'human reason', expectationAuthority: 'human_explanation', provenance: { reviewer: 'Reviewer' }, disposition: 'awaiting_behavior_verification' });

function proposal(overrides = {}) {
    const routes = [
        { correction_id: 'c2', lane: 'prompt', case_id: 'case-2', original_text: 'before 2', corrected_text: 'after 2', source: 'human' },
        { correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'before 1', corrected_text: 'after 1', source: 'human' },
    ];
    const records = [behaviorRecord('c1'), behaviorRecord('c2')];
    const behavior = { schemaVersion: 1, frozenAt: new Date().toISOString(), records, tests: [], contextualTests: [] };
    behavior.sha256 = HASH(JSON.stringify({ schemaVersion: behavior.schemaVersion, frozenAt: behavior.frozenAt, records, tests: [], contextualTests: [] }));
    return {
        id: 'proposal-queue', status: 'pending', cycle_id: 'cycle-1', correction_routing: routes,
        replay_evidence: routes.map((route) => ({ correction_id: route.correction_id, submission_id: `submission-${route.correction_id}`, case_id: route.case_id, original_text: route.original_text, corrected_text: route.corrected_text, status: 'replay_mismatch' })),
        eval_summary: { replay_retirement_policy_version: 1, behavior_tests: behavior },
        code_recommendations: [{ title: 'one' }], ...overrides,
    };
}

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-queue-'));
    fs.mkdirSync(path.join(root, 'tmp', 'review-eval'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp', 'review-eval', 'dataset.jsonl'), `${JSON.stringify({ case_id: 'base', raw_input: 'Base', ground_truth: 'Base', context: {} })}\n`);
    const client = { from: (table) => {
        const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: table === 'correction_rules' ? [] : [] }), or: () => Promise.resolve({ data: [] }), single: async () => ({ data: null }) };
        return q;
    } };
    return { root, client, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const verification = { codeProposalVerificationFingerprint: (value) => HASH(JSON.stringify(value)), hashCodeImplementation: () => HASH('source'), hashAcceptedRules: () => HASH('rules') };

beforeEach(() => { prepareCodeProposalAttempt.mockReset(); });

test('inventory order and canonical snapshot are stable for shuffled routes', () => {
    const original = proposal();
    const first = buildPreparationInventory(original, { proposalFingerprint: HASH('proposal') });
    const second = buildPreparationInventory({ ...original, correction_routing: original.correction_routing.slice().reverse() }, { proposalFingerprint: HASH('proposal') });
    expect(first.snapshot_sha256).toBe(second.snapshot_sha256);
    expect(first.groups.map((group) => group.correction_id)).toEqual(['c1', 'c2']);
    expect(first.enumeration.complete).toBe(true);
});

test('final inventory freezes every preparation identity', () => {
    const inventory = buildPreparationInventory(proposal(), { proposalFingerprint: HASH('proposal') });
    const finalized = finalizePreparationInventory(inventory, { behavior_tests_sha256: HASH('behavior'), dataset_sha256: HASH('dataset'), source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') });
    expect(finalized.frozen_hashes).toEqual({ behavior_tests_sha256: HASH('behavior'), dataset_sha256: HASH('dataset'), source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') });
    expect(finalized.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('incomplete enumeration and duplicate replay mappings fail closed', () => {
    expect(() => buildPreparationInventory(proposal(), { enumeration: { complete: false } })).toThrow(/incomplete/);
    expect(() => buildPreparationInventory(proposal({ replay_evidence: [...proposal().replay_evidence, proposal().replay_evidence[0]] }))).toThrow(/one replay binding/);
});

test('pagination requires an explicit complete terminal page', async () => {
    const pages = await enumerateCompletePages(async (cursor) => cursor ? { rows: ['b'], complete: true } : { rows: ['a'], nextCursor: 'next' });
    expect(pages.rows).toEqual(['a', 'b']);
    await expect(enumerateCompletePages(async () => ({ rows: ['a'] }))).rejects.toThrow(/incomplete/);
});

test('pending proposal retrieval is fully paginated', async () => {
    const client = { from: () => {
        const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, range: (from) => Promise.resolve({ data: from >= 2 ? [] : from ? [{ id: 'p2' }] : [{ id: 'p1' }] }) };
        return q;
    } };
    await expect(loadPendingProposalRows(client, { pageSize: 1, cutoff: '2026-01-03' })).resolves.toMatchObject({ rows: [{ id: 'p1' }, { id: 'p2' }], rows_count: 2, row_ids: ['p1', 'p2'], complete: true });
});

test('multiple groups share one owner-bound attempt and injected authorization cannot dispatch', async () => {
    const state = setup();
    prepareCodeProposalAttempt.mockImplementation(async (options) => {
        const attemptRoot = path.join(state.root, 'tmp', 'code-proposals', 'proposal-queue', 'proposal-proposal-queue');
        fs.mkdirSync(path.join(attemptRoot, 'candidate'), { recursive: true });
        fs.writeFileSync(path.join(attemptRoot, 'candidate', 'progress.json'), JSON.stringify({ state: 'active' }));
        fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify(options.inventory, null, 2)}\n`);
        return { status: 'claimed', attemptId: 'proposal-proposal-queue', artifactDirectory: attemptRoot, metadata: { preparation_inventory_sha256: HASH('inventory'), behavior_tests_sha256: HASH('behavior'), expected_dataset_sha256: HASH('dataset'), baseline_source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') } };
    });
    try {
        const result = await prepareCodeProposalQueue({ proposal: proposal(), client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, authorization: { stage: 'code-candidate', status: 'active' }, dispatchDraft: jest.fn(), runPreparedLifecycle: jest.fn() });
        expect(result.reason).toBe('code_candidate_authorization_required');
        expect(result.inventory.groups).toHaveLength(2);
        expect(prepareCodeProposalAttempt).toHaveBeenCalledTimes(1);
        expect(prepareCodeProposalAttempt.mock.calls[0][0].authorization).toBeUndefined();
    } finally { state.cleanup(); }
});

test('complete multi-proposal consumer preserves ordering and does not abort on one blocked proposal', async () => {
    const state = setup();
    prepareCodeProposalAttempt.mockImplementation(async (options) => {
        const attemptRoot = path.join(state.root, 'tmp', 'code-proposals', options.proposal.id, 'attempt');
        fs.mkdirSync(path.join(attemptRoot, 'candidate'), { recursive: true });
        fs.writeFileSync(path.join(attemptRoot, 'candidate', 'progress.json'), JSON.stringify({ state: 'active' }));
        fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify(options.inventory, null, 2)}\n`);
        return { status: 'claimed', attemptId: `attempt-${options.proposal.id}`, artifactDirectory: attemptRoot, metadata: { behavior_tests_sha256: HASH('behavior'), expected_dataset_sha256: HASH('dataset'), baseline_source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') } };
    });
    try {
        const good = proposal({ id: 'p-good', cycle_id: 'cycle-good', created_at: '2026-01-02' });
        const badBase = proposal({ id: 'p-bad', cycle_id: 'cycle-bad', created_at: '2026-01-01' });
        const bad = { ...badBase, correction_routing: badBase.correction_routing.map((row, index) => ({ ...row, correction_id: `b${index + 1}`, case_id: `case-b${index + 1}` })), replay_evidence: badBase.replay_evidence.map((row, index) => ({ ...row, correction_id: `b${index + 1}`, case_id: `case-b${index + 1}` })), eval_summary: { ...badBase.eval_summary, behavior_tests: { ...badBase.eval_summary.behavior_tests, records: [] } } };
        const enumeration = { complete: true, pages: 1, cutoff: '2026-01-03', rows_count: 2, row_ids: ['p-bad', 'p-good'], query: { table: 'prompt_proposals' } };
        const result = await preparePendingCodeProposalQueue({ proposals: [good, bad], enumeration, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, inventoryDirectory: path.join(state.root, 'tmp') });
        expect(result.snapshot.rows.map((row) => row.id)).toEqual(['p-bad', 'p-good']);
        expect(result.results[0].reason).toBe('preparation_binding_incomplete');
        expect(result.results[1].reason).toBe('code_candidate_authorization_required');
        expect(prepareCodeProposalAttempt).toHaveBeenCalledTimes(1);
        const snapshots = fs.readdirSync(path.join(state.root, 'tmp')).filter((name) => name.startsWith('pending-preparation-inventory-'));
        expect(snapshots).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(path.join(state.root, 'tmp', snapshots[0]))).snapshot_sha256).toBe(result.snapshot.snapshot_sha256);
    } finally { state.cleanup(); }
});

test('production-style consumer resolves its verifier when no verifier is injected', async () => {
    const state = setup();
    prepareCodeProposalAttempt.mockImplementation(async (options) => {
        const attemptRoot = path.join(state.root, 'tmp', 'code-proposals', options.proposal.id, 'attempt');
        fs.mkdirSync(path.join(attemptRoot, 'candidate'), { recursive: true });
        fs.writeFileSync(path.join(attemptRoot, 'candidate', 'progress.json'), JSON.stringify({ state: 'active' }));
        fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify(options.inventory, null, 2)}\n`);
        return { status: 'claimed', attemptId: `attempt-${options.proposal.id}`, artifactDirectory: attemptRoot, metadata: { behavior_tests_sha256: HASH('behavior'), expected_dataset_sha256: HASH('dataset'), baseline_source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') } };
    });
    try {
        const item = proposal({ id: 'p-production', cycle_id: 'cycle-production' });
        const enumeration = { complete: true, pages: 1, cutoff: '2026-01-03', rows_count: 1, row_ids: ['p-production'], query: { table: 'prompt_proposals' } };
        const result = await preparePendingCodeProposalQueue({ proposals: [item], enumeration, client: state.client, repoRoot: process.cwd(), datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), inventoryDirectory: path.join(state.root, 'tmp') });
        expect(result.snapshot.rows[0].proposal_fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(result.results[0].reason).toBe('code_candidate_authorization_required');
    } finally { state.cleanup(); }
});

test('missing or non-human binding, cross-cycle duplicate, and mutable status drift fail closed', async () => {
    const missingBehavior = proposal({ eval_summary: { replay_retirement_policy_version: 1, behavior_tests: { ...proposal().eval_summary.behavior_tests, records: [] } } });
    const blockedInventory = buildPreparationInventory(missingBehavior);
    expect(blockedInventory.blocked_groups[0].reason).toBe('missing_behavior_binding');
    expect(() => buildPreparationInventory(proposal(), { previousInventories: [buildPreparationInventory(proposal(), { proposalFingerprint: HASH('old') })] })).toThrow(/supersession/);
    const state = setup();
    try {
        await expect(prepareCodeProposalQueue({ proposal: proposal({ status: 'approved' }), client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification })).rejects.toThrow(/pending/);
    } finally { state.cleanup(); }
});

test('explicit supersession permits a cross-cycle correction binding', async () => {
    const state = setup();
    prepareCodeProposalAttempt.mockImplementation(async (options) => {
        const attemptRoot = path.join(state.root, 'tmp', 'code-proposals', options.proposal.id, 'attempt');
        fs.mkdirSync(path.join(attemptRoot, 'candidate'), { recursive: true });
        fs.writeFileSync(path.join(attemptRoot, 'candidate', 'progress.json'), JSON.stringify({ state: 'active' }));
        fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify(options.inventory, null, 2)}\n`);
        return { status: 'claimed', attemptId: `attempt-${options.proposal.id}`, artifactDirectory: attemptRoot, metadata: { behavior_tests_sha256: HASH('behavior'), expected_dataset_sha256: HASH('dataset'), baseline_source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') } };
    });
    try {
        const first = proposal({ id: 'p-old', cycle_id: 'cycle-old', created_at: '2026-01-01' });
        const second = proposal({ id: 'p-new', cycle_id: 'cycle-new', created_at: '2026-01-02', superseded_from_cycle_id: 'cycle-old' });
        const enumeration = { complete: true, pages: 1, cutoff: '2026-01-03', rows_count: 2, row_ids: ['p-old', 'p-new'], query: { table: 'prompt_proposals' } };
        await expect(preparePendingCodeProposalQueue({ proposals: [first, second], enumeration, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification })).resolves.toMatchObject({ status: 'completed' });
    } finally { state.cleanup(); }
});

test('unknown routing lanes are explicit blocked groups', () => {
    const inventory = buildPreparationInventory(proposal({ correction_routing: [{ ...proposal().correction_routing[0], lane: 'future_lane' }] }));
    expect(inventory.groups[0]).toMatchObject({ status: 'blocked', reason: 'unknown_routing_lane' });
});

test('existing owner is reconciled before local recovery and changed status is not replaced', async () => {
    const state = setup();
    const current = proposal({ eval_summary: { ...proposal().eval_summary, code_candidate: { attempt_id: 'attempt-existing', status: 'running', started_at: new Date().toISOString(), artifact_directory: path.join(state.root, 'attempt') } } });
    try {
        await expect(prepareCodeProposalQueue({ proposal: current, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, readCurrentProposal: async () => ({ ...current, status: 'approved' }) })).rejects.toThrow(/no longer pending/);
        expect(prepareCodeProposalAttempt).not.toHaveBeenCalled();
    } finally { state.cleanup(); }
});
