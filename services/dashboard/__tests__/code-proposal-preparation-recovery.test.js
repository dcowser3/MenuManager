'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { prepareCodeProposalAttempt } = require('../../../scripts/lib/code-proposal-preparation');
const { buildPreparationInventory, prepareCodeProposalQueue } = require('../../../scripts/lib/code-proposal-preparation-queue');
const { recordCodeVerification } = require('../../../scripts/lib/proposal-verification-store');
const { hashBehaviorArtifact } = require('../lib/learning-behavior-tests');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readJsonPath(row, field) {
    const textMarker = field.indexOf('->>');
    const pathText = textMarker >= 0 ? field.slice(0, textMarker) : field;
    const key = textMarker >= 0 ? field.slice(textMarker + 3) : null;
    let value = pathText.split('->').reduce((current, part) => current == null ? null : current[part], row);
    if (key !== null) value = value == null ? null : value[key];
    if (textMarker >= 0 && value != null && typeof value !== 'string') return JSON.stringify(value);
    return value;
}

function clientState() {
    const state = { proposal: null, writes: 0, beforeUpdate: null };
    const client = { from(table) {
        const filters = [];
        const query = {
            select: () => query,
            update: (patch) => { query.patch = patch; return query; },
            eq: (field, value) => { filters.push({ kind: 'eq', field, value }); return query; },
            is: (field, value) => { filters.push({ kind: 'is', field, value }); return query; },
            order: () => query,
            or: () => query,
            then(resolve) {
                if (table === 'correction_rules') return Promise.resolve({ data: [] }).then(resolve);
                if (table === 'submissions') return Promise.resolve({ data: [{ id: 'submission-1', legacy_id: 'legacy-1', project_name: 'Project', property: 'Property', template_type: 'food', menu_type: 'standard', service_period: 'Dinner', approved_menu_content: 'after', form_attempt_id: 'attempt-1' }] }).then(resolve);
                if (table === 'basic_ai_check_audits') return Promise.resolve({ data: [{ id: 'audit-1', menu_content_raw: 'before', attempt_id: 'attempt-1', event_type: 'completed', review_mode: 'full' }] }).then(resolve);
                if (query.patch) {
                    if (typeof state.beforeUpdate === 'function') {
                        const hook = state.beforeUpdate;
                        state.beforeUpdate = null;
                        hook();
                    }
                    const matches = filters.every((filter) => {
                        const current = filter.field.includes('->') ? readJsonPath(state.proposal, filter.field) : state.proposal?.[filter.field];
                        if (filter.kind === 'is') return current == null && filter.value == null;
                        if (filter.field === 'eval_summary' && typeof filter.value === 'string') return JSON.stringify(current) === filter.value;
                        return current === filter.value;
                    });
                    if (!matches) return Promise.resolve({ data: [] }).then(resolve);
                    state.proposal = { ...state.proposal, eval_summary: query.patch.eval_summary };
                    state.writes += 1;
                    return Promise.resolve({ data: [{ id: state.proposal.id }] }).then(resolve);
                }
                return Promise.resolve({ data: [] }).then(resolve);
            },
            single: async () => ({ data: state.proposal }),
        };
        return query;
    } };
    return { client, state };
}

