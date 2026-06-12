"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ejs = require('ejs');
const viewPath = path_1.default.resolve(__dirname, '../views/learning-submission.ejs');
function renderLearningSubmission() {
    const template = fs_1.default.readFileSync(viewPath, 'utf8');
    return ejs.render(template, {
        title: 'Learning Review: sub-123',
        submissionId: 'sub-123',
        learningDetail: {
            timestamp: '2026-05-20T12:00:00.000Z',
            dish_correction_count: 1,
            dish_corrections: [
                {
                    correction_id: 'dish-6',
                    change_type: 'modified',
                    before_line: 'Churro French Toast, banana, cajeta sauce, grandma chocolate sauce',
                    after_line: "Churro French Toast, banana, cajeta sauce, abuelita's chocolate sauce </script><div>bad</div>",
                    diff_html: '<span>safe rendered diff</span>',
                },
            ],
        },
        submissionMeta: {
            project_name: "Chef's Test Menu",
            property: 'Maya - New York',
        },
        savedCorrectionRules: [],
        locationOptions: ['Maya - New York'],
    }, { filename: viewPath });
}
describe('learning-submission view', () => {
    test('keeps quoted dish text out of the Save Explanation button markup', () => {
        const html = renderLearningSubmission();
        const saveButton = html.match(/<button[^>]*class="btn save-rule-btn"[^>]*>([\s\S]*?)<\/button>/);
        expect(saveButton).not.toBeNull();
        expect(saveButton?.[0]).toContain('data-dish-index="0"');
        expect(saveButton?.[1]).toBe('Save Explanation');
        expect(saveButton?.[0]).not.toContain("abuelita's chocolate sauce");
        expect(html).not.toContain("onclick='saveDishRule");
    });
    test('describes reviewer annotation as a correction explanation, not a rule', () => {
        const html = renderLearningSubmission();
        expect(html).toContain('Explain this correction; the final rule is decided later');
        expect(html).toContain('Correction Explanation *');
        expect(html).toContain('Should this explanation be limited to specific properties?');
        expect(html).toContain('Limit to specific property?');
        expect(html).toContain('Saved Correction Explanations For This Submission');
        expect(html).toContain('No saved explanations yet.');
        expect(html).toContain('Explanation is required.');
        expect(html).not.toContain('Write the actionable rule this correction represents');
        expect(html).not.toContain('Does this rule apply to specific properties?');
    });
    test('escapes embedded correction JSON so script tags cannot break the page', () => {
        const html = renderLearningSubmission();
        expect(html).toContain('abuelita\\u0027s chocolate sauce');
        expect(html).toContain('\\u003c/script\\u003e\\u003cdiv\\u003ebad\\u003c/div\\u003e');
        expect(html).not.toContain('</script><div>bad</div>');
        expect(html).toContain('projectName":"Chef\\u0027s Test Menu');
    });
    test('renders menu scope controls for saved correction rules', () => {
        const html = renderLearningSubmission();
        expect(html).toContain('id="menu-scope-0"');
        expect(html).toContain('<option value="food">Food menus only</option>');
        expect(html).toContain('<option value="beverage">Beverage menus only</option>');
        expect(html).toContain('applies_to_menu_type: menuScope');
    });
});
