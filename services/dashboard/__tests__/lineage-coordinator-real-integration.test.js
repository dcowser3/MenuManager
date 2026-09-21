'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { preparePendingCodeProposalQueue } = require('../../../scripts/lib/code-proposal-preparation-queue');
const { recordCodeVerification, recordParentCampaignLineage, closeCodeCandidateOwnerForLineageRepair } = require('../../../scripts/lib/proposal-verification-store');
const { loadPreparedDraft, deriveDraftScope } = require('../../../scripts/auto-code-proposal');
const { snapshotBaseline } = require('../../../scripts/lib/code-proposal-draft');
const { canonicalHash } = require('../../../scripts/lib/code-proposal-broker');
const { hashBehaviorArtifact } = require('../lib/learning-behavior-tests');

const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const verification = require('../../../scripts/lib/proposal-verification-store').loadVerificationModule(path.resolve(__dirname, '../../..'));

class XminClient {
    constructor(proposal, { race = null } = {}) {
        this.tables = { prompt_proposals: [{ ...clone(proposal), xmin: proposal.xmin || '1' }], submissions: [], basic_ai_check_audits: [], correction_rules: [] };
        this.race = race;
        this.writes = [];
    }
    proposal() { return this.tables.prompt_proposals[0]; }
    from(table) { return new Query(this, table); }
}

