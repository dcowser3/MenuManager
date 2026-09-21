'use strict';
const { buildManualRuleRewritePlan, buildPredeletedRecoveryPlan, proposalPatchMatches, assertPlan, writeRecoveryMarker, advanceRewriteMarker, runManualRuleRewrite, OLD_IDS, NEW_ID, RULE, hash } = require('../../../scripts/lib/manual-rule-rewrite');
const fs = require('fs');
const os = require('os');
const path = require('path');

const proposal = () => {
    const ids = [...OLD_IDS, ...Array.from({ length: 27 }, (_, i) => `keep-${i}`)];
    const rows = (key) => ids.map((correction_id) => ({ correction_id, [key]: true }));
    const routing = rows('route');
    Object.assign(routing.find((row) => row.correction_id === OLD_IDS[0]), { original_text: 'Salmon', corrected_text: 'Salmon*' });
    Object.assign(routing.find((row) => row.correction_id === OLD_IDS[1]), { original_text: 'Salmon', corrected_text: 'Salmon*' });
    Object.assign(routing.find((row) => row.correction_id === OLD_IDS[2]), { original_text: 'Roasted Heirloom Beet Salad, caramelized walnuts, pistou herbs', corrected_text: 'Roasted Heirloom Beet Salad, caramelized walnut, pistou herb' });
    const behaviorRows = (key) => ids.map((correctionId) => ({ correctionId, [key]: true }));
    return { id: 'p1', status: 'pending', correction_rule_count: 30, eval_status: 'regressed', disposition: 'rules_only', correction_routing: routing, replay_evidence: rows('replay'), eval_summary: { behavior_tests: { records: behaviorRows('record'), tests: behaviorRows('test'), contextualTests: behaviorRows('context') }, regressions: [{ case_id: 'holdout-1' }] } };
};
const correctionRules = OLD_IDS.map((correction_id, i) => ({ id: `r${i}`, correction_id, submission_id: i < 2 ? 's-salmon' : 's-beet', original_text: i < 2 ? 'Salmon' : 'Roasted Heirloom Beet Salad, caramelized walnuts, pistou herbs', corrected_text: i < 2 ? 'Salmon*' : 'Roasted Heirloom Beet Salad, caramelized walnut, pistou herb', source_binding: { case_id: `case-${i}` }, reviewer_name: 'Isabella', source: 'human', status: 'pending', updated_at: '2026-09-21T12:00:00Z' }));
const targetHashes = Object.fromEntries(correctionRules.map((row) => [row.correction_id, hash(row)]));
const fingerprint = () => 'f'.repeat(64);
const planArgs = (extra = {}) => ({ correctionRules, proposal: proposal(), expectedProposalFingerprint: 'f'.repeat(64), expectedTargetHashes: targetHashes, codeProposalVerificationFingerprint: fingerprint, ...extra });

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
    ['duplicate replay membership', () => { const value = proposal(); value.replay_evidence[1] = { ...value.replay_evidence[0] }; return value; }],
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
    await expect(runManualRuleRewrite({ adapter, markerPath: marker, plan, failAfterPhase: 'proposal_reconciled', codeProposalVerificationFingerprint: fingerprint })).rejects.toThrow('Injected failure');
    await runManualRuleRewrite({ adapter, markerPath: marker, plan, codeProposalVerificationFingerprint: fingerprint });
    await runManualRuleRewrite({ adapter, markerPath: marker, plan, codeProposalVerificationFingerprint: fingerprint });
    expect(inserts).toBe(1);
    expect(deletions).toEqual(OLD_IDS);
    expect(state.correctionRules.filter((row) => OLD_IDS.includes(row.correction_id))).toHaveLength(0);
    expect(state.correctionRules.find((row) => row.correction_id === NEW_ID)).toMatchObject({ status: 'pending', source_binding: null, rule: RULE });
    expect(state.proposal.correction_rule_count).toBe(27);
});

test('requires the canonical fingerprint function and private recovery marker', async () => {
    expect(() => buildManualRuleRewritePlan({ ...planArgs(), codeProposalVerificationFingerprint: undefined })).toThrow(/canonical verifier/);
    const plan = buildManualRuleRewritePlan(planArgs());
    await expect(runManualRuleRewrite({ adapter: { readState: async () => ({ correctionRules, proposal: proposal() }) }, plan, codeProposalVerificationFingerprint: fingerprint })).rejects.toThrow(/marker path/);
});

test('post-CAS matching ignores only xmin and rejects preserved-field changes', () => {
    const expected = { ...proposal(), xmin: '10', proposed_prompt: 'prompt-a' };
    expect(proposalPatchMatches({ ...expected, xmin: '11' }, expected)).toBe(true);
    expect(proposalPatchMatches({ ...expected, status: 'approved', xmin: '11' }, expected)).toBe(false);
    expect(proposalPatchMatches({ ...expected, proposed_prompt: 'prompt-b', xmin: '11' }, expected)).toBe(false);
});

test('reconciles forward when all three old rows were already deleted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-rule-predeleted-'));
    const marker = path.join(dir, 'recovery.json');
    let state = { correctionRules: [], proposal: proposal() };
    const plan = buildPredeletedRecoveryPlan({ correctionRules: [], proposal: state.proposal, expectedProposalFingerprint: fingerprint(), reviewerName: 'Derian', codeProposalVerificationFingerprint: fingerprint });
    const adapter = {
        readState: async () => state,
        updateProposal: async (next) => { state.proposal = next; },
        insertCorrectionRule: async (row) => { state.correctionRules = [row]; },
        deleteCorrectionRule: async () => { throw new Error('predeleted recovery must not delete'); },
    };
    await runManualRuleRewrite({ adapter, markerPath: marker, plan, codeProposalVerificationFingerprint: fingerprint });
    expect(state.proposal.correction_rule_count).toBe(27);
    expect(state.correctionRules).toHaveLength(1);
    expect(state.correctionRules[0]).toMatchObject({ correction_id: NEW_ID, status: 'pending', source_binding: null });
});
