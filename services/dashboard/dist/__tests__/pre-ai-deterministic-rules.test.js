"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pre_ai_deterministic_rules_1 = require("../lib/pre-ai-deterministic-rules");
describe('runPreAiDeterministicChecks', () => {
    it('applies safe built-in spelling and diacritic replacements before AI review', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Jalapeno Salad, passionfruit, mozarella D, G 18', { allergenLegend: 'D dairy | G gluten | V vegetarian' });
        expect(result.menuText).toBe('Jalapeño Salad, passion fruit, mozzarella D,G 18');
        expect(result.appliedCorrections.map((c) => c.type)).toEqual([
            'Diacritics',
            'Spelling',
            'Spelling',
            'Allergen Code',
        ]);
    });
    it('adds the ají tone mark generally while protecting Hawaiian ahi tuna phrases', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Aji Amarillo Rice 18',
            'Aji Panca Chicken D 24',
            'aji tuna tostada 18',
            'ají tuna tostada 18',
            'ahí tuna tostada 18',
            'Aji Lime Sauce 4',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Ají Amarillo Rice 18',
            'Ají Panca Chicken D 24',
            'ahi tuna tostada 18',
            'ahi tuna tostada 18',
            'ahi tuna tostada 18',
            'Ají Lime Sauce 4',
        ].join('\n'));
    });
    it('adds the cheese modifier to Cotija without duplicating or changing hyphenated forms', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Esquites, sweet yellow corn, spicy aioli, cotija, bacon* D 17',
            'Pork Belly, COTIJA CHEESE, pickled chili D,G 18',
            'Taco, Cotija Cheese, salsa verde D 15',
            'Corn, cotija-style crema D 12',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Esquites, sweet yellow corn, spicy aioli, cotija cheese, bacon* D 17',
            'Pork Belly, COTIJA CHEESE, pickled chili D,G 18',
            'Taco, Cotija Cheese, salsa verde D 15',
            'Corn, cotija-style crema D 12',
        ].join('\n'));
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            type: 'Terminology',
            original: 'cotija',
            corrected: 'cotija cheese',
            rule: 'Cotija must include the cheese modifier.',
        }));
        expect(result.appliedCorrections).toHaveLength(1);
    });
    it('normalizes existing raw marker placement and adds markers for strong raw terms', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Tuna Tartare F 24',
            'Sashimi F * 18',
            'Angry Zengo*, spicy tuna, avocado, lemon, yuzu kosho mayo E,F,SE',
            'Sushi & Sashimi Selection',
            '14oz Striploin *D 75',
            'Guacamole V 12',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Tuna Tartare* F 24',
            'Sashimi* F 18',
            'Angry Zengo*, spicy tuna, avocado, lemon, yuzu kosho mayo E,F,SE',
            'Sushi & Sashimi Selection',
            '14oz Striploin* D 75',
            'Guacamole V 12',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(3);
    });
    it('keeps raw asterisks attached to the last dish-name word', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Hamachi New Style Sashimi * CE,F,G,MU 98',
            'Tuna Ceviche CE,D,F 78',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Hamachi New Style Sashimi* CE,F,G,MU 98',
            'Tuna Ceviche* CE,D,F 78',
        ].join('\n'));
    });
    it('normalizes allergen spacing and case while alphabetizing code order', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Salad, tomato, herbs g, d 18', { allergenLegend: 'D dairy | G gluten | V vegetarian' });
        expect(result.menuText).toBe('Salad, tomato, herbs D,G 18');
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            type: 'Allergen Code',
            original: 'g, d',
            corrected: 'D,G',
        }));
    });
    it('applies curated human-review explanation rules before AI review', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Grilled Tlayuda, pickled veggies D,V 25',
            'Veggie Burger, lettuce V 18',
            'TORO TORO TRES LECHES D,E,G,TN',
            'Tres Leches Cake D,G 12',
            'Avocado Toast, poached egg, sourdough G 19',
            'Huevos Rancheros, sunny side up egg D 22',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Grilled Tlayuda, pickled vegetables D,V 25',
            'Veggie Burger, lettuce V 18',
            'TORO TORO TRES LECHES D,E,G,TN,V',
            'Tres Leches Cake D,G,V 12',
            'Avocado Toast, poached egg, sourdough* G 19',
            'Huevos Rancheros, sunny side up egg* D 22',
        ].join('\n'));
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'Spelling',
                original: 'veggies',
                corrected: 'vegetables',
            }),
            expect.objectContaining({
                type: 'Allergen Code',
                original: 'D,E,G,TN',
                corrected: 'D,E,G,TN,V',
                rule: 'Tres Leches always needs a vegetarian symbol V.',
            }),
            expect.objectContaining({
                type: 'Raw Item',
                original: 'Avocado Toast, poached egg, sourdough G 19',
                corrected: 'Avocado Toast, poached egg, sourdough* G 19',
            }),
            expect.objectContaining({
                type: 'Raw Item',
                original: 'Huevos Rancheros, sunny side up egg D 22',
                corrected: 'Huevos Rancheros, sunny side up egg* D 22',
            }),
        ]));
    });
    it('keeps intentional spelling preferences for brussels sprouts and dried chili', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Brussels Sprout, dry chili vinaigrette V 16',
            'Brussels Sprouts, dried chili vinaigrette V 16',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Brussels Sprouts, dried chili vinaigrette V 16',
            'Brussels Sprouts, dried chili vinaigrette V 16',
        ].join('\n'));
    });
    it('does not treat emphasis or multi-item separators as raw asterisk markers', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Submit *fully* approved menus to design@example.com.',
            'add spicy tuna* 8 | crispy pork belly 8',
            'Sashimi : sake F, suzuki F',
            '8oz Wagyu Filet* D MKT',
            'Wagyu Australian Tomahawk, served with bone marrow butter, chimichurri, choice of 2 sides* D MKT',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Submit *fully* approved menus to design@example.com.',
            'add spicy tuna* 8 | crispy pork belly 8',
            'Sashimi : sake F, suzuki F',
            '8oz Wagyu Filet* D MKT',
            'Wagyu Australian Tomahawk, served with bone marrow butter, chimichurri, choice of 2 sides* D MKT',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(0);
    });
    it('does not add raw markers to cooked ceviche or cooked oyster preparations', () => {
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'Shrimp Cocktail Ceviche, poached marinated shrimp, aguachile rojo, avocado S 26',
            'Temptation Oysters, spinach butter, jalapeño, parmesan, panko D,G,S 28',
            'Oysters on the Half Shell, mignonette S 24',
        ].join('\n'));
        expect(result.menuText).toBe([
            'Shrimp Cocktail Ceviche, poached marinated shrimp, aguachile rojo, avocado S 26',
            'Temptation Oysters, spinach butter, jalapeño, parmesan, panko D,G,S 28',
            'Oysters on the Half Shell, mignonette* S 24',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(1);
    });
    it('applies accepted global learned replacement rules exactly', () => {
        const rules = [{
                id: 'rule-1',
                status: 'accepted',
                source: 'human',
                original_text: 'habanero salsa',
                corrected_text: 'habanero relish',
                change_type: 'terminology',
                rule: 'Use relish for this approved preparation.',
                is_location_specific: false,
                location: 'All properties (global rule)',
            }];
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Taco, habanero salsa, cilantro 15', { acceptedCorrectionRules: rules });
        expect(result.menuText).toBe('Taco, habanero relish, cilantro 15');
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.learnedRulesApplied).toBe(1);
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            type: 'Learned Rule',
            source: 'accepted_correction_rule',
            ruleId: 'rule-1',
        }));
    });
    it('applies learned spelling and diacritic rules without requiring the same accent marks', () => {
        const rules = [
            {
                id: 'rule-creme-anglaise',
                status: 'accepted',
                source: 'system',
                original_text: 'creme anglaise',
                corrected_text: 'crème anglaise',
                change_type: 'diacritic',
                rule: 'crème anglaise is proper spelling',
                is_location_specific: false,
                location: 'All properties (global rule)',
            },
        ];
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)([
            'creme anglaise 8',
            'crême anglaise 8',
            'crème anglaise 8',
        ].join('\n'), { acceptedCorrectionRules: rules });
        expect(result.menuText).toBe([
            'crème anglaise 8',
            'crème anglaise 8',
            'crème anglaise 8',
        ].join('\n'));
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.learnedRulesApplied).toBe(1);
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: 'rule-creme-anglaise', original: 'creme anglaise', corrected: 'crème anglaise' }),
            expect.objectContaining({ ruleId: 'rule-creme-anglaise', original: 'crême anglaise', corrected: 'crème anglaise' }),
        ]));
        expect(result.appliedCorrections).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ original: 'crème anglaise' }),
        ]));
    });
    it('never applies context-dependent learned rules as blind replacements', () => {
        const rules = [
            {
                id: 'rule-berry',
                status: 'accepted',
                source: 'human',
                original_text: 'berry',
                corrected_text: 'berries',
                change_type: 'spelling',
                rule: "Just 'berry' implies mixed berries and should be plural.",
                is_location_specific: false,
                location: 'All properties (global rule)',
            },
            {
                id: 'rule-tartare',
                status: 'accepted',
                source: 'human',
                original_text: 'poblano tartare',
                corrected_text: 'poblano tartar',
                change_type: 'terminology',
                rule: 'This is the sauce, not the raw preparation.',
                is_location_specific: false,
                location: 'All properties (global rule)',
            },
        ];
        // "berry compote" must stay singular; "tartare" must stay raw — a global
        // find/replace would corrupt both, so neither rule is even considered.
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Berry compote 8\nBeef tartare crostini 18', { acceptedCorrectionRules: rules });
        expect(result.learnedRulesConsidered).toBe(0);
        expect(result.learnedRulesApplied).toBe(0);
        // The context-dependent terms are left exactly as submitted.
        expect(result.menuText).toContain('Berry compote');
        expect(result.menuText).not.toMatch(/berries/i);
        expect(result.menuText).toContain('tartare');
        expect(result.menuText).not.toMatch(/\btartar\b/i);
    });
    it('classifies tartare to tartar accepted rules as context guidance only', () => {
        const rule = {
            id: 'rule-tartare',
            status: 'accepted',
            source: 'human',
            original_text: 'poblano tartare',
            corrected_text: 'poblano tartar',
            change_type: 'terminology',
            rule: 'tartar sauce',
            is_location_specific: false,
            location: 'All properties (global rule)',
        };
        expect((0, pre_ai_deterministic_rules_1.getAcceptedCorrectionRulePreAiEligibility)(rule)).toEqual({
            eligible: false,
            reason: 'context_dependent',
            contextTerm: 'tartare',
        });
    });
    it('does not duplicate append-style learned rules already satisfied by curated guards', () => {
        const rules = [{
                id: 'rule-tres-leches',
                status: 'accepted',
                source: 'human',
                original_text: 'TORO TORO TRES LECHES D,E,G,TN',
                corrected_text: 'TORO TORO TRES LECHES D,E,G,TN,V',
                change_type: null,
                rule: 'Tres Leches always needs a vegetarian symbol "V".',
                is_location_specific: false,
                location: 'All properties (global rule)',
            }];
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('TORO TORO TRES LECHES D,E,G,TN', { acceptedCorrectionRules: rules });
        expect(result.menuText).toBe('TORO TORO TRES LECHES D,E,G,TN,V');
        expect(result.appliedCorrections.filter((correction) => correction.ruleId === 'rule-tres-leches')).toHaveLength(0);
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.learnedRulesApplied).toBe(0);
    });
    it('only applies location-specific learned rules to matching properties', () => {
        const rules = [{
                id: 'rule-location',
                status: 'accepted',
                source: 'human',
                original_text: 'tomatillo salsa',
                corrected_text: 'tomatillo sauce',
                change_type: 'terminology',
                rule: 'Denver uses sauce naming for this item.',
                is_location_specific: true,
                location: 'Toro Denver',
                other_applicable_locations: ['Toro Chicago'],
            }];
        expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Fish, tomatillo salsa 22', { property: 'Toro Denver', acceptedCorrectionRules: rules }).menuText).toBe('Fish, tomatillo sauce 22');
        expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('Fish, tomatillo salsa 22', { property: 'Toro Miami', acceptedCorrectionRules: rules }).menuText).toBe('Fish, tomatillo salsa 22');
    });
    it('only applies menu-scoped learned rules to matching template types', () => {
        const rules = [{
                id: 'rule-beverage',
                status: 'accepted',
                source: 'human',
                original_text: 'zero proof',
                corrected_text: 'zero-proof',
                change_type: 'punctuation',
                rule: 'Beverage menus hyphenate zero-proof.',
                applies_to_menu_type: 'beverage',
                is_location_specific: false,
                location: 'All properties (global rule)',
            }];
        expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('zero proof margarita 13', { templateType: 'food', acceptedCorrectionRules: rules }).menuText).toBe('zero proof margarita 13');
        expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('zero proof margarita 13', { templateType: 'beverage', acceptedCorrectionRules: rules }).menuText).toBe('zero-proof margarita 13');
        expect((0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('zero proof margarita 13', { templateType: 'food_beverage', acceptedCorrectionRules: rules }).menuText).toBe('zero-proof margarita 13');
    });
    it('ignores pending or broad content learned rules', () => {
        const rules = [
            {
                id: 'pending',
                status: 'pending',
                original_text: 'jalapeno',
                corrected_text: 'jalapeño',
                change_type: 'diacritic',
                rule: 'Pending rule.',
            },
            {
                id: 'content',
                status: 'accepted',
                original_text: 'taco',
                corrected_text: 'taco with added chef note',
                change_type: 'content',
                rule: 'Too broad for deterministic precheck.',
            },
        ];
        const result = (0, pre_ai_deterministic_rules_1.runPreAiDeterministicChecks)('taco, jalapeno 12', {
            acceptedCorrectionRules: rules,
        });
        expect(result.menuText).toBe('taco, jalapeño 12');
        expect(result.learnedRulesConsidered).toBe(0);
        expect(result.appliedCorrections).toHaveLength(1);
    });
});