class Query {
    constructor(client, table) { this.client = client; this.table = table; this.filters = []; this.payload = null; this.orders = []; this.limitValue = null; }
    select() { return this; }
    update(payload) { this.payload = clone(payload); return this; }
    eq(field, value) { this.filters.push(['eq', field, value]); return this; }
    is(field, value) { this.filters.push(['is', field, value]); return this; }
    lte(field, value) { this.filters.push(['lte', field, value]); return this; }
    order(field, options = {}) { this.orders.push([field, options.ascending !== false]); return this; }
    limit(value) { this.limitValue = value; return this; }
    or() { return this; }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
        const rows = this.client.tables[this.table] || [];
        if (this.payload) {
            const current = rows.find((row) => this.matches(row));
            this.client.writes.push({ filters: clone(this.filters), before: clone(current), payload: clone(this.payload) });
            if (this.client.race && current) {
                this.client.race(this.client, current, this);
                this.client.race = null;
            }
            const target = rows.find((row) => this.matches(row));
            if (!target) return { data: [], error: null };
            Object.assign(target, clone(this.payload)); target.xmin = `${Number(target.xmin) + 1}`;
            return { data: [{ id: target.id }], error: null };
        }
        let found = rows.filter((row) => this.matches(row));
        for (const [field, ascending] of this.orders) found.sort((a, b) => `${a[field]}`.localeCompare(`${b[field]}`) * (ascending ? 1 : -1));
        if (this.limitValue != null) found = found.slice(0, this.limitValue);
        const data = clone(found);
        if (single) return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'expected one row' } };
        return { data, error: null };
    }
    matches(row) {
        return this.filters.every(([type, field, expected]) => {
            const textSelector = field.includes('->>');
            let value = field.replaceAll('->>', '->').split('->').reduce((v, key) => v == null ? undefined : v[key], row);
            if (textSelector && value != null && typeof value === 'object') value = JSON.stringify(value);
            if (type === 'eq') return field === 'eval_summary' && typeof expected === 'string' ? expected === JSON.stringify(value) : `${value ?? ''}` === `${expected ?? ''}`;
            if (type === 'is') return expected === null ? value == null : value === expected;
            if (type === 'lte') return Date.parse(`${value}`) <= Date.parse(`${expected}`);
            return true;
        });
    }
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'real-lineage-coordinator-'));
    const behaviorBody = { schemaVersion: 1, frozenAt: '2026-09-21T12:00:00.000Z', records: [{ correctionId: 'c1', submissionId: 'submission-1', caseId: 'production:submission-1', inputSpan: { text: 'Dish, lemons' }, expectedSpan: { text: 'Dish, lemon' }, reason: 'human', expectationAuthority: 'human_explanation', provenance: { source: 'human' }, disposition: 'awaiting_behavior_verification' }], tests: [], contextualTests: [] };
    const behavior = { ...behaviorBody, sha256: hashBehaviorArtifact(behaviorBody) };
    const proposal = { id: `real-${crypto.randomUUID().replace(/-/g, '')}`, status: 'pending', created_at: '2026-09-21T12:00:00.000Z', cycle_id: 'real-cycle', current_prompt: 'frozen prompt', proposed_prompt: 'frozen prompt', code_recommendations: [{ title: 'singularize' }], correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'production:submission-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', source: 'human' }], replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', case_id: 'production:submission-1', status: 'replay_mismatch', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }], eval_summary: { replay_retirement_policy_version: verification.REPLAY_RETIREMENT_POLICY_VERSION, behavior_tests: behavior } };
    const client = new XminClient(proposal);
    client.tables.submissions.push({ id: 'submission-1', legacy_id: 'submission-1', project_name: 'real', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Dish, lemon', form_attempt_id: 'form-1', allergens: '' });
    client.tables.basic_ai_check_audits.push({ id: 'audit-1', attempt_id: 'form-1', event_type: 'completed', review_mode: 'full', menu_content_raw: 'Dish, lemons', created_at: '2026-09-21T12:01:00.000Z' });
    const datasetPath = path.join(root, 'dataset.jsonl'); fs.writeFileSync(datasetPath, `${JSON.stringify({ case_id: 'production:submission-1', submission_id: 'submission-1', attempt_id: 'form-1', audit_id: 'audit-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon', context: {} })}\n`);
    const outputRoot = path.join(path.resolve(__dirname, '../../..'), 'tmp', 'code-proposals');
    const sentinelPath = path.join(outputRoot, 'pending-preparation-inventory-sentinel.json');
    const sentinelExisted = fs.existsSync(sentinelPath);
    const sentinelBytes = sentinelExisted ? fs.readFileSync(sentinelPath) : Buffer.from('{"sentinel":true}\n');
    if (!sentinelExisted) fs.writeFileSync(sentinelPath, sentinelBytes, { mode: 0o600 });
    const authoritativePath = fs.readdirSync(outputRoot).find((name) => name === 'pending-preparation-inventory-ef3f76086789b19afa44d6fd9613c4fb0a64f5d3b5ff55ad1cc432cf4628ecac.json');
    const authoritativeBytes = authoritativePath ? fs.readFileSync(path.join(outputRoot, authoritativePath)) : null;
    const enumeration = (cutoff) => ({ complete: true, pages: 1, cutoff, rows_count: 1, row_ids: [proposal.id], query: { table: 'prompt_proposals', status: 'pending' } });
    const knownSnapshotNames = new Set(fs.readdirSync(outputRoot).filter((name) => name.startsWith('pending-preparation-inventory-')));
    const snapshotPaths = new Set();
    const trackSnapshots = () => { for (const name of fs.readdirSync(outputRoot)) if (name.startsWith('pending-preparation-inventory-') && !knownSnapshotNames.has(name)) snapshotPaths.add(path.join(outputRoot, name)); };
    return { root, proposal, client, datasetPath, outputRoot, enumeration, sentinelPath, sentinelExisted, sentinelBytes, authoritativePath: authoritativePath && path.join(outputRoot, authoritativePath), authoritativeBytes, snapshotPaths, trackSnapshots, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(path.join(outputRoot, proposal.id), { recursive: true, force: true }); for (const file of snapshotPaths) fs.rmSync(file, { force: true }); if (sentinelExisted) fs.writeFileSync(sentinelPath, sentinelBytes, { mode: 0o600 }); else fs.rmSync(sentinelPath, { force: true }); } };
}

