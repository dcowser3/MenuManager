const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const { preparePendingCodeProposalQueue } = require('../../../scripts/lib/code-proposal-preparation-queue');
const { prepareManualCodeProposalReview } = require('../../../scripts/lib/manual-code-proposal-review');
const { bindHistoricalDataset } = require('../../../scripts/lib/code-proposal-preparation');
const { snapshotBaseline, revalidateAttemptArtifacts } = require('../../../scripts/lib/code-proposal-draft');
const { deriveDraftScope } = require('../../../scripts/auto-code-proposal');
const { promptProposalApprovalBlock } = require('../lib/improvement-cycle-core');
const { runPostHandoffCodeProposalLifecycle } = require('../../../scripts/lib/code-proposal-lifecycle');
const { recordCodeVerification, loadVerificationModule } = require('../../../scripts/lib/proposal-verification-store');
const { FIXED_RUNTIME_ID } = require('../../../scripts/lib/code-proposal-docker-launcher');
const { hashBehaviorArtifact } = require('../lib/learning-behavior-tests');

const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
const hashCanonical = (value) => HASH(JSON.stringify(canonical(value)));
const hashFile = (file) => HASH(fs.readFileSync(file));
const dockerImageId = () => childProcess.execFileSync('docker', ['image', 'inspect', 'menumanager/dev:latest', '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }).trim();
const integration = process.env.RUN_REVIEW_LEARNING_COORDINATOR_INTEGRATION === '1' ? test : test.skip;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/** A small PostgREST-shaped client that preserves update CAS semantics. */
class InMemorySupabase {
    constructor({ proposal, proposals, submissions, audits, rules }) {
        this.proposals = clone(proposals || (proposal ? [proposal] : []));
        this.proposal = this.proposals[0] || null;
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
    or(expression) {
        const match = /^id\.eq\.([^,]+),legacy_id\.eq\.([^,]+)$/.exec(`${expression || ''}`);
        if (!match || match[1] !== match[2]) throw new Error(`Unsupported in-memory OR expression: ${expression}`);
        this.orExpression = expression;
        this.orPredicate = { kind: 'submission_alias', value: match[1] };
        return this;
    }

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
        if (this.orders.length) rows = rows.slice().sort((a, b) => {
            for (const order of this.orders) {
                const left = `${a?.[order.field] ?? ''}`;
                const right = `${b?.[order.field] ?? ''}`;
                const comparison = left.localeCompare(right);
                if (comparison) return comparison * (order.ascending ? 1 : -1);
            }
            return 0;
        });
        if (this.limitValue != null) rows = rows.slice(0, this.limitValue);
        return { data: clone(rows), error: null };
    }

    async executeUpdate() {
        const currentIndex = this.client.proposals.findIndex((proposal) => this.matches(proposal));
        const current = currentIndex >= 0 ? this.client.proposals[currentIndex] : this.client.proposal;
        const matches = currentIndex >= 0;
        const evalFilter = this.filters.find((filter) => filter.field === 'eval_summary');
        const boundedEvaluationFilters = this.filters.filter((filter) => filter.field.startsWith('eval_summary->'));
        this.client.casWrites.push({
            table: this.table,
            filters: clone(this.filters),
            beforeStatus: current.status,
            beforeEvalSummary: clone(current.eval_summary),
            exactEvalSummaryCas: typeof evalFilter?.value === 'string' && evalFilter.value === JSON.stringify(current.eval_summary),
            boundedEvaluationCas: !evalFilter && boundedEvaluationFilters.length > 0,
        });
        if (!matches) return { data: [], error: null };
        const updated = { ...current, ...clone(this.updatePayload) };
        this.client.proposals[currentIndex] = updated;
        if (currentIndex === 0) this.client.proposal = updated;
        return { data: [{ id: current.id }], error: null };
    }

    rows() {
        if (this.table === 'prompt_proposals') return this.client.proposals;
        if (this.table === 'submissions') return this.client.submissions;
        if (this.table === 'basic_ai_check_audits') return this.client.audits;
        if (this.table === 'correction_rules') return this.client.rules;
        return [];
    }

    matches(row) {
        const matchesFilters = this.filters.every((filter) => {
            const textSelector = filter.field.includes('->>');
            const pathParts = filter.field.replaceAll('->>', '->').split('->');
            let value = pathParts.reduce((current, part) => current?.[part], row);
            if (textSelector && value != null && typeof value === 'object') value = JSON.stringify(value);
            if (filter.type === 'eq') {
                if (filter.field === 'eval_summary' && typeof filter.value === 'string') return filter.value === JSON.stringify(value);
                return `${value ?? ''}` === `${filter.value ?? ''}`;
            }
            if (filter.type === 'is') return filter.value === null ? value == null : value === filter.value;
            if (filter.type === 'lte') return Date.parse(`${value}`) <= Date.parse(`${filter.value}`);
            return true;
        });
        if (!matchesFilters) return false;
        if (this.orPredicate?.kind === 'submission_alias') {
            return `${row?.id ?? ''}` === this.orPredicate.value || `${row?.legacy_id ?? ''}` === this.orPredicate.value;
        }
        return true;
    }
}

test('InMemorySupabase binds unique submission aliases and rejects absent, ambiguous, or unsupported OR lookups', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'coordinator-or-'));
    const sourcePath = path.join(root, 'source.jsonl');
    const outputPath = path.join(root, 'bound.jsonl');
    const proposal = {
        correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation' }],
        replay_evidence: [{ correction_id: 'c1', submission_id: 'legacy-1' }],
    };
    const submission = {
        id: 'uuid-1', legacy_id: 'legacy-1', project_name: 'OR fixture', property: 'Property',
        template_type: 'food', menu_type: 'standard', service_period: 'Dinner',
        approved_menu_content: 'Dish, lemon', form_attempt_id: 'attempt-1', allergens: '',
    };
    const audit = { id: 'audit-1', attempt_id: 'attempt-1', event_type: 'completed', review_mode: 'full', menu_content_raw: 'Dish, lemons' };
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(sourcePath, `${JSON.stringify({ case_id: 'base', raw_input: 'Base', ground_truth: 'Base', context: {} })}\n`, { mode: 0o600 });
    try {
        const unique = new InMemorySupabase({ proposals: [], submissions: [submission], audits: [audit], rules: [] });
        const bound = await bindHistoricalDataset(unique, proposal, sourcePath, outputPath);
        expect(bound.rows.find((row) => row.case_id === 'production:legacy-1')).toMatchObject({ submission_id: 'legacy-1', audit_id: 'audit-1', raw_input: 'Dish, lemons', ground_truth: 'Dish, lemon' });
        expect(unique.calls.find((call) => call.table === 'submissions').or).toBe('id.eq.legacy-1,legacy_id.eq.legacy-1');

        const absent = new InMemorySupabase({ proposals: [], submissions: [], audits: [audit], rules: [] });
        await expect(bindHistoricalDataset(absent, proposal, sourcePath, path.join(root, 'absent.jsonl'))).rejects.toThrow('missing or ambiguous');

        const ambiguous = new InMemorySupabase({ proposals: [], submissions: [submission, { ...submission, id: 'uuid-2' }], audits: [audit], rules: [] });
        await expect(bindHistoricalDataset(ambiguous, proposal, sourcePath, path.join(root, 'ambiguous.jsonl'))).rejects.toThrow('missing or ambiguous');

        expect(() => new InMemoryQuery(unique, 'submissions').or('status.eq.pending')).toThrow('Unsupported in-memory OR expression');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function makeBehavior() {
    const body = {
        schemaVersion: 1,
        frozenAt: new Date().toISOString(),
        records: [{
            correctionId: 'c1', submissionId: 'submission-1', caseId: 'production:submission-1',
            inputSpan: { text: 'Dish, lemons, olive oil', start: null, end: null },
            expectedSpan: { text: 'Dish, lemon, olive oil', start: null, end: null },
            reason: 'Use the approved singular ingredient spelling.',
            expectationAuthority: 'human_explanation',
            provenance: { source: 'human', reviewer: 'test-reviewer' },
            disposition: 'awaiting_behavior_verification',
        }],
        tests: [], contextualTests: [],
    };
    return { ...body, sha256: hashBehaviorArtifact(body) };
}

function makeCycleBehavior(corrections) {
    const body = {
        schemaVersion: 1,
        frozenAt: new Date().toISOString(),
        records: corrections.map((correction) => ({
            correctionId: correction.correction_id,
            submissionId: correction.submission_id, caseId: correction.case_id,
            inputSpan: { text: correction.original_text, start: null, end: null },
            expectedSpan: { text: correction.corrected_text, start: null, end: null },
            reason: correction.reason,
            expectationAuthority: 'human_explanation',
            provenance: { source: 'human', reviewer: 'test-reviewer' },
            disposition: 'awaiting_behavior_verification',
        })),
        tests: [], contextualTests: [],
    };
    return { ...body, sha256: hashBehaviorArtifact(body) };
}

function makeCycleProposal({ id, cycleId, createdAt, corrections, supersededFromCycleId = null, code = true }) {
    const behavior = makeCycleBehavior(corrections);
    return {
        id, status: 'pending', created_at: createdAt, cycle_id: cycleId,
        superseded_from_cycle_id: supersededFromCycleId,
        parent_campaign_sha256: HASH('parent-campaign-m2'),
        current_prompt: `test-only ${cycleId} prompt`, proposed_prompt: `test-only ${cycleId} prompt`,
        code_recommendations: code ? corrections.filter((correction) => correction.lane === 'code_recommendation').map((correction) => ({ title: correction.title })) : [],
        correction_routing: corrections.map((correction) => ({
            correction_id: correction.correction_id, lane: correction.lane, case_id: correction.case_id,
            original_text: correction.original_text, corrected_text: correction.corrected_text, source: 'human',
            ...(correction.replay_status ? { replay_status: correction.replay_status } : {}),
        })),
        replay_evidence: corrections.map((correction) => ({
            correction_id: correction.correction_id, submission_id: correction.submission_id, case_id: correction.case_id,
            audit_id: correction.audit_id, attempt_id: correction.attempt_id,
            status: correction.replay_status || 'replay_mismatch', original_text: correction.original_text, corrected_text: correction.corrected_text,
        })),
        eval_summary: { replay_retirement_policy_version: loadVerificationModule(path.resolve(__dirname, '../../..')).REPLAY_RETIREMENT_POLICY_VERSION, behavior_tests: behavior },
    };
}

function makeCyclePatch(cycle) {
    if (cycle === 1) return `diff --git a/services/dashboard/lib/pre-ai-deterministic-rules.ts b/services/dashboard/lib/pre-ai-deterministic-rules.ts
--- a/services/dashboard/lib/pre-ai-deterministic-rules.ts
+++ b/services/dashboard/lib/pre-ai-deterministic-rules.ts
@@ -579,4 +579,5 @@ const CONSERVATIVE_SINGULAR_INGREDIENT_PATTERNS: SingularIngredientPattern[] = [
     { pattern: /(,\\s*)(jalapeños)(?=\\s*,)/giu, corrected: 'jalapeño' },
     { pattern: /(,\\s*)(prawns)(?=\\s*,)/giu, corrected: 'prawn' },
+    { pattern: /(,\\s*)(lemons)(?=\\s*,)/giu, corrected: 'lemon' },
     { pattern: /(,\\s*)(pickles)(?=\\s*,)/giu, corrected: 'pickle' },
 ];
diff --git a/services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts b/services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts
@@ -0,0 +1,2 @@
+const { runPreAiDeterministicChecks } = require('../lib/pre-ai-deterministic-rules');
+test('cycle 1 singularizes lemons', () => expect(runPreAiDeterministicChecks('Dish, lemons, olive oil 18').menuText).toBe('Dish, lemon, olive oil 18'));
`;
    return `diff --git a/services/dashboard/lib/pre-ai-deterministic-rules.ts b/services/dashboard/lib/pre-ai-deterministic-rules.ts
--- a/services/dashboard/lib/pre-ai-deterministic-rules.ts
+++ b/services/dashboard/lib/pre-ai-deterministic-rules.ts
@@ -579,4 +579,6 @@ const CONSERVATIVE_SINGULAR_INGREDIENT_PATTERNS: SingularIngredientPattern[] = [
     { pattern: /(,\\s*)(jalapeños)(?=\\s*,)/giu, corrected: 'jalapeño' },
     { pattern: /(,\\s*)(prawns)(?=\\s*,)/giu, corrected: 'prawn' },
+    { pattern: /(,\\s*)(lemons)(?=\\s*,)/giu, corrected: 'lemon' },
+    { pattern: /(,\\s*)(tomatoes)(?=\\s*,)/giu, corrected: 'tomato' },
     { pattern: /(,\\s*)(pickles)(?=\\s*,)/giu, corrected: 'pickle' },
 ];
diff --git a/services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts b/services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts
@@ -0,0 +1,2 @@
+const { runPreAiDeterministicChecks } = require('../lib/pre-ai-deterministic-rules');
+test('cycle 2 preserves carried lemon singularization', () => expect(runPreAiDeterministicChecks('Dish, lemons, olive oil 18').menuText).toBe('Dish, lemon, olive oil 18'));
diff --git a/services/dashboard/__tests__/code-candidate-coordinator-m2-c2.test.ts b/services/dashboard/__tests__/code-candidate-coordinator-m2-c2.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-coordinator-m2-c2.test.ts
@@ -0,0 +1,2 @@
+const { runPreAiDeterministicChecks } = require('../lib/pre-ai-deterministic-rules');
+test('cycle 2 singularizes tomatoes', () => expect(runPreAiDeterministicChecks('Sauce, tomatoes, basil 22').menuText).toBe('Sauce, tomato, basil 22'));
`;
}

function makeProposal() {
    const behavior = makeBehavior();
    return {
        id: `coordinator-m1-${crypto.randomUUID().replace(/-/g, '')}`,
        status: 'pending', created_at: '2026-09-21T12:00:00.000Z', cycle_id: 'cycle-coordinator-m1',
        parent_campaign_sha256: HASH('parent-campaign'),
        current_prompt: 'test-only prompt', proposed_prompt: 'test-only prompt',
        code_recommendations: [{ title: 'Apply the approved singular spelling.' }],
        correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'production:submission-1', original_text: 'Dish, lemons, olive oil', corrected_text: 'Dish, lemon, olive oil', source: 'human' }],
        replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', case_id: 'production:submission-1', status: 'replay_mismatch', original_text: 'Dish, lemons, olive oil', corrected_text: 'Dish, lemon, olive oil' }],
        eval_summary: { replay_retirement_policy_version: loadVerificationModule(path.resolve(__dirname, '../../..')).REPLAY_RETIREMENT_POLICY_VERSION, behavior_tests: behavior },
    };
}

