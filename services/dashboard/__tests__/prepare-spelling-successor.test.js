const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { evalStatusFromSummary, promptProposalApprovalBlock } = require('../dist/lib/improvement-cycle-core');
const { assertFrozenRuntime, assertPendingInsertPayload, classifyCreateReadback, persistedSchemaFingerprint, prepareSingleApproval, recoverApprovalReadback } = require('../../../scripts/lib/spelling-successor-operational-path');

const script = path.resolve(__dirname, '../../../scripts/prepare-spelling-successor.js');
const live = path.resolve(__dirname, '../../../tmp/code-proposals/72c144aa-c33e-4873-85e8-6e48537e799e/contextual-descriptor-reconciliation/live-proposal.json');

test('constructs only the three safe spelling rules with provenance and deterministic proof', () => {
    if (!fs.existsSync(live)) return;
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'spelling-successor-'));
    const runtimeEvidence = path.resolve(__dirname, '../../../tmp/code-proposals/72c144aa-c33e-4873-85e8-6e48537e799e/contextual-descriptor-reconciliation/accepted-rules-runtime-snapshot.json');
    if (!fs.existsSync(runtimeEvidence)) return;
    const result = execFileSync(process.execPath, [script, '--proposal-file', live, '--output-dir', output, '--accepted-rules-file', runtimeEvidence, '--runtime-root', path.resolve(__dirname, '../../..')], { encoding: 'utf8' });
    const summary = JSON.parse(result);
    const plan = JSON.parse(fs.readFileSync(path.join(output, 'plan.json'), 'utf8'));
    expect(summary.model_calls).toBe(0);
    expect(summary.provider_calls).toBe(0);
    expect(plan.successor.proposed_rules.map((rule) => `${rule.original_text}->${rule.corrected_text}`)).toEqual([
        'chilies->chilis', 'affila->affilla', 'afila->affilla',
    ]);
    expect(plan.successor.proposed_rules.map((rule) => rule.applies_to_menu_type)).toEqual(['all', 'food', 'food']);
    expect(plan.eval_status).toBe('passed');
    expect(plan.approval_gate).toBe('passed');
    expect(promptProposalApprovalBlock(plan.successor)).toBeNull();
    expect(plan.successor.id).toBeUndefined();
    expect(plan.successor.current_prompt).toBe(plan.successor.proposed_prompt);
    expect(plan.successor.eval_summary.successor_provenance.source_correction_ids).toHaveLength(3);
    expect(plan.held_originals).toEqual(expect.arrayContaining(['Salmon', 'Turkey 2 ways, Roulade, breast, haricots verts, mashed potatoes, sage giblet gravy, cranberry sauce D']));
    expect(plan.successor.eval_summary.candidate_rule_activations.every((entry) => entry.total_activations > 0)).toBe(true);
    expect(plan.successor.eval_summary.regressions).toEqual([]);
    expect(plan.successor.eval_summary.baseline_accepted_rules_sha256).toBe(plan.accepted_rules_sha256);
    expect(plan.successor.current_prompt).toBe(plan.successor.proposed_prompt);
    expect(assertPendingInsertPayload(plan.successor, plan, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: JSON.parse(fs.readFileSync(runtimeEvidence, 'utf8')).accepted_rules, implementation_sha256: plan.implementation_sha256 })).toBe(true);
    expect(prepareSingleApproval(plan.successor, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: JSON.parse(fs.readFileSync(runtimeEvidence, 'utf8')).accepted_rules, implementation_sha256: plan.implementation_sha256 }, [0, 1, 2]).accepted_rule_indexes).toEqual([0, 1, 2]);
    expect(() => assertFrozenRuntime(plan.successor, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: JSON.parse(fs.readFileSync(runtimeEvidence, 'utf8')).accepted_rules, implementation_sha256: 'forged' })).toThrow(/implementation identity/);
    expect(() => assertPendingInsertPayload({ ...plan.successor, proposed_rules: plan.successor.proposed_rules.map((rule, index) => index === 0 ? { ...rule, corrected_text: 'forged' } : rule) }, plan, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: JSON.parse(fs.readFileSync(runtimeEvidence, 'utf8')).accepted_rules, implementation_sha256: plan.implementation_sha256 })).toThrow(/frozen plan hashes|rules or routing/);
});

test('forged or incomplete evaluation evidence cannot pass the rules-only gate', () => {
    const summary = { candidate: {}, comparedCases: 5, regressed: 0, candidate_rule_activations: [{ total_activations: 0 }] };
    expect(evalStatusFromSummary(summary, { rulesOnly: true })).toBe('no_effect');
    expect(promptProposalApprovalBlock({ eval_status: 'no_effect', disposition: 'rules_only', proposed_rules: [{ original_text: 'x', corrected_text: 'y' }], eval_summary: summary })).toEqual(expect.objectContaining({ reason: 'eval_rule_inactive' }));
});

test('create/readback recovery is idempotent and rejects mismatched successors', () => {
    const successor = { cycle_id: 'cycle-x', status: 'pending', accepted_rules: null, current_prompt: 'p', proposed_prompt: 'p', proposed_rules: [], correction_routing: [] };
    const plan = { successor, successor_sha256: persistedSchemaFingerprint(successor) };
    expect(classifyCreateReadback({ ...successor, id: 'db-id', created_at: 'now' }, plan).state).toBe('already_created');
    expect(classifyCreateReadback({ ...successor, proposed_prompt: 'forged', id: 'db-id' }, plan).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'pending', accepted_rules: null }, { expected_cycle_id: 'cycle-x' }).state).toBe('retry_allowed');
    const accepted = [{ correction_id: 'a', original_text: 'a', corrected_text: 'b', applies_to_menu_type: 'all' }, { correction_id: 'b', original_text: 'c', corrected_text: 'd', applies_to_menu_type: 'food' }, { correction_id: 'c', original_text: 'e', corrected_text: 'f', applies_to_menu_type: 'food' }];
    const persistent = accepted.map((row, index) => ({ ...row, correction_id: `proposal-cycle-x-rule-${index}`, status: 'accepted' }));
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: persistent }).state).toBe('already_approved');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: [{}, {}, {}] }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: [{}, {}, {}] }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-y', status: 'approved_modified', accepted_rules: [{}, {}, {}] }, { expected_cycle_id: 'cycle-x' }).state).toBe('conflict');
});
