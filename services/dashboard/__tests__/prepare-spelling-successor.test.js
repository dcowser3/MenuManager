const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { evalStatusFromSummary, promptProposalApprovalBlock, mapProposedRuleToCorrectionRulePayload } = require('../dist/lib/improvement-cycle-core');
const { assertFrozenRuntime, assertPendingInsertPayload, classifyCreateReadback, persistedSchemaFingerprint, prepareSingleApproval, recoverApprovalReadback } = require('../../../scripts/lib/spelling-successor-operational-path');
const { hashCodeImplementation } = require('../dist/lib/code-proposal-verification');

const script = path.resolve(__dirname, '../../../scripts/prepare-spelling-successor.js');
const live = path.resolve(__dirname, '../../../tmp/code-proposals/72c144aa-c33e-4873-85e8-6e48537e799e/contextual-descriptor-reconciliation/live-proposal.json');

function testInputs() {
    const runtimeEvidence = path.resolve(__dirname, '../../../tmp/code-proposals/72c144aa-c33e-4873-85e8-6e48537e799e/contextual-descriptor-reconciliation/accepted-rules-runtime-snapshot.json');
    if (fs.existsSync(live) && fs.existsSync(runtimeEvidence)) return { proposal: live, runtime: runtimeEvidence };
    const root = path.resolve(__dirname, '../../..');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spelling-successor-fixture-'));
    const fixtureProposal = path.join(fixtureDir, 'proposal.json');
    const fixtureRuntime = path.join(fixtureDir, 'runtime.json');
    const targets = [
        ['chilies', 'chilis', 'all', 'ba387837-ccf6-428f-94ee-f21be1242558'],
        ['affila', 'affilla', 'food', '4c057a0c-a672-4ff5-accc-6e3b90a9ada6'],
        ['afila', 'affilla', 'food', 'ac5916e6-8219-4dfb-bd42-1665126620c1'],
    ];
    const proposed_rules = targets.map(([original_text, corrected_text, applies_to_menu_type, correction_id]) => ({ original_text, corrected_text, applies_to_menu_type, correction_id, source_correction_id: correction_id, rule: 'fixture spelling', change_type: 'spelling', is_location_specific: false }));
    const correction_routing = targets.map(([original_text, corrected_text, , correction_id]) => ({ correction_id, target: `${original_text} -> ${corrected_text}`, lane: 'replacement_rule', replay_status: 'still_missed', original_text: `Fixture ${original_text}`, corrected_text: `Fixture ${corrected_text}` }));
    fs.writeFileSync(fixtureProposal, JSON.stringify({ id: '72c144aa-c33e-4873-85e8-6e48537e799e', cycle_id: 'fixture-parent', current_prompt: 'fixture prompt', proposed_prompt: 'fixture prompt', status: 'pending', eval_status: 'regressed', disposition: 'rules_only', proposed_rules, correction_routing, eval_summary: { code_candidate: { attempt_id: 'fixture-owner', closed_at: '2026-01-01T00:00:00Z' } } }, null, 2));
    const promptHash = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'sop-processor/qa_prompt.txt'))).digest('hex');
    fs.writeFileSync(fixtureRuntime, JSON.stringify({ accepted_rules: [], accepted_rules_sha256: require('../../../scripts/lib/spelling-successor-operational-path').sha([]), effective_prompt_sha256: promptHash, implementation_sha256: hashCodeImplementation(root) }, null, 2));
    return { proposal: fixtureProposal, runtime: fixtureRuntime };
}

