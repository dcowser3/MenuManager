'use strict';
const { buildManualRuleRewritePlan, assertPlan, OLD_IDS, NEW_ID, RULE } = require('../../../scripts/lib/manual-rule-rewrite');

const proposal = () => {
    const ids = [...OLD_IDS, ...Array.from({ length: 27 }, (_, i) => `keep-${i}`)];
    const rows = (key) => ids.map((correction_id) => ({ correction_id, [key]: true }));
    return { id: 'p1', status: 'pending', correction_rule_count: 30, eval_status: 'regressed', disposition: 'rules_only', correction_routing: rows('route'), replay_evidence: rows('replay'), eval_summary: { behavior_tests: { records: rows('record'), tests: rows('test'), contextualTests: rows('context') }, regressions: [{ case_id: 'holdout-1' }] } };
};
const correctionRules = OLD_IDS.map((correction_id, i) => ({ id: `r${i}`, correction_id, submission_id: `s${i}`, original_text: 'walnuts', corrected_text: 'walnut', source_binding: { case_id: `case-${i}` }, reviewer_name: 'Isabella', source: 'human', status: 'pending' }));

test('plans exact 30-member rewrite with bounded recovery and only target removals', () => {
    const plan = buildManualRuleRewritePlan({ correctionRules, proposal: proposal(), expectedProposalFingerprint: 'f'.repeat(64) });
    expect(plan.correction_rule_deletes).toHaveLength(3);
    expect(plan.replacement.row).toMatchObject({ correction_id: NEW_ID, submission_id: expect.stringContaining('manual-submission-'), rule: RULE, reviewer_name: 'Derian', source: 'human', status: 'pending', source_binding: null, original_text: null, corrected_text: null });
    expect(plan.proposal_patch.correction_rule_count).toBe(27);
    expect(plan.proposal_patch.eval_status).toBe('regressed');
    expect(plan.proposal_patch.disposition).toBe('rules_only');
    expect(plan.proposal_patch.eval_summary.regressions).toEqual([{ case_id: 'holdout-1' }]);
    expect(JSON.stringify(plan.proposal_patch)).not.toContain(OLD_IDS[0]);
    expect(JSON.stringify(plan.proposal_patch)).not.toContain(OLD_IDS[1]);
    expect(JSON.stringify(plan.proposal_patch)).not.toContain(OLD_IDS[2]);
    expect(assertPlan(plan)).toBe(true);
});

test.each([
    ['stale owner', () => ({ ...proposal(), eval_summary: { code_candidate: { attempt_id: 'a1', status: 'running' } } })],
    ['wrong membership', () => ({ ...proposal(), correction_routing: proposal().correction_routing.slice(1) })],
])('refuses %s without producing a rewrite', (_label, make) => {
    expect(() => buildManualRuleRewritePlan({ correctionRules, proposal: make(), expectedProposalFingerprint: 'f'.repeat(64) })).toThrow();
});

test('requires all three exact correction rule rows and remains resumable by stable replacement id', () => {
    const plan = buildManualRuleRewritePlan({ correctionRules, proposal: proposal(), expectedProposalFingerprint: 'f'.repeat(64) });
    const retry = buildManualRuleRewritePlan({ correctionRules, proposal: proposal(), expectedProposalFingerprint: 'f'.repeat(64) });
    expect(retry.new_id).toBe(plan.new_id);
    expect(() => buildManualRuleRewritePlan({ correctionRules: correctionRules.slice(1), proposal: proposal(), expectedProposalFingerprint: 'f'.repeat(64) })).toThrow(/one exact/);
});