test('durable claim crash before summary converges to blocked zero-dispatch recovery', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prep-recovery-')));
    fs.mkdirSync(path.join(root, 'tmp', 'review-eval'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp', 'review-eval', 'dataset.jsonl'), `${JSON.stringify({ case_id: 'base', raw_input: 'Base', ground_truth: 'Base', context: {} })}\n`);
    const behaviorBody = { schemaVersion: 1, frozenAt: new Date().toISOString(), records: [{ correctionId: 'c1', submissionId: 'submission-1', inputSpan: { text: 'before' }, expectedSpan: { text: 'after' }, reason: 'reason', expectationAuthority: 'human_explanation', provenance: { reviewer: 'Reviewer' }, disposition: 'awaiting_behavior_verification' }], tests: [], contextualTests: [] };
    const behavior = { ...behaviorBody, sha256: hashBehaviorArtifact(behaviorBody) };
    const proposal = { id: 'p-recovery', status: 'pending', cycle_id: 'cycle-recovery', proposed_prompt: 'prompt', correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'before', corrected_text: 'after', source: 'human' }], replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', case_id: 'case-1', original_text: 'before', corrected_text: 'after', status: 'replay_mismatch' }], eval_summary: { replay_retirement_policy_version: 1, behavior_tests: behavior }, code_recommendations: [{ title: 'fix' }] };
    const { client, state } = clientState();
    const verification = { REPLAY_RETIREMENT_POLICY_VERSION: 1, codeProposalVerificationFingerprint: (value) => digest(JSON.stringify({ id: value.id, cycle_id: value.cycle_id, proposed_prompt: value.proposed_prompt, correction_routing: value.correction_routing, replay_evidence: value.replay_evidence, code_recommendations: value.code_recommendations })), hashCodeImplementation: () => digest('source'), hashAcceptedRules: () => digest('rules') };
    state.proposal = proposal;
    const store = { recordCodeVerification };
    const behaviorModule = { validateBehaviorArtifact: () => {} };
    try {
        const inventory = buildPreparationInventory(proposal, { proposalFingerprint: verification.codeProposalVerificationFingerprint(proposal) });
        const prepared = await prepareCodeProposalAttempt({ client, proposal, repoRoot: root, datasetPath: path.join(root, 'tmp/review-eval/dataset.jsonl'), verification, store, behaviorModule, inventory, attemptId: 'attempt-recovery' });
        expect(state.writes).toBe(1);
        fs.rmSync(path.join(prepared.artifactDirectory, 'preparation-summary.json'), { force: true });
        const result = await prepareCodeProposalQueue({ client, proposal: state.proposal, repoRoot: root, datasetPath: path.join(root, 'tmp/review-eval/dataset.jsonl'), verification, store, readCurrentProposal: async () => state.proposal });
        expect(result.reason).toBe('code_candidate_authorization_required');
        expect(fs.existsSync(path.join(prepared.artifactDirectory, 'preparation-summary.json'))).toBe(true);
        expect(state.writes).toBe(1);
        const owner = state.proposal.eval_summary.code_candidate;
        await expect(recordCodeVerification(client, state.proposal, { code_candidate: { ...owner, attempt_id: 'newer-owner', started_at: new Date().toISOString() } }, verification)).rejects.toThrow(/already running/);
        const lateCompletion = { ...owner, status: 'blocked' };
        state.beforeUpdate = () => {
            state.proposal = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary,
                code_candidate: { ...owner, attempt_id: 'concurrent-owner', started_at: new Date().toISOString() } } };
        };
        await expect(recordCodeVerification(client, state.proposal, { code_candidate: lateCompletion }, verification)).rejects.toThrow(/changed concurrently/);
        expect(state.proposal.eval_summary.code_candidate.attempt_id).toBe('concurrent-owner');
        expect(state.writes).toBe(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a concurrent claim after the no-owner read cannot move or replace the winner artifact', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prep-orphan-race-')));
    fs.mkdirSync(path.join(root, 'tmp', 'review-eval'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp', 'review-eval', 'dataset.jsonl'), `${JSON.stringify({ case_id: 'base', raw_input: 'Base', ground_truth: 'Base', context: {} })}\n`);
    const behaviorBody = { schemaVersion: 1, frozenAt: new Date().toISOString(), records: [{ correctionId: 'c1', submissionId: 'submission-1', inputSpan: { text: 'before' }, expectedSpan: { text: 'after' }, reason: 'reason', expectationAuthority: 'human_explanation', provenance: { reviewer: 'Reviewer' }, disposition: 'awaiting_behavior_verification' }], tests: [], contextualTests: [] };
    const behavior = { ...behaviorBody, sha256: hashBehaviorArtifact(behaviorBody) };
    const proposal = { id: 'p-orphan-race', status: 'pending', cycle_id: 'cycle-orphan-race', proposed_prompt: 'prompt', correction_routing: [{ correction_id: 'c1', lane: 'code_recommendation', case_id: 'case-1', original_text: 'before', corrected_text: 'after', source: 'human' }], replay_evidence: [{ correction_id: 'c1', submission_id: 'submission-1', case_id: 'case-1', original_text: 'before', corrected_text: 'after', status: 'replay_mismatch' }], eval_summary: { replay_retirement_policy_version: 1, behavior_tests: behavior }, code_recommendations: [{ title: 'fix' }] };
    const { client, state } = clientState();
    state.proposal = proposal;
    const verification = { REPLAY_RETIREMENT_POLICY_VERSION: 1, codeProposalVerificationFingerprint: (value) => digest(JSON.stringify({ id: value.id, cycle_id: value.cycle_id, proposed_prompt: value.proposed_prompt, correction_routing: value.correction_routing, replay_evidence: value.replay_evidence, code_recommendations: value.code_recommendations })), hashCodeImplementation: () => digest('source'), hashAcceptedRules: () => digest('rules') };
    const inventory = buildPreparationInventory(proposal, { proposalFingerprint: verification.codeProposalVerificationFingerprint(proposal) });
    const finalized = require('../../../scripts/lib/code-proposal-preparation-queue').finalizePreparationInventory(inventory, { behavior_tests_sha256: behavior.sha256, dataset_sha256: digest('dataset'), source_sha256: digest('source'), prompt_sha256: digest('prompt'), accepted_rules_sha256: digest('rules') });
    const orphanRoot = path.join(root, 'tmp', 'code-proposals', proposal.id, `proposal-${proposal.id}`);
    fs.mkdirSync(orphanRoot, { recursive: true });
    fs.writeFileSync(path.join(orphanRoot, 'preparation-inventory.json'), `${JSON.stringify(finalized, null, 2)}\n`);
    fs.writeFileSync(path.join(orphanRoot, 'winner-marker.txt'), 'winner-bytes');
    const realLstat = fs.lstatSync;
    let injected = false;
    const lstatSpy = jest.spyOn(fs, 'lstatSync').mockImplementation((target) => {
        if (!injected && path.resolve(`${target}`) === path.resolve(orphanRoot)) {
            injected = true;
            state.proposal = { ...state.proposal, eval_summary: { ...state.proposal.eval_summary, code_candidate: {
                attempt_id: `proposal-${proposal.id}`, status: 'running', started_at: new Date().toISOString(), artifact_directory: orphanRoot,
            } } };
        }
        return realLstat(target);
    });
    try {
        await expect(prepareCodeProposalQueue({ client, proposal, repoRoot: root, datasetPath: path.join(root, 'tmp/review-eval/dataset.jsonl'), verification, store: { recordCodeVerification }, behaviorModule: { validateBehaviorArtifact: () => {} } })).rejects.toThrow(/already running/);
        expect(state.proposal.eval_summary.code_candidate.attempt_id).toBe(`proposal-${proposal.id}`);
        expect(state.proposal.eval_summary.code_candidate.artifact_directory).toBe(orphanRoot);
        expect(fs.readFileSync(path.join(orphanRoot, 'winner-marker.txt'), 'utf8')).toBe('winner-bytes');
        expect(fs.existsSync(orphanRoot)).toBe(true);
        expect(state.writes).toBe(0);
    } finally {
        lstatSpy.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
