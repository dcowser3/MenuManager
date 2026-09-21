'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const fs = require('fs');

const OLD_IDS = Object.freeze([
    'ce9e56a4-12c4-46aa-a12e-606df66b6b43',
    '3f338cf9-483e-4d66-afde-d9c46fb285b2',
    'fc08d1d2-2145-4cf8-b44b-55ea830d6e07',
]);
const NEW_ID = 'manual-rule-walnut-pistou-herb-singularization';
const NEW_SUBMISSION_ID = 'manual-submission-walnut-pistou-herb-singularization';
const RULE = "Singularize ‘walnuts’ and ‘pistou herbs’ to ‘walnut’ and ‘pistou herb’ in ingredient lists.";
const DIGEST = /^[a-f0-9]{64}$/;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
let productionBehaviorHash;
try { productionBehaviorHash = require('../../services/dashboard/dist/lib/learning-behavior-tests').hashBehaviorArtifact; } catch { /* source-only checkout */ }
const behaviorHash = (value) => (productionBehaviorHash || ((input) => hash(canonical(input))))(value);
let verificationFingerprint;
try { verificationFingerprint = require('../../services/dashboard/dist/lib/code-proposal-verification').codeProposalVerificationFingerprint; } catch { /* source-only checkout */ }

function stripOldMembership(value) {
    if (Array.isArray(value)) return value.filter((row) => !OLD_IDS.includes(row?.correction_id) && !OLD_IDS.includes(row?.correctionId)).map(stripOldMembership);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if ((key === 'correction_id' || key === 'correctionId') && OLD_IDS.includes(child)) return undefined;
        const next = stripOldMembership(child);
        if (next !== undefined) output[key] = next;
    }
    return output;
}

function refreshBehaviorCounts(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(refreshBehaviorCounts);
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = refreshBehaviorCounts(child);
    for (const [plural, child] of Object.entries(out)) {
        if (Array.isArray(child) && ['records', 'tests', 'contextualTests'].includes(plural)) {
            out[`${plural}_count`] = child.length;
            out[`${plural.replace(/s$/, '')}_count`] = child.length;
        }
    }
    return out;
}

function removeTargetRows(rows) {
    return Array.isArray(rows) ? rows.filter((row) => !OLD_IDS.includes(row?.correction_id) && !OLD_IDS.includes(row?.correctionId)) : rows;
}

function patchKnownProposalFields(proposal) {
    const next = { ...proposal };
    for (const field of ['correction_routing', 'replay_evidence', 'coverage_claims', 'code_recommendations']) {
        if (Array.isArray(next[field])) next[field] = removeTargetRows(next[field]);
    }
    const behavior = next.eval_summary?.behavior_tests;
    if (behavior && typeof behavior === 'object') {
        const patchedBehavior = { ...behavior };
        for (const field of ['records', 'tests', 'contextualTests']) if (Array.isArray(patchedBehavior[field])) patchedBehavior[field] = removeTargetRows(patchedBehavior[field]);
        next.eval_summary = { ...next.eval_summary, behavior_tests: refreshBehaviorCounts(patchedBehavior) };
    }
    return clearDerivedVerification(next);
}

function assertNoOldIds(value) {
    if (OLD_IDS.some((id) => JSON.stringify(value).includes(id))) throw new Error('Rewrite proposal still contains a target correction ID.');
}

function buildNewManualRule(oldRow, reviewerName = 'Derian', buildCorrectionRuleRecord) {
    const payload = {
        correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID, original_text: null, corrected_text: null,
        example_original: null, example_corrected: null, source_binding: null, rule: RULE,
        applies_to_menu_type: 'all', is_location_specific: false, location: 'All properties (global rule)',
        other_applicable_locations: [], reviewer_name: reviewerName, source: 'human', status: 'pending',
    };
    if (typeof buildCorrectionRuleRecord === 'function') {
        const built = buildCorrectionRuleRecord(payload, []);
        return { ...built, correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID, source: 'human', status: 'pending', source_binding: null };
    }
    return {
        id: undefined, correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID,
        original_text: null, corrected_text: null, example_original: null, example_corrected: null,
        force_target_case: false, change_type: null, project_name: null, restaurant_name: '',
        source_binding: null, rule: RULE, applies_to_menu_type: 'all', is_location_specific: false,
        location: 'All properties (global rule)', other_applicable_locations: [], reviewer_name: reviewerName,
        source: 'human', status: 'pending', prompt_cycle_id: null, consumed_at: null,
    };
}

