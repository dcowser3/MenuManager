const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const { preparePendingCodeProposalQueue } = require('../../../scripts/lib/code-proposal-preparation-queue');
const { prepareManualCodeProposalReview } = require('../../../scripts/lib/manual-code-proposal-review');
const { snapshotBaseline, revalidateAttemptArtifacts } = require('../../../scripts/lib/code-proposal-draft');
const { deriveDraftScope } = require('../../../scripts/auto-code-proposal');
const { runPostHandoffCodeProposalLifecycle } = require('../../../scripts/lib/code-proposal-lifecycle');
const { recordCodeVerification, loadVerificationModule } = require('../../../scripts/lib/proposal-verification-store');
const { FIXED_RUNTIME_ID } = require('../../../scripts/lib/code-proposal-docker-launcher');

const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const integration = process.env.RUN_REVIEW_LEARNING_COORDINATOR_INTEGRATION === '1' ? test : test.skip;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/** A small PostgREST-shaped client that preserves update CAS semantics. */
class InMemorySupabase {
    constructor({ proposal, submissions, audits, rules }) {
        this.proposal = clone(proposal);
        this.submissions = clone(submissions);
        this.audits = clone(audits);
        this.rules = clone(rules);
        this.calls = [];
        this.casWrites = [];
    }

    from(table) {
        return new InMemoryQuery(this, table);
    }
}

class InMemoryQuery {
    constructor(client, table) {
        this.client = client;
        this.table = table;
        this.filters = [];
        this.orders = [];
        this.limitValue = null;
        this.updatePayload = null;
        this.orExpression = null;
        this.selectColumns = null;
    }

    select(columns) { this.selectColumns = columns; return this; }
    update(payload) { this.updatePayload = clone(payload); return this; }
    eq(field, value) { this.filters.push({ type: 'eq', field, value }); return this; }
    is(field, value) { this.filters.push({ type: 'is', field, value }); return this; }
    lte(field, value) { this.filters.push({ type: 'lte', field, value }); return this; }
    order(field, options = {}) { this.orders.push({ field, ascending: options.ascending !== false }); return this; }
    limit(value) { this.limitValue = value; return this; }
    or(expression) { this.orExpression = expression; return this; }

    async single() {
        const result = await this.execute();
        if (result.error) return result;
        if (result.data.length !== 1) return { data: null, error: { message: `expected one ${this.table} row` } };
        return { data: result.data[0], error: null };
    }

    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }

    async execute() {
        if (this.updatePayload) return this.executeUpdate();
        this.client.calls.push({ table: this.table, operation: 'select', filters: clone(this.filters), or: this.orExpression, columns: this.selectColumns });
        let rows = this.rows().filter((row) => this.matches(row));
        for (const order of this.orders) {
            rows = rows.slice().sort((a, b) => {
                const left = `${a?.[order.field] ?? ''}`;
                const right = `${b?.[order.field] ?? ''}`;
                return (left.localeCompare(right)) * (order.ascending ? 1 : -1);
            });
        }
        if (this.limitValue != null) rows = rows.slice(0, this.limitValue);
        return { data: clone(rows), error: null };
    }

    async executeUpdate() {
        const current = this.client.proposal;
        const matches = this.matches(current);
        const evalFilter = this.filters.find((filter) => filter.field === 'eval_summary');
        this.client.casWrites.push({
            table: this.table,
            filters: clone(this.filters),
            beforeStatus: current.status,
            beforeEvalSummary: clone(current.eval_summary),
            exactEvalSummaryCas: typeof evalFilter?.value === 'string' && evalFilter.value === JSON.stringify(current.eval_summary),
        });
        if (!matches) return { data: [], error: null };
        this.client.proposal = { ...current, ...clone(this.updatePayload) };
        return { data: [{ id: current.id }], error: null };
    }

    rows() {
        if (this.table === 'prompt_proposals') return [this.client.proposal];
        if (this.table === 'submissions') return this.client.submissions;
        if (this.table === 'basic_ai_check_audits') return this.client.audits;
        if (this.table === 'correction_rules') return this.client.rules;
        return [];
    }

    matches(row) {
        return this.filters.every((filter) => {
            const value = row?.[filter.field];
            if (filter.type === 'eq') {
                if (filter.field === 'eval_summary' && typeof filter.value === 'string') return filter.value === JSON.stringify(value);
                return `${value ?? ''}` === `${filter.value ?? ''}`;
            }
            if (filter.type === 'is') return filter.value === null ? value == null : value === filter.value;
            if (filter.type === 'lte') return Date.parse(`${value}`) <= Date.parse(`${filter.value}`);
            return true;
        });
    }
}

