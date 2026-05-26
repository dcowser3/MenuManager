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
        acceptedRules: [],
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
});