function makePatch() {
    return `diff --git a/services/dashboard/lib/pre-ai-deterministic-rules.ts b/services/dashboard/lib/pre-ai-deterministic-rules.ts
--- a/services/dashboard/lib/pre-ai-deterministic-rules.ts
+++ b/services/dashboard/lib/pre-ai-deterministic-rules.ts
@@ -579,4 +579,5 @@ const CONSERVATIVE_SINGULAR_INGREDIENT_PATTERNS: SingularIngredientPattern[] = [
     { pattern: /(,\\s*)(jalapeños)(?=\\s*,)/giu, corrected: 'jalapeño' },
     { pattern: /(,\\s*)(prawns)(?=\\s*,)/giu, corrected: 'prawn' },
+    { pattern: /(,\\s*)(lemons)(?=\\s*,)/giu, corrected: 'lemon' },
     { pattern: /(,\\s*)(pickles)(?=\\s*,)/giu, corrected: 'pickle' },
 ];
diff --git a/services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts b/services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts
@@ -0,0 +1,2 @@
+const { runPreAiDeterministicChecks } = require('../lib/pre-ai-deterministic-rules');
+test('candidate coordinator singularizes lemons', () => expect(runPreAiDeterministicChecks('Dish, lemons, olive oil 18').menuText).toBe('Dish, lemon, olive oil 18'));
`;
}