test('constructs only the three safe spelling rules with provenance and deterministic proof', () => {
    const inputs = testInputs();
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'spelling-successor-'));
    const result = execFileSync(process.execPath, [script, '--proposal-file', inputs.proposal, '--output-dir', output, '--accepted-rules-file', inputs.runtime, '--runtime-root', path.resolve(__dirname, '../../..')], { encoding: 'utf8' });
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
    const runtime = JSON.parse(fs.readFileSync(inputs.runtime, 'utf8'));
    expect(assertPendingInsertPayload(plan.successor, plan, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: runtime.accepted_rules, implementation_sha256: plan.implementation_sha256 })).toBe(true);
    expect(prepareSingleApproval(plan.successor, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: runtime.accepted_rules, implementation_sha256: plan.implementation_sha256 }, [0, 1, 2]).accepted_rule_indexes).toEqual([0, 1, 2]);
    expect(() => assertFrozenRuntime(plan.successor, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: runtime.accepted_rules, implementation_sha256: 'forged' })).toThrow(/implementation identity/);
    expect(() => assertPendingInsertPayload({ ...plan.successor, proposed_rules: plan.successor.proposed_rules.map((rule, index) => index === 0 ? { ...rule, corrected_text: 'forged' } : rule) }, plan, { effective_prompt_sha256: plan.effective_prompt_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, accepted_rules: runtime.accepted_rules, implementation_sha256: plan.implementation_sha256 })).toThrow(/frozen plan hashes|rules or routing/);
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
    const expectedPromptHash = require('crypto').createHash('sha256').update('p').digest('hex');
    const pending = { cycle_id: 'cycle-x', status: 'pending', accepted_rules: null, current_prompt: 'p', eval_summary: { baseline_accepted_rules_sha256: 'rules', implementation_sha256: 'impl' } };
    const pendingRequest = { expected_cycle_id: 'cycle-x', expected_proposal_fingerprint: persistedSchemaFingerprint(pending), effective_prompt_sha256: expectedPromptHash, accepted_rules_sha256: 'rules', implementation_sha256: 'impl' };
    expect(recoverApprovalReadback(pending, pendingRequest).state).toBe('retry_allowed');
    expect(recoverApprovalReadback({ ...pending, current_prompt: 'changed' }, pendingRequest).state).toBe('conflict');
    const accepted = [
        { source_correction_id: 'a', original_text: 'a', corrected_text: 'b', applies_to_menu_type: 'all', is_location_specific: false, change_type: 'spelling', rule: 'fixture a' },
        { source_correction_id: 'b', original_text: 'c', corrected_text: 'd', applies_to_menu_type: 'food', is_location_specific: false, change_type: 'spelling', rule: 'fixture b' },
        { source_correction_id: 'c', original_text: 'e', corrected_text: 'f', applies_to_menu_type: 'food', is_location_specific: false, change_type: 'spelling', rule: 'fixture c' },
    ];
    const persistent = accepted.map((row, index) => mapProposedRuleToCorrectionRulePayload(row, 'cycle-x', index, 'Reviewer', { cycleId: 'cycle-x', consumedAt: null }));
    // Model an actual DB readback: mapper fields plus generated columns that
    // must not weaken the semantic comparison.
    const dbReadback = persistent.map((row, index) => ({ ...mapProposedRuleToCorrectionRulePayload(accepted[index], 'cycle-x', index, 'Reviewer', { cycleId: 'cycle-x', consumedAt: `2026-09-21T00:0${index}:00.000Z` }), id: `db-${index}`, created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z', xmin: `${index + 10}` }));
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback }).state).toBe('already_approved');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback.map((row) => ({ ...row, location: 'All properties (global rule)' })) }).state).toBe('already_approved');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback.map((row) => ({ ...row, source: 'human' })) }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback.map((row) => ({ ...row, applies_to_menu_type: 'all' })) }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback.map((row) => ({ ...row, is_location_specific: true, location: 'Property A' })) }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback.map(({ submission_id, ...row }) => row) }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted.map((row, index) => index === 0 ? { ...row, source_correction_id: 'tampered' } : row) }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: accepted }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: dbReadback.map((row) => ({ ...row, consumed_at: null })) }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-x', status: 'approved_modified', accepted_rules: [{}, {}, {}] }, { expected_cycle_id: 'cycle-x', expected_accepted_rules: accepted, expected_persistent_correction_rules: persistent, persistentCorrectionRules: [{}, {}, {}] }).state).toBe('conflict');
    expect(recoverApprovalReadback({ cycle_id: 'cycle-y', status: 'approved_modified', accepted_rules: [{}, {}, {}] }, { expected_cycle_id: 'cycle-x' }).state).toBe('conflict');
});
