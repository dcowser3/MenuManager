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
});
