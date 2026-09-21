'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TARGETS = Object.freeze([
    { correction_id: 'b23b0708-ca83-4829-9e67-9f6269b444b8', original_text: 'Achiote Grilled', corrected_text: 'Achiote-Grilled' },
    { correction_id: 'c1575e20-c01d-437e-9d65-3a66e3194af5', original_text: 'Cast Iron Pancakes', corrected_text: 'Cast-Iron Pancakes' },
    { correction_id: '8b32c298-bb73-4a4c-9395-2a48a9dfe218', original_text: 'brûlée pineapple', corrected_text: 'brûléed pineapple' },
]);
const DIGEST = /^[a-f0-9]{64}$/;
const CONTRACT_PATH = path.resolve(__dirname, '../../docs/references/contextual-compound-descriptors-v1.json');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const contractHash = () => hash(JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')));
const targetById = new Map(TARGETS.map((target) => [target.correction_id, target]));

function exactTarget(row, target) {
    return row?.original_text === target.original_text && row?.corrected_text === target.corrected_text;
}

function exactRoute(row, target) {
    return row?.correction_id === target.correction_id
        && row?.target === `${target.original_text} -> ${target.corrected_text}`
        && typeof row.original_text === 'string' && typeof row.corrected_text === 'string'
        && row.original_text.includes(target.original_text) && row.corrected_text.includes(target.corrected_text);
}

function buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint, implementationSha256, expectedImplementationSha256, expectedContractSha256 = contractHash() } = {}) {
    if (!proposal || proposal.status !== 'pending' || proposal.eval_status !== 'regressed' || proposal.disposition !== 'rules_only') throw new Error('Contextual descriptor reconciliation requires the pending regressed rules-only proposal.');
    const candidate = proposal.eval_summary?.code_candidate;
    if (!candidate || !candidate.closed_at || !['blocked', 'completed'].includes(candidate.status)) throw new Error('Contextual descriptor reconciliation requires the preserved terminal paid owner.');
    if (!DIGEST.test(expectedProposalFingerprint || '') || !DIGEST.test(implementationSha256 || '') || implementationSha256 !== expectedImplementationSha256) throw new Error('Implementation/proposal fingerprint verification is missing or stale.');
    const actualContractSha256 = contractHash();
    if (!DIGEST.test(expectedContractSha256) || actualContractSha256 !== expectedContractSha256) throw new Error('Contextual descriptor contract artifact hash mismatch.');
    const proposedRules = Array.isArray(proposal.proposed_rules) ? proposal.proposed_rules : [];
    const matchingRules = TARGETS.map((target) => proposedRules.filter((row) => exactTarget(row, target)));
    if (matchingRules.some((rows) => rows.length !== 1)) throw new Error('Each exact motivating proposed rule must be present exactly once.');
    const routing = Array.isArray(proposal.correction_routing) ? proposal.correction_routing : [];
    const matchingRoutes = TARGETS.map((target) => routing.filter((row) => exactRoute(row, target)));
    if (matchingRoutes.some((rows) => rows.length !== 1)) throw new Error('Each exact motivating correction route must be present exactly once.');
    const lanes = routing.reduce((counts, row) => { counts[row?.lane] = (counts[row?.lane] || 0) + 1; return counts; }, {});
    if (routing.length !== 27 || lanes.code_recommendation !== 17 || lanes.replacement_rule !== 10) throw new Error('Reconciliation requires the complete 17-code/10-replacement routing inventory.');
    const nextRouting = routing.map((row) => {
        const target = targetById.get(row?.correction_id);
        if (!target) return row;
        return { ...row, replay_status: 'satisfied_by_code_guard', satisfaction: { kind: 'versioned_code_guard', guard_id: 'pre-ai/contextual-compound-descriptors', contract_version: 'contextual-compound-descriptors-v1', contract_sha256: actualContractSha256 } };
    });
    const nextProposal = { ...proposal, proposed_rules: proposedRules.filter((row) => !TARGETS.some((target) => exactTarget(row, target))), correction_routing: nextRouting };
    return Object.freeze({
        schema_version: 1, phase: 'planned', proposal_id: proposal.id,
        expected_proposal_fingerprint: expectedProposalFingerprint,
        implementation_sha256: implementationSha256, contract_sha256: actualContractSha256,
        target_correction_ids: TARGETS.map((target) => target.correction_id),
        proposal_before_sha256: hash(proposal), proposal_after_sha256: hash(nextProposal),
        preserved: { status: proposal.status, eval_status: proposal.eval_status, disposition: proposal.disposition, terminal_attempt_id: candidate.attempt_id, replay_evidence_sha256: hash(proposal.replay_evidence || []), lane_counts: lanes },
        proposal_patch: { proposed_rules: nextProposal.proposed_rules, correction_routing: nextProposal.correction_routing },
    });
}

function assertContextualDescriptorReconciliationPlan(plan) {
    if (!plan || plan.schema_version !== 1 || plan.phase !== 'planned' || !DIGEST.test(plan.proposal_before_sha256 || '') || !DIGEST.test(plan.proposal_after_sha256 || '') || plan.target_correction_ids?.join('|') !== TARGETS.map((target) => target.correction_id).join('|')) throw new Error('Invalid contextual descriptor reconciliation plan.');
    if (!DIGEST.test(plan.contract_sha256 || '') || plan.contract_sha256 !== contractHash() || !DIGEST.test(plan.implementation_sha256 || '')) throw new Error('Contextual descriptor reconciliation plan contract is stale.');
    return true;
}

async function applyContextualDescriptorReconciliation(client, proposalId, expectedXmin, plan) {
    assertContextualDescriptorReconciliationPlan(plan);
    if (!client?.from || !proposalId || expectedXmin == null) throw new Error('Contextual descriptor reconciliation CAS requires client, proposal id, and xmin.');
    const result = await client.from('prompt_proposals').update(plan.proposal_patch)
        .eq('id', proposalId).eq('status', 'pending').eq('xmin', expectedXmin).select('*,xmin');
    if (result.error) throw new Error(`Contextual descriptor reconciliation CAS failed: ${result.error.message}`);
    if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Contextual descriptor reconciliation CAS affected zero or multiple rows.');
    return result.data[0];
}

function assertContextualDescriptorReadback(actual, plan) {
    assertContextualDescriptorReconciliationPlan(plan);
    if (hash(actual) !== plan.proposal_after_sha256 || actual.status !== plan.preserved.status || actual.eval_status !== plan.preserved.eval_status || actual.disposition !== plan.preserved.disposition || hash(actual.replay_evidence || []) !== plan.preserved.replay_evidence_sha256 || actual.eval_summary?.code_candidate?.attempt_id !== plan.preserved.terminal_attempt_id) throw new Error('Contextual descriptor reconciliation readback changed preserved proposal state/history.');
    return true;
}

module.exports = { TARGETS, CONTRACT_PATH, canonical, hash, contractHash, buildContextualDescriptorReconciliationPlan, assertContextualDescriptorReconciliationPlan, applyContextualDescriptorReconciliation, assertContextualDescriptorReadback };
