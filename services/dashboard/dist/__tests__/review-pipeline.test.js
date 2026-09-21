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
const review_response_contract_1 = require("../lib/review-response-contract");
function buildFeedback(correctedMenu, suggestions) {
    return [
        review_response_contract_1.AI_REVIEW_FENCES.correctedMenuStart,
        correctedMenu,
        review_response_contract_1.AI_REVIEW_FENCES.correctedMenuEnd,
        '',
        review_response_contract_1.AI_REVIEW_FENCES.suggestionsStart,
        JSON.stringify(suggestions),
        review_response_contract_1.AI_REVIEW_FENCES.suggestionsEnd,
    ].join('\n');
}
describe('parseAIResponse (extracted from index.ts)', () => {
    test('replays the Toro response without moving allergen suffixes or adding a vegan raw marker', () => {
        const fixture = require('../__fixtures__/basic-check/toro-holiday.json');
        const corrected = fixture.modelCorrectedLines.join('\n');
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(corrected, []),
            preCheckedReviewBody: fixture.originalLines.join('\n'),
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: true,
            effectiveReviewAllergens: 'D dairy | G gluten | N nuts | S shellfish | V vegetarian | VG vegan',
        });
        expect(result.structureGuard.safe).toBe(true);
        expect(result.correctedMenuSanitized).toContain('Jumbo Shrimp, cocktail sauce, horseradish, lemons S');
        expect(result.correctedMenuSanitized).toContain('Snow Crab Claws & Crab Legs');
        expect(result.correctedMenuSanitized).not.toContain('Snow Crab Claws & Crab Legs S');
        expect(result.correctedMenuSanitized).not.toContain('Vegan Tiradito, cucumber, avocado, serrano, aguachile VG');
        expect(result.correctedMenuSanitized).not.toContain('Oysters, chipotle mignonette* S');
        expect(result.hasCriticalErrors).toBe(false);
    });
    test('extracts corrected menu and suggestions from markers', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('GUACAMOLE\nfresh avocado 12', [
            { type: 'Spelling', confidence: 'high', menuItem: 'GUACAMOLE', description: 'x', recommendation: 'y' },
        ]), 'ORIGINAL');
        expect(parsed.correctedMenu).toBe('GUACAMOLE\nfresh avocado 12');
        expect(parsed.fenceMissing).toBe(false);
        expect(parsed.suggestions).toHaveLength(1);
        expect(parsed.suggestions[0].severity).toBe('normal');
    });
    test('normalizes a string suggestion to the canonical object shape', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('MENU', ['Prices are not shown for the listed menu items; confirm whether prices should be added.']), 'MENU');
        expect(parsed.suggestions).toEqual([{
                type: 'General Review Note',
                confidence: 'medium',
                severity: 'normal',
                menuItem: '',
                description: 'Prices are not shown for the listed menu items; confirm whether prices should be added.',
                recommendation: '',
            }]);
    });
    test('normalizes strings while preserving object suggestions in a mixed array', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('MENU', [
            'Verify the price for Smoked BARBECUE Pulled Pork Sliders; the listed price “1” appears incomplete or incorrect.',
            { type: 'Spelling', confidence: 'high', menuItem: 'Maldon', description: 'Capitalization', recommendation: 'Use Maldon.' },
        ]), 'MENU');
        expect(parsed.suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'General Review Note', severity: 'normal', confidence: 'medium' }),
            expect.objectContaining({ type: 'Spelling', severity: 'normal', menuItem: 'Maldon' }),
        ]));
    });
    test('falls back to the original menu when markers are absent and to [] on bad JSON', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)('no markers here', 'ORIGINAL MENU');
        expect(parsed.correctedMenu).toBe('ORIGINAL MENU');
        expect(parsed.fenceMissing).toBe(true);
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
        expect(review_pipeline_1.FORCED_CRITICAL_HIGH_CONFIDENCE_TYPES).toEqual(['unrecognized term']);
    });
    test('forces a model-discovered unresolved nonword to critical severity', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('Mystery sauce', [{
                type: 'Unrecognized Term',
                confidence: 'high',
                severity: 'normal',
                menuItem: 'Mystery sauce',
                description: '"xyqzz" appears malformed and has no reliable contextual correction.',
                recommendation: 'Confirm or correct "xyqzz".',
                spellingDisposition: 'unresolved_nonword',
                sourceToken: 'xyqzz',
            }]), 'Mystery sauce');
        expect(parsed.suggestions[0]).toMatchObject({
            type: 'Unrecognized Term',
            confidence: 'high',
            severity: 'critical',
        });
    });
    test('does not make a medium-confidence unfamiliar term blocking', () => {
        const parsed = (0, review_pipeline_1.parseAIResponse)(buildFeedback('Mystery sauce', [{
                type: 'Unrecognized Term',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Mystery sauce',
                description: 'The term may be unfamiliar.',
                recommendation: 'Verify it.',
            }]), 'Mystery sauce');
        expect(parsed.suggestions[0].severity).toBe('normal');
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
    test.each([
        '68 pp',
        '50.00PP',
        'Bottomless Food & Drink 68 pp',
        'Bottomless Food & Drink 68 pp | Bottomless Food 39 pp',
        '85 | 40 wine pairing',
        '3 Courses | 60 | Your selection per course',
        'Three courses 35 Choice per course',
        'Choice One Selection Per Course 65',
        'Bloody Mary Omakase Bar 22',
        '275 AED – A full Margarita Pitcher...',
        '$60',
        '€60',
        '£60',
    ])('recognizes valid top-level price evidence: %s', (line) => {
        expect((0, review_pipeline_1.detectTopLevelPrixFixePrice)(line)).toMatchObject({ found: true, matchedLine: line });
        expect((0, review_pipeline_1.enforcePrixFixeCriticalChecks)(line, []).filter((s) => s.type === 'PRICING STRUCTURE')).toEqual([]);
    });
    test.each([
        '3 Courses',
        '2-hour time limit per table',
        'Available from 5:30pm',
        'January 2026',
        'Menu\nA La Carte\nGuacamole, onion, tomato, cilantro, lime VG 20',
        'Menu\nFirst Course\nSecond Course\nThird Course\nFourth Course\n68 pp',
    ])('rejects non-price or out-of-window evidence: %s', (menu) => {
        expect((0, review_pipeline_1.detectTopLevelPrixFixePrice)(menu)).toEqual(expect.objectContaining({ found: false }));
    });
    test('removes an AI missing-price warning when explicit price evidence exists', () => {
        const result = (0, review_pipeline_1.enforcePrixFixeCriticalChecks)('Bottomless Food & Drink 68 pp | Bottomless Food 39 pp', [{
                type: 'PRICING STRUCTURE',
                severity: 'critical',
                menuItem: 'Prix Fixe Menu',
                description: 'Prix fixe menu is missing a single price at the top.',
                recommendation: 'Add a prix fixe price at the top of the menu.',
            }]);
        expect(result).toEqual([]);
    });
    test('adds exactly one pricing critical for a genuinely unpriced menu', () => {
        const result = (0, review_pipeline_1.enforcePrixFixeCriticalChecks)(unnumberedNoPrice, [{
                type: 'Missing Price',
                severity: 'critical',
                menuItem: 'Entire menu',
                description: 'The prix fixe menu does not show an overall package price.',
                recommendation: 'Add the applicable prix fixe price near the top of the menu.',
            }]);
        const pricing = result.filter((s) => s.type === 'PRICING STRUCTURE');
        expect(pricing).toHaveLength(1);
        expect(result.filter((s) => s.type === 'Missing Price')).toHaveLength(0);
        expect(pricing[0]).toMatchObject({ severity: 'critical', confidence: 'high' });
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
    test('keeps an explicit valid culinary spelling decision out of chef-facing suggestions', () => {
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(menu, [{
                    type: 'Spelling Disposition',
                    spellingFindingId: 'CV-001',
                    spellingDisposition: 'valid_as_written',
                    sourceToken: 'GUACAMOLE',
                    menuItem: 'GUACAMOLE',
                    description: 'Valid culinary term as written.',
                    recommendation: '',
                }]),
            preCheckedReviewBody: menu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            canonicalSpellingFindings: [{
                    found: 'GUACAMOLE',
                    canonical: 'GUACAMOLÉ',
                    kind: 'ambiguous',
                    distance: 0,
                    message: 'context question',
                    source: 'approved_corpus',
                    confidence: 'medium',
                }],
            precheckEnabled: false,
        });
        expect(result.finalSuggestions).toEqual([]);
        expect(result.spellingAdjudications).toContainEqual(expect.objectContaining({
            findingId: 'CV-001',
            disposition: 'valid_as_written',
        }));
        expect(result.hasCriticalErrors).toBe(false);
    });
    test('blocks on a high-confidence unresolved nonword and leaves it overrideable', () => {
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(menu, [{
                    type: 'Unrecognized Term',
                    spellingFindingId: 'CV-001',
                    spellingDisposition: 'unresolved_nonword',
                    sourceToken: 'GUACAMOLE',
                    confidence: 'high',
                    menuItem: 'GUACAMOLE',
                    description: 'The token appears malformed but no safe correction is known.',
                    recommendation: 'Confirm, correct, or override it.',
                }]),
            preCheckedReviewBody: menu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            canonicalSpellingFindings: [{
                    found: 'GUACAMOLE',
                    canonical: 'GUACAMOLÉ',
                    kind: 'typo',
                    distance: 1,
                    message: 'candidate',
                    source: 'approved_corpus',
                    confidence: 'medium',
                }],
            precheckEnabled: false,
        });
        expect(result.hasCriticalErrors).toBe(true);
        expect(result.criticalSuggestions).toContainEqual(expect.objectContaining({
            type: 'Unrecognized Term',
            severity: 'critical',
            spellingDisposition: 'unresolved_nonword',
        }));
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
    test('does not silently lose an approved-corpus spelling suspicion the model ignored', () => {
        const typoMenu = 'Chicken, tamrind glaze D 24';
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(typoMenu, []),
            preCheckedReviewBody: typoMenu,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            canonicalSpellingFindings: [{
                    found: 'tamrind',
                    canonical: 'tamarind',
                    kind: 'typo',
                    distance: 1,
                    source: 'approved_corpus',
                    confidence: 'medium',
                    message: 'near miss',
                }],
            precheckEnabled: false,
        });
        expect(result.hasCriticalErrors).toBe(false);
        expect(result.finalSuggestions).toContainEqual(expect.objectContaining({
            type: 'Spelling',
            severity: 'normal',
            confidence: 'medium',
            menuItem: typoMenu,
        }));
    });
    test('restores protected terms after the model rewrites them', () => {
        const original = [
            'DINNER MENU',
            'Chicken, picked herbs, twice-baked potatoes D 24',
        ].join('\n');
        const modelRewrite = [
            'DINNER MENU',
            'Chicken, pickled herbs, twice -baked potatoes D 24',
        ].join('\n');
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(modelRewrite, []),
            preCheckedReviewBody: original,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.correctedMenuSanitized).toBe(original);
        expect(result.protectedTerms.restoredTerms).toEqual(['picked herbs', 'twice-baked']);
        expect(result.correctedMenuSanitized).not.toContain('pickled herbs');
        expect(result.correctedMenuSanitized).not.toContain('twice -baked');
    });
    test('restores protected terms after a model suggestion is auto-applied', () => {
        const original = 'Chicken, picked herbs, twice-baked potatoes D 24';
        const modelRewrite = 'Chicken, pickled herbs, twice -baked potatoes D 24';
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(modelRewrite, [
                {
                    type: 'Spelling',
                    confidence: 'high',
                    menuItem: original,
                    recommendation: 'Change "picked herbs" to "pickled herbs".',
                },
            ]),
            preCheckedReviewBody: original,
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.correctedMenuSanitized).toBe(original);
        expect(result.correctedMenuSanitized).not.toContain('pickled herbs');
    });
    test('restores submitted allergen after a late high-confidence suggestion removes it', () => {
        const original = 'Cusco Chicken, marinade S 22\nSteak, fries D 30';
        const modelRewrite = 'Cusco Chicken, marinade S 22\nSteak, fries D 30';
        const result = (0, review_pipeline_1.runPostAiPipeline)({
            feedback: buildFeedback(modelRewrite, [{
                    type: 'Spelling', confidence: 'high', menuItem: 'Cusco Chicken',
                    description: 'Remove the trailing code from the dish wording.',
                    recommendation: 'Change "marinade S" to "marinade".',
                }]),
            preCheckedReviewBody: original,
            effectiveReviewAllergens: 'S contains shellfish | D contains dairy',
            acceptedCorrectionRules: [],
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            precheckEnabled: false,
        });
        expect(result.correctedAfterHighConfidence).not.toContain('marinade S 22');
        expect(result.correctedMenuSanitized).toContain('Cusco Chicken, marinade S 22');
        expect(result.correctedMenuSanitized).toContain('Steak, fries D 30');
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
    it('recognizes trailing codes on description-less and described unpriced buffet dishes', () => {
        for (const line of ['Snow Crab Claws & Crab Legs S', 'Vegan Tiradito, cucumber, avocado VG']) {
            expect((0, review_pipeline_1.enforceAllergenProgramCheck)(line, [])).toEqual([]);
        }
    });
    it('does not mistake an uncoded dish plus legend for a coded buffet program', () => {
        const result = (0, review_pipeline_1.enforceAllergenProgramCheck)('Snow Crab Claws & Crab Legs\nS shellfish | VG vegan', []);
        expect(result).toEqual([expect.objectContaining({ severity: 'critical', menuItem: 'Entire menu' })]);
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
