const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { evalStatusFromSummary, promptProposalApprovalBlock } = require('../dist/lib/improvement-cycle-core');

const script = path.resolve(__dirname, '../../../scripts/prepare-spelling-successor.js');
const live = path.resolve(__dirname, '../../../tmp/code-proposals/72c144aa-c33e-4873-85e8-6e48537e799e/contextual-descriptor-reconciliation/live-proposal.json');

test('constructs only the three safe spelling rules with provenance and deterministic proof', () => {
    if (!fs.existsSync(live)) return;
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'spelling-successor-'));
    const result = execFileSync(process.execPath, [script, '--proposal-file', live, '--output-dir', output], { encoding: 'utf8' });
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
});

test('forged or incomplete evaluation evidence cannot pass the rules-only gate', () => {
    const summary = { candidate: {}, comparedCases: 5, regressed: 0, candidate_rule_activations: [{ total_activations: 0 }] };
    expect(evalStatusFromSummary(summary, { rulesOnly: true })).toBe('no_effect');
    expect(promptProposalApprovalBlock({ eval_status: 'no_effect', disposition: 'rules_only', proposed_rules: [{ original_text: 'x', corrected_text: 'y' }], eval_summary: summary })).toEqual(expect.objectContaining({ reason: 'eval_rule_inactive' }));
});
