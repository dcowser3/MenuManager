import fs from 'fs';
import path from 'path';

const ejs = require('ejs');

const viewPath = path.resolve(__dirname, '../views/prompt-proposal.ejs');

function renderProposalView(overrides: Record<string, unknown> = {}) {
    const template = fs.readFileSync(viewPath, 'utf8');
    return ejs.render(template, {
        title: 'Prompt Proposal Review',
        proposal: null,
        history: [],
        ...overrides,
    }, { filename: viewPath });
}

const baseProposal = {
    id: 'prop-1',
    cycle_id: '2026-06-12',
    status: 'pending',
    correction_rule_count: 8,
    submission_count: 3,
    date_range_start: '2026-06-01',
    date_range_end: '2026-06-11',
    llm_model: 'gpt-4o',
    created_at: '2026-06-12T09:15:00Z',
    llm_analysis: 'Added vegetables terminology rule.',
    llm_warnings: [],
    prompt_diff: '- old line\n+ new line',
    current_prompt: 'CURRENT PROMPT',
    proposed_prompt: 'PROPOSED PROMPT',
    source: 'improvement_cycle',
    eval_status: 'passed',
    eval_summary: {
        comparedCases: 27,
        avgDelta: 0.0042,
        improved: 5,
        same: 22,
        regressed: 0,
        regressions: [],
        baseline: { label: 'baseline', casesEvaluated: 27, exactMatches: 1, avgComposite: 0.81, correctionF1: 0.55, reportPath: '/tmp/b' },
        candidate: { label: 'candidate', casesEvaluated: 27, exactMatches: 2, avgComposite: 0.84, correctionF1: 0.61, reportPath: '/tmp/c' },
    },
    proposed_rules: [
        {
            original_text: 'veggies',
            corrected_text: 'vegetables',
            change_type: 'spelling',
            rule: 'Reviewer: veggies should always be vegetables.',
            applies_to_menu_type: 'all',
            is_location_specific: false,
            location: null,
            other_applicable_locations: [],
        },
    ],
    code_recommendations: [
        {
            title: 'Add poached egg raw-marker guard',
            description: 'Extend shouldAddRawAsterisk to cover soft-boiled eggs.',
            manifest_rule_ids: ['pre-ai/raw-asterisk-insertion'],
            target_file_hint: 'services/dashboard/lib/pre-ai-deterministic-rules.ts',
        },
    ],
};