function proposalMemberIds(proposal) {
    const ids = new Set();
    const visit = (value) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if ((key === 'correction_id' || key === 'correctionId') && typeof child === 'string') ids.add(child);
            else visit(child);
        }
    };
    visit(proposal);
    return ids;
}

function clearDerivedVerification(proposal) {
    const next = { ...proposal, eval_summary: { ...(proposal.eval_summary || {}) } };
    delete next.eval_summary.code_candidate;
    delete next.eval_summary.code_verification;
    return next;
}

function buildManualRuleRewritePlan({ correctionRules, proposal, expectedProposalFingerprint, reviewerName = 'Derian', buildCorrectionRuleRecord, expectedTargetHashes, codeProposalVerificationFingerprint } = {}) {
    const rows = Array.isArray(correctionRules) ? correctionRules : [];
    if (!proposal || proposal.status !== 'pending') throw new Error('Rewrite requires a pending proposal.');
    if (proposal.eval_summary?.code_candidate || proposal.eval_summary?.code_verification) throw new Error('Rewrite refuses a proposal with an owned or derived code candidate.');
    if (!DIGEST.test(expectedProposalFingerprint || '')) throw new Error('Rewrite requires a verified proposal fingerprint.');
    if (typeof codeProposalVerificationFingerprint === 'function' && codeProposalVerificationFingerprint(proposal) !== expectedProposalFingerprint) throw new Error('Rewrite proposal fingerprint is stale.');
    const members = proposalMemberIds(proposal);
    if (members.size !== 30 || OLD_IDS.some((id) => !members.has(id))) throw new Error('Rewrite requires exactly 30 proposal members including all exact old ids.');
    const oldRows = OLD_IDS.map((id) => rows.filter((row) => row?.correction_id === id));
    if (oldRows.some((matches) => matches.length !== 1)) throw new Error('Rewrite requires one exact correction_rules row per old id.');
    if (!expectedTargetHashes || OLD_IDS.some((id) => !DIGEST.test(expectedTargetHashes[id] || ''))) throw new Error('Rewrite requires exact target correction_rules shape hashes.');
    for (const id of OLD_IDS) if (expectedTargetHashes[id] !== hash(oldRows[OLD_IDS.indexOf(id)][0])) throw new Error(`Target correction_rules shape is stale for ${id}.`);
    const routing = Array.isArray(proposal.correction_routing) ? proposal.correction_routing : [];
    const replay = Array.isArray(proposal.replay_evidence) ? proposal.replay_evidence : [];
    if (routing.length !== 30 || replay.length !== 30) throw new Error('Rewrite requires the exact 30-member pending proposal.');
    const before = { correction_rules: oldRows.flat(), proposal };
    const nextProposal = patchKnownProposalFields(proposal);
    assertNoOldIds(nextProposal);
    nextProposal.correction_rule_count = 27;
    if (nextProposal.eval_summary?.behavior_tests && typeof nextProposal.eval_summary.behavior_tests === 'object') {
        const { sha256: _oldHash, ...behaviorBody } = nextProposal.eval_summary.behavior_tests;
        nextProposal.eval_summary.behavior_tests = { ...behaviorBody, sha256: behaviorHash(behaviorBody) };
    }
    const freeformRow = oldRows[2][0];
    return Object.freeze({
        schema_version: 1, source: 'user_directed_manual_rule_rewrite', phase: 'planned', proposal_id: proposal.id,
        expected_proposal_fingerprint: expectedProposalFingerprint, old_ids: [...OLD_IDS], new_id: NEW_ID,
        target_hashes: Object.freeze(Object.fromEntries(OLD_IDS.map((id) => [id, hash(oldRows[OLD_IDS.indexOf(id)][0])]))),
        recovery_snapshot: Object.freeze({ before, sha256: hash(before) }),
        correction_rule_deletes: Object.freeze(oldRows.flat().map((row) => ({ id: row.id, correction_id: row.correction_id, expected_sha256: hash(row) }))),
        replacement: Object.freeze({ old_id: freeformRow.id, expected_sha256: hash(freeformRow), row: buildNewManualRule(freeformRow, reviewerName, buildCorrectionRuleRecord) }),
        proposal_before_sha256: hash(proposal), proposal_after_sha256: hash(nextProposal), proposal_patch: Object.freeze(nextProposal),
    });
}

