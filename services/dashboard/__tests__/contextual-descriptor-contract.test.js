'use strict';

const fs = require('fs');
const path = require('path');
const {
    TARGETS, contractHash, buildContextualDescriptorReconciliationPlan,
    assertContextualDescriptorReconciliationPlan, applyContextualDescriptorReconciliation,
    assertContextualDescriptorReadback, hash,
} = require('../../../scripts/lib/contextual-descriptor-reconciliation');

const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/references/contextual-compound-descriptors-v1.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/references/code-rules-manifest.json'), 'utf8'));
const baseProposal = (overrides = {}) => ({
    id: 'proposal', status: 'pending', eval_status: 'regressed', disposition: 'rules_only',
    eval_summary: { code_candidate: { status: 'blocked', closed_at: '2026-09-21T18:34:29.335Z', attempt_id: 'terminal-paid' } },
    proposed_rules: [
        { original_text: 'Achiote Grilled', corrected_text: 'Achiote-Grilled' },
        { original_text: 'Cast Iron Pancakes', corrected_text: 'Cast-Iron Pancakes' },
        { original_text: 'brûlée pineapple', corrected_text: 'brûléed pineapple' },
        { original_text: 'chilies', corrected_text: 'chilis' },
        { original_text: 'Salmon', corrected_text: 'Salmon*' },
    ],
    replay_evidence: TARGETS.map((target) => ({ correction_id: target.correction_id, status: 'still_missed' })),
    correction_routing: [
        ...TARGETS.map((target) => ({ correction_id: target.correction_id, target: `${target.original_text} -> ${target.corrected_text}`, original_text: `Dish, ${target.original_text}, garnish 18`, corrected_text: `Dish, ${target.corrected_text}, garnish 18`, lane: 'replacement_rule', replay_status: 'still_missed' })),
        ...Array.from({ length: 17 }, (_, index) => ({ correction_id: `code-${index}`, lane: 'code_recommendation' })),
        ...Array.from({ length: 7 }, (_, index) => ({ correction_id: `replacement-${index}`, lane: 'replacement_rule' })),
    ],
    ...overrides,
});

test('reviewed contract artifact is stable and hash-bound', () => {
    expect(contract.version).toBe('contextual-compound-descriptors-v1');
    expect(contract.motivating_examples).toHaveLength(3);
    expect(contract.unseen_positive_examples.length).toBeGreaterThanOrEqual(2);
    expect(contract.negative_examples.length).toBeGreaterThanOrEqual(5);
    expect(contractHash()).toMatch(/^[a-f0-9]{64}$/);
    const entry = manifest.entries.find((candidate) => candidate.id === 'pre-ai/contextual-compound-descriptors');
    expect(entry.data.contract_sha256).toBe(contractHash());
    expect(entry.data.version).toBe(contract.version);
});

test('plans exact-row reconciliation while preserving evidence, owner, lanes, and state', () => {
    const proposal = baseProposal();
    const plan = buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), implementationSha256: hash('implementation'), expectedImplementationSha256: hash('implementation') });
    assertContextualDescriptorReconciliationPlan(plan);
    expect(plan.proposal_patch.proposed_rules).toHaveLength(2);
    expect(plan.proposal_patch.proposed_rules.map((row) => row.original_text)).toEqual(expect.arrayContaining(['chilies', 'Salmon']));
    expect(plan.proposal_patch.correction_routing).toHaveLength(27);
    expect(plan.proposal_patch.correction_routing.filter((row) => row.satisfaction?.kind === 'versioned_code_guard')).toHaveLength(3);
    expect(plan.proposal_patch.correction_routing.filter((row) => row.lane === 'code_recommendation')).toHaveLength(17);
    expect(plan.preserved).toMatchObject({ status: 'pending', eval_status: 'regressed', disposition: 'rules_only', terminal_attempt_id: 'terminal-paid', lane_counts: { code_recommendation: 17, replacement_rule: 10 } });
});

test('rejects stale implementation, contract, incomplete inventory, or changed exact rows', () => {
    const proposal = baseProposal();
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), implementationSha256: hash('a'), expectedImplementationSha256: hash('b') })).toThrow(/fingerprint/);
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), implementationSha256: hash('a'), expectedImplementationSha256: hash('a'), expectedContractSha256: hash('wrong') })).toThrow(/contract artifact/);
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal: baseProposal({ correction_routing: baseProposal().correction_routing.slice(0, 26) }), expectedProposalFingerprint: hash(proposal), implementationSha256: hash('a'), expectedImplementationSha256: hash('a') })).toThrow(/inventory/);
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal: baseProposal({ proposed_rules: baseProposal().proposed_rules.map((row) => row.original_text === 'Achiote Grilled' ? { ...row, corrected_text: 'wrong' } : row) }), expectedProposalFingerprint: hash(proposal), implementationSha256: hash('a'), expectedImplementationSha256: hash('a') })).toThrow(/exact motivating/);
});

test('CAS requires exact pending xmin and readback preserves full evidence/history', async () => {
    const proposal = baseProposal();
    const plan = buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), implementationSha256: hash('a'), expectedImplementationSha256: hash('a') });
    const calls = [];
    const query = { update: (patch) => (calls.push(['update', patch]), query), eq: (field, value) => (calls.push(['eq', field, value]), query), select: async () => ({ data: [baseProposal({ proposed_rules: plan.proposal_patch.proposed_rules, correction_routing: plan.proposal_patch.correction_routing })], error: null }) };
    const result = await applyContextualDescriptorReconciliation({ from: () => query }, 'proposal', 'xmin-1', plan);
    expect(result.proposed_rules).toHaveLength(2);
    expect(calls.filter((call) => call[0] === 'eq')).toEqual([['eq', 'id', 'proposal'], ['eq', 'status', 'pending'], ['eq', 'xmin', 'xmin-1']]);
    expect(() => assertContextualDescriptorReadback({ ...result, eval_summary: proposal.eval_summary, replay_evidence: proposal.replay_evidence, status: proposal.status, eval_status: proposal.eval_status, disposition: proposal.disposition }, plan)).not.toThrow();
    const race = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }) }) };
    await expect(applyContextualDescriptorReconciliation(race, 'proposal', 'stale', plan)).rejects.toThrow(/zero or multiple/);
});