async function prepareInterrupted() {
    const state = fixture(); let fail = true; let lineageWrites = 0;
    const store = {
        recordParentCampaignLineage: async (...args) => { lineageWrites += 1; const result = await recordParentCampaignLineage(...args); return result; },
        recordCodeVerification: async (...args) => { if (fail) { fail = false; throw new Error('injected recordCodeVerification failure'); } return recordCodeVerification(...args); },
    };
    const first = await preparePendingCodeProposalQueue({ proposals: [state.proposal], enumeration: state.enumeration('2026-09-21T13:00:00.000Z'), client: state.client, repoRoot: path.resolve(__dirname, '../../..'), outputRoot: state.outputRoot, inventoryDirectory: state.outputRoot, datasetPath: state.datasetPath, verification, store, attemptId: 'real-attempt' });
    state.trackSnapshots();
    expect(first.results[0].reason).toMatch(/injected recordCodeVerification failure/);
    expect(state.client.proposal().eval_summary.parent_campaign_sha256).toMatch(/^[a-f0-9]{64}$/);
    const oldLineage = JSON.parse(fs.readFileSync(path.join(state.outputRoot, state.proposal.id, 'real-attempt', 'parent-campaign-lineage.json')));
    const second = await preparePendingCodeProposalQueue({ proposals: [state.client.proposal()], enumeration: state.enumeration('2026-09-21T15:00:00.000Z'), client: state.client, repoRoot: path.resolve(__dirname, '../../..'), outputRoot: state.outputRoot, inventoryDirectory: state.outputRoot, datasetPath: state.datasetPath, verification, store, attemptId: 'real-attempt' });
    state.trackSnapshots();
    expect(second.results[0]).toMatchObject({ status: 'blocked', reason: 'code_candidate_authorization_required' });
    expect(second.results[0].attemptId).toMatch(/^real-attempt-recovery-/);
    const resumedLineage = JSON.parse(fs.readFileSync(path.join(second.results[0].artifactDirectory, 'parent-campaign-lineage.json')));
    expect(resumedLineage.pending_enumeration.global_snapshot_sha256).toBe(oldLineage.pending_enumeration.global_snapshot_sha256);
    expect(lineageWrites).toBe(2);
    expect(state.client.proposal().eval_summary.code_candidate.attempt_id).toBe(second.results[0].attemptId);
    return { ...state, prepared: second.results[0], lineage: oldLineage };
}

test('actual queue resumes lineage-write-to-claim crash from the old immutable snapshot and creates one owner', async () => {
    const state = await prepareInterrupted();
    try { expect(state.client.proposal().eval_summary.parent_campaign_sha256).toBe(state.lineage.parent_campaign_sha256); expect(fs.existsSync(path.join(state.prepared.artifactDirectory, 'parent-campaign-lineage.json'))).toBe(true); expect(fs.readFileSync(state.sentinelPath)).toEqual(state.sentinelBytes); if (state.authoritativePath) expect(fs.readFileSync(state.authoritativePath)).toEqual(state.authoritativeBytes); } finally { state.cleanup(); }
});

