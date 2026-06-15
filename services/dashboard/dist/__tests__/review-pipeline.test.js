"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const review_pipeline_1 = require("../lib/review-pipeline");
function buildFeedback(correctedMenu, suggestions) {
    return [
        '=== CORRECTED MENU ===',
        correctedMenu,
        '=== END CORRECTED MENU ===',
        '',
        '=== SUGGESTIONS ===',
        JSON.stringify(suggestions),
        '=== END SUGGESTIONS ===',
    ].join('\n');
}
describe('parseAIResponse (extracted from index.ts)', () => {
    test('extracts corrected menu and suggestions from markers', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('GUACAMOLE\nfresh avocado 12', [
            { type: 'Spelling', confidence: 'high', menuItem: 'GUACAMOLE', description: 'x', recommendation: 'y' },
        ]), 'ORIGINAL');
        expect(parsed.correctedMenu).toBe('GUACAMOLE\nfresh avocado 12');
        expect(parsed.suggestions).toHaveLength(1);
        expect(parsed.suggestions[0].severity).toBe('normal');
    });
    test('falls back to the original menu when markers are absent and to [] on bad JSON', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)('no markers here', 'ORIGINAL MENU');
        expect(parsed.correctedMenu).toBe('ORIGINAL MENU');
        expect(parsed.suggestions).toEqual([]);
        const badJson = (0, review_pipeline_1.parseAIResponse)('=== CORRECTED MENU ===\nMENU\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\nnot json\n=== END SUGGESTIONS ===', 'ORIGINAL');
        expect(badJson.suggestions).toEqual([]);
    });
    test('forces critical severity for known critical types', () => {
        const suggestions = [
            { type: 'Missing Price', menuItem: 'A', description: '', recommendation: '' },
            { type: 'Incomplete Dish Name', menuItem: 'B', description: '', recommendation: '' },
            { type: 'Set Menu Item Price', menuItem: 'C', description: '', recommendation: '' },
            { type: 'Course Progression', menuItem: 'D', description: '', recommendation: '' },
            { type: 'PRICING STRUCTURE', menuItem: 'E', description: '', recommendation: '' },
            { type: 'Spelling', menuItem: 'F', description: 'minor typo', recommendation: 'fix' },
        ];
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('MENU', suggestions), 'MENU');
        const severities = parsed.suggestions.map((s) => s.severity);
        expect(severities).toEqual(['critical', 'critical', 'critical', 'critical', 'critical', 'normal']);
    });
    test('fallback regex reclassifies missing-price descriptions as critical', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('MENU', [
            { type: 'Other', menuItem: 'Tacos', description: 'This item has a missing price at the end', recommendation: '' },
        ]), 'MENU');
        expect(parsed.suggestions[0].type).toBe('Missing Price');
        expect(parsed.suggestions[0].severity).toBe('critical');
    });
    test('exported forced-critical type lists match the implementation contract', () => {
        expect(review_pipeline_1.FORCED_CRITICAL_EXACT_TYPES).toEqual(['Missing Price', 'Incomplete Dish Name']);
        expect(review_pipeline_1.FORCED_CRITICAL_NORMALIZED_TYPES).toEqual(['set menu item price', 'course progression', 'pricing structure']);
    });
});
describe('normalizeRawAsteriskPlacement (post-AI canonicalization)', () => {
    test('moves the raw marker before trailing allergens and price', () => {
        expect((0, review_pipeline_1.normalizeRawAsteriskPlacement)('Steak Tartare*, capers, egg yolk D,G 24'))
            .toBe('Steak Tartare, capers, egg yolk * D,G 24');
    });
    test('collapses duplicate markers to a single canonical marker', () => {
        expect((0, review_pipeline_1.normalizeRawAsteriskPlacement)('Salmon Crudo*, ponzu* 16'))
            .toBe('Salmon Crudo, ponzu * 16');
    });
    test('leaves titles, legends, and the raw notice untouched', () => {
        const notice = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';
        expect((0, review_pipeline_1.normalizeRawAsteriskPlacement)(notice)).toBe(notice);
        expect((0, review_pipeline_1.normalizeRawAsteriskPlacement)('RAW BAR*')).toBe('RAW BAR*');
        expect((0, review_pipeline_1.normalizeRawAsteriskPlacement)('G gluten | V veg | *raw item')).toBe('G gluten | V veg | *raw item');
    });
});
describe('enforcePrixFixeCriticalChecks', () => {
    const numberedMenu = '85 | 40 wine pairing\n1\nFirst Course\nsoup\n2\nSecond Course\nfish';
    const unnumberedNoPrice = 'First Course\nsoup\nSecond Course\nfish';
    test('synthesizes critical pricing and course-numbering suggestions when missing', () => {
        const result = (0, review_pipeline_1.enforcePrixFixeCriticalChecks)(unnumberedNoPrice, []);
        const types = result.map((s) => s.type);
        expect(types).toContain('PRICING STRUCTURE');
        expect(types).toContain('COURSE NUMBERING');
        expect(result.every((s) => s.severity === 'critical')).toBe(true);
    });
    test('does not duplicate suggestions when the menu is well-formed', () => {
        const result = (0, review_pipeline_1.enforcePrixFixeCriticalChecks)(numberedMenu, []);
        expect(result).toEqual([]);
    });
    test('removes AI course-numbering false positives when numbers are present', () => {
        const result = (0, review_pipeline_1.enforcePrixFixeCriticalChecks)(numberedMenu, [
            { type: 'Course Numbering', severity: 'critical', menuItem: 'Courses', description: 'courses are not numbered', recommendation: 'number them' },
        ]);
        expect(result).toEqual([]);
    });
});
describe('reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics', () => {
    test('drops criticals already resolved in the corrected menu and keeps the rest', () => {
        const corrected = 'GUACAMOLE\nfresh avocado, lime 12\nTACOS\nal pastor, pineapple';
        const result = (0, review_pipeline_1.reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics)(corrected, [
            { type: 'Missing Price', severity: 'critical', menuItem: 'GUACAMOLE', description: '', recommendation: '' },
            { type: 'Missing Price', severity: 'critical', menuItem: 'TACOS', description: '', recommendation: '' },
            { type: 'Spelling', severity: 'normal', menuItem: 'TACOS', description: '', recommendation: '' },
        ]);
        expect(result.droppedSuggestions).toHaveLength(1);
        expect(result.droppedSuggestions[0].suggestion.menuItem).toBe('GUACAMOLE');
        expect(result.droppedSuggestions[0].reason).toBe('critical_resolved_in_corrected_menu');
        expect(result.suggestions.map((s) => s.menuItem)).toEqual(['TACOS', 'TACOS']);
    });
    test('drops incomplete-dish-name false positives for standalone selection instructions', () => {
        const corrected = [
            'Specialties',
            'choose one',
            'Avocado Toast, sourdough bread, sunny-side-up egg G,V',
        ].join('\n');
        const result = (0, review_pipeline_1.reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics)(corrected, [
            {
                type: 'Incomplete Dish Name',
                severity: 'critical',
                menuItem: 'choose one',
                description: "The instruction 'choose one' does not provide a valid dish name.",
                recommendation: 'Consider renaming or providing a dish name.',
            },
        ]);
        expect(result.suggestions).toEqual([]);
        expect(result.droppedSuggestions).toHaveLength(1);
        expect(result.droppedSuggestions[0]).toMatchObject({
            reason: 'critical_false_positive_selection_instruction',
            matchedLine: 'choose one',
        });
    });
    test('keeps incomplete-dish-name criticals for description-only dish rows', () => {
        const corrected = 'Specialties\ngrilled, served with salsa 24';
        const result = (0, review_pipeline_1.reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics)(corrected, [
            {
                type: 'Incomplete Dish Name',
                severity: 'critical',
                menuItem: 'grilled, served with salsa 24',
                description: 'This item is missing a dish name.',
                recommendation: 'Add a dish name.',
            },
        ]);
        expect(result.droppedSuggestions).toEqual([]);
        expect(result.suggestions).toHaveLength(1);
    });
});
describe('runPostAiPipeline (full guard chain)', () => {
    const menu = 'DINNER MENU\n\nGUACAMOLE\nfresh avocado, lime 12\n\nCAESAR SALAD\nromaine, parmesan 14';
    test('passes a well-formed AI response through unchanged with no criticals', () => {
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(menu, []),
            preCheckedReviewBody: menu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.correctedMenuSanitized).toBe(menu);
        expect(result.finalSuggestions).toEqual([]);
        expect(result.hasCriticalErrors).toBe(false);
        expect(result.structureGuard.safe).toBe(true);
    });
    test('structure guard rejects an AI response that collapses the menu', () => {
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback('GUACAMOLE', []),
            preCheckedReviewBody: menu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.structureGuard.safe).toBe(false);
        expect(result.guardedCorrectedMenu).toBe(menu);
        expect(result.correctedMenuSanitized).toBe(menu);
    });
    test('reconciliation drops resolved criticals after guards run', () => {
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(menu, [
                { type: 'Missing Price', severity: 'critical', confidence: 'high', menuItem: 'GUACAMOLE', description: 'missing price', recommendation: 'add price' },
            ]),
            preCheckedReviewBody: menu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.reconciliation.droppedSuggestions).toHaveLength(1);
        expect(result.finalSuggestions).toEqual([]);
        expect(result.hasCriticalErrors).toBe(false);
    });
    test('prix fixe menus get synthesized critical checks', () => {
        const prixFixeMenu = 'First Course\nsoup\nSecond Course\nfish';
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(prixFixeMenu, []),
            preCheckedReviewBody: prixFixeMenu,
            menuType: 'prix_fixe',
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.hasCriticalErrors).toBe(true);
        expect(result.criticalSuggestions.map((s) => s.type)).toEqual(expect.arrayContaining(['PRICING STRUCTURE', 'COURSE NUMBERING']));
    });
    test('does not block submission when AI flags a choice instruction as an incomplete dish name', () => {
        const brunchMenu = [
            'Endless Bubbles & Brunch',
            'Includes 4 courses & endless bubbly cocktails 85',
            '',
            'Specialties',
            'choose one',
            'Avocado Toast, sourdough bread, sunny-side-up egg G,V',
        ].join('\n');
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(brunchMenu, [
                {
                    type: 'Incomplete Dish Name',
                    severity: 'critical',
                    confidence: 'critical',
                    menuItem: 'choose one',
                    description: "The instruction 'choose one' does not provide a valid dish name.",
                    recommendation: 'Consider renaming or providing a dish name.',
                },
            ]),
            preCheckedReviewBody: brunchMenu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.hasCriticalErrors).toBe(false);
        expect(result.criticalSuggestions).toEqual([]);
        expect(result.reconciliation.droppedSuggestions[0].reason).toBe('critical_false_positive_selection_instruction');
    });
});