function makeBehavior() {
    const body = {
        schemaVersion: 1,
        frozenAt: new Date().toISOString(),
        records: [{
            correctionId: 'c1', submissionId: 'submission-1',
            inputSpan: { text: 'Dish, lemons', start: null, end: null },
            expectedSpan: { text: 'Dish, lemon', start: null, end: null },
            reason: 'Use the approved singular ingredient spelling.',
            expectationAuthority: 'human_explanation',
            provenance: { source: 'human', reviewer: 'test-reviewer' },
            disposition: 'awaiting_behavior_verification',
        }],
        tests: [], contextualTests: [],
    };
    return { ...body, sha256: HASH(JSON.stringify(body)) };
}

function makeProposal() {
    const behavior = makeBehavior();
    return {
        id: `coordinator-m1-${crypto.randomUUID().replace(/-/g, '')}`,
        status: 'pending', created_at: '2026-09-21T12:00:00.000Z', cycle_id: 'cycle-coordinator-m1',
        parent_campaign_sha256: HASH('parent-campaign'),
        current_prompt: 'test-only prompt', proposed_prompt: 'test-only prompt',
        code_recommendations: [{ title: 'Apply the approved singular spelling.' }],
        correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'production:submission-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', source: 'human' }],
        replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', case_id: 'production:submission-1', status: 'replay_mismatch', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' }],
        eval_summary: { replay_retirement_policy_version: loadVerificationModule(path.resolve(__dirname, '../../..')).REPLAY_RETIREMENT_POLICY_VERSION, behavior_tests: behavior },
    };
}

function makePatch() {
    return `diff --git a/services/dashboard/lib/review-context.ts b/services/dashboard/lib/review-context.ts
--- a/services/dashboard/lib/review-context.ts
+++ b/services/dashboard/lib/review-context.ts
@@ -18,7 +18,7 @@ export function reviewContextOptions(context: ReviewContext = {}) {
     return {
-        submissionMode: context.submissionMode || '',
+        submissionMode: typeof context.submissionMode === 'string' ? context.submissionMode.trim() : '',
         revisionSource: context.revisionSource || '',
         property: context.property || '',
         templateType: context.templateType || 'food',
diff --git a/services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts b/services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts
@@ -0,0 +1,2 @@
+const { reviewContextOptions } = require('../lib/review-context');
+test('candidate coordinator repair', () => expect(reviewContextOptions({ submissionMode: ' new ' }).submissionMode).toBe('new'));
`;
}

