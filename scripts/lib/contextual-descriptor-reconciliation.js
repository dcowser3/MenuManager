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

function buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint, computeProposalFingerprint, implementationSha256, expectedImplementationSha256, expectedContractSha256 = contractHash() } = {}) {
    if (!proposal || proposal.status !== 'pending' || proposal.eval_status !== 'regressed' || proposal.disposition !== 'rules_only') throw new Error('Contextual descriptor reconciliation requires the pending regressed rules-only proposal.');
    const candidate = proposal.eval_summary?.code_candidate;
    if (!candidate || !candidate.closed_at || !['blocked', 'completed'].includes(candidate.status)) throw new Error('Contextual descriptor reconciliation requires the preserved terminal paid owner.');
    if (!DIGEST.test(expectedProposalFingerprint || '') || typeof computeProposalFingerprint !== 'function' || computeProposalFingerprint(proposal) !== expectedProposalFingerprint || !DIGEST.test(implementationSha256 || '') || implementationSha256 !== expectedImplementationSha256) throw new Error('Implementation/proposal fingerprint verification is missing or stale.');
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
        return { ...row, lane: 'existing_rule', satisfaction: { kind: 'versioned_code_guard', guard_id: 'pre-ai/contextual-compound-descriptors', contract_version: 'contextual-compound-descriptors-v1', contract_sha256: actualContractSha256, original_replay_status: row.replay_status } };
    });
    const nextProposal = { ...proposal, proposed_rules: proposedRules.filter((row) => !TARGETS.some((target) => exactTarget(row, target))), correction_routing: nextRouting };
    const remainingRules = nextProposal.proposed_rules.map((row) => ({ original_text: row.original_text || null, corrected_text: row.corrected_text || null, rule: row.rule || null }));
    const salmonOrphan = remainingRules.find((row) => row.original_text === 'Salmon' && row.corrected_text === 'Salmon*') || null;
    const beforeSubstantive = substantive(proposal);
    const afterSubstantive = substantive(nextProposal);
    return Object.freeze({
        schema_version: 1, phase: 'planned', proposal_id: proposal.id,
        expected_proposal_fingerprint: expectedProposalFingerprint,
        implementation_sha256: implementationSha256, contract_sha256: actualContractSha256,
        target_correction_ids: TARGETS.map((target) => target.correction_id),
        expected_xmin: proposal.xmin == null ? null : `${proposal.xmin}`,
        proposal_before_sha256: hash(proposal), proposal_after_sha256: hash(nextProposal),
        substantive_before_sha256: hash(beforeSubstantive), substantive_after_sha256: hash(afterSubstantive),
        expected_substantive_snapshot: beforeSubstantive,
        remaining_proposed_rules: remainingRules, remaining_proposed_rules_sha256: hash(remainingRules), salmon_orphan: salmonOrphan,
        preserved: { status: proposal.status, eval_status: proposal.eval_status, disposition: proposal.disposition, terminal_attempt_id: candidate.attempt_id, replay_evidence_sha256: hash(proposal.replay_evidence || []), lane_counts: { code_recommendation: 17, replacement_rule: 7, existing_rule: 3 } },
        proposal_patch: { proposed_rules: nextProposal.proposed_rules, correction_routing: nextProposal.correction_routing },
    });
}

function substantive(value) {
    if (!value || typeof value !== 'object') return value;
    const copy = { ...value };
    delete copy.xmin;
    return copy;
}

