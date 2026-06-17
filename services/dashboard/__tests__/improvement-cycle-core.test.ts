import {
    buildCodeRecommendationIssue,
    buildProposalEvalSummary,
    evalStatusFromSummary,
    evaluateSecretExpiry,
    mapProposedRuleToCorrectionRulePayload,
    pickEffectivePrompt,
    shouldRunCycle,
    summarizeEvalReport,
    validateImprovementLlmOutput,
} from '../lib/improvement-cycle-core';

describe('shouldRunCycle gating', () => {
    test('skips when a proposal is already pending', () => {
        const gate = shouldRunCycle({ unconsumedCorrectionCount: 5, pendingProposalExists: true, minNewCorrections: 1 });
        expect(gate.run).toBe(false);
        expect(gate.reason).toContain('pending proposal');
    });

    test('skips below the correction threshold and runs at it', () => {
        expect(shouldRunCycle({ unconsumedCorrectionCount: 0, pendingProposalExists: false, minNewCorrections: 1 }).run).toBe(false);
        expect(shouldRunCycle({ unconsumedCorrectionCount: 2, pendingProposalExists: false, minNewCorrections: 3 }).run).toBe(false);
        expect(shouldRunCycle({ unconsumedCorrectionCount: 3, pendingProposalExists: false, minNewCorrections: 3 }).run).toBe(true);
    });

    test('treats minNewCorrections below 1 as 1', () => {
        expect(shouldRunCycle({ unconsumedCorrectionCount: 0, pendingProposalExists: false, minNewCorrections: 0 }).run).toBe(false);
        expect(shouldRunCycle({ unconsumedCorrectionCount: 1, pendingProposalExists: false, minNewCorrections: 0 }).run).toBe(true);
    });
});

