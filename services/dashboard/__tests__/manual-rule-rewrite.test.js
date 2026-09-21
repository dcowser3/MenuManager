'use strict';
const { buildManualRuleRewritePlan, assertPlan, writeRecoveryMarker, advanceRewriteMarker, runManualRuleRewrite, OLD_IDS, NEW_ID, RULE, hash } = require('../../../scripts/lib/manual-rule-rewrite');
const fs = require('fs');
const os = require('os');
const path = require('path');

const proposal = () => {
    const ids = [...OLD_IDS, ...Array.from({ length: 27 }, (_, i) => `keep-${i}`)];
    const rows = (key) => ids.map((correction_id) => ({ correction_id, [key]: true }));
    return { id: 'p1', status: 'pending', correction_rule_count: 30, eval_status: 'regressed', disposition: 'rules_only', correction_routing: rows('route'), replay_evidence: rows('replay'), eval_summary: { behavior_tests: { records: rows('record'), tests: rows('test'), contextualTests: rows('context') }, regressions: [{ case_id: 'holdout-1' }] } };
};
const correctionRules = OLD_IDS.map((correction_id, i) => ({ id: `r${i}`, correction_id, submission_id: `s${i}`, original_text: 'walnuts', corrected_text: 'walnut', source_binding: { case_id: `case-${i}` }, reviewer_name: 'Isabella', source: 'human', status: 'pending' }));
const targetHashes = Object.fromEntries(correctionRules.map((row) => [row.correction_id, hash(row)]));
const planArgs = (extra = {}) => ({ correctionRules, proposal: proposal(), expectedProposalFingerprint: 'f'.repeat(64), expectedTargetHashes: targetHashes, ...extra });

test('plans exact 30-member rewrite with bounded recovery and only target removals', () => {
    const plan = buildManualRuleRewritePlan(planArgs());
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
    expect(() => buildManualRuleRewritePlan(planArgs({ proposal: make() }))).toThrow();
});

test('requires all three exact correction rule rows and remains resumable by stable replacement id', () => {
    const plan = buildManualRuleRewritePlan(planArgs());
    const retry = buildManualRuleRewritePlan(planArgs());
    expect(retry.new_id).toBe(plan.new_id);
    expect(() => buildManualRuleRewritePlan(planArgs({ correctionRules: correctionRules.slice(1) }))).toThrow(/one exact/);
});

test('advances a private recovery marker only from the expected phase snapshot', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-rule-rewrite-'));
    const marker = path.join(dir, 'recovery.json');
    const plan = buildManualRuleRewritePlan(planArgs());
    await writeRecoveryMarker(marker, plan);
    const next = await advanceRewriteMarker(marker, hash(plan), 'rules_reconciled');
    expect(next.phase).toBe('rules_reconciled');
    await expect(advanceRewriteMarker(marker, hash(plan), 'proposal_reconciled')).rejects.toThrow(/changed concurrently/);
    expect(fs.statSync(marker).mode & 0o777).toBe(0o600);
});

test('resumes after a phase interruption without duplicate replacement or provider calls', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-rule-rewrite-'));
    const marker = path.join(dir, 'recovery.json');
    let state = { correctionRules: correctionRules.map((row) => ({ ...row })), proposal: proposal() };
    let inserts = 0;
    const deletions = [];
    const adapter = {
        readState: async () => state,
        deleteCorrectionRule: async ({ correction_id }) => { deletions.push(correction_id); state.correctionRules = state.correctionRules.filter((row) => row.correction_id !== correction_id); },
        insertCorrectionRule: async (row) => { if (!state.correctionRules.some((item) => item.correction_id === row.correction_id)) { state.correctionRules.push(row); inserts++; } },
        updateProposal: async (next) => { state.proposal = next; },
    };
    const plan = buildManualRuleRewritePlan({ ...planArgs(), correctionRules: state.correctionRules, proposal: state.proposal });
    await expect(runManualRuleRewrite({ adapter, markerPath: marker, plan, failAfterPhase: 'proposal_reconciled' })).rejects.toThrow('Injected failure');
    await runManualRuleRewrite({ adapter, markerPath: marker, plan });
    await runManualRuleRewrite({ adapter, markerPath: marker, plan });
    expect(inserts).toBe(1);
    expect(deletions).toEqual(OLD_IDS);
    expect(state.correctionRules.filter((row) => OLD_IDS.includes(row.correction_id))).toHaveLength(0);
    expect(state.correctionRules.find((row) => row.correction_id === NEW_ID)).toMatchObject({ status: 'pending', source_binding: null, rule: RULE });
    expect(state.proposal.correction_rule_count).toBe(27);
});