function assertContextualDescriptorReconciliationPlan(plan) {
    if (!plan || plan.schema_version !== 1 || plan.phase !== 'planned' || !DIGEST.test(plan.proposal_before_sha256 || '') || !DIGEST.test(plan.proposal_after_sha256 || '') || !DIGEST.test(plan.substantive_before_sha256 || '') || !DIGEST.test(plan.substantive_after_sha256 || '') || plan.target_correction_ids?.join('|') !== TARGETS.map((target) => target.correction_id).join('|')) throw new Error('Invalid contextual descriptor reconciliation plan.');
    if (!DIGEST.test(plan.contract_sha256 || '') || plan.contract_sha256 !== contractHash() || !DIGEST.test(plan.implementation_sha256 || '') || !plan.expected_substantive_snapshot || hash(plan.expected_substantive_snapshot) !== plan.substantive_before_sha256 || plan.preserved?.lane_counts?.code_recommendation !== 17 || plan.preserved?.lane_counts?.replacement_rule !== 7 || plan.preserved?.lane_counts?.existing_rule !== 3 || !Array.isArray(plan.remaining_proposed_rules) || plan.remaining_proposed_rules_sha256 !== hash(plan.remaining_proposed_rules)) throw new Error('Contextual descriptor reconciliation plan contract is stale.');
    return true;
}

async function applyContextualDescriptorReconciliation(client, proposalId, expectedXmin, plan) {
    assertContextualDescriptorReconciliationPlan(plan);
    if (!client?.rpc || !proposalId || expectedXmin == null) throw new Error('Contextual descriptor reconciliation CAS requires RPC client, proposal id, and xmin.');
    if (`${plan.expected_xmin}` !== `${expectedXmin}`) throw new Error('Contextual descriptor reconciliation xmin binding mismatch.');
    const result = await client.rpc('reconcile_contextual_descriptor_proposal', {
        p_proposal_id: proposalId,
        p_expected_xmin: `${expectedXmin}`,
        p_expected_substantive: plan.expected_substantive_snapshot,
        p_new_proposed_rules: plan.proposal_patch.proposed_rules,
        p_new_correction_routing: plan.proposal_patch.correction_routing,
    });
    if (result.error) throw new Error(`Contextual descriptor reconciliation CAS failed: ${result.error.message}`);
    if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Contextual descriptor reconciliation CAS affected zero or multiple rows.');
    return result.data[0];
}

async function resumeContextualDescriptorReconciliation({ client, proposalId, expectedXmin, plan, readCurrent } = {}) {
    assertContextualDescriptorReconciliationPlan(plan);
    if (typeof readCurrent !== 'function') throw new Error('Contextual descriptor reconciliation recovery requires a full-row read function.');
    const current = await readCurrent();
    const currentSubstantiveHash = hash(substantive(current));
    if (currentSubstantiveHash === plan.substantive_after_sha256 && `${current.xmin}` !== `${expectedXmin}`) return { state: 'already_applied', row: current };
    if (currentSubstantiveHash !== plan.substantive_before_sha256 || `${current.xmin}` !== `${expectedXmin}`) throw new Error('Contextual descriptor reconciliation recovery found conflicting state.');
    const applied = await applyContextualDescriptorReconciliation(client, proposalId, expectedXmin, plan);
    return { state: 'applied', row: applied };
}

function assertContextualDescriptorReadback(actual, plan) {
    assertContextualDescriptorReconciliationPlan(plan);
    if (hash(substantive(actual)) !== plan.substantive_after_sha256 || plan.expected_xmin != null && `${actual.xmin}` === plan.expected_xmin || actual.status !== plan.preserved.status || actual.eval_status !== plan.preserved.eval_status || actual.disposition !== plan.preserved.disposition || hash(actual.replay_evidence || []) !== plan.preserved.replay_evidence_sha256 || actual.eval_summary?.code_candidate?.attempt_id !== plan.preserved.terminal_attempt_id) throw new Error('Contextual descriptor reconciliation readback changed preserved proposal state/history or xmin.');
    return true;
}

module.exports = { TARGETS, CONTRACT_PATH, canonical, hash, contractHash, substantive, buildContextualDescriptorReconciliationPlan, assertContextualDescriptorReconciliationPlan, applyContextualDescriptorReconciliation, resumeContextualDescriptorReconciliation, assertContextualDescriptorReadback };