function makeIneffectivePatch() {
    return `diff --git a/services/dashboard/lib/review-context.ts b/services/dashboard/lib/review-context.ts
--- a/services/dashboard/lib/review-context.ts
+++ b/services/dashboard/lib/review-context.ts
@@ -18,5 +18,5 @@ export function reviewContextOptions(context: ReviewContext = {}) {
     return {
-        submissionMode: context.submissionMode || '',
+        submissionMode: typeof context.submissionMode === 'string' ? context.submissionMode.trim() : '',
         revisionSource: context.revisionSource || '',
         property: context.property || '',
         templateType: context.templateType || 'food',
diff --git a/services/dashboard/__tests__/code-candidate-coordinator-ineffective.test.ts b/services/dashboard/__tests__/code-candidate-coordinator-ineffective.test.ts
new file mode 100644
--- /dev/null
+++ b/services/dashboard/__tests__/code-candidate-coordinator-ineffective.test.ts
@@ -0,0 +1,2 @@
+const { reviewContextOptions } = require('../lib/review-context');
+test('unrelated context normalization', () => expect(reviewContextOptions({ submissionMode: ' new ' }).submissionMode).toBe('new'));
`;
}

integration('prepares one owner-bound proposal, applies a synthetic draft, and verifies it through network-none Docker with idempotent resume', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const verification = loadVerificationModule(repoRoot);
    const behavior = makeBehavior();
    const proposal = makeProposal();
    const datasetPath = path.join(repoRoot, 'tmp', `review-learning-coordinator-m1-dataset-${crypto.randomUUID()}.jsonl`);
    const dataset = `${JSON.stringify({ case_id: 'production:submission-1', source: 'production', submission_id: 'submission-1', attempt_id: 'form-attempt-1', audit_id: 'audit-1', raw_input: 'Dish, lemons, olive oil', ground_truth: 'Dish, lemon, olive oil', context: {} })}\n`;
    const outputRoot = path.join(repoRoot, 'tmp', 'code-proposals');
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(datasetPath, dataset, { mode: 0o600 });
    const client = new InMemorySupabase({
        proposal,
        submissions: [{ id: 'submission-1', legacy_id: 'submission-1', project_name: 'Coordinator test', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Dish, lemon, olive oil', form_attempt_id: 'form-attempt-1', allergens: '' }],
        audits: [{ id: 'audit-1', attempt_id: 'form-attempt-1', event_type: 'completed', review_mode: 'full', menu_content_raw: 'Dish, lemons, olive oil', created_at: '2026-09-21T12:01:00.000Z' }],
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
            draft: { summary: 'offline coordinator integration', patch, test_files: ['services/dashboard/__tests__/code-candidate-coordinator-m1.test.ts'], corrections: [{ correction_id: 'c1', case_id: 'production:submission-1', test_name: 'candidate coordinator singularizes lemons', original_text: 'Dish, lemons, olive oil', corrected_text: 'Dish, lemon, olive oil', recommendation_indexes: [0] }] },
            baselineRoot, checked, cases: checked.cases, scope,
            authorizationHash: HASH(`synthetic-auth:${attemptId}`),
            response: { bodySha256: responseHash, requestId: `synthetic:${attemptId}`, model: 'test-only', finishReason: 'stop' },
        };
        let fatalDispatchCalls = 0;
        const fatalDispatch = async () => { fatalDispatchCalls += 1; throw new Error('fatal dispatch must never be called for supplied offline draft'); };
        const imageId = dockerImageId();
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
        expect(fs.readFileSync(path.join(attemptRoot, 'candidate/services/dashboard/lib/pre-ai-deterministic-rules.ts'), 'utf8')).toContain("corrected: 'lemon'");
        const verified = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        expect(verified.eval_summary.code_candidate.status).toBe('verified');
        expect(verified.eval_summary.code_verification.status).toBe('passed');
        expect(verified.eval_summary.code_verification.test_only).toBe(true);
        expect(promptProposalApprovalBlock(verified)).toMatchObject({ reason: 'code_verification_failed', error: 'Synthetic model verification is test-only and cannot authorize approval.' });
        expect(manual.lifecycle.proofPath).toBe(path.join(attemptRoot, 'verifier/proof.json'));

        const handoff = JSON.parse(fs.readFileSync(path.join(attemptRoot, 'c2b-handoff.json'), 'utf8'));
        const postMetadata = { ...prepared.metadata, authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash, c2b_handoff_sha256: HASH(fs.readFileSync(path.join(attemptRoot, 'c2b-handoff.json'))), baseline_source_sha256: handoff.baseline_source_sha256, candidate_source_sha256: handoff.candidate_source_sha256, draft_patch_sha256: handoff.draft.patch_sha256, draft_content_sha256: handoff.draft.content_sha256, draft_response_sha256: handoff.draft.response_sha256 };
        const attachCount = client.casWrites.length;
        const resumed = await runPostHandoffCodeProposalLifecycle({ ...lifecycleOptions, metadata: postMetadata, proposal: verified, originalProposal: proposal, resume: true, store: { recordCodeVerification: async () => { throw new Error('idempotent resume must not attach twice'); } } });
        expect(resumed.status).toBe('verified');
        expect(resumed.resumed).toBe(true);
        expect(client.casWrites.length).toBe(attachCount);
        expect(client.casWrites.every((write) => write.boundedEvaluationCas && !write.exactEvalSummaryCas)).toBe(true);
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

integration('refuses a real ineffective candidate before verified attachment', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const verification = loadVerificationModule(repoRoot);
    const behaviorModule = require('../lib/learning-behavior-tests');
    const proposal = makeProposal();
    proposal.id = `coordinator-ineffective-${crypto.randomUUID().replace(/-/g, '')}`;
    proposal.cycle_id = 'cycle-coordinator-ineffective';
    const outputRoot = path.join(repoRoot, 'tmp', 'code-proposals');
    const datasetPath = path.join(repoRoot, 'tmp', `review-learning-coordinator-ineffective-dataset-${crypto.randomUUID()}.jsonl`);
    let attemptRoot;
    let pendingInventoryPath;
    const attachedPatches = [];
    let fatalDispatchCalls = 0;
    const guardedStore = {
        recordCodeVerification: async (...args) => {
            const patch = clone(args[2]);
            attachedPatches.push(patch);
            if (patch.code_candidate?.status === 'verified') throw new Error('verified attachment must not be attempted for an ineffective candidate');
            return recordCodeVerification(...args);
        },
    };
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(datasetPath, `${JSON.stringify({ case_id: 'production:submission-1', source: 'production', submission_id: 'submission-1', attempt_id: 'form-attempt-1', audit_id: 'audit-1', raw_input: 'Dish, lemons, olive oil', ground_truth: 'Dish, lemon, olive oil', context: {} })}\n`, { mode: 0o600 });
    try {
        const enumeration = { complete: true, pages: 1, cutoff: '2026-09-21T13:30:00.000Z', rows_count: 1, row_ids: [proposal.id], query: { table: 'prompt_proposals', status: 'pending' } };
        const client = new InMemorySupabase({
            proposal,
            submissions: [{ id: 'submission-1', legacy_id: 'submission-1', project_name: 'Ineffective candidate', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Dish, lemon, olive oil', form_attempt_id: 'form-attempt-1', allergens: '' }],
            audits: [{ id: 'audit-1', attempt_id: 'form-attempt-1', event_type: 'completed', review_mode: 'full', menu_content_raw: 'Dish, lemons, olive oil', created_at: '2026-09-21T13:30:01.000Z' }],
            rules: [],
        });
        const queued = await preparePendingCodeProposalQueue({ proposals: [proposal], enumeration, client, repoRoot, datasetPath, verification, inventoryDirectory: outputRoot });
        expect(queued.providerCalls).toBe(0);
        const prepared = queued.results[0];
        expect(prepared).toMatchObject({ status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0 });
        attemptRoot = prepared.artifactDirectory;
        pendingInventoryPath = path.join(outputRoot, `pending-preparation-inventory-${queued.snapshot.snapshot_sha256}.json`);
        const liveClaim = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        const baselineRoot = path.join(attemptRoot, 'baseline');
        snapshotBaseline(repoRoot, baselineRoot, verification);
        const checked = revalidateAttemptArtifacts({ attemptRoot, trustedRoot: outputRoot, metadata: prepared.metadata, proposal: liveClaim, verification, behaviorModule, baselineRoot });
        const scope = deriveDraftScope({ attemptRoot, metadata: prepared.metadata, parentCampaignSha256: proposal.parent_campaign_sha256, proposal: liveClaim, checked });
        const draftResult = {
            draft: {
                summary: 'ineffective candidate control',
                patch: makeIneffectivePatch(),
                test_files: ['services/dashboard/__tests__/code-candidate-coordinator-ineffective.test.ts'],
                corrections: [{ correction_id: 'c1', case_id: 'production:submission-1', test_name: 'unrelated context normalization', original_text: 'Dish, lemons, olive oil', corrected_text: 'Dish, lemon, olive oil', recommendation_indexes: [0] }],
            },
            baselineRoot, checked, cases: checked.cases, scope,
            authorizationHash: HASH(`synthetic-auth:${prepared.attemptId}`),
            response: { bodySha256: HASH(`synthetic-response:${prepared.attemptId}`), requestId: `synthetic:${prepared.attemptId}`, model: 'test-only', finishReason: 'stop' },
        };
        const fatalDispatch = async () => { fatalDispatchCalls += 1; throw new Error('fatal dispatch must not run'); };
        const lifecycleOptions = {
            client, store: guardedStore, originalProposal: proposal, proposal: liveClaim, repoRoot, attemptRoot,
            trustedRoot: outputRoot, progressRoot: repoRoot, verification, behaviorModule, baselineRoot,
            candidateRoot: path.join(attemptRoot, 'candidate'), handoffPath: path.join(attemptRoot, 'c2b-handoff.json'),
            handoffFile: path.join(attemptRoot, 'c2b-handoff.json'), c2bHandoffFile: path.join(attemptRoot, 'c2b-handoff.json'),
            metadata: prepared.metadata, imageId: dockerImageId(), runtimeId: FIXED_RUNTIME_ID,
            replayPolicyVersion: verification.REPLAY_RETIREMENT_POLICY_VERSION, vocabularySha256: HASH('vocabulary-ineffective'),
            expectationsSha256: HASH('expectations-ineffective'), model: 'test-only', executorTimeoutMs: 150000,
        };
        await expect(prepareManualCodeProposalReview({
            ...lifecycleOptions, existingAttempt: prepared,
            authorization: { stage: 'code-candidate', status: 'active' },
            validatedDraftResult: draftResult, dispatchDraft: fatalDispatch,
        })).rejects.toThrow('Candidate replay misses correction c1');
        expect(fatalDispatchCalls).toBe(0);
        expect(attachedPatches).toHaveLength(1);
        expect(attachedPatches.every((patch) => patch.code_candidate?.status === 'running')).toBe(true);
        expect(attachedPatches.some((patch) => patch.code_candidate?.status === 'verified' || patch.code_verification)).toBe(false);
        const failedLive = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        expect(failedLive.eval_summary.code_candidate.status).toBe('running');
        expect(failedLive.eval_summary.code_verification).toBeUndefined();
        expect(promptProposalApprovalBlock(failedLive)).toMatchObject({ reason: 'code_verification_required' });
        expect(fs.existsSync(path.join(attemptRoot, 'verifier', 'proof.json'))).toBe(false);
        expect(fs.existsSync(path.join(attemptRoot, 'verifier', 'staged-proof.json'))).toBe(false);
        const failedProgress = JSON.parse(fs.readFileSync(path.join(attemptRoot, 'candidate', 'progress.json'), 'utf8'));
        expect(failedProgress).toMatchObject({ phase: 'verification', state: 'failed', reason: expect.stringContaining('Candidate replay misses correction c1') });
    } finally {
        if (process.env.KEEP_REVIEW_LEARNING_COORDINATOR_ARTIFACTS !== '1') {
            if (attemptRoot && fs.existsSync(attemptRoot)) fs.rmSync(attemptRoot, { recursive: true, force: true });
            if (attemptRoot && fs.existsSync(path.dirname(attemptRoot)) && fs.readdirSync(path.dirname(attemptRoot)).length === 0) fs.rmSync(path.dirname(attemptRoot), { recursive: true, force: true });
            if (pendingInventoryPath && fs.existsSync(pendingInventoryPath)) fs.rmSync(pendingInventoryPath, { force: true });
            if (fs.existsSync(datasetPath)) fs.rmSync(datasetPath, { force: true });
        } else console.error(`preserved ineffective-candidate artifacts at ${attemptRoot || datasetPath}`);
    }
}, 360000);

integration('runs two superseding coordinator cycles from a preconstructed snapshot plus held and non-code proposals with distinct evidence identities', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const verification = loadVerificationModule(repoRoot);
    const behaviorModule = require('../lib/learning-behavior-tests');
    const outputRoot = path.join(repoRoot, 'tmp', 'code-proposals');
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const datasetPath = path.join(repoRoot, 'tmp', `review-learning-coordinator-m2-dataset-${nonce}.jsonl`);
    const evidenceSummaryPath = path.join(repoRoot, 'tmp', `review-learning-coordinator-m2-evidence-${nonce}.json`);
    const c1 = { correction_id: 'c1', lane: 'code_recommendation', case_id: 'production:submission-1', submission_id: 'submission-1', audit_id: 'audit-1', attempt_id: 'form-attempt-m2-1', original_text: 'Dish, lemons, olive oil', corrected_text: 'Dish, lemon, olive oil', title: 'Singularize the bare lemon ingredient.', reason: 'Use the approved singular ingredient spelling.' };
    const c2 = { correction_id: 'c2', lane: 'code_recommendation', case_id: 'production:submission-2', submission_id: 'submission-2', audit_id: 'audit-2', attempt_id: 'form-attempt-m2-2', original_text: 'Sauce, tomatoes, basil', corrected_text: 'Sauce, tomato, basil', title: 'Singularize the bare tomato ingredient.', reason: 'Use the approved singular ingredient spelling.' };
    const c3 = { correction_id: 'c3', lane: 'code_recommendation', case_id: 'production:submission-3', submission_id: 'submission-3', audit_id: 'audit-3', attempt_id: 'form-attempt-m2-3', original_text: 'Fish, salts', corrected_text: 'Fish, salt', title: 'Held delivery correction.', reason: 'Delivery evidence is unavailable.', replay_status: 'delivery_mismatch' };
    const c4 = { correction_id: 'c4', lane: 'prompt', case_id: 'production:submission-4', submission_id: 'submission-4', audit_id: 'audit-4', attempt_id: 'form-attempt-m2-4', original_text: 'Soup, broths', corrected_text: 'Soup, broth', title: 'Prompt-only correction.', reason: 'This correction belongs to the prompt lane.' };
    const cycle1Proposal = makeCycleProposal({ id: `coordinator-m2-cycle1-${nonce}`, cycleId: 'cycle-coordinator-m2-1', createdAt: '2026-09-21T14:00:00.000Z', corrections: [c1] });
    const cycle2Proposal = makeCycleProposal({ id: `coordinator-m2-cycle2-${nonce}`, cycleId: 'cycle-coordinator-m2-2', createdAt: '2026-09-21T14:01:00.000Z', supersededFromCycleId: cycle1Proposal.cycle_id, corrections: [c1, c2] });
    const deliveryProposal = makeCycleProposal({ id: `coordinator-m2-delivery-${nonce}`, cycleId: 'cycle-coordinator-m2-delivery', createdAt: '2026-09-21T14:02:00.000Z', corrections: [c3] });
    const nonCodeProposal = makeCycleProposal({ id: `coordinator-m2-prompt-${nonce}`, cycleId: 'cycle-coordinator-m2-prompt', createdAt: '2026-09-21T14:03:00.000Z', corrections: [c4], code: false });
    const proposals = [cycle1Proposal, cycle2Proposal, deliveryProposal, nonCodeProposal];
    const initialSourceHash = verification.hashCodeImplementation(repoRoot);
    const dataset = `${JSON.stringify({ case_id: c1.case_id, source: 'production', submission_id: c1.submission_id, attempt_id: c1.attempt_id, audit_id: c1.audit_id, raw_input: 'Dish, lemons, olive oil', ground_truth: 'Dish, lemon, olive oil', context: {} })}\n`;
    const client = new InMemorySupabase({
        proposals,
        submissions: [
            { id: c1.submission_id, legacy_id: c1.submission_id, project_name: 'Coordinator cycle 1', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Dish, lemon, olive oil', form_attempt_id: c1.attempt_id, allergens: '' },
            { id: c2.submission_id, legacy_id: c2.submission_id, project_name: 'Coordinator cycle 2', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Sauce, tomato, basil', form_attempt_id: c2.attempt_id, allergens: '' },
            { id: c3.submission_id, legacy_id: c3.submission_id, project_name: 'Coordinator delivery hold', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Fish, salt', form_attempt_id: c3.attempt_id, allergens: '' },
            { id: c4.submission_id, legacy_id: c4.submission_id, project_name: 'Coordinator prompt lane', property: '', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'Soup, broth', form_attempt_id: c4.attempt_id, allergens: '' },
        ],
        audits: [
            { id: c1.audit_id, attempt_id: c1.attempt_id, event_type: 'completed', review_mode: 'full', menu_content_raw: 'Dish, lemons, olive oil', created_at: '2026-09-21T14:00:01.000Z' },
            { id: c2.audit_id, attempt_id: c2.attempt_id, event_type: 'completed', review_mode: 'full', menu_content_raw: 'Sauce, tomatoes, basil', created_at: '2026-09-21T14:01:01.000Z' },
            { id: c3.audit_id, attempt_id: c3.attempt_id, event_type: 'completed', review_mode: 'full', menu_content_raw: 'Fish, salt', created_at: '2026-09-21T14:02:01.000Z' },
            { id: c4.audit_id, attempt_id: c4.attempt_id, event_type: 'completed', review_mode: 'full', menu_content_raw: 'Soup, broth', created_at: '2026-09-21T14:03:01.000Z' },
        ],
        rules: [],
    });
    const attemptRoots = [];
    let outerInventoryPath;
    let fatalDispatchCalls = 0;
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(datasetPath, dataset, { mode: 0o600 });
    const fatalDispatch = async () => { fatalDispatchCalls += 1; throw new Error('fatal dispatch must never be called for supplied offline drafts'); };
    const imageId = dockerImageId();

    const runCycle = async (proposal, prepared, cycle, testFiles, testMappings) => {
        const liveClaim = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        expect(liveClaim).toMatchObject({ status: 'pending', eval_summary: { code_candidate: { status: 'running', attempt_id: prepared.attemptId, artifact_directory: prepared.artifactDirectory } } });
        const attemptRoot = prepared.artifactDirectory;
        attemptRoots.push(attemptRoot);
        const baselineRoot = path.join(attemptRoot, 'baseline');
        snapshotBaseline(repoRoot, baselineRoot, verification);
        const checked = revalidateAttemptArtifacts({ attemptRoot, trustedRoot: outputRoot, metadata: prepared.metadata, proposal: liveClaim, verification, behaviorModule, baselineRoot });
        const scope = deriveDraftScope({ attemptRoot, metadata: prepared.metadata, parentCampaignSha256: proposal.parent_campaign_sha256, proposal: liveClaim, checked });
        const patch = makeCyclePatch(cycle);
        const draftResult = {
            draft: { summary: `offline coordinator cycle ${cycle}`, patch, test_files: testFiles, corrections: testMappings },
            baselineRoot, checked, cases: checked.cases, scope,
            authorizationHash: HASH(`synthetic-auth:${prepared.attemptId}`),
            response: { bodySha256: HASH(`synthetic-response:${prepared.attemptId}`), requestId: `synthetic:${prepared.attemptId}`, model: 'test-only', finishReason: 'stop' },
        };
        const lifecycleOptions = {
            client, store: { recordCodeVerification }, originalProposal: proposal, proposal: liveClaim, repoRoot, attemptRoot,
            trustedRoot: outputRoot, progressRoot: repoRoot, verification, behaviorModule, baselineRoot,
            candidateRoot: path.join(attemptRoot, 'candidate'), handoffPath: path.join(attemptRoot, 'c2b-handoff.json'),
            handoffFile: path.join(attemptRoot, 'c2b-handoff.json'), c2bHandoffFile: path.join(attemptRoot, 'c2b-handoff.json'),
            metadata: prepared.metadata, imageId, runtimeId: FIXED_RUNTIME_ID,
            replayPolicyVersion: verification.REPLAY_RETIREMENT_POLICY_VERSION, vocabularySha256: HASH('vocabulary-m2'),
            expectationsSha256: HASH('expectations-m2'), model: 'test-only', executorTimeoutMs: 150000,
        };
        const manual = await prepareManualCodeProposalReview({ ...lifecycleOptions, existingAttempt: prepared, authorization: { stage: 'code-candidate', status: 'active' }, validatedDraftResult: draftResult, dispatchDraft: fatalDispatch });
        expect(manual.status).toBe('ready_for_manual_review');
        expect(manual.providerCalls).toBe(0);
        expect(manual.lifecycle.status).toBe('verified');
        expect(manual.lifecycle.resumed).toBe(false);
        const handoffPath = path.join(attemptRoot, 'c2b-handoff.json');
        const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
        const verified = (await client.from('prompt_proposals').select('*').eq('id', proposal.id).single()).data;
        const proofPath = path.join(attemptRoot, 'verifier', 'proof.json');
        expect(verified.eval_summary.code_candidate.status).toBe('verified');
        expect(verified.eval_summary.code_verification.status).toBe('passed');
        expect(manual.lifecycle.proofPath).toBe(proofPath);
        const postMetadata = { ...prepared.metadata, authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash, c2b_handoff_sha256: HASH(fs.readFileSync(handoffPath)), baseline_source_sha256: handoff.baseline_source_sha256, candidate_source_sha256: handoff.candidate_source_sha256, draft_patch_sha256: handoff.draft.patch_sha256, draft_content_sha256: handoff.draft.content_sha256, draft_response_sha256: handoff.draft.response_sha256 };
        const attachCount = client.casWrites.length;
        const resumed = await runPostHandoffCodeProposalLifecycle({ ...lifecycleOptions, metadata: postMetadata, proposal: verified, originalProposal: proposal, resume: true, store: { recordCodeVerification: async () => { throw new Error('idempotent resume must not attach twice'); } } });
        expect(resumed.status).toBe('verified');
        expect(resumed.resumed).toBe(true);
        expect(client.casWrites.length).toBe(attachCount);
        return {
            proposal, prepared, attemptRoot, baselineRoot, checked, manual, verified, handoff,
            proofPath, lifecycleOptions, postMetadata,
            handoffPath, stagedProofPath: path.join(attemptRoot, 'verifier', 'staged-proof.json'),
            planPath: path.join(attemptRoot, 'verifier', 'plan.json'),
            baselineReportPath: path.join(attemptRoot, 'verifier', 'baseline-report.json'),
            candidateReportPath: path.join(attemptRoot, 'verifier', 'candidate-report.json'), resume: resumed,
        };
    };

    try {
        const enumeration = { complete: true, pages: 1, cutoff: '2026-09-21T15:00:00.000Z', rows_count: proposals.length, row_ids: proposals.map((proposal) => proposal.id), query: { table: 'prompt_proposals', status: 'pending' } };
        const queued = await preparePendingCodeProposalQueue({ proposals, enumeration, client, repoRoot, datasetPath, verification, inventoryDirectory: outputRoot });
        outerInventoryPath = path.join(outputRoot, `pending-preparation-inventory-${queued.snapshot.snapshot_sha256}.json`);
        expect(queued.status).toBe('completed');
        expect(queued.providerCalls).toBe(0);
        expect(queued.results).toHaveLength(4);
        const [cycle1Prepared, cycle2Prepared, deliveryPrepared, nonCodePrepared] = queued.results;
        expect(cycle1Prepared).toMatchObject({ status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0 });
        expect(cycle2Prepared).toMatchObject({ status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0 });
        expect(deliveryPrepared).toMatchObject({ status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0 });
        expect(nonCodePrepared).toMatchObject({ status: 'blocked', reason: 'no_code_recommendation_groups', providerCalls: 0 });
        expect(cycle2Prepared.inventory.superseded_from_cycle_id).toBe(cycle1Proposal.cycle_id);
        expect(cycle2Prepared.inventory.groups.map((group) => group.correction_id)).toEqual(['c1', 'c2']);
        const cycle2Membership = { carried: cycle2Prepared.inventory.groups.filter((group) => group.correction_id === 'c1').map((group) => group.correction_id), new: cycle2Prepared.inventory.groups.filter((group) => group.correction_id === 'c2').map((group) => group.correction_id) };
        expect(cycle2Membership).toEqual({ carried: ['c1'], new: ['c2'] });
        expect(cycle2Prepared.inventory.groups.find((group) => group.correction_id === 'c1')).toMatchObject({ lane: 'code_recommendation' });
        expect(cycle2Prepared.inventory.groups.find((group) => group.correction_id === 'c2')).toMatchObject({ lane: 'code_recommendation' });
        expect(nonCodePrepared.artifactDirectory).toBeUndefined();
        expect((await client.from('prompt_proposals').select('*').eq('id', nonCodeProposal.id).single()).data.eval_summary.code_candidate).toBeUndefined();

        const cycle1 = await runCycle(cycle1Proposal, cycle1Prepared, 1, ['services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts'], [{ correction_id: 'c1', case_id: c1.case_id, test_name: 'cycle 1 singularizes lemons', original_text: c1.original_text, corrected_text: c1.corrected_text, recommendation_indexes: [0] }]);
        const cycle1ProofBeforeCycle2 = clone(cycle1.verified.eval_summary.code_verification);
        const cycle2 = await runCycle(cycle2Proposal, cycle2Prepared, 2, ['services/dashboard/__tests__/code-candidate-coordinator-m2-c1.test.ts', 'services/dashboard/__tests__/code-candidate-coordinator-m2-c2.test.ts'], [
            { correction_id: 'c1', case_id: c1.case_id, test_name: 'cycle 2 preserves carried lemon singularization', original_text: c1.original_text, corrected_text: c1.corrected_text, recommendation_indexes: [0] },
            { correction_id: 'c2', case_id: c2.case_id, test_name: 'cycle 2 singularizes tomatoes', original_text: c2.original_text, corrected_text: c2.corrected_text, recommendation_indexes: [1] },
        ]);
        const cycle1AfterCycle2 = (await client.from('prompt_proposals').select('*').eq('id', cycle1Proposal.id).single()).data;
        expect(cycle1AfterCycle2.eval_summary.code_verification).toEqual(cycle1ProofBeforeCycle2);
        expect(cycle1.verified.id).not.toBe(cycle2.verified.id);
        expect(cycle1.prepared.attemptId).not.toBe(cycle2.prepared.attemptId);
        expect(cycle1.attemptRoot).not.toBe(cycle2.attemptRoot);
        expect(cycle1.handoff.candidate_source_sha256).not.toBe(cycle2.handoff.candidate_source_sha256);
        expect(cycle1.handoff.baseline_source_sha256).toBe(initialSourceHash);
        expect(cycle2.handoff.baseline_source_sha256).toBe(initialSourceHash);
        expect(cycle2.handoff.baseline_source_sha256).not.toBe(cycle1.handoff.candidate_source_sha256);
        expect(fs.readFileSync(path.join(cycle2.baselineRoot, 'services/dashboard/lib/pre-ai-deterministic-rules.ts'), 'utf8')).not.toContain("corrected: 'lemon'");
        expect(verification.assessCodeProposalVerificationIntegrity(cycle1.verified)).toBeNull();
        expect(verification.assessCodeProposalVerificationIntegrity(cycle2.verified)).toBeNull();
        expect(cycle1.verified.eval_summary.code_verification.test_only).toBe(true);
        expect(cycle2.verified.eval_summary.code_verification.test_only).toBe(true);
        const substituted = clone(cycle2.verified);
        substituted.eval_summary.code_verification = cycle1ProofBeforeCycle2;
        expect(verification.assessCodeProposalVerificationIntegrity(substituted)).not.toBeNull();
        const ineffectiveProofControl = clone(cycle2.verified);
        ineffectiveProofControl.eval_summary.code_verification.runs[0].corrections[0].candidate_output = ineffectiveProofControl.eval_summary.code_verification.runs[0].corrections[0].baseline_output;
        const ineffectiveProofControlBlock = verification.assessCodeProposalVerificationIntegrity(ineffectiveProofControl);
        expect(ineffectiveProofControlBlock).toMatchObject({ reason: 'code_verification_failed', error: expect.stringContaining('Candidate replay still misses correction') });
        expect(promptProposalApprovalBlock(ineffectiveProofControl)).toMatchObject({ reason: 'code_verification_failed', error: expect.stringContaining('Candidate replay still misses correction') });
        expect(promptProposalApprovalBlock(cycle1.verified)).toMatchObject({ reason: 'code_verification_failed', error: 'Synthetic model verification is test-only and cannot authorize approval.' });
        expect(promptProposalApprovalBlock(cycle2.verified)).toMatchObject({ reason: 'code_verification_failed', error: 'Synthetic model verification is test-only and cannot authorize approval.' });

        // Milestone 3 exercises the real lifecycle's store-rejection and crash
        // recovery boundaries using cycle 1's proof, without another Docker
        // invocation. Keep the exact successful bytes so the final summary is
        // still evidence for the successful cycle rather than the negatives.
        const cycle1Index = client.proposals.findIndex((proposal) => proposal.id === cycle1Proposal.id);
        const cycle1LiveOriginal = clone(client.proposals[cycle1Index]);
        const cycle1LiveOriginalBytes = Buffer.from(JSON.stringify(cycle1LiveOriginal));
        const cycle1ProgressPath = path.join(cycle1.attemptRoot, 'candidate', 'progress.json');
        const cycle1ProofPath = cycle1.proofPath;
        const cycle1ProgressOriginalBytes = fs.readFileSync(cycle1ProgressPath);
        const cycle1ProofOriginalBytes = fs.readFileSync(cycle1ProofPath);
        const cycle1StagedOriginalExists = fs.existsSync(cycle1.stagedProofPath);
        expect(cycle1StagedOriginalExists).toBe(true);
        const cycle1StagedOriginalBytes = cycle1StagedOriginalExists ? fs.readFileSync(cycle1.stagedProofPath) : null;
        const stagedEnvelope = JSON.parse(cycle1StagedOriginalBytes.toString('utf8'));
        expect(stagedEnvelope).toEqual({ staged_status: 'pending_store', proof: cycle1ProofBeforeCycle2 });
        expect(fs.lstatSync(cycle1.stagedProofPath).mode & 0o777).toBe(0o600);
        const setCycle1Stored = (value) => {
            client.proposals[cycle1Index] = clone(value);
            if (cycle1Index === 0) client.proposal = client.proposals[cycle1Index];
        };
        const writeExact = (file, bytes) => {
            fs.writeFileSync(file, bytes, { mode: 0o600 });
            fs.chmodSync(file, 0o600);
        };
        const setBlockedProgress = (reason) => {
            const progress = JSON.parse(cycle1ProgressOriginalBytes.toString('utf8'));
            delete progress.proof_path;
            progress.phase = 'verification';
            progress.state = 'blocked';
            progress.reason = reason;
            progress.updated_at = new Date().toISOString();
            writeExact(cycle1ProgressPath, `${JSON.stringify(progress, null, 2)}\n`);
        };
        const restoreCycle1Exact = () => {
            setCycle1Stored(cycle1LiveOriginal);
            writeExact(cycle1ProgressPath, cycle1ProgressOriginalBytes);
            writeExact(cycle1ProofPath, cycle1ProofOriginalBytes);
            if (cycle1StagedOriginalExists) writeExact(cycle1.stagedProofPath, cycle1StagedOriginalBytes);
            else fs.rmSync(cycle1.stagedProofPath, { force: true });
        };
        let recoveryEvidence;
        try {
            const { code_verification: ignoredProof, ...runningEvalSummary } = cycle1LiveOriginal.eval_summary;
            const runningClaim = {
                ...cycle1LiveOriginal,
                eval_summary: {
                    ...runningEvalSummary,
                    code_candidate: { ...cycle1LiveOriginal.eval_summary.code_candidate, status: 'running', phase: 'verification' },
                },
            };
            setCycle1Stored(runningClaim);
            fs.rmSync(cycle1ProofPath, { force: true });
            setBlockedProgress('awaiting_store');
            let rejectedStoreCalls = 0;
            await expect(runPostHandoffCodeProposalLifecycle({
                ...cycle1.lifecycleOptions,
                metadata: cycle1.postMetadata,
                proposal: runningClaim,
                originalProposal: cycle1.proposal,
                resume: true,
                store: { recordCodeVerification: async () => { rejectedStoreCalls += 1; throw new Error('synthetic store rejection'); } },
            })).rejects.toThrow('synthetic store rejection');
            expect(rejectedStoreCalls).toBe(1);
            const rejectedProgress = JSON.parse(fs.readFileSync(cycle1ProgressPath, 'utf8'));
            expect(rejectedProgress).toMatchObject({ phase: 'verification', state: 'blocked', reason: 'store_rejected' });
            expect(fs.existsSync(cycle1ProofPath)).toBe(false);
            const rejectedLive = (await client.from('prompt_proposals').select('*').eq('id', cycle1Proposal.id).single()).data;
            expect(rejectedLive.eval_summary.code_candidate).toMatchObject({ status: 'running', phase: 'verification', attempt_id: cycle1.prepared.attemptId });
            expect(rejectedLive.eval_summary.code_verification).toBeUndefined();
            recoveryEvidence = {
                store_rejection: { store_calls: rejectedStoreCalls, progress_state: rejectedProgress.state, progress_reason: rejectedProgress.reason, final_proof: false, live_status: rejectedLive.eval_summary.code_candidate.status },
            };

            const liveVerifiedWithStagedProof = clone(cycle1LiveOriginal);
            liveVerifiedWithStagedProof.eval_summary.code_verification = clone(stagedEnvelope.proof);
            setCycle1Stored(liveVerifiedWithStagedProof);
            let recoveryStoreCalls = 0;
            let recoveryFatalExecutorCalls = 0;
            const recovered = await runPostHandoffCodeProposalLifecycle({
                ...cycle1.lifecycleOptions,
                metadata: cycle1.postMetadata,
                proposal: liveVerifiedWithStagedProof,
                originalProposal: cycle1.proposal,
                resume: true,
                executor: async () => { recoveryFatalExecutorCalls += 1; throw new Error('fatal verifier path must not run'); },
                store: { recordCodeVerification: async () => { recoveryStoreCalls += 1; throw new Error('fatal attachment path must not run'); } },
            });
            expect(recovered).toMatchObject({ status: 'verified', resumed: true, proofPath: cycle1ProofPath });
            expect(recoveryStoreCalls).toBe(0);
            expect(recoveryFatalExecutorCalls).toBe(0);
            expect(JSON.parse(fs.readFileSync(cycle1ProofPath, 'utf8'))).toEqual(stagedEnvelope.proof);
            expect(fs.readFileSync(cycle1ProofPath)).toEqual(cycle1ProofOriginalBytes);
            expect(JSON.parse(fs.readFileSync(cycle1ProgressPath, 'utf8'))).toMatchObject({ phase: 'verification', state: 'verified', proof_path: cycle1ProofPath });
            const recoveredLive = (await client.from('prompt_proposals').select('*').eq('id', cycle1Proposal.id).single()).data;
            expect(recoveredLive.eval_summary.code_candidate.status).toBe('verified');
            expect(recoveredLive.eval_summary.code_verification).toEqual(stagedEnvelope.proof);
            recoveryEvidence.crash_recovery = { store_calls: recoveryStoreCalls, verifier_calls: recoveryFatalExecutorCalls, progress_state: 'verified', proof_sha256: hashFile(cycle1ProofPath) };

            fs.rmSync(cycle1ProofPath, { force: true });
            setBlockedProgress('awaiting_recovery');
            const tamperedEnvelope = clone(stagedEnvelope);
            tamperedEnvelope.proof.runs[0].corrections[0].candidate_output = tamperedEnvelope.proof.runs[0].corrections[0].baseline_output;
            writeExact(cycle1.stagedProofPath, `${JSON.stringify(tamperedEnvelope, null, 2)}\n`);
            let tamperedStoreCalls = 0;
            await expect(runPostHandoffCodeProposalLifecycle({
                ...cycle1.lifecycleOptions,
                metadata: cycle1.postMetadata,
                proposal: liveVerifiedWithStagedProof,
                originalProposal: cycle1.proposal,
                resume: true,
                store: { recordCodeVerification: async () => { tamperedStoreCalls += 1; throw new Error('tampered attachment must not run'); } },
            })).rejects.toThrow('staged proof failed integrity');
            expect(tamperedStoreCalls).toBe(0);
            expect(fs.existsSync(cycle1ProofPath)).toBe(false);
            expect(JSON.parse(fs.readFileSync(cycle1ProgressPath, 'utf8'))).toMatchObject({ phase: 'verification', state: 'blocked' });
            recoveryEvidence.tampered_staged_proof = { store_calls: tamperedStoreCalls, final_proof: false, rejected: true };

            const crossCycleEnvelope = { staged_status: 'pending_store', proof: clone(cycle2.verified.eval_summary.code_verification) };
            writeExact(cycle1.stagedProofPath, `${JSON.stringify(crossCycleEnvelope, null, 2)}\n`);
            let crossCycleStoreCalls = 0;
            await expect(runPostHandoffCodeProposalLifecycle({
                ...cycle1.lifecycleOptions,
                metadata: cycle1.postMetadata,
                proposal: liveVerifiedWithStagedProof,
                originalProposal: cycle1.proposal,
                resume: true,
                store: { recordCodeVerification: async () => { crossCycleStoreCalls += 1; throw new Error('cross-cycle attachment must not run'); } },
            })).rejects.toThrow(/staged proof identity|staged proof failed integrity/);
            expect(crossCycleStoreCalls).toBe(0);
            expect(fs.existsSync(cycle1ProofPath)).toBe(false);
            expect(JSON.parse(fs.readFileSync(cycle1ProgressPath, 'utf8'))).toMatchObject({ phase: 'verification', state: 'blocked' });
            recoveryEvidence.cross_cycle_staged_proof = { store_calls: crossCycleStoreCalls, final_proof: false, rejected: true };

            restoreCycle1Exact();
            const newerAttemptId = `newer-${nonce}`;
            const newerClaim = { ...cycle1LiveOriginal.eval_summary.code_candidate, attempt_id: newerAttemptId, status: 'running', phase: 'analysis', started_at: new Date().toISOString() };
            const newerProposal = clone(cycle1LiveOriginal);
            const { code_verification: ignoredNewerProof, ...newerEvalSummary } = newerProposal.eval_summary;
            newerProposal.eval_summary = { ...newerEvalSummary, code_candidate: newerClaim };
            setCycle1Stored(newerProposal);
            await expect(recordCodeVerification(client, cycle1LiveOriginal, {
                attempt_id: cycle1LiveOriginal.eval_summary.code_candidate.attempt_id,
                code_candidate: { ...cycle1LiveOriginal.eval_summary.code_candidate, status: 'verified' },
                code_verification: cycle1ProofBeforeCycle2,
            }, verification)).rejects.toThrow(/ownership|attempt|changed|pending/);
            const staleOwnerLive = (await client.from('prompt_proposals').select('*').eq('id', cycle1Proposal.id).single()).data;
            expect(staleOwnerLive.eval_summary.code_candidate.attempt_id).toBe(newerAttemptId);
            expect(staleOwnerLive.eval_summary.code_candidate.status).toBe('running');
            recoveryEvidence.stale_owner = { old_attempt_id: cycle1LiveOriginal.eval_summary.code_candidate.attempt_id, newer_attempt_id: newerAttemptId, overwrite: false };
        } finally {
            restoreCycle1Exact();
        }
        expect(client.proposals[cycle1Index]).toEqual(cycle1LiveOriginal);
        expect(Buffer.from(JSON.stringify(client.proposals[cycle1Index]))).toEqual(cycle1LiveOriginalBytes);
        expect(fs.readFileSync(cycle1ProgressPath)).toEqual(cycle1ProgressOriginalBytes);
        expect(fs.readFileSync(cycle1ProofPath)).toEqual(cycle1ProofOriginalBytes);
        expect(fs.existsSync(cycle1.stagedProofPath)).toBe(cycle1StagedOriginalExists);
        if (cycle1StagedOriginalExists) expect(fs.readFileSync(cycle1.stagedProofPath)).toEqual(cycle1StagedOriginalBytes);

        const deliveryAttemptRoot = deliveryPrepared.artifactDirectory;
        attemptRoots.push(deliveryAttemptRoot);
        const deliveryCasCount = client.casWrites.length;
        const heldManual = await prepareManualCodeProposalReview({ client, proposal: (await client.from('prompt_proposals').select('*').eq('id', deliveryProposal.id).single()).data, existingAttempt: deliveryPrepared, authorization: { stage: 'code-candidate', status: 'active' }, dispatchDraft: fatalDispatch });
        expect(heldManual).toMatchObject({ status: 'ready_for_manual_review', reason: 'delivery_verification_required', providerCalls: 0 });
        expect(client.casWrites.length).toBe(deliveryCasCount);
        expect(fs.existsSync(path.join(deliveryAttemptRoot, 'c2b-handoff.json'))).toBe(false);
        expect(fs.existsSync(path.join(deliveryAttemptRoot, 'verifier'))).toBe(false);
        expect(nonCodePrepared.providerCalls).toBe(0);
        expect(fatalDispatchCalls).toBe(0);

        const cycleFiles = [
            { name: 'outer_inventory', path: outerInventoryPath },
            { name: 'cycle1_preparation_inventory', path: path.join(cycle1.attemptRoot, 'preparation-inventory.json') },
            { name: 'cycle1_handoff', path: path.join(cycle1.attemptRoot, 'c2b-handoff.json') },
            { name: 'cycle1_plan', path: cycle1.planPath },
            { name: 'cycle1_baseline_report', path: cycle1.baselineReportPath },
            { name: 'cycle1_candidate_report', path: cycle1.candidateReportPath },
            { name: 'cycle1_proof', path: cycle1.proofPath },
            { name: 'cycle1_staged_proof', path: cycle1.stagedProofPath },
            { name: 'cycle2_preparation_inventory', path: path.join(cycle2.attemptRoot, 'preparation-inventory.json') },
            { name: 'cycle2_handoff', path: path.join(cycle2.attemptRoot, 'c2b-handoff.json') },
            { name: 'cycle2_plan', path: cycle2.planPath },
            { name: 'cycle2_baseline_report', path: cycle2.baselineReportPath },
            { name: 'cycle2_candidate_report', path: cycle2.candidateReportPath },
            { name: 'cycle2_proof', path: cycle2.proofPath },
        ].map((entry) => ({ ...entry, sha256: hashFile(entry.path) }));
        const cycleFileHash = (name) => cycleFiles.find((entry) => entry.name === name).sha256;
        const identityHashes = ['cycle1_plan', 'cycle2_plan', 'cycle1_baseline_report', 'cycle2_baseline_report', 'cycle1_candidate_report', 'cycle2_candidate_report', 'cycle1_proof', 'cycle2_proof'].map(cycleFileHash);
        expect(new Set(identityHashes).size).toBe(identityHashes.length);
        expect(client.casWrites.length).toBe(7);
        expect(client.casWrites.every((write) => write.boundedEvaluationCas && !write.exactEvalSummaryCas && write.beforeStatus === 'pending')).toBe(true);
        const summaryBody = {
            schema_version: 1,
            kind: 'review-learning-coordinator-m2-evidence',
            test_only: true,
            git_head: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            composer_source_sha256: hashFile(__filename),
            outer_snapshot: { source: 'preconstructed_test_enumeration', snapshot_sha256: queued.snapshot.snapshot_sha256, rows_count: queued.snapshot.enumeration.count, file: outerInventoryPath, file_sha256: cycleFileHash('outer_inventory') },
            proposals: [cycle1, cycle2].map((cycle) => ({ id: cycle.proposal.id, cycle_id: cycle.proposal.cycle_id, superseded_from_cycle_id: cycle.proposal.superseded_from_cycle_id || null, proposal_sha256: cycle.prepared.metadata.proposal_sha256, attempt_id: cycle.prepared.attemptId, artifact_directory: cycle.attemptRoot, baseline_source_sha256: cycle.handoff.baseline_source_sha256, candidate_source_sha256: cycle.handoff.candidate_source_sha256, plan_path: cycle.planPath, plan_sha256: cycleFileHash(`cycle${cycle.proposal.cycle_id.endsWith('-1') ? 1 : 2}_plan`), baseline_report_sha256: cycleFileHash(`cycle${cycle.proposal.cycle_id.endsWith('-1') ? 1 : 2}_baseline_report`), candidate_report_sha256: cycleFileHash(`cycle${cycle.proposal.cycle_id.endsWith('-1') ? 1 : 2}_candidate_report`), proof_path: cycle.proofPath, proof_sha256: cycleFileHash(`cycle${cycle.proposal.cycle_id.endsWith('-1') ? 1 : 2}_proof`), test_only: cycle.verified.eval_summary.code_verification.test_only })),
            inventory_membership: { carried: cycle2Membership.carried, new: cycle2Membership.new, superseded_from_cycle_id: cycle2Proposal.superseded_from_cycle_id },
            ineffective_proof_control: { accepted: false, reason: ineffectiveProofControlBlock.reason, error: ineffectiveProofControlBlock.error },
            recovery_negatives: recoveryEvidence,
            transitions: [
                { proposal_id: cycle1.proposal.id, cycle_id: cycle1.proposal.cycle_id, queue: 'blocked/code_candidate_authorization_required', manual: 'ready_for_manual_review', lifecycle: 'verified', resume: 'verified/resumed' },
                { proposal_id: cycle2.proposal.id, cycle_id: cycle2.proposal.cycle_id, queue: 'blocked/code_candidate_authorization_required', manual: 'ready_for_manual_review', lifecycle: 'verified', resume: 'verified/resumed' },
            ],
            held_disposition: { proposal_id: deliveryProposal.id, cycle_id: deliveryProposal.cycle_id, queue: deliveryPrepared.reason, manual: heldManual.reason, handoff: false, proof: false },
            non_code_disposition: { proposal_id: nonCodeProposal.id, cycle_id: nonCodeProposal.cycle_id, queue: nonCodePrepared.reason, owner: false, provider_calls: nonCodePrepared.providerCalls },
            zero_call_counters: { outer_provider_calls: queued.providerCalls, cycle1_provider_calls: cycle1.manual.providerCalls, cycle2_provider_calls: cycle2.manual.providerCalls, held_provider_calls: heldManual.providerCalls, fatal_dispatch_calls: fatalDispatchCalls, cas_writes: client.casWrites.length },
            named_files: cycleFiles,
        };
        const evidenceSummary = { ...summaryBody, summary_sha256: hashCanonical(summaryBody) };
        fs.writeFileSync(evidenceSummaryPath, `${JSON.stringify(evidenceSummary, null, 2)}\n`, { mode: 0o600 });
        fs.chmodSync(evidenceSummaryPath, 0o600);
        expect(fs.statSync(evidenceSummaryPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(evidenceSummaryPath).size).toBeLessThan(1024 * 1024);
        const reopened = JSON.parse(fs.readFileSync(evidenceSummaryPath, 'utf8'));
        const { summary_sha256: reopenedSummaryHash, ...reopenedBody } = reopened;
        expect(reopenedSummaryHash).toBe(hashCanonical(reopenedBody));
        for (const entry of reopened.named_files) expect(hashFile(entry.path)).toBe(entry.sha256);
        expect(reopened.outer_snapshot.snapshot_sha256).toBe(queued.snapshot.snapshot_sha256);
        expect(fatalDispatchCalls).toBe(0);
    } finally {
        if (process.env.KEEP_REVIEW_LEARNING_COORDINATOR_ARTIFACTS !== '1') {
            for (const target of [...new Set([...attemptRoots, ...attemptRoots.map((attemptRoot) => path.dirname(attemptRoot))])]) if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
            if (outerInventoryPath && fs.existsSync(outerInventoryPath)) fs.rmSync(outerInventoryPath, { force: true });
            if (fs.existsSync(datasetPath)) fs.rmSync(datasetPath, { force: true });
            if (fs.existsSync(evidenceSummaryPath)) fs.rmSync(evidenceSummaryPath, { force: true });
        } else console.error(`preserved coordinator milestone-2/3 artifacts at ${evidenceSummaryPath}`);
    }
}, 600000);
