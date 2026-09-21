'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('../../../scripts/lib/code-proposal-preparation', () => ({
    prepareCodeProposalAttempt: jest.fn(),
    bindHistoricalDataset: jest.fn(async () => ({ sha256: HASH('dataset') })),
    readFrozenDataset: jest.fn(() => ({ bytes: Buffer.from('dataset') })),
}));

const { prepareCodeProposalAttempt } = require('../../../scripts/lib/code-proposal-preparation');
const { buildPreparationInventory, finalizePreparationInventory, prepareCodeProposalQueue, preparePendingCodeProposalQueue, enumerateCompletePages, loadPendingProposalRows, inventoryBoundaryHash, validateManualExclusionArtifact, USER_MANUAL_UNRESOLVED } = require('../../../scripts/lib/code-proposal-preparation-queue');
const { hashBehaviorArtifact } = require('../lib/learning-behavior-tests');

const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const behaviorRecord = (id) => ({ correctionId: id, inputSpan: { text: 'before' }, expectedSpan: { text: 'after' }, reason: 'human reason', expectationAuthority: 'human_explanation', provenance: { reviewer: 'Reviewer' }, disposition: 'awaiting_behavior_verification' });

function proposal(overrides = {}) {
    const routes = [
        { correction_id: 'c2', lane: 'prompt', case_id: 'case-2', original_text: 'before', corrected_text: 'after', source: 'human' },
        { correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'before', corrected_text: 'after', source: 'human' },
    ];
    const records = [behaviorRecord('c1'), behaviorRecord('c2')];
    const behavior = { schemaVersion: 1, frozenAt: new Date().toISOString(), records, tests: [], contextualTests: [] };
    behavior.sha256 = hashBehaviorArtifact({ schemaVersion: behavior.schemaVersion, frozenAt: behavior.frozenAt, records, tests: [], contextualTests: [] });
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

const verification = { codeProposalVerificationFingerprint: (value) => HASH(JSON.stringify({ ...value, eval_summary: { ...(value.eval_summary || {}), code_candidate: undefined } })), hashCodeImplementation: () => HASH('source'), hashAcceptedRules: () => HASH('rules') };

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
        const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q, or: () => { q._cursor = true; return q; }, then: (resolve) => Promise.resolve({ data: q._cursor ? [] : [{ id: 'p1', created_at: '2026-01-01' }, { id: 'p2', created_at: '2026-01-01' }] }).then(resolve) };
        return q;
    } };
    await expect(loadPendingProposalRows(client, { pageSize: 1, cutoff: '2026-01-03' })).resolves.toMatchObject({ rows: [{ id: 'p1' }, { id: 'p2' }], rows_count: 2, row_ids: ['p1', 'p2'], complete: true });
});

test('keyset continuation retains the next row when an earlier row leaves pending, and malformed pages fail', async () => {
    let continued = false;
    let page = 0;
    const client = { from: () => {
        const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q, or: () => { continued = true; return q; }, then: (resolve) => Promise.resolve({ data: page++ === 0 ? [{ id: 'a', created_at: '2026-01-01' }] : page === 2 ? [{ id: 'b', created_at: '2026-01-01' }] : [] }).then(resolve) };
        return q;
    } };
    const rows = await loadPendingProposalRows(client, { pageSize: 1, cutoff: '2026-01-03' });
    expect(rows.row_ids).toEqual(['a', 'b']);
    const malformed = { from: () => ({ select: () => ({ eq: () => ({ lte: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: null }) }) }) }) }) }) }) };
    await expect(loadPendingProposalRows(malformed, { pageSize: 1 })).rejects.toThrow(/malformed page/);
});

test('pending enumeration rejects invalid rows, duplicate keys, and non-advancing pages', async () => {
    const clientFor = (rows) => ({ from: () => {
        const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q, or: () => q, then: (resolve) => Promise.resolve({ data: rows }).then(resolve) };
        return q;
    } });
    await expect(loadPendingProposalRows(clientFor([{ id: '', created_at: '2026-01-01' }]), { pageSize: 1 })).rejects.toThrow(/malformed row/);
    await expect(loadPendingProposalRows(clientFor([{ id: 'a', created_at: 'not-a-date' }]), { pageSize: 1 })).rejects.toThrow(/malformed row/);
    let calls = 0;
    const duplicate = { from: () => {
        const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q, or: () => q, then: (resolve) => Promise.resolve({ data: calls++ ? [{ id: 'a', created_at: '2026-01-01' }] : [{ id: 'a', created_at: '2026-01-01' }] }).then(resolve) };
        return q;
    } };
    await expect(loadPendingProposalRows(duplicate, { pageSize: 1 })).rejects.toThrow(/non-monotonic/);
});

