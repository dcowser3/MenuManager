'use strict';

const fs = require('fs');
const path = require('path');
const {
    TARGETS, contractHash, buildContextualDescriptorReconciliationPlan,
    assertContextualDescriptorReconciliationPlan, applyContextualDescriptorReconciliation,
    assertContextualDescriptorReadback, hash,
} = require('../../../scripts/lib/contextual-descriptor-reconciliation');
const { runPreAiDeterministicChecks } = require('../../../services/dashboard/lib/pre-ai-deterministic-rules');

const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/references/contextual-compound-descriptors-v1.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/references/code-rules-manifest.json'), 'utf8'));
const baseProposal = (overrides = {}) => ({
    id: 'proposal', xmin: 'old-xmin', status: 'pending', eval_status: 'regressed', disposition: 'rules_only',
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

test('every reviewed contract example executes through the real deterministic pass', () => {
    for (const example of [...contract.motivating_examples, ...contract.unseen_positive_examples, ...contract.negative_examples]) {
        const result = runPreAiDeterministicChecks(example.before).menuText;
        expect(result).toBe(example.after);
        expect(runPreAiDeterministicChecks(result).menuText).toBe(example.after);
    }
});

test('plans exact-row reconciliation while preserving evidence, owner, lanes, and state', () => {
    const proposal = baseProposal();
    const plan = buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), computeProposalFingerprint: hash, implementationSha256: hash('implementation'), expectedImplementationSha256: hash('implementation') });
    assertContextualDescriptorReconciliationPlan(plan);
    expect(plan.proposal_patch.proposed_rules).toHaveLength(2);
    expect(plan.proposal_patch.proposed_rules.map((row) => row.original_text)).toEqual(expect.arrayContaining(['chilies', 'Salmon']));
    expect(plan.proposal_patch.correction_routing).toHaveLength(27);
    expect(plan.proposal_patch.correction_routing.filter((row) => row.satisfaction?.kind === 'versioned_code_guard')).toHaveLength(3);
    expect(plan.proposal_patch.correction_routing.filter((row) => row.lane === 'existing_rule')).toHaveLength(3);
    expect(plan.proposal_patch.correction_routing.filter((row) => row.lane === 'replacement_rule')).toHaveLength(7);
    expect(plan.proposal_patch.correction_routing.filter((row) => row.lane === 'code_recommendation')).toHaveLength(17);
    expect(plan.preserved).toMatchObject({ status: 'pending', eval_status: 'regressed', disposition: 'rules_only', terminal_attempt_id: 'terminal-paid', lane_counts: { code_recommendation: 17, replacement_rule: 7, existing_rule: 3 } });
});

test('rejects stale implementation, contract, incomplete inventory, or changed exact rows', () => {
    const proposal = baseProposal();
    const args = { expectedProposalFingerprint: hash(proposal), computeProposalFingerprint: hash, implementationSha256: hash('a'), expectedImplementationSha256: hash('a') };
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal, ...args, expectedProposalFingerprint: hash('wrong') })).toThrow(/fingerprint/);
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal, ...args, expectedContractSha256: hash('wrong') })).toThrow(/contract artifact/);
    const incomplete = baseProposal({ correction_routing: baseProposal().correction_routing.slice(0, 26) });
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal: incomplete, ...args, expectedProposalFingerprint: hash(incomplete) })).toThrow(/inventory/);
    const changed = baseProposal({ proposed_rules: baseProposal().proposed_rules.map((row) => row.original_text === 'Achiote Grilled' ? { ...row, corrected_text: 'wrong' } : row) });
    expect(() => buildContextualDescriptorReconciliationPlan({ proposal: changed, ...args, expectedProposalFingerprint: hash(changed) })).toThrow(/exact motivating/);
});

test('CAS requires exact pending xmin and readback preserves full evidence/history', async () => {
    const proposal = baseProposal();
    const plan = buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), computeProposalFingerprint: hash, implementationSha256: hash('a'), expectedImplementationSha256: hash('a') });
    const calls = [];
    const client = { rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: [baseProposal({ proposed_rules: plan.proposal_patch.proposed_rules, correction_routing: plan.proposal_patch.correction_routing, xmin: 'new-xmin' })], error: null }; } };
    const result = await applyContextualDescriptorReconciliation(client, 'proposal', 'old-xmin', plan);
    result.xmin = 'new-xmin';
    expect(result.proposed_rules).toHaveLength(2);
    expect(calls[0][0]).toBe('rpc');
    expect(calls[0][1]).toBe('reconcile_contextual_descriptor_proposal');
    expect(calls[0][2].p_expected_xmin).toBe('old-xmin');
    expect(() => assertContextualDescriptorReadback({ ...result, eval_summary: proposal.eval_summary, replay_evidence: proposal.replay_evidence, status: proposal.status, eval_status: proposal.eval_status, disposition: proposal.disposition }, plan)).not.toThrow();
    expect(() => assertContextualDescriptorReadback({ ...result, proposed_rules: result.proposed_rules.map((row) => row.original_text === 'chilies' ? { ...row, corrected_text: 'changed' } : row), eval_summary: proposal.eval_summary, replay_evidence: proposal.replay_evidence, status: proposal.status, eval_status: proposal.eval_status, disposition: proposal.disposition }, plan)).toThrow(/state\/history/);
    const race = { rpc: async () => ({ data: [], error: { message: 'xmin conflict' } }) };
    await expect(applyContextualDescriptorReconciliation(race, 'proposal', 'old-xmin', plan)).rejects.toThrow(/xmin conflict/);
});

test('recovery resolves timeout-after-commit and retries only an exact untouched before-state', async () => {
    const proposal = baseProposal();
    const plan = buildContextualDescriptorReconciliationPlan({ proposal, expectedProposalFingerprint: hash(proposal), computeProposalFingerprint: hash, implementationSha256: hash('a'), expectedImplementationSha256: hash('a') });
    const after = baseProposal({ proposed_rules: plan.proposal_patch.proposed_rules, correction_routing: plan.proposal_patch.correction_routing, xmin: 'new-xmin' });
    const recovery = require('../../../scripts/lib/contextual-descriptor-reconciliation').resumeContextualDescriptorReconciliation;
    const recovered = await recovery({ client: { rpc: async () => { throw new Error('must not redispatch'); } }, proposalId: 'proposal', expectedXmin: 'old-xmin', plan, readCurrent: async () => after });
    expect(recovered.state).toBe('already_applied');
    const before = baseProposal(); let calls = 0;
    const retried = await recovery({ client: { rpc: async () => { calls += 1; return { data: [after], error: null }; } }, proposalId: 'proposal', expectedXmin: 'old-xmin', plan, readCurrent: async () => before });
    expect(retried.state).toBe('applied'); expect(calls).toBe(1);
    await expect(recovery({ client: { rpc: async () => ({ data: [after], error: null }) }, proposalId: 'proposal', expectedXmin: 'old-xmin', plan, readCurrent: async () => ({ ...before, disposition: 'prompt_only' }) })).rejects.toThrow(/conflicting state/);
});
