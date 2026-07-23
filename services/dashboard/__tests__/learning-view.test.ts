import fs from 'fs';
import path from 'path';

const ejs = require('ejs');

const viewPath = path.resolve(__dirname, '../views/learning.ejs');

function renderLearningView(overrides: Record<string, unknown> = {}) {
    const template = fs.readFileSync(viewPath, 'utf8');

    return ejs.render(template, {
        title: 'Learning Rules',
        generatedAt: null,
        minOccurrences: 2,
        totalEntries: 1,
        totalRules: 0,
        detectedPatterns: [],
        pendingRules: [],
        ignoredSystemPendingRules: [],
        acceptedRules: [],
        activeExactRules: [],
        manualGuidanceRules: [],
        recentSubmissions: [],
        learningSubmissions: [],
        propertyOptions: [],
        differStatus: {
            rulesOk: true,
            trainingOk: true,
            submissionsOk: true,
            rulesError: '',
            trainingError: '',
            submissionsError: '',
        },
        basePrompt: '',
        learningDashboardTimeZone: 'America/New_York',
        ...overrides,
    }, { filename: viewPath });
}

describe('learning dashboard view', () => {
    test('does not expose deployment storage-path diagnostics in the page chrome', () => {
        const html = renderLearningView({
            documentStorageRoot: '/app/tmp/documents',
        });

        expect(html).not.toContain('Cloud Deployment Note');
        expect(html).not.toContain('DOCUMENT_STORAGE_ROOT');
        expect(html).not.toContain('/app/tmp/documents');
    });

    test('formats learning scan timestamps in the configured dashboard timezone', () => {
        const html = renderLearningView({
            generatedAt: '2026-06-19T01:46:16.000Z',
            learningDashboardTimeZone: 'America/New_York',
        });

        expect(html).toContain('6/18/2026, 9:46:16 PM EDT');
        expect(html).not.toContain('6/19/2026, 1:46:16 AM');
    });

    test('shows menu names in the recent learned submissions column', () => {
        const html = renderLearningView({
            learningSubmissions: [{
                submission_id: '83b0220a-ccf6-460c-be69-fa3d0a37bc22',
                submission_display_name: 'Aqimero Brunch Menu',
                submission_display_detail: 'Aqimero | brunch | 83b0220a',
                timestamp: '2026-05-22T20:18:43.000Z',
                changes_detected: true,
                change_percentage: 3.25,
                replacement_count: 1,
                ai_draft_path: '/tmp/form-1779242807016-draft.docx',
                final_path: '/tmp/83b0220a-ccf6-460c-be69-fa3d0a37bc22-approved.docx',
            }],
        });

        expect(html).toContain('Aqimero Brunch Menu');
        expect(html).toContain('Aqimero | brunch | 83b0220a');
        expect(html).not.toContain('<td><code>83b0220a-ccf6-460c-be69-fa3d0a37bc22</code></td>');
    });

    test('uses learning submissions for the empty-state decision when training data is unavailable', () => {
        const html = renderLearningView({
            recentSubmissions: [],
            learningSubmissions: [{
                submission_id: 'sub-1',
                submission_display_name: 'Recovered Menu',
                timestamp: '2026-05-22T20:18:43.000Z',
                changes_detected: false,
                change_percentage: 0,
                replacement_count: 0,
            }],
        });

        expect(html).toContain('Recovered Menu');
        expect(html).not.toContain('No training submissions recorded yet.');
    });

    test('renders evidence controls for pending system rules', () => {
        const html = renderLearningView({
            pendingRules: [{
                id: 'rule-1',
                original_text: 'radishes',
                corrected_text: 'radish',
                rule: 'Always use "radish" instead of "radishes"',
                source: 'system',
                restaurant_name: '',
                location: 'All properties (global rule)',
                is_location_specific: false,
                occurrences: 2,
                confidence: 0.6,
                submission_ids: ['sub-123'],
                created_at: '2026-06-26T14:30:00.000Z',
            }],
        });

        expect(html).toContain('Examples');
        expect(html).toContain('Created / From');
        expect(html).toContain('Detected pattern scan');
        expect(html).toContain('6/26/2026, 10:30:00 AM EDT');
        expect(html).toContain('ruleExamplesPayload');
        expect(html).toContain('"original_text":"radishes"');
        expect(html).toContain('"submission_ids":["sub-123"]');
        expect(html).toContain('rule-examples-row-rule-1');
        expect(html).toContain('Project / Location');
    });

    test('shows whether pending human rules came from general entry or a menu correction page', () => {
        const html = renderLearningView({
            pendingRules: [
                {
                    id: 'manual-rule',
                    submission_id: 'manual-submission-123',
                    original_text: 'ahi tuna',
                    corrected_text: 'ahi tuna',
                    rule: 'Ahi tuna is the correct spelling.',
                    source: 'human',
                    restaurant_name: '',
                    location: 'All properties (global rule)',
                    is_location_specific: false,
                    created_at: '2026-06-26T15:00:00.000Z',
                },
                {
                    id: 'menu-rule',
                    submission_id: 'submission-123',
                    original_text: 'ají tuna',
                    corrected_text: 'ahi tuna',
                    rule: 'Ahi tuna is the correct spelling.',
                    source: 'human',
                    project_name: 'Tamayo Lunch Menu',
                    restaurant_name: 'Tamayo Lunch Menu',
                    location: 'All properties (global rule)',
                    is_location_specific: false,
                    created_at: '2026-06-26T15:30:00.000Z',
                },
            ],
        });

        expect(html).toContain('General add-rule area');
        expect(html).toContain('Menu correction page');
        expect(html).toContain('Tamayo Lunch Menu');
        expect(html).toContain('6/26/2026, 11:00:00 AM EDT');
        expect(html).toContain('6/26/2026, 11:30:00 AM EDT');
    });

    test('renders the manual add-rule form with menu and property scope controls', () => {
        const html = renderLearningView({
            propertyOptions: ['Maya - New York', 'Tamayo - Denver'],
        });

        expect(html).toContain('id="manualRuleForm"');
        expect(html).toContain('id="manual-rule-menu-type"');
        expect(html).toContain('<option value="food">Food menus only</option>');
        expect(html).toContain('<option value="beverage">Beverage menus only</option>');
        expect(html).toContain('id="manual-rule-location-specific"');
        expect(html).toContain('<option value="Maya - New York">Maya - New York</option>');
        expect(html).toContain("fetch('/api/learning/correction-rules'");
        expect(html).toContain('applies_to_menu_type');
    });

    test('renders the pre-AI rule tables and audit log without rendering the full AI prompt', () => {
        const html = renderLearningView({
            basePrompt: 'SECRET PROMPT TEXT',
            activeExactRules: [{
                original_text: 'tomatoes',
                corrected_text: 'tomato',
                rule: 'Always use "tomato" instead of "tomatoes"',
                source: 'system',
                location: 'All properties (global rule)',
                is_location_specific: false,
                implementation_detail: 'Pre-AI replaces the exact phrase "tomatoes" with "tomato" when menu and property scope match.',
            }],
            manualGuidanceRules: [{
                rule: 'Beverage menus keep zero-proof section names.',
                applies_to_menu_type: 'beverage',
                source: 'human',
                location: 'All properties (global rule)',
                is_location_specific: false,
                pre_ai_status: 'Manual guidance',
                pre_ai_active: false,
            }],
            acceptedRules: [{
                original_text: 'tomatoes',
                corrected_text: 'tomato',
                rule: 'Always use "tomato" instead of "tomatoes"',
                source: 'system',
                location: 'All properties (global rule)',
                is_location_specific: false,
                pre_ai_status: 'Active exact replacement',
                implementation_status: 'Active exact replacement',
                implementation_detail: 'Pre-AI replaces the exact phrase "tomatoes" with "tomato" when menu and property scope match.',
                pre_ai_active: true,
            }, {
                original_text: null,
                corrected_text: null,
                rule: 'Beverage menus keep zero-proof section names.',
                source: 'human',
                applies_to_menu_type: 'beverage',
                location: 'All properties (global rule)',
                is_location_specific: false,
                pre_ai_status: 'Manual guidance',
                implementation_status: 'Manual guidance',
                implementation_detail: 'No exact before/after replacement was supplied; this remains reviewer guidance and prompt-proposal material.',
                pre_ai_active: false,
            }],
        });

        expect(html).toContain('Active Pre-AI Rules');
        expect(html).toContain('Accepted Exact Replacement Rules Active In Pre-AI (1)');
        expect(html).toContain('Accepted Manual Guidance (1)');
        // The four static example cards were removed; the data tables remain.
        expect(html).not.toContain('veggies -&gt; vegetables');
        expect(html).not.toContain('rule-card-title');
        expect(html).toContain('Pre-AI replaces the exact phrase &#34;tomatoes&#34; with &#34;tomato&#34; when menu and property scope match.');
        expect(html).toContain('What Code Does');
        expect(html).toContain('Beverage menus keep zero-proof section names.');
        expect(html).toContain('Accepted Correction Rule Audit Log (2)');
        expect(html).toContain('Project / Menu');
        expect(html).not.toContain('<th>Restaurant</th>');
        expect(html).not.toContain('Current Base Prompt');
        expect(html).not.toContain('SECRET PROMPT TEXT');
    });

    test('labels threshold-met detected patterns as candidates instead of active rules', () => {
        const html = renderLearningView({
            detectedPatterns: [{
                source: 'tartare',
                target: 'tartar',
                kind: 'spelling',
                category: 'active',
                occurrences: 2,
                submission_count: 2,
                confidence: 0.64,
                last_seen_at: '2026-06-15T22:43:44.000Z',
                implementation_status: 'Context guidance only',
                implementation_detail: 'No blind replacement is active because tartare depends on usage; handle through reviewer judgment or prompt guidance.',
            }],
        });

        expect(html).toContain('tartare');
        expect(html).toContain('tartar');
        expect(html).toContain('Candidate');
        // Reworked table: patterns are promoted to pending rules via an action button.
        expect(html).toContain('Detected Patterns (Needs a Decision)');
        expect(html).toContain('Add rule');
        expect(html).toContain('promote it to a <strong>pending rule</strong>');
        // Context-dependent patterns show an inline hint; the full detail rides in the title attribute.
        expect(html).toContain('context-dependent — an explanation helps the cycle route it');
        expect(html).toContain('No blind replacement is active because tartare depends on usage');
        expect(html).not.toContain('>active</span>');
    });

    test('keeps stale system proposals out of the actionable pending table', () => {
        const html = renderLearningView({
            pendingRules: [],
            ignoredSystemPendingRules: [{
                id: 'stale-rule',
                original_text: 'radishes',
                corrected_text: 'radish',
                rule: 'Always use "radish" instead of "radishes"',
                source: 'system',
                created_at: '2026-05-26T18:11:46.250Z',
            }],
        });

        expect(html).toContain('No actionable pending rules');
        expect(html).toContain('Ignored stale system proposals (1)');
        expect(html).toContain('These are pending system proposals from older detected-pattern data');
        expect(html).not.toContain("reviewRule('stale-rule'");
    });
});