test('explicit replay and behavior associations reject case, text, and empty-span conflicts', () => {
    const base = proposal();
    const mismatch = { ...base, correction_routing: base.correction_routing.map((row) => ({ ...row, case_id: 'route-case' })), replay_evidence: base.replay_evidence.map((row) => ({ ...row, case_id: 'wrong-case' })) };
    expect(buildPreparationInventory(mismatch).groups[0].reason).toBe('behavior_binding_conflict');
    const emptySpan = { ...base, eval_summary: { ...base.eval_summary, behavior_tests: { ...base.eval_summary.behavior_tests, records: base.eval_summary.behavior_tests.records.map((row) => ({ ...row, inputSpan: { text: '' } })) } } };
    expect(buildPreparationInventory(emptySpan).groups[0].reason).toBe('behavior_binding_conflict');
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
        expect(result.results[0].reason).toMatch(/exactly one behavior binding/);
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

test('same owner reconciles across outer cutoff/snapshot refresh without dispatch', async () => {
    const state = setup();
    const base = proposal({ id: 'p-resume', cycle_id: 'cycle-resume' });
    const firstInventory = finalizePreparationInventory(buildPreparationInventory(base, { proposalFingerprint: verification.codeProposalVerificationFingerprint(base), query: { cutoff: 'old' }, enumeration: { complete: true, order: 'old' }, advisoryCursor: 'old' }), { behavior_tests_sha256: base.eval_summary.behavior_tests.sha256, dataset_sha256: HASH('dataset'), source_sha256: HASH('source'), prompt_sha256: HASH(''), accepted_rules_sha256: HASH('rules') });
    const attemptRoot = path.join(state.root, 'attempt-resume');
    fs.mkdirSync(path.join(attemptRoot, 'candidate'), { recursive: true });
    fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify(firstInventory, null, 2)}\n`);
    fs.writeFileSync(path.join(attemptRoot, 'dataset.jsonl'), 'dataset');
    const summary = { schema_version: 1, snapshot_sha256: firstInventory.snapshot_sha256, proposal_id: firstInventory.proposal_id, cycle_id: firstInventory.cycle_id, attempt_id: 'attempt-resume', artifact_directory: attemptRoot, provider_calls: 0, advisory_cursor: firstInventory.advisory_cursor, groups: firstInventory.groups.map((g) => ({ correction_id: g.correction_id, lane: g.lane, status: g.status, reason: g.reason })), status: 'blocked', reason: 'code_candidate_authorization_required' };
    fs.writeFileSync(path.join(attemptRoot, 'preparation-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(path.join(attemptRoot, 'candidate/progress.json'), `${JSON.stringify({ schema_version: 1, attempt_id: 'attempt-resume', state: 'blocked', reason: 'code_candidate_authorization_required', deadline_at: '2099-01-01T00:00:00.000Z', budget: { model_calls: 0 } })}\n`);
    const owner = { status: 'running', attempt_id: 'attempt-resume', started_at: new Date().toISOString(), deadline_at: '2099-01-01T00:00:00.000Z', artifact_directory: attemptRoot, preparation_inventory_sha256: HASH(JSON.stringify(firstInventory, null, 2) + '\n'), expected_dataset_sha256: HASH('dataset') };
    const current = { ...base, eval_summary: { ...base.eval_summary, code_candidate: owner } };
    try {
        const refreshed = { ...current };
        const result = await prepareCodeProposalQueue({ proposal: refreshed, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, readCurrentProposal: async () => current });
        expect(result.attemptId).toBe('attempt-resume');
        expect(result.reason).toBe('code_candidate_authorization_required');
        expect(prepareCodeProposalAttempt).not.toHaveBeenCalled();
        expect(inventoryBoundaryHash(result.inventory)).toBe(inventoryBoundaryHash(firstInventory));
        fs.writeFileSync(path.join(attemptRoot, 'preparation-summary.json'), `${JSON.stringify({ ...summary, reason: 'tampered' })}\n`);
        await expect(prepareCodeProposalQueue({ proposal: refreshed, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, readCurrentProposal: async () => current })).rejects.toThrow(/summary integrity/);
        fs.writeFileSync(path.join(attemptRoot, 'preparation-summary.json'), `${JSON.stringify(summary)}\n`);
        fs.writeFileSync(path.join(attemptRoot, 'candidate/progress.json'), `${JSON.stringify({ schema_version: 1, attempt_id: 'attempt-resume', state: 'blocked', reason: 'code_candidate_authorization_required', deadline_at: '2099-01-01T00:00:00.000Z', budget: {} })}\n`);
        await expect(prepareCodeProposalQueue({ proposal: refreshed, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, readCurrentProposal: async () => current })).rejects.toThrow(/progress integrity/);
    } finally { state.cleanup(); }
});

test('missing or non-human binding, cross-cycle duplicate, and mutable status drift fail closed', async () => {
    const missingBehavior = proposal({ eval_summary: { replay_retirement_policy_version: 1, behavior_tests: { ...proposal().eval_summary.behavior_tests, records: [] } } });
    expect(() => buildPreparationInventory(missingBehavior)).toThrow(/exactly one behavior/);
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

test('user-owned manual exclusions preserve inventory while removing exactly three groups from automatic scope', () => {
    const ids = [...USER_MANUAL_UNRESOLVED];
    const routes = ids.map((id) => ({ correction_id: id, lane: 'prompt', case_id: id, original_text: 'before', corrected_text: 'after', source: 'human' })).concat([{ correction_id: 'eligible-code', lane: 'code_recommendation', case_id: 'eligible', original_text: 'before', corrected_text: 'after', source: 'human' }]);
    const records = routes.map((route) => behaviorRecord(route.correction_id));
    const evidence = routes.map((route) => ({ correction_id: route.correction_id, submission_id: `submission-${route.correction_id}`, case_id: route.case_id, original_text: route.original_text, corrected_text: route.corrected_text, status: 'replay_mismatch' }));
    const p = proposal({ id: 'manual-exclusion', cycle_id: 'cycle-manual', correction_routing: routes, replay_evidence: evidence, eval_summary: { behavior_tests: { records } } });
    const fingerprint = HASH(JSON.stringify(p));
    const artifact = { schema_version: 1, source: 'user_owned_manual_exclusion', proposal_id: p.id, cycle_id: p.cycle_id, proposal_fingerprint: fingerprint, exclusions: ids.map((correction_id) => ({ correction_id, reason: 'user_owned_manual_unresolved' })) };
    const inventory = buildPreparationInventory(p, { proposalFingerprint: fingerprint, manualExclusionArtifact: artifact });
    expect(inventory.groups).toHaveLength(4);
    expect(inventory.groups.filter((group) => group.reason === 'user_owned_manual_unresolved')).toHaveLength(3);
    expect(inventory.groups.find((group) => group.correction_id === 'eligible-code').status).toBe('awaiting_code_candidate_authorization');
    expect(() => validateManualExclusionArtifact(p, { ...artifact, exclusions: artifact.exclusions.slice(0, 2) }, fingerprint)).toThrow(/missing/);
    expect(() => validateManualExclusionArtifact(p, { ...artifact, source: 'model' }, fingerprint)).toThrow(/missing or stale/);
});

test('duplicate or conflicting human behavior bindings fail closed', () => {
    const base = proposal();
    const duplicate = { ...base, eval_summary: { ...base.eval_summary, behavior_tests: { ...base.eval_summary.behavior_tests, records: [...base.eval_summary.behavior_tests.records, { ...base.eval_summary.behavior_tests.records[0] }] } } };
    expect(() => buildPreparationInventory(duplicate)).toThrow(/exactly one behavior/);
    const conflict = { ...base, eval_summary: { ...base.eval_summary, behavior_tests: { ...base.eval_summary.behavior_tests, records: base.eval_summary.behavior_tests.records.map((record) => record.correctionId === 'c1' ? { ...record, inputSpan: { text: 'conflict' } } : record) } } };
    expect(buildPreparationInventory(conflict).blocked_groups[0].reason).toBe('behavior_binding_conflict');
});

test('existing owner is reconciled before local recovery and changed status is not replaced', async () => {
    const state = setup();
    const current = proposal({ eval_summary: { ...proposal().eval_summary, code_candidate: { attempt_id: 'attempt-existing', status: 'running', started_at: new Date().toISOString(), artifact_directory: path.join(state.root, 'attempt') } } });
    try {
        await expect(prepareCodeProposalQueue({ proposal: current, client: state.client, repoRoot: state.root, datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, readCurrentProposal: async () => ({ ...current, status: 'approved' }) })).rejects.toThrow(/no longer pending/);
        expect(prepareCodeProposalAttempt).not.toHaveBeenCalled();
    } finally { state.cleanup(); }
});

test('deterministic orphan is reclaimed only when its inventory identity is exact', async () => {
    const state = setup();
    const base = proposal({ correction_routing: [proposal().correction_routing[1]], replay_evidence: [proposal().replay_evidence[1]], eval_summary: { replay_retirement_policy_version: 1, behavior_tests: proposal().eval_summary.behavior_tests } });
    const inventory = finalizePreparationInventory(buildPreparationInventory(base, { proposalFingerprint: verification.codeProposalVerificationFingerprint(base) }), { behavior_tests_sha256: HASH('behavior'), dataset_sha256: HASH('dataset'), source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') });
    const orphan = path.join(state.root, 'tmp', 'code-proposals', base.id, `proposal-${base.id}`);
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'preparation-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
    prepareCodeProposalAttempt.mockImplementationOnce(async (options) => {
        const artifactDirectory = path.join(state.root, 'tmp', 'code-proposals', base.id, options.attemptId);
        fs.mkdirSync(path.join(artifactDirectory, 'candidate'), { recursive: true });
        fs.writeFileSync(path.join(artifactDirectory, 'preparation-inventory.json'), `${JSON.stringify(options.inventory, null, 2)}\n`);
        fs.writeFileSync(path.join(artifactDirectory, 'candidate', 'progress.json'), JSON.stringify({ state: 'active', budget: { model_calls: 0 } }));
        return { status: 'claimed', attemptId: options.attemptId, artifactDirectory, metadata: { behavior_tests_sha256: HASH('behavior'), expected_dataset_sha256: HASH('dataset'), baseline_source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') } };
    });
    const result = await prepareCodeProposalQueue({ proposal: base, client: state.client, repoRoot: state.root, outputRoot: path.join(state.root, 'tmp', 'code-proposals'), datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification, store: { recordCodeVerification: jest.fn() } });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('code_candidate_authorization_required');
    expect(fs.existsSync(orphan)).toBe(true);
    expect(prepareCodeProposalAttempt.mock.calls.at(-1)[0].attemptId).toMatch(/^proposal-proposal-queue-recovery-/);
    state.cleanup();
});

test('tampered orphan snapshot and frozen boundary remain blocked and preserved', async () => {
    const state = setup();
    const base = proposal({ correction_routing: [proposal().correction_routing[1]], replay_evidence: [proposal().replay_evidence[1]], eval_summary: { replay_retirement_policy_version: 1, behavior_tests: proposal().eval_summary.behavior_tests } });
    const inventory = finalizePreparationInventory(buildPreparationInventory(base, { proposalFingerprint: verification.codeProposalVerificationFingerprint(base) }), { behavior_tests_sha256: HASH('behavior'), dataset_sha256: HASH('dataset'), source_sha256: HASH('source'), prompt_sha256: HASH('prompt'), accepted_rules_sha256: HASH('rules') });
    const orphan = path.join(state.root, 'tmp', 'code-proposals', base.id, `proposal-${base.id}`);
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'preparation-inventory.json'), `${JSON.stringify({ ...inventory, snapshot_sha256: HASH('tampered') }, null, 2)}\n`);
    const result = await prepareCodeProposalQueue({ proposal: base, client: state.client, repoRoot: state.root, outputRoot: path.join(state.root, 'tmp', 'code-proposals'), datasetPath: path.join(state.root, 'tmp/review-eval/dataset.jsonl'), verification });
    expect(result.reason).toBe('orphan_artifact_ambiguous');
    expect(fs.existsSync(orphan)).toBe(true);
    state.cleanup();
});
