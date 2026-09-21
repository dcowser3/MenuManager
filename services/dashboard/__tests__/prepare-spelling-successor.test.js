const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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
    expect(plan.successor.source_provenance.source_correction_ids).toHaveLength(3);
    expect(plan.successor.source_provenance.held_originals).toEqual(expect.arrayContaining(['Salmon', 'Turkey 2 ways, Roulade, breast, haricots verts, mashed potatoes, sage giblet gravy, cranberry sauce D']));
    expect(plan.successor.eval_summary.candidate_rule_activations.every((entry) => entry.total_activations > 0)).toBe(true);
    expect(plan.successor.eval_summary.regressions).toEqual([]);
});