describe('prompt-proposal view', () => {
    test('renders the empty state mentioning the improvement cycle', () => {
        const html = renderProposalView();
        expect(html).toContain('improve:cycle');
        expect(html).toContain('No prompt proposals yet');
    });

    test('renders eval results, proposed rules with checkboxes, and code recommendations for a pending proposal', () => {
        const html = renderProposalView({ proposal: baseProposal });

        expect(html).toContain('Source Corrections');
        expect(html).toContain('Eval Results');
        expect(html).toContain('84.00%');
        expect(html).toContain('5 / 22 / 0');

        expect(html).toContain('Proposed Deterministic Replacement Rules');
        expect(html).toContain('proposed-rule-checkbox');
        expect(html).toContain('veggies');
        expect(html).toContain('vegetables');

        expect(html).toContain('Code Recommendations');
        expect(html).toContain('Add poached egg raw-marker guard');
        expect(html).toContain('accepted_rule_indexes');

        expect(html).toContain('Improvement cycle');
    });

    test('renders LLM validation notes when output rules were dropped or guarded', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                llm_warnings: [
                    'rule 4 dropped: "pepita" was mentioned in analysis but was not a valid replacement rule',
                ],
            },
        });

        expect(html).toContain('Validation Notes');
        expect(html).toContain('rule 4 dropped');
        expect(html).toContain('pepita');
    });

    test('renders the client-side diff scaffold (current/proposed textareas + diff containers)', () => {
        const html = renderProposalView({ proposal: baseProposal });
        // The diff is computed in the browser from these elements; assert they exist.
        expect(html).toContain('id="currentPrompt"');
        expect(html).toContain('id="proposedPrompt"');
        expect(html).toContain('id="diffView"');
        expect(html).toContain('id="promptDiffSummary"');
        expect(html).toContain('Prompt Changes');
        expect(html).toContain('function lineDiff');
        // The old never-populated stored-diff path is gone.
        expect(html).not.toContain('No diff available');
    });

    test('renders regressed eval results with the regression table and hides checkboxes when reviewed', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                status: 'approved',
                eval_status: 'regressed',
                eval_summary: {
                    ...baseProposal.eval_summary,
                    regressed: 1,
                    regressions: [{ case_id: 'c1', label: 'TORO MALTA MENU', delta: -0.0123 }],
                },
            },
        });

        expect(html).toContain('TORO MALTA MENU');
        expect(html).toContain('-1.230 pp');
        expect(html).not.toContain('proposed-rule-checkbox');
    });

    test('renders legacy proposals without eval or rules sections', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                source: 'prompt_rewrite',
                eval_status: null,
                eval_summary: null,
                proposed_rules: null,
                code_recommendations: null,
            },
        });
        expect(html).not.toContain('Eval Results');
        expect(html).not.toContain('Proposed Deterministic Replacement Rules');
        expect(html).toContain('Prompt rewrite');
    });

    test('renders no_effect eval status with distinct amber class on detail and in history', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                eval_status: 'no_effect',
                eval_summary: { ...baseProposal.eval_summary, triggers_improved: 0, triggers_regressed: 0 },
            },
            history: [
                { cycle_id: '2026-06-10', status: 'rejected', eval_status: 'no_effect', correction_rule_count: 0, submission_count: 2, created_at: '2026-06-10T10:00:00Z' },
            ],
        });
        // Detail meta uses the amber chip
        expect(html).toContain('class="badge no_effect"');
        expect(html).toContain('no_effect');
        // History table includes Eval column header and the amber badge for the row
        expect(html).toContain('<th>Eval</th>');
        expect(html).toMatch(/<td>.*class="badge no_effect".*no_effect.*<\/td>/s);
    });

    test('renders validated coverage claims section (Fix 5)', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                coverage_claims: [
                    { correction_id: 'c42', prompt_quote: 'always use the full word vegetables', explanation: 'exact section' },
                ],
            },
        });
        expect(html).toContain('Coverage Claims (validated)');
        expect(html).toContain('c42');
        expect(html).toContain('always use the full word vegetables');
        expect(html).toContain('replay evidence takes precedence');
    });

    test('renders thin-evidence amber badge and respects thin-unchecked default (B6)', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                status: 'pending',
                proposed_rules: [
                    { original_text: 'veggies', corrected_text: 'vegetables', change_type: 'terminology', rule: 'use full', applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [], evidence_submission_count: 1, evidence_occurrence_count: 1 },
                    { original_text: 'radish', corrected_text: 'radishes', change_type: 'spelling', rule: 'plural', applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [], evidence_submission_count: 3 },
                ],
            },
            thinRuleUncheckedDefault: true,
        });
        expect(html).toContain('single-submission evidence');
        // First rule (thin) should not have checked when default-unchecked
        expect(html).toMatch(/data-rule-index="0" (?!checked)/);
        // Second (multi) still checked
        expect(html).toMatch(/data-rule-index="1"[^>]*checked/);
    });

    test('renders supersede metadata: combined correction count and supersedes line', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                superseded_from_cycle_id: '2026-07-01',
                supersede_carried_correction_count: 4,
                supersede_new_correction_count: 2,
                correction_rule_count: 6,
            },
        });
        expect(html).toContain('Supersedes');
        expect(html).toContain('2026-07-01');
        expect(html).toContain('4 carried + 2 new');
    });

    test('C2: renders the disposition headline in plain language', () => {
        const html = renderProposalView({
            proposal: { ...baseProposal, disposition: 'rules_and_prompt' },
        });
        expect(html).toContain('Disposition');
        expect(html).toContain('replacement rule(s) + a prompt change');
    });

    test('C2: guard-discarded disposition collapses/labels the analysis as DISCARDED', () => {
        const html = renderProposalView({
            proposal: { ...baseProposal, disposition: 'no_change_guard_discarded' },
        });
        expect(html).toContain('DISCARDED');
        expect(html).toContain('describes a DISCARDED rewrite');
        // the analysis text lives inside a collapsible details block, not shown raw as a top-level box
        expect(html).toContain('Show the discarded analysis');
    });

    test('C2: renders computed prompt length before -> after', () => {
        const html = renderProposalView({
            proposal: { ...baseProposal, current_prompt: 'x'.repeat(100), proposed_prompt: 'y'.repeat(120) },
        });
        expect(html).toContain('Prompt length (computed)');
        expect(html).toContain('100');
        expect(html).toContain('120');
    });

    test('C3: renders the per-correction routing table at the top', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                disposition: 'prompt_change',
                correction_routing: [
                    { correction_id: 'a1', lane: 'prompt', target: 'section 4', note: 'sharpened', replay_status: 'still_missed', original_text: 'veggies', corrected_text: 'vegetables' },
                    { correction_id: 'b2', lane: 'dismissed', target: '', note: 'invalid', replay_status: 'not_verifiable', original_text: null, corrected_text: null, guidance: 'LAURENT-PERRIER must always be hyphenated' },
                ],
            },
        });
        expect(html).toContain('What happened to each correction');
        expect(html).toContain('section 4');
        // freeform correction shows the human's guidance, not a bare UUID
        expect(html).toContain('LAURENT-PERRIER must always be hyphenated');
        expect(html).not.toContain('freeform · b2');
        expect(html).toContain('guidance only');
    });

    test('C4a: renders the inferred-from-guidance badge on synthesized rules', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                proposed_rules: [
                    { original_text: 'jalapeno', corrected_text: 'jalapeño', change_type: 'diacritic', rule: 'accent', applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [], inferred_from_guidance: true, evidence_submission_count: 2 },
                ],
            },
        });
        expect(html).toContain('inferred from guidance');
    });

    test('rules_only proposal (prompt unchanged) hides the side-by-side and shows a no-change note', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                disposition: 'rules_only',
                current_prompt: 'IDENTICAL PROMPT TEXT',
                proposed_prompt: 'IDENTICAL PROMPT TEXT',
                final_prompt: null,
            },
        });
        expect(html).toContain('No prompt change in this proposal');
        expect(html).not.toContain('id="diffView"');
        // the editable proposed textarea still exists so Approve With Edits works
        expect(html).toContain('id="proposedPrompt"');
        // but not the read-only current-prompt side-by-side panel
        expect(html).not.toContain('id="currentPrompt"');
    });

    test('all-unavailable trigger cases collapse to a note instead of a wall of n/a rows', () => {
        const html = renderProposalView({
            proposal: {
                ...baseProposal,
                eval_summary: {
                    ...baseProposal.eval_summary,
                    triggers_unavailable: 2,
                    triggers: [
                        { case_id: 'production:manual-submission-1-x', baseline_composite: null, candidate_composite: null, delta: null, status: 'unavailable' },
                        { case_id: 'production:manual-submission-2-y', baseline_composite: null, candidate_composite: null, delta: null, status: 'unavailable' },
                    ],
                },
            },
        });
        expect(html).toContain('Trigger progression not measurable');
        expect(html).not.toContain('production:manual-submission-1-x');
    });

    test('history shows superseded status with pointer to replacing cycle', () => {
        const html = renderProposalView({
            history: [
                { cycle_id: '2026-07-01', status: 'superseded', superseded_by_cycle_id: '2026-07-02', correction_rule_count: 4, submission_count: 1, created_at: '2026-07-01T10:00:00Z' },
            ],
        });
        expect(html).toContain('class="badge superseded"');
        expect(html).toContain('superseded');
        expect(html).toContain('2026-07-02');
    });
});
