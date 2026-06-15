import { RAW_NOTICE_TEXT } from '../lib/menu-footer';
import { QA_PROMPT_SECTIONS, buildFinalPrompt } from '../lib/qa-prompt-builder';
import { analyzeEmbeddedSetMenus } from '../lib/embedded-set-menu-guard';

const BASE_PROMPT = [
    'You are a menu editor.',
    '## RSH MENU GUIDELINES - COMPREHENSIVE RULES',
    'Rule one.',
    '### 7. ALLERGENS',
    'Allergen rules here.',
].join('\n');

const EMPTY_SET_MENU = { sections: [], issues: [] };

describe('buildFinalPrompt (extracted from handleBasicCheck)', () => {
    test('always appends the standard tail sections in canonical order', () => {
        const { prompt, sections } = buildFinalPrompt(BASE_PROMPT, {
            precheckEnabled: false,
            embeddedSetMenuAnalysis: EMPTY_SET_MENU,
        });

        expect(sections).toEqual([
            'corrected_menu_structure_rules',
            'footer_rules',
            'add_on_price_rules',
            'standard_item_price_rules',
            'selection_instruction_rules',
        ]);
        expect(prompt.startsWith(BASE_PROMPT)).toBe(true);
        expect(prompt).toContain('IMPORTANT CORRECTED MENU STRUCTURE RULES:');
        expect(prompt).toContain('Never delete submitted dishes, beverages, options, headings, or standalone item lines.');
        expect(prompt).toContain(`The canonical foodborne illness warning is: ${RAW_NOTICE_TEXT}`);
        expect(prompt).toContain('IMPORTANT ADD-ON PRICE RULES:');
        expect(prompt).toContain('add chorizo 5 | mushrooms V 4');
        expect(prompt).toContain('IMPORTANT STANDARD ITEM PRICE RULES:');
        expect(prompt).toContain('Short Rib al Carbón');
        expect(prompt).toContain('IMPORTANT SELECTION INSTRUCTION RULES:');
        expect(prompt).toContain('choose one');
        expect(prompt).not.toContain('PRIX FIXE / PRE-FIX MENU RULES');
        expect(prompt).not.toContain('IMPORTANT PRE-AI DETERMINISTIC CHECKS');
        expect(prompt).not.toContain('IMPORTANT SCOPE FOR THIS REVIEW');
    });

    test('prix fixe rules are injected at the top of the guidelines section', () => {
        const { prompt, sections } = buildFinalPrompt(BASE_PROMPT, {
            menuType: 'prix_fixe',
            precheckEnabled: true,
            embeddedSetMenuAnalysis: EMPTY_SET_MENU,
        });

        expect(sections[0]).toBe('prix_fixe');
        expect(sections).toContain('pre_ai_deterministic_checks');
        const guidelineIdx = prompt.indexOf('## RSH MENU GUIDELINES - COMPREHENSIVE RULES');
        const prixFixeIdx = prompt.indexOf('**PRIX FIXE / PRE-FIX MENU RULES:**');
        const ruleOneIdx = prompt.indexOf('Rule one.');
        expect(prixFixeIdx).toBeGreaterThan(guidelineIdx);
        expect(prixFixeIdx).toBeLessThan(ruleOneIdx);
        expect(prompt).toContain('Do NOT flag missing prices on individual courses/dishes');
    });

    test('allergen key is injected after the allergens heading when present', () => {
        const { prompt, sections } = buildFinalPrompt(BASE_PROMPT, {
            effectiveAllergens: 'G gluten | V vegetarian',
            precheckEnabled: false,
            embeddedSetMenuAnalysis: EMPTY_SET_MENU,
        });

        expect(sections).toContain('allergens');
        const headingIdx = prompt.indexOf('### 7. ALLERGENS');
        const customIdx = prompt.indexOf('**CUSTOM ALLERGEN KEY FOR THIS MENU:**');
        expect(customIdx).toBeGreaterThan(headingIdx);
        expect(prompt).toContain('G gluten | V vegetarian');
    });

    test('allergen key is appended when the base prompt lacks the heading', () => {
        const { prompt } = buildFinalPrompt('Minimal prompt.', {
            effectiveAllergens: 'N nuts',
            precheckEnabled: false,
            embeddedSetMenuAnalysis: EMPTY_SET_MENU,
        });
        expect(prompt).toContain('**CUSTOM ALLERGEN KEY FOR THIS MENU:**');
        expect(prompt).toContain('N nuts');
    });

    test('changed-only scope section appears between deterministic notice and footer rules', () => {
        const { prompt, sections } = buildFinalPrompt(BASE_PROMPT, {
            changedOnlyMode: true,
            precheckEnabled: true,
            embeddedSetMenuAnalysis: EMPTY_SET_MENU,
        });

        expect(sections).toEqual([
            'corrected_menu_structure_rules',
            'pre_ai_deterministic_checks',
            'changed_only_scope',
            'footer_rules',
            'add_on_price_rules',
            'standard_item_price_rules',
            'selection_instruction_rules',
        ]);
        expect(prompt).toContain('You are reviewing ONLY changed excerpts from a menu revision.');
    });

    test('embedded set-menu section is appended when sections are detected', () => {
        const analysis = analyzeEmbeddedSetMenus([
            'FEAST MENU 65',
            'choice of',
            'STARTERS',
            'guacamole, chips',
            'MAINS',
            'short rib, tomatillo',
        ].join('\n'));
        const { prompt, sections } = buildFinalPrompt(BASE_PROMPT, {
            precheckEnabled: false,
            embeddedSetMenuAnalysis: analysis,
        });

        if (analysis.sections.length > 0) {
            expect(sections).toContain('embedded_set_menu_rules');
            expect(sections[sections.length - 1]).toBe('embedded_set_menu_rules');
        } else {
            // Conservative analyzer may not detect this synthetic fixture; the
            // contract is simply that no section means no prompt block.
            expect(sections).not.toContain('embedded_set_menu_rules');
            expect(prompt).not.toContain('EMBEDDED SET MENU');
        }
    });

    test('every emitted section id is documented in QA_PROMPT_SECTIONS', () => {
        const { sections } = buildFinalPrompt(BASE_PROMPT, {
            menuType: 'prix_fixe',
            effectiveAllergens: 'G gluten',
            changedOnlyMode: true,
            precheckEnabled: true,
            embeddedSetMenuAnalysis: EMPTY_SET_MENU,
        });
        for (const id of sections) {
            expect(QA_PROMPT_SECTIONS[id]).toBeDefined();
        }
    });
});
