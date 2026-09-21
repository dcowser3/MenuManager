'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');

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

function buildNewManualRule(oldRow, reviewerName = 'Derian') {
    return {
        ...(oldRow || {}), id: undefined, correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID,
        original_text: null, corrected_text: null, example_original: null, example_corrected: null,
        source_binding: null, rule: RULE, applies_to_menu_type: 'all', is_location_specific: false,
        location: 'All properties (global rule)', other_applicable_locations: [], reviewer_name: reviewerName,
        source: 'human', status: 'pending', prompt_cycle_id: null, consumed_at: null,
    };
}

function buildManualRuleRewritePlan({ correctionRules, proposal, expectedProposalFingerprint, reviewerName = 'Derian' } = {}) {
    const rows = Array.isArray(correctionRules) ? correctionRules : [];
    if (!proposal || proposal.status !== 'pending') throw new Error('Rewrite requires a pending proposal.');
    if (proposal.eval_summary?.code_candidate) throw new Error('Rewrite refuses a proposal with an owned code candidate.');
    const memberships = JSON.stringify(proposal);
    if (OLD_IDS.some((id) => !memberships.includes(id))) throw new Error('Rewrite requires all exact old ids in the pending proposal.');
    const oldRows = OLD_IDS.map((id) => rows.filter((row) => row?.correction_id === id));
    if (oldRows.some((matches) => matches.length !== 1)) throw new Error('Rewrite requires one exact correction_rules row per old id.');
    const routing = Array.isArray(proposal.correction_routing) ? proposal.correction_routing : [];
    const replay = Array.isArray(proposal.replay_evidence) ? proposal.replay_evidence : [];
    if (routing.length !== 30 || replay.length !== 30) throw new Error('Rewrite requires the exact 30-member pending proposal.');
    const before = { correction_rules: oldRows.flat(), proposal };
    const nextProposal = refreshBehaviorCounts(stripOldMembership(proposal));
    nextProposal.correction_rule_count = 27;
    nextProposal.eval_summary = { ...(nextProposal.eval_summary || {}) };
    delete nextProposal.eval_summary.code_candidate;
    delete nextProposal.eval_summary.code_verification;
    const freeformRow = oldRows[2][0];
    return Object.freeze({
        schema_version: 1, source: 'user_directed_manual_rule_rewrite', phase: 'planned', proposal_id: proposal.id,
        expected_proposal_fingerprint: expectedProposalFingerprint, old_ids: [...OLD_IDS], new_id: NEW_ID,
        recovery_snapshot: Object.freeze({ before, sha256: hash(before) }),
        correction_rule_deletes: Object.freeze(oldRows.flat().map((row) => ({ id: row.id, correction_id: row.correction_id, expected_sha256: hash(row) }))),
        replacement: Object.freeze({ old_id: freeformRow.id, expected_sha256: hash(freeformRow), row: buildNewManualRule(freeformRow, reviewerName) }),
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

module.exports = { OLD_IDS, NEW_ID, NEW_SUBMISSION_ID, RULE, stripOldMembership, buildNewManualRule, buildManualRuleRewritePlan, assertPlan, writeRecoveryMarker, advanceRewriteMarker, hash };