function assertPlan(plan) {
    if (!plan || plan.schema_version !== 1 || plan.phase !== 'planned' || !DIGEST.test(plan.recovery_snapshot?.sha256 || '') || plan.old_ids.join('|') !== OLD_IDS.join('|')) throw new Error('Invalid manual-rule rewrite plan.');
    if (plan.replacement?.row?.correction_id !== NEW_ID || plan.replacement.row.status !== 'pending' || plan.replacement.row.source_binding !== null) throw new Error('Replacement row is not an unbound pending manual rule.');
    return true;
}

async function writeRecoveryMarker(markerPath, plan) {
    const bytes = Buffer.from(JSON.stringify(plan, null, 2));
    if (bytes.length > 128 * 1024) throw new Error('Recovery snapshot exceeds the bounded size.');
    await fsp.mkdir(require('path').dirname(markerPath), { recursive: true, mode: 0o700 });
    await fsp.chmod(require('path').dirname(markerPath), 0o700);
    const temporary = `${markerPath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, markerPath);
    await fsp.chmod(markerPath, 0o600);
}

async function advanceRewriteMarker(markerPath, expectedPlanSha256, phase) {
    const allowed = new Set(['planned', 'rules_reconciled', 'proposal_reconciled', 'verified']);
    if (!allowed.has(phase)) throw new Error('Unknown manual-rule rewrite phase.');
    const current = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
    if (hash(current) !== expectedPlanSha256) throw new Error('Rewrite marker changed concurrently.');
    const next = { ...current, phase, previous_phase: current.phase };
    await writeRecoveryMarker(markerPath, next);
    return next;
}

/**
 * Run the rewrite against an explicitly supplied adapter. The adapter is the
 * only live-data boundary, which keeps planning/tests provider-free and makes
 * each phase safely retryable after a process interruption.
 */
async function runManualRuleRewrite({ adapter, markerPath, plan, failAfterPhase, codeProposalVerificationFingerprint } = {}) {
    if (!adapter || typeof adapter.readState !== 'function') throw new Error('Rewrite adapter must provide readState.');
    assertPlan(plan);
    const marker = markerPath && fs.existsSync(markerPath) ? JSON.parse(await fsp.readFile(markerPath, 'utf8')) : null;
    if (marker && (marker.proposal_id !== plan.proposal_id || marker.proposal_before_sha256 !== plan.proposal_before_sha256 || !['planned', 'snapshot', 'proposal_reconciled', 'deleted', 'inserted', 'updated', 'verified'].includes(marker.phase))) throw new Error('Rewrite marker is stale or malformed.');
    let phase = marker?.phase || 'planned';
    const mark = async (next) => {
        phase = next;
        if (markerPath) await writeRecoveryMarker(markerPath, { ...plan, phase: next });
        if (failAfterPhase === next) throw new Error(`Injected failure after ${next}`);
    };
    if (phase === 'planned') {
        const state = await adapter.readState();
        const current = buildManualRuleRewritePlan({ correctionRules: state.correctionRules, proposal: state.proposal, expectedProposalFingerprint: plan.expected_proposal_fingerprint, reviewerName: plan.replacement.row.reviewer_name, expectedTargetHashes: plan.target_hashes, codeProposalVerificationFingerprint });
        if (current.proposal_before_sha256 !== plan.proposal_before_sha256) throw new Error('Live state changed before rewrite.');
    }
    if (phase === 'planned') { if (markerPath) await writeRecoveryMarker(markerPath, { ...plan, phase: 'snapshot' }); await mark('snapshot'); }
    if (phase === 'snapshot') {
        // Reconcile the proposal first. This prevents preparation from ever
        // observing a proposal that references rows already deleted.
        const live = await adapter.readState();
        if (hash(live.proposal) !== plan.proposal_before_sha256) throw new Error('Proposal changed concurrently before CAS.');
        await adapter.updateProposal(plan.proposal_patch, { expectedFingerprint: plan.expected_proposal_fingerprint, expectedProposal: live.proposal });
        await mark('proposal_reconciled');
    }
    if (phase === 'proposal_reconciled' || phase === 'deleted') {
        // Adapter must make this insert idempotent by correction_id.
        await adapter.insertCorrectionRule(plan.replacement.row, { expectedSha256: plan.replacement.expected_sha256 });
        await mark('inserted');
    }
    if (phase === 'inserted') {
        // Delete only the two Salmon duplicates and the old Beet row after the
        // replacement is durably present. All deletes are exact-ID/CAS writes.
        for (const target of plan.correction_rule_deletes) await adapter.deleteCorrectionRule(target);
        await mark('updated');
    }
    if (phase === 'updated') {
        const after = await adapter.readState();
        const ids = proposalMemberIds(after.proposal);
        if (ids.size !== 27 || OLD_IDS.some((id) => ids.has(id)) || after.proposal.correction_rule_count !== 27) throw new Error('Rewrite readback does not reconcile exact membership.');
        if (!after.correctionRules.some((row) => row.correction_id === NEW_ID && row.status === 'pending' && row.source_binding === null)) throw new Error('Rewrite readback is missing the pending unbound replacement.');
        await mark('verified');
    }
    return { phase };
}

function createSupabaseRewriteAdapter(client, proposalId) {
    if (!client?.from || !proposalId) throw new Error('Supabase rewrite adapter requires a client and proposal id.');
    const exact = (query, label) => query.then ? query : query;
    return {
        async readState() {
            const [rulesResult, proposalResult] = await Promise.all([
                client.from('correction_rules').select('*').in('correction_id', OLD_IDS),
                client.from('prompt_proposals').select('*').eq('id', proposalId).single(),
            ]);
            if (rulesResult.error) throw new Error(`Read correction_rules failed: ${rulesResult.error.message}`);
            if (proposalResult.error) throw new Error(`Read prompt_proposals failed: ${proposalResult.error.message}`);
            return { correctionRules: rulesResult.data || [], proposal: proposalResult.data };
        },
        async updateProposal(next, guard) {
            const expected = guard?.expectedProposal;
            if (!expected) throw new Error('Proposal CAS requires the original proposal JSON.');
            const patch = { correction_routing: next.correction_routing, replay_evidence: next.replay_evidence, eval_summary: next.eval_summary, correction_rule_count: next.correction_rule_count };
            for (const field of ['coverage_claims', 'code_recommendations']) if (Object.prototype.hasOwnProperty.call(next, field)) patch[field] = next[field];
            let query = client.from('prompt_proposals').update(patch).eq('id', proposalId).eq('status', 'pending').eq('correction_rule_count', 30).eq('eval_summary', expected.eval_summary).eq('correction_routing', expected.correction_routing).eq('replay_evidence', expected.replay_evidence).select('id');
            const result = await query;
            if (result.error) throw new Error(`Proposal CAS failed: ${result.error.message}`);
            if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Proposal CAS affected zero or multiple rows.');
            return result.data[0];
        },
        async insertCorrectionRule(row, guard) {
            const existing = await client.from('correction_rules').select('correction_id').eq('correction_id', row.correction_id);
            if (existing.error) throw new Error(`Replacement lookup failed: ${existing.error.message}`);
            if (existing.data?.length) {
                const full = await client.from('correction_rules').select('*').eq('correction_id', row.correction_id).single();
                if (full.error || hash(full.data) !== hash(row)) throw new Error('Existing stable replacement conflicts with planned row.');
                return full.data;
            }
            const result = await client.from('correction_rules').insert(row).select('correction_id');
            if (result.error) throw new Error(`Replacement insert failed: ${result.error.message}`);
            if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Replacement insert affected unexpected rows.');
            return result.data[0];
        },
        async deleteCorrectionRule(target) {
            const current = await client.from('correction_rules').select('*').eq('id', target.id).eq('correction_id', target.correction_id).single();
            if (current.error || !current.data || hash(current.data) !== target.expected_sha256) throw new Error(`Correction target is stale for ${target.correction_id}.`);
            const result = await client.from('correction_rules').delete().eq('id', target.id).eq('correction_id', target.correction_id).eq('status', 'pending').select('id');
            if (result.error) throw new Error(`Correction delete failed: ${result.error.message}`);
            if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error(`Correction delete affected unexpected rows for ${target.correction_id}.`);
            return result.data[0];
        },
    };
}

module.exports = { OLD_IDS, NEW_ID, NEW_SUBMISSION_ID, RULE, stripOldMembership, buildNewManualRule, buildManualRuleRewritePlan, proposalMemberIds, clearDerivedVerification, patchKnownProposalFields, createSupabaseRewriteAdapter, runManualRuleRewrite, assertPlan, writeRecoveryMarker, advanceRewriteMarker, hash, behaviorHash, proposalFingerprint: verificationFingerprint };