describe('pickEffectivePrompt', () => {
    test('prefers the latest approved proposal over the file', () => {
        const result = pickEffectivePrompt([
            { status: 'approved', final_prompt: 'OLD APPROVED', reviewed_at: '2026-06-01T00:00:00Z' },
            { status: 'approved_modified', final_prompt: 'NEWEST APPROVED', reviewed_at: '2026-06-10T00:00:00Z' },
            { status: 'rejected', final_prompt: 'REJECTED', reviewed_at: '2026-06-11T00:00:00Z' },
        ], 'FILE PROMPT');
        expect(result.source).toBe('approved_proposal');
        expect(result.prompt).toBe('NEWEST APPROVED');
    });

    test('falls back to proposed_prompt when final_prompt is empty, and to the file when nothing is approved', () => {
        expect(pickEffectivePrompt([
            { status: 'approved', final_prompt: '', proposed_prompt: 'PROPOSED', reviewed_at: '2026-06-10T00:00:00Z' },
        ], 'FILE').prompt).toBe('PROPOSED');
        expect(pickEffectivePrompt([], 'FILE')).toEqual({ prompt: 'FILE', source: 'prompt_file' });
        expect(pickEffectivePrompt([{ status: 'rejected', final_prompt: 'X' }], 'FILE').source).toBe('prompt_file');
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
        expect(() => validateImprovementLlmOutput({ analysis: 'x' })).toThrow('proposed_prompt');
    });

    test('keeps valid rules and drops unsafe or incomplete ones with warnings', () => {
        const output = validateImprovementLlmOutput({
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

    test('drops context-dependent terminology (tartare/tartar) from replacement rules', () => {
        const output = validateImprovementLlmOutput({
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                { ...validRule, original_text: 'poblano tartare', corrected_text: 'poblano tartar', change_type: 'terminology' },
                validRule, // veggies -> vegetables, safe, should survive
            ],
        });
        expect(output.proposed_replacement_rules.map((r) => r.original_text)).toEqual(['veggies']);
        expect(output.warnings.some((w) => /context-dependent/.test(w) && /tartar/.test(w))).toBe(true);
    });

    test('warns on a suspiciously short prompt and normalizes menu scope', () => {
        const output = validateImprovementLlmOutput({
            proposed_prompt: 'short prompt',
            proposed_replacement_rules: [{ ...validRule, applies_to_menu_type: 'WEIRD' }],
        });
        expect(output.warnings.some((w) => w.includes('suspiciously short'))).toBe(true);
        expect(output.proposed_replacement_rules[0].applies_to_menu_type).toBe('all');
    });

    test('UNCHANGED sentinel substitutes the current prompt', () => {
        const output = validateImprovementLlmOutput(
            { proposed_prompt: 'UNCHANGED', analysis: 'No prompt change needed.' },
            { currentPrompt: 'THE CURRENT PROMPT' }
        );
        expect(output.promptUnchanged).toBe(true);
        expect(output.proposed_prompt).toBe('THE CURRENT PROMPT');
        expect(output.warnings).toEqual([]);
    });

    test('echoed input context falls back to unchanged with a warning', () => {
        const output = validateImprovementLlmOutput(
            { proposed_prompt: 'Some prompt...\n## Code Rules Manifest\n| aji | ají |' },
            { currentPrompt: 'THE CURRENT PROMPT' }
        );
        expect(output.promptUnchanged).toBe(true);
        expect(output.proposed_prompt).toBe('THE CURRENT PROMPT');
        expect(output.warnings.some((w) => w.includes('echoed input context'))).toBe(true);
    });

    test('broken Markdown code fence structure falls back to unchanged with a warning', () => {
        const current = [
            'Response format:',
            '```',
            '=== CORRECTED MENU ===',
            '=== END CORRECTED MENU ===',
            '```',
            'Rules continue here.',
        ].join('\n');
        const proposed = [
            'Response format:',
            '```',
            '=== CORRECTED MENU ===',
            '=== END CORRECTED MENU ===',
            'Rules continue here.',
        ].join('\n');

        const output = validateImprovementLlmOutput(
            { proposed_prompt: proposed, proposed_replacement_rules: [validRule] },
            { currentPrompt: current }
        );

        expect(output.promptUnchanged).toBe(true);
        expect(output.proposed_prompt).toBe(current);
        expect(output.proposed_replacement_rules).toHaveLength(1);
        expect(output.warnings.some((w) => w.includes('code fence structure'))).toBe(true);
    });

    test('an identical rewrite is recognized as unchanged and oversized rewrites warn', () => {
        const current = 'P'.repeat(1000);
        const identical = validateImprovementLlmOutput({ proposed_prompt: current }, { currentPrompt: current });
        expect(identical.promptUnchanged).toBe(true);

        const bloated = validateImprovementLlmOutput({ proposed_prompt: 'Q'.repeat(2000) }, { currentPrompt: current });
        expect(bloated.promptUnchanged).toBe(false);
        expect(bloated.warnings.some((w) => w.includes('review for bloat'))).toBe(true);
    });
});

describe('eval summary + status', () => {
    const report = (composite: number, regressed = 0) => ({
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
        const baseline = summarizeEvalReport('baseline', report(0.8), '/tmp/base/report.json');
        const candidate = summarizeEvalReport('candidate', report(0.82), '/tmp/cand/report.json');
        const summary = buildProposalEvalSummary(baseline, candidate, report(0.82, 0));
        expect(summary.improved).toBe(3);
        expect(summary.regressed).toBe(0);
        expect(evalStatusFromSummary(summary)).toBe('passed');

        const regressedSummary = buildProposalEvalSummary(baseline, candidate, report(0.79, 2));
        expect(evalStatusFromSummary(regressedSummary)).toBe('regressed');
        expect(regressedSummary.regressions[0].label).toBe('Case 1');

        expect(evalStatusFromSummary(null)).toBe('skipped');
        expect(evalStatusFromSummary({ ...summary, error: 'boom' } as any)).toBe('failed');
        expect(evalStatusFromSummary({ ...summary, candidate: null } as any)).toBe('failed');
    });
});

describe('evaluateSecretExpiry', () => {
    const now = Date.parse('2026-06-15T00:00:00Z');

    test('unknown when unset or unparseable', () => {
        expect(evaluateSecretExpiry('', now).status).toBe('unknown');
        expect(evaluateSecretExpiry(undefined, now).status).toBe('unknown');
        expect(evaluateSecretExpiry('not-a-date', now).status).toBe('unknown');
    });

    test('ok well before expiry', () => {
        const r = evaluateSecretExpiry('2026-12-01', now);
        expect(r.status).toBe('ok');
        expect(r.daysLeft).toBeGreaterThan(30);
    });

    test('warning within the threshold window', () => {
        const r = evaluateSecretExpiry('2026-07-01', now, 30);
        expect(r.status).toBe('warning');
        expect(r.daysLeft).toBe(16);
        expect(r.message).toContain('expires in 16');
    });

    test('expired after the date', () => {
        const r = evaluateSecretExpiry('2026-06-01', now);
        expect(r.status).toBe('expired');
        expect(r.daysLeft).toBeLessThan(0);
        expect(r.message).toContain('EXPIRED');
    });

    test('custom warn window', () => {
        expect(evaluateSecretExpiry('2026-08-01', now, 30).status).toBe('ok');
        expect(evaluateSecretExpiry('2026-08-01', now, 90).status).toBe('warning');
    });
});

describe('buildCodeRecommendationIssue', () => {
    test('builds a self-contained issue with checklist, manifest pointers, and label', () => {
        const issue = buildCodeRecommendationIssue({
            title: 'Add soft-boiled egg raw-marker coverage',
            description: 'Extend shouldAddRawAsterisk to treat soft-boiled eggs like poached eggs.',
            manifest_rule_ids: ['pre-ai/raw-asterisk-insertion'],
            target_file_hint: 'services/dashboard/lib/pre-ai-deterministic-rules.ts',
        }, { id: 'prop-9', cycle_id: '2026-06-12' }, 'https://menus.example.com/');

        expect(issue.title).toBe('[improvement-cycle] Add soft-boiled egg raw-marker coverage');
        expect(issue.labels).toEqual(['improvement-cycle']);
        expect(issue.body).toContain('soft-boiled eggs like poached eggs');
        expect(issue.body).toContain('`2026-06-12`');
        expect(issue.body).toContain('https://menus.example.com/learning/prompt-proposal');
        expect(issue.body).toContain('pre-ai/raw-asterisk-insertion');
        expect(issue.body).toContain('services/dashboard/lib/pre-ai-deterministic-rules.ts');
        expect(issue.body).toContain('npm run rules:manifest');
        expect(issue.body).toContain('npm run review:eval');
    });

    test('omits optional pointers when absent and truncates very long titles', () => {
        const issue = buildCodeRecommendationIssue({
            title: 'T'.repeat(300),
            description: 'Desc.',
            manifest_rule_ids: [],
            target_file_hint: null,
        }, { id: 'prop-1' }, '');

        expect(issue.title.length).toBeLessThanOrEqual(250);
        expect(issue.body).not.toContain('Likely implementation file');
        expect(issue.body).not.toContain('Related code-rules-manifest entries');
    });
});

describe('mapProposedRuleToCorrectionRulePayload', () => {
    test('maps a global rule with accepted status and system source', () => {
        const payload = mapProposedRuleToCorrectionRulePayload({
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
        // Born consumed (by proposal id when no cycle given) so it does not
        // re-enter the gate as a new correction next cycle.
        expect(payload.prompt_cycle_id).toBe('proposal-abc-123');
    });

    test('marks the rule consumed by the proposal cycle when provided', () => {
        const payload = mapProposedRuleToCorrectionRulePayload({
            original_text: 'a', corrected_text: 'b', change_type: 'spelling', rule: 'why',
            applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [],
        }, 'p1', 0, null, { cycleId: '2026-06-13', consumedAt: '2026-06-13T12:00:00Z' });

        expect(payload.prompt_cycle_id).toBe('2026-06-13');
        expect(payload.consumed_at).toBe('2026-06-13T12:00:00Z');
    });

    test('keeps location fields for location-specific rules', () => {
        const payload = mapProposedRuleToCorrectionRulePayload({
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
