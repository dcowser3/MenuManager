"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const improvement_cycle_core_1 = require("../lib/improvement-cycle-core");
describe('shouldRunCycle gating', () => {
    test('skips when a proposal is already pending', () => {
        const gate = (0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 5, pendingProposalExists: true, minNewCorrections: 1 });
        expect(gate.run).toBe(false);
        expect(gate.reason).toContain('pending proposal');
    });
    test('skips below the correction threshold and runs at it', () => {
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposalExists: false, minNewCorrections: 1 }).run).toBe(false);
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 2, pendingProposalExists: false, minNewCorrections: 3 }).run).toBe(false);
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 3, pendingProposalExists: false, minNewCorrections: 3 }).run).toBe(true);
    });
    test('treats minNewCorrections below 1 as 1', () => {
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposalExists: false, minNewCorrections: 0 }).run).toBe(false);
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 1, pendingProposalExists: false, minNewCorrections: 0 }).run).toBe(true);
    });
});
describe('pickEffectivePrompt', () => {
    test('prefers the latest approved proposal over the file', () => {
        const result = (0, improvement_cycle_core_1.pickEffectivePrompt)([
            { status: 'approved', final_prompt: 'OLD APPROVED', reviewed_at: '2026-06-01T00:00:00Z' },
            { status: 'approved_modified', final_prompt: 'NEWEST APPROVED', reviewed_at: '2026-06-10T00:00:00Z' },
            { status: 'rejected', final_prompt: 'REJECTED', reviewed_at: '2026-06-11T00:00:00Z' },
        ], 'FILE PROMPT');
        expect(result.source).toBe('approved_proposal');
        expect(result.prompt).toBe('NEWEST APPROVED');
    });
    test('falls back to proposed_prompt when final_prompt is empty, and to the file when nothing is approved', () => {
        expect((0, improvement_cycle_core_1.pickEffectivePrompt)([
            { status: 'approved', final_prompt: '', proposed_prompt: 'PROPOSED', reviewed_at: '2026-06-10T00:00:00Z' },
        ], 'FILE').prompt).toBe('PROPOSED');
        expect((0, improvement_cycle_core_1.pickEffectivePrompt)([], 'FILE')).toEqual({ prompt: 'FILE', source: 'prompt_file' });
        expect((0, improvement_cycle_core_1.pickEffectivePrompt)([{ status: 'rejected', final_prompt: 'X' }], 'FILE').source).toBe('prompt_file');
    });
});
describe('validateImprovementLlmOutput', () => {
    const validRule = {
        original_text: 'veggies',
        corrected_text: 'vegetables',
        change_type: 'spelling',
        rule: 'Reviewer prefers the full word.',
        applies_to_menu_type: 'all',
        is_location_specific: false,
        location: null,
        other_applicable_locations: [],
    };
    test('throws without a proposed prompt', () => {
        expect(() => (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ analysis: 'x' })).toThrow('proposed_prompt');
    });
    test('keeps valid rules and drops unsafe or incomplete ones with warnings', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            analysis: 'Did things.',
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                validRule,
                { ...validRule, change_type: 'content' },
                { ...validRule, corrected_text: '' },
                { ...validRule, corrected_text: 'veggies' },
            ],
            code_recommendations: [
                { title: 'Add guard', description: 'Do X precisely.', manifest_rule_ids: ['post-ai/price-integrity-guard'], target_file_hint: 'services/dashboard/lib/price-integrity-guard.ts' },
                { title: '', description: 'missing title' },
            ],
        });
        expect(output.proposed_replacement_rules).toHaveLength(1);
        expect(output.proposed_replacement_rules[0].original_text).toBe('veggies');
        expect(output.warnings.join(' ')).toContain('not deterministic-safe');
        expect(output.code_recommendations).toHaveLength(1);
        expect(output.code_recommendations[0].title).toBe('Add guard');
    });
    test('warns on a suspiciously short prompt and normalizes menu scope', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'short prompt',
            proposed_replacement_rules: [{ ...validRule, applies_to_menu_type: 'WEIRD' }],
        });
        expect(output.warnings.some((w) => w.includes('suspiciously short'))).toBe(true);
        expect(output.proposed_replacement_rules[0].applies_to_menu_type).toBe('all');
    });
});
describe('eval summary + status', () => {
    const report = (composite, regressed = 0) => ({
        summary: { casesEvaluated: 10, exactMatches: 2, avgComposite: composite, corrections: { f1: 0.5 } },
        baselineComparison: {
            comparedCases: 10,
            avgDelta: 0.01,
            improved: 3,
            regressed,
            same: 10 - 3 - regressed,
            regressions: regressed ? [{ case_id: 'c1', label: 'Case 1', delta: -0.02 }] : [],
        },
    });
    test('builds a compact summary and derives status', () => {
        const baseline = (0, improvement_cycle_core_1.summarizeEvalReport)('baseline', report(0.8), '/tmp/base/report.json');
        const candidate = (0, improvement_cycle_core_1.summarizeEvalReport)('candidate', report(0.82), '/tmp/cand/report.json');
        const summary = (0, improvement_cycle_core_1.buildProposalEvalSummary)(baseline, candidate, report(0.82, 0));
        expect(summary.improved).toBe(3);
        expect(summary.regressed).toBe(0);
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(summary)).toBe('passed');
        const regressedSummary = (0, improvement_cycle_core_1.buildProposalEvalSummary)(baseline, candidate, report(0.79, 2));
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(regressedSummary)).toBe('regressed');
        expect(regressedSummary.regressions[0].label).toBe('Case 1');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(null)).toBe('skipped');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)({ ...summary, error: 'boom' })).toBe('failed');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)({ ...summary, candidate: null })).toBe('failed');
    });
});
describe('mapProposedRuleToCorrectionRulePayload', () => {
    test('maps a global rule with accepted status and system source', () => {
        const payload = (0, improvement_cycle_core_1.mapProposedRuleToCorrectionRulePayload)({
            original_text: 'veggies',
            corrected_text: 'vegetables',
            change_type: 'spelling',
            rule: 'Use the full word.',
            applies_to_menu_type: 'all',
            is_location_specific: false,
            location: null,
            other_applicable_locations: [],
        }, 'abc-123', 2, 'Derian');
        expect(payload).toMatchObject({
            submission_id: 'proposal-abc-123',
            correction_id: 'proposal-abc-123-rule-2',
            original_text: 'veggies',
            corrected_text: 'vegetables',
            change_type: 'spelling',
            status: 'accepted',
            source: 'system',
            location: null,
            restaurant_name: 'All RSH restaurants',
            reviewer_name: 'Derian',
        });
    });
    test('keeps location fields for location-specific rules', () => {
        const payload = (0, improvement_cycle_core_1.mapProposedRuleToCorrectionRulePayload)({
            original_text: 'a',
            corrected_text: 'b',
            change_type: 'terminology',
            rule: 'why',
            applies_to_menu_type: 'food',
            is_location_specific: true,
            location: 'Zengo - Doha',
            other_applicable_locations: ['Toro - Dubai'],
        }, 'p1', 0, null);
        expect(payload.location).toBe('Zengo - Doha');
        expect(payload.other_applicable_locations).toEqual(['Toro - Dubai']);
        expect(payload.restaurant_name).toBe('Zengo - Doha');
    });
});