test('actual loadPreparedDraft validates before transport and rejects mutated snapshot and old-scope authorization', async () => {
    const state = await prepareInterrupted();
    try {
        const attemptRoot = state.prepared.artifactDirectory; const baselineRoot = path.join(attemptRoot, 'baseline'); snapshotBaseline(path.resolve(__dirname, '../../..'), baselineRoot, verification);
        const live = state.client.proposal(); const behaviorModule = require('../lib/learning-behavior-tests');
        const checked = require('../../../scripts/lib/code-proposal-draft').revalidateAttemptArtifacts({ attemptRoot, trustedRoot: state.outputRoot, metadata: state.prepared.metadata, proposal: live, verification, behaviorModule, baselineRoot });
        const scope = deriveDraftScope({ attemptRoot, metadata: state.prepared.metadata, parentCampaignSha256: state.lineage.parent_campaign_sha256, proposal: live, checked });
        const auth = { schemaVersion: 1, authorizationId: 'auth-real', ledgerId: 'ledger-real', stage: 'code-candidate', status: 'active', provider: 'openai', mode: 'synthetic', model: 'gpt-5.6-sol', issuedAt: new Date(Date.now() - 1000).toISOString(), runDeadline: new Date(Date.now() + 3600000).toISOString(), expiresAt: new Date(Date.now() + 7200000).toISOString(), runRoot: attemptRoot, ledgerRelativePath: 'budget-state.json', scope, stageLimits: { usd: 1, requests: 1, inputTokens: 1000, completionTokens: 100 }, cumulativeLimits: { usd: 1, requests: 1, inputTokens: 1000, completionTokens: 100 }, requestLimits: { inputTokens: 1000, completionTokens: 100, timeoutMs: 1000 }, pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 }, requestSchedule: [{ requestId: `${state.prepared.attemptId}:draft:1:transport:1`, bodySha256: HASH('body'), inputTokens: 1, completionTokens: 1 }] };
        const authFile = path.join(attemptRoot, 'authorization.json'); const stateFile = path.join(attemptRoot, 'budget-state.json'); fs.writeFileSync(authFile, `${JSON.stringify(auth)}\n`, { mode: 0o600 }); fs.chmodSync(authFile, 0o600); fs.writeFileSync(stateFile, `${JSON.stringify({ schemaVersion: 1, authorizationId: auth.authorizationId, authorizationHash: HASH(fs.readFileSync(authFile)), scopeHash: canonicalHash(scope), requests: {}, totals: { usd: 0, requests: 0, inputTokens: 0, completionTokens: 0 } })}\n`, { mode: 0o600 }); fs.chmodSync(stateFile, 0o600);
        let transport = 0; expect(loadPreparedDraft({ attemptRoot, trustedRoot: state.outputRoot, metadata: state.prepared.metadata, proposal: live, verification, behaviorModule, sourceRoot: path.resolve(__dirname, '../../..'), baselineRoot, parentCampaignSha256: state.lineage.parent_campaign_sha256, authorizationFile: authFile, stateFile, transport: () => { transport += 1; } })).toBeTruthy();
        fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(attemptRoot, 'preparation-inventory.json'))), tampered: true }, null, 2)}\n`);
        expect(() => loadPreparedDraft({ attemptRoot, trustedRoot: state.outputRoot, metadata: state.prepared.metadata, proposal: live, verification, behaviorModule, sourceRoot: path.resolve(__dirname, '../../..'), baselineRoot, parentCampaignSha256: state.lineage.parent_campaign_sha256, authorizationFile: authFile, stateFile, transport: () => { transport += 1; } })).toThrow();
        expect(transport).toBe(0);
        fs.writeFileSync(path.join(attemptRoot, 'preparation-inventory.json'), `${JSON.stringify(state.prepared.inventory, null, 2)}\n`);
        const old = { ...auth, scope: { ...scope, proposalSha256: 'f'.repeat(64) } }; fs.writeFileSync(authFile, `${JSON.stringify(old)}\n`, { mode: 0o600 }); fs.chmodSync(authFile, 0o600); fs.writeFileSync(stateFile, `${JSON.stringify({ schemaVersion: 1, authorizationId: old.authorizationId, authorizationHash: HASH(fs.readFileSync(authFile)), scopeHash: canonicalHash(old.scope), requests: {}, totals: { usd: 0, requests: 0, inputTokens: 0, completionTokens: 0 } })}\n`, { mode: 0o600 }); fs.chmodSync(stateFile, 0o600);
        expect(() => loadPreparedDraft({ attemptRoot, trustedRoot: state.outputRoot, metadata: state.prepared.metadata, proposal: live, verification, behaviorModule, sourceRoot: path.resolve(__dirname, '../../..'), baselineRoot, parentCampaignSha256: state.lineage.parent_campaign_sha256, authorizationFile: authFile, stateFile, transport: () => { transport += 1; } })).toThrow(/scope differs/);
        expect(transport).toBe(0);
    } finally { state.cleanup(); }
});

test('actual lineage CAS race rejects stale no-owner and closed-owner transitions byte-identically', async () => {
    const state = await prepareInterrupted(); const envelope = state.lineage;
    const race = (client, current) => { current.xmin = `${Number(current.xmin) + 1}`; current.eval_summary = { ...current.eval_summary, marker: 'concurrent' }; };
    const racedProposal = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary } }; const raced = new XminClient(racedProposal, { race });
    const beforeRace = clone(raced.proposal());
    try {
        await expect(recordParentCampaignLineage(raced, raced.proposal(), envelope, verification)).rejects.toThrow(/concurrently|xmin/);
        expect(raced.proposal()).toEqual({ ...beforeRace, xmin: '2', eval_summary: { ...beforeRace.eval_summary, marker: 'concurrent' } });
        const owned = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary, code_candidate: { attempt_id: 'closed-race', status: 'running', started_at: new Date().toISOString() } } };
        const closedRace = new XminClient(owned, { race }); const beforeClosure = clone(closedRace.proposal());
        await expect(closeCodeCandidateOwnerForLineageRepair(closedRace, closedRace.proposal(), 'closed-race', verification)).rejects.toThrow(/concurrently|xmin/);
        expect(closedRace.proposal()).toEqual({ ...beforeClosure, xmin: '2', eval_summary: { ...beforeClosure.eval_summary, marker: 'concurrent' } });
    } finally { state.cleanup(); }
});
