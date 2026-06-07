"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ejs = require('ejs');
const viewPath = path_1.default.resolve(__dirname, '../views/learning.ejs');
function renderLearningView(overrides = {}) {
    const template = fs_1.default.readFileSync(viewPath, 'utf8');
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
        curatedActiveRules: [],
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
        documentStorageRoot: '',
        ...overrides,
    }, { filename: viewPath });
}
describe('learning dashboard view', () => {
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
                }],
        });
        expect(html).toContain('Examples');
        expect(html).toContain('ruleExamplesPayload');
        expect(html).toContain('"original_text":"radishes"');
        expect(html).toContain('"submission_ids":["sub-123"]');
        expect(html).toContain('rule-examples-row-rule-1');
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
    test('shows active pre-AI rules without rendering the full AI prompt', () => {
        const html = renderLearningView({
            basePrompt: 'SECRET PROMPT TEXT',
            curatedActiveRules: [{
                    label: 'veggies -> vegetables',
                    detail: 'Accepted human guidance, except veggie burger wording.',
                    source: 'human',
                    status: 'Active code guard',
                    evidenceCount: 2,
                }],
            activeExactRules: [{
                    original_text: 'tomatoes',
                    corrected_text: 'tomato',
                    rule: 'Always use "tomato" instead of "tomatoes"',
                    source: 'system',
                    location: 'All properties (global rule)',
                    is_location_specific: false,
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
                    pre_ai_status: 'Active exact rule',
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
                    pre_ai_active: false,
                }],
        });
        expect(html).toContain('Active Pre-AI Rules');
        expect(html).toContain('veggies -&gt; vegetables');
        expect(html).toContain('Accepted Exact Rules Active In Pre-AI (1)');
        expect(html).toContain('Accepted Manual Guidance (1)');
        expect(html).toContain('Beverage menus keep zero-proof section names.');
        expect(html).toContain('Beverage menus');
        expect(html).toContain('Accepted Correction Rule Audit Log (2)');
        expect(html).not.toContain('Current Base Prompt');
        expect(html).not.toContain('SECRET PROMPT TEXT');
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