integration('prepares one owner-bound proposal, applies a synthetic draft, and verifies it through network-none Docker with idempotent resume', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const verification = loadVerificationModule(repoRoot);
    const behavior = makeBehavior();
    const proposal = makeProposal();
    const datasetPath = path.join(repoRoot, 'tmp', `review-learning-coordinator-m1-dataset-${crypto.randomUUID()}.jsonl`);
    const dataset = `${JSON.stringify({ case_id: 'production:submission-1', source: 'production', submission_id: 'submission-1', attempt_id: 'form-attempt-1', audit_id: 'audit-1', raw_input: 'Dish, lemon', ground_truth: 'Dish, lemon', context: {} })}\n`;
    const outputRoot = path.join(repoRoot, 'tmp', 'code-proposals');
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(datasetPath, dataset, { mode: 0o600 });
    const client = new InMemorySupabase({
        proposal,
        submissions: [{ id: 'submission-1', legacy_id: 'submission-1', project_name: 'Coordinator test', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Dish, lemon', form_attempt_id: 'form-attempt-1', allergens: '' }],
        audits: [{ id: 'audit-1', attempt_id: 'form-attempt-1', event_type: 'completed', review_mode: 'full', menu_content_raw: 'Dish, lemon', created_at: '2026-09-21T12:01:00.000Z' }],
        rules: [],
    });
    let prepared;
    let attemptRoot;
    let pendingInventoryPath;
    try {
        const enumeration = { complete: true, pages: 1, cutoff: '2026-09-21T13:00:00.000Z', rows_count: 1, row_ids: [proposal.id], query: { table: 'prompt_proposals', status: 'pending' } };
        const queued = await preparePendingCodeProposalQueue({ proposals: [proposal], enumeration, client, repoRoot, datasetPath, verification, inventoryDirectory: outputRoot, attemptId: `attempt-${crypto.randomUUID().replace(/-/g, '')}` });
        expect(queued.status).toBe('completed');
        expect(queued.providerCalls).toBe(0);
        expect(queued.results).toHaveLength(1);
        prepared = queued.results[0];
        expect(prepared).toMatchObject({ status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0 });
        attemptRoot = prepared.artifactDirectory;
        pendingInventoryPath = path.join(outputRoot, `pending-preparation-inventory-${queued.snapshot.snapshot_sha256}.json`);
        expect(fs.existsSync(path.join(attemptRoot, 'c2b-handoff.json'))).toBe(false);
        expect(fs.readdirSync(path.join(attemptRoot, 'candidate'))).toEqual(['progress.json']);
        expect(JSON.parse(fs.readFileSync(path.join(attemptRoot, 'candidate/progress.json'), 'utf8'))).toMatchObject({ phase: 'analysis', state: 'blocked', reason: 'code_candidate_authorization_required' });

        const liveClaim = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        expect(liveClaim).toMatchObject({ status: 'pending', eval_summary: { code_candidate: { status: 'running', attempt_id: prepared.attemptId, artifact_directory: attemptRoot } } });
        const baselineRoot = path.join(attemptRoot, 'baseline');
        snapshotBaseline(repoRoot, baselineRoot, verification);
        const behaviorModule = require('../lib/learning-behavior-tests');
        const checked = revalidateAttemptArtifacts({ attemptRoot, trustedRoot: outputRoot, metadata: prepared.metadata, proposal: liveClaim, verification, behaviorModule, baselineRoot });
        const scope = deriveDraftScope({ attemptRoot, metadata: prepared.metadata, parentCampaignSha256: proposal.parent_campaign_sha256, proposal: liveClaim, checked });
        const patch = makePatch();
        const attemptId = prepared.attemptId;
        const responseHash = HASH(`synthetic-response:${attemptId}`);
        const draftResult = {
            draft: { summary: 'offline coordinator integration', patch, test_files: ['services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts'], corrections: [{ correction_id: 'c1', case_id: 'production:submission-1', test_name: 'candidate coordinator repair', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon', recommendation_indexes: [0] }] },
            baselineRoot, checked, cases: checked.cases, scope,
            authorizationHash: HASH(`synthetic-auth:${attemptId}`),
            response: { bodySha256: responseHash, requestId: `synthetic:${attemptId}`, model: 'test-only', finishReason: 'stop' },
        };
        let fatalDispatchCalls = 0;
        const fatalDispatch = async () => { fatalDispatchCalls += 1; throw new Error('fatal dispatch must never be called for supplied offline draft'); };
        const imageId = childProcess.execFileSync('docker', ['image', 'inspect', 'menumanager/dev:latest', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
        const lifecycleOptions = { client, store: { recordCodeVerification }, originalProposal: proposal, proposal: liveClaim, repoRoot, attemptRoot, trustedRoot: outputRoot, progressRoot: repoRoot, verification, behaviorModule, baselineRoot, candidateRoot: path.join(attemptRoot, 'candidate'), handoffPath: path.join(attemptRoot, 'c2b-handoff.json'), handoffFile: path.join(attemptRoot, 'c2b-handoff.json'), c2bHandoffFile: path.join(attemptRoot, 'c2b-handoff.json'), metadata: prepared.metadata, imageId, runtimeId: FIXED_RUNTIME_ID, replayPolicyVersion: verification.REPLAY_RETIREMENT_POLICY_VERSION, vocabularySha256: HASH('vocabulary'), expectationsSha256: HASH('expectations'), model: 'test-only', executorTimeoutMs: 150000 };
        const manual = await prepareManualCodeProposalReview({
            ...lifecycleOptions, existingAttempt: prepared, authorization: { stage: 'code-candidate', status: 'active' }, validatedDraftResult: draftResult, dispatchDraft: fatalDispatch,
        });
        expect(manual.status).toBe('ready_for_manual_review');
        expect(manual.providerCalls).toBe(0);
        expect(fatalDispatchCalls).toBe(0);
        expect(manual.lifecycle.status).toBe('verified');
        expect(manual.lifecycle.resumed).toBe(false);
        expect(fs.existsSync(path.join(attemptRoot, 'c2b-handoff.json'))).toBe(true);
        expect(fs.readFileSync(path.join(attemptRoot, 'candidate/services/dashboard/lib/review-context.ts'), 'utf8')).toContain('submissionMode.trim()');
        const verified = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        expect(verified.eval_summary.code_candidate.status).toBe('verified');
        expect(verified.eval_summary.code_verification.status).toBe('passed');
        expect(manual.lifecycle.proofPath).toBe(path.join(attemptRoot, 'verifier/proof.json'));

        const handoff = JSON.parse(fs.readFileSync(path.join(attemptRoot, 'c2b-handoff.json'), 'utf8'));
        const postMetadata = { ...prepared.metadata, authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash, c2b_handoff_sha256: HASH(fs.readFileSync(path.join(attemptRoot, 'c2b-handoff.json'))), baseline_source_sha256: handoff.baseline_source_sha256, candidate_source_sha256: handoff.candidate_source_sha256, draft_patch_sha256: handoff.draft.patch_sha256, draft_content_sha256: handoff.draft.content_sha256, draft_response_sha256: handoff.draft.response_sha256 };
        const attachCount = client.casWrites.length;
        const resumed = await runPostHandoffCodeProposalLifecycle({ ...lifecycleOptions, metadata: postMetadata, proposal: verified, originalProposal: proposal, resume: true, store: { recordCodeVerification: async () => { throw new Error('idempotent resume must not attach twice'); } } });
        expect(resumed.status).toBe('verified');
        expect(resumed.resumed).toBe(true);
        expect(client.casWrites.length).toBe(attachCount);
        expect(client.casWrites.every((write) => write.exactEvalSummaryCas)).toBe(true);
        expect(client.casWrites.length).toBe(3);
        expect(client.calls.filter((call) => call.table === 'submissions')).toHaveLength(1);
        expect(client.calls.filter((call) => call.table === 'basic_ai_check_audits')).toHaveLength(1);
        expect(client.calls.filter((call) => call.table === 'correction_rules')).toHaveLength(1);
        expect(client.casWrites.every((write) => write.beforeStatus === 'pending')).toBe(true);
    } finally {
        if (process.env.KEEP_REVIEW_LEARNING_COORDINATOR_ARTIFACTS !== '1') {
            if (attemptRoot && fs.existsSync(attemptRoot)) fs.rmSync(attemptRoot, { recursive: true, force: true });
            if (pendingInventoryPath && fs.existsSync(pendingInventoryPath)) fs.rmSync(pendingInventoryPath, { force: true });
            if (fs.existsSync(datasetPath)) fs.rmSync(datasetPath, { force: true });
        } else console.error(`preserved coordinator integration artifacts at ${attemptRoot}`);
    }
}, 360000);
