"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Pin rawMarkerPlacement so these tests are deterministic regardless of the
// ambient config/tenant.json (a demo tenant may set 'preserve', which turns off
// the post-AI marker canonicalization inside parseAIResponse). Defaults to the
// RSH convention; the dedicated 'preserve' tests below flip it.
// (jest.mock factories may only close over vars prefixed with `mock`.)
let mockRawMarkerPlacement = 'description_end';
jest.mock('@menumanager/tenant-config', () => {
    const actual = jest.requireActual('@menumanager/tenant-config');
    return {
        ...actual,
        getTenantConfig: () => {
            const cfg = actual.getTenantConfig();
            return { ...cfg, rulebook: { ...cfg.rulebook, rawMarkerPlacement: mockRawMarkerPlacement } };
        },
    };
});
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
// The 'preserve' branch (rulebook.rawMarkerPlacement) shipped untested: only the
// prompt-side section had coverage, not the post-AI decision in parseAIResponse
// that actually suppresses canonicalization for tenants whose house style keeps
// the author's marker position.
describe("rawMarkerPlacement branch in parseAIResponse", () => {
    const authored = 'Steak Tartare*, capers, egg yolk D,G 24';
    const canonical = 'Steak Tartare, capers, egg yolk * D,G 24';
    afterEach(() => {
        mockRawMarkerPlacement = 'description_end';
    });
    test("default 'description_end' canonicalizes the AI's corrected menu", () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback(authored, []), authored);
        expect(parsed.correctedMenu).toBe(canonical);
    });
    test("'preserve' leaves the author's marker placement exactly as written", () => {
        mockRawMarkerPlacement = 'preserve';
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback(authored, []), authored);
        expect(parsed.correctedMenu).toBe(authored);
    });
    test("'preserve' does not collapse duplicate markers either", () => {
        mockRawMarkerPlacement = 'preserve';
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('Salmon Crudo*, ponzu* 16', []), 'Salmon Crudo*, ponzu* 16');
        expect(parsed.correctedMenu).toBe('Salmon Crudo*, ponzu* 16');
    });
    test("'preserve' still parses suggestions and applies the other guards", () => {
        mockRawMarkerPlacement = 'preserve';
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback(authored, [
            { type: 'Missing Price', confidence: 'high', menuItem: 'Tartare', description: 'x', recommendation: 'y' },
        ]), authored);
        expect(parsed.correctedMenu).toBe(authored);
        expect(parsed.suggestions).toHaveLength(1);
        // Severity forcing is independent of marker placement.
        expect(parsed.suggestions[0].severity).toBe('critical');
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
describe('detectKnownTextArtifactSuggestions', () => {
    test('adds an actionable suggestion for Cotes de Provence extraction artifacts', () => {
        const menu = 'Fleur de Mere, Rosé, ctes de provence, france GL 18/BTL 82';
        const result = (0, review_pipeline_1.detectKnownTextArtifactSuggestions)(menu, []);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'Possible Extraction Typo',
            confidence: 'high',
            severity: 'normal',
            menuItem: menu,
            recommendation: 'Change "ctes de provence" to "côtes de provence".',
        });
    });
    test('does not duplicate an existing AI suggestion for the same change', () => {
        const menu = 'Fleur de Mere, Rosé, ctes de provence, france GL 18/BTL 82';
        const result = (0, review_pipeline_1.detectKnownTextArtifactSuggestions)(menu, [{
                type: 'Spelling',
                confidence: 'high',
                severity: 'normal',
                menuItem: menu,
                description: 'Known wine region typo.',
                recommendation: 'Change "ctes de provence" to "côtes de provence".',
            }]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('Spelling');
    });
    test('leaves normal Cotes de Provence wording alone', () => {
        const menu = 'Fleur de Mere, Rosé, côtes de provence, france GL 18/BTL 82';
        expect((0, review_pipeline_1.detectKnownTextArtifactSuggestions)(menu, [])).toEqual([]);
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
    // Carries allergen codes so it is a genuinely well-formed menu — otherwise the
    // food-menu allergen-program check injects a critical "no allergen program".
    const menu = 'DINNER MENU\n\nGUACAMOLE\nfresh avocado, lime V,VG 12\n\nCAESAR SALAD\nromaine, parmesan D,G 14';
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
    test('adds known text artifact suggestions after AI output guards', () => {
        const menu = 'Fleur de Mere, Rosé, ctes de provence, france GL 18/BTL 82';
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(menu, []),
            preCheckedReviewBody: menu,
            // Beverage menu: the food-only allergen-program check must not fire here.
            templateType: 'beverage',
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.hasCriticalErrors).toBe(false);
        expect(result.finalSuggestions).toHaveLength(1);
        expect(result.finalSuggestions[0]).toMatchObject({
            type: 'Possible Extraction Typo',
            severity: 'normal',
            recommendation: 'Change "ctes de provence" to "côtes de provence".',
        });
    });
});
describe('enforceAllergenProgramCheck', () => {
    const uncodedMenu = [
        'OAK STEAKHOUSE',
        'STARTERS',
        'Crab Cake, house tartar, slaw 23',
        'Pork Belly, mushroom marsala ragout, fines herb oil 19',
    ].join('\n');
    const codedMenu = [
        'ANTOJITOS',
        'Guacamole, totopos, lime V,VG 14',
        'Queso Fundido, chorizo, flour tortillas D,G 16',
    ].join('\n');
    it('injects one critical Entire-menu suggestion when no dish carries allergen codes', () => {
        const result = (0, review_pipeline_1.enforceAllergenProgramCheck)(uncodedMenu, []);
        const allergen = result.filter((s) => (s.type || '').toLowerCase().includes('allergen'));
        expect(allergen).toHaveLength(1);
        expect(allergen[0].severity).toBe('critical');
        expect(allergen[0].menuItem).toBe('Entire menu');
    });
    it('does not inject when dishes carry allergen code clusters', () => {
        const result = (0, review_pipeline_1.enforceAllergenProgramCheck)(codedMenu, []);
        expect(result.filter((s) => (s.type || '').toLowerCase().includes('allergen'))).toHaveLength(0);
    });
    it('does not duplicate an existing AI allergen suggestion', () => {
        const existing = [{ type: 'Allergen Code', severity: 'critical', menuItem: 'Entire menu' }];
        const result = (0, review_pipeline_1.enforceAllergenProgramCheck)(uncodedMenu, existing);
        expect(result.filter((s) => (s.type || '').toLowerCase().includes('allergen'))).toHaveLength(1);
    });
    it('keeps unrelated suggestions intact', () => {
        const existing = [{ type: 'Spelling', severity: 'normal', menuItem: 'Crab Cake' }];
        const result = (0, review_pipeline_1.enforceAllergenProgramCheck)(uncodedMenu, existing);
        expect(result).toHaveLength(2);
    });
});
