"use strict";
// Final QA prompt assembly for the Basic AI Check. Extracted verbatim from
// services/dashboard/index.ts handleBasicCheck so the offline review pipeline
// (eval harness) builds byte-identical prompts to production.
Object.defineProperty(exports, "__esModule", { value: true });
exports.QA_PROMPT_SECTIONS = void 0;
exports.buildFinalPrompt = buildFinalPrompt;
const menu_footer_1 = require("./menu-footer");
const embedded_set_menu_guard_1 = require("./embedded-set-menu-guard");
const tenant_config_1 = require("@menumanager/tenant-config");
// Registry of every runtime prompt section. Consumed by the review-rules
// manifest so prompt-layer rules are enumerable alongside code rules.
exports.QA_PROMPT_SECTIONS = {
    prix_fixe: {
        description: 'Prix fixe pricing/course-numbering rules; suppresses per-dish missing-price flags and requires a single top price plus numbered courses.',
        appliesWhen: "menuType === 'prix_fixe'",
    },
    allergens: {
        description: 'Injects the custom or footer-extracted allergen key and restricts allergen checking to those codes.',
        appliesWhen: 'effective allergen legend is non-empty',
    },
    corrected_menu_structure_rules: {
        description: 'Requires the CORRECTED MENU block to preserve every submitted line in order with no merges, splits, reorders, or deletions.',
        appliesWhen: 'always',
    },
    pre_ai_deterministic_checks: {
        description: 'Tells the model deterministic pre-AI fixes were already applied so it does not re-report them.',
        appliesWhen: 'BASIC_AI_PRECHECK_ENABLED',
    },
    changed_only_scope: {
        description: 'Restricts a revision review to changed excerpts only and pins the corrected output to the same lines.',
        appliesWhen: "reviewMode === 'changed_only' with a baseline",
    },
    footer_rules: {
        description: 'Excludes the allergen legend and the canonical foodborne-illness footer from review scope.',
        appliesWhen: 'always',
    },
    add_on_price_rules: {
        description: 'Treats numbers after add-on options (pipe/slash separated) as that option price; prevents false Missing Price flags on add-on rows.',
        appliesWhen: 'always',
    },
    standard_item_price_rules: {
        description: 'Treats a trailing whole number as a valid price even without allergen codes before it.',
        appliesWhen: 'always',
    },
    selection_instruction_rules: {
        description: 'Treats standalone selection instructions such as "choose one" as menu instructions, not dish entries with incomplete names.',
        appliesWhen: 'always',
    },
    embedded_set_menu_rules: {
        description: 'Explains detected embedded set-menu sections (package title + total price + choice-of headings) so included dishes are not flagged for missing prices.',
        appliesWhen: 'embedded set-menu sections detected in a non prix-fixe menu',
    },
};
function buildFinalPrompt(basePrompt, ctx, opts = {}) {
    const omit = new Set(opts.omitSections || []);
    const sections = [];
    let qaPrompt = basePrompt;
    // If prix fixe menu type, inject special rules
    if (ctx.menuType === 'prix_fixe') {
        const prixFixeSection = `
**PRIX FIXE / PRE-FIX MENU RULES:**
This is a PRIX FIXE (pre-fix) menu. Apply these special rules:

1. **PRICING STRUCTURE**: Prix fixe menus should have:
   - A single prix fixe price at the TOP of the menu (format: 00.00PP, 00.00pp, or just a whole number)
   - Treat PP/pp as "per person" and count prices like "50.00pp" as valid top-level prices
   - Optional wine/alcohol pairing price listed alongside (e.g., "185 | 85 wine pairing")
   - Individual dishes do NOT need their own prices - this is CORRECT for prix fixe menus
   - Do NOT flag missing prices on individual courses/dishes

2. **COURSE NUMBERING**: Prix fixe menus MUST have numbered courses:
   - Each course should be preceded by its course number (1, 2, 3, etc.)
   - Numbers can be on their own line above the course name
   - Example format:
     1
     First Course
     dish name, description

     2
     Second Course
     dish name, description
   - FLAG if course numbers are missing

3. **COURSE STRUCTURE**: Look for proper course progression:
   - Courses should flow logically (appetizer → main → dessert, or similar)
   - Each course section should have clear separation

4. **WHAT TO CHECK**:
   - Prix fixe price present at top (FLAG if missing)
   - Course numbers present (FLAG if missing)
   - All other standard rules still apply (spelling, accents, allergens, etc.)

5. **WHAT NOT TO FLAG**:
   - Missing prices on individual dishes (this is normal for prix fixe)
   - Individual items without their own pricing
   - Do NOT set severity to "critical" for missing individual dish prices on prix fixe menus
`;
        // Insert at the beginning of the rules section. The anchor heading is
        // configured per business (rulebook.guidelinesAnchor) and must appear
        // verbatim in the active prompt for this injection to land.
        if (!omit.has('prix_fixe')) {
            const guidelinesAnchor = (0, tenant_config_1.getTenantConfig)().rulebook.guidelinesAnchor;
            qaPrompt = qaPrompt.replace(guidelinesAnchor, `${guidelinesAnchor}\n${prixFixeSection}`);
            console.log('Injected prix fixe rules into prompt');
            sections.push('prix_fixe');
        }
    }
    // If custom or extracted allergens are provided, inject them into the prompt
    if (ctx.effectiveAllergens && ctx.effectiveAllergens.trim() && !omit.has('allergens')) {
        const allergenSection = `
**CUSTOM ALLERGEN KEY FOR THIS MENU:**
Use the following allergen codes for reviewing this menu:
${ctx.effectiveAllergens}

Note: Use ONLY these allergen codes when checking allergen compliance. Do not use any other allergen codes not defined above.
`;
        // Insert after the configured allergens anchor when present; append for
        // test/minimal prompts.
        const allergensAnchor = (0, tenant_config_1.getTenantConfig)().rulebook.allergensAnchor;
        qaPrompt = qaPrompt.includes(allergensAnchor)
            ? qaPrompt.replace(allergensAnchor, `${allergensAnchor}\n${allergenSection}`)
            : `${qaPrompt}\n${allergenSection}`;
        console.log('Injected custom allergens into prompt');
        sections.push('allergens');
    }
    let finalPrompt = qaPrompt;
    if (!omit.has('corrected_menu_structure_rules')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT CORRECTED MENU STRUCTURE RULES:\n- The CORRECTED MENU section must contain every submitted menu line in the same order.\n- Do not summarize, shorten, condense, omit, merge, reorder, or rewrite the menu structure.\n- Do not add section headings or line breaks that were not in the submitted menu.\n- Apply only high-confidence corrections inline and leave all other text unchanged.`;
        finalPrompt = `${finalPrompt}\n- Never delete submitted dishes, beverages, options, headings, or standalone item lines. If a line seems wrong, duplicated, invalid, or not orderable, leave it in CORRECTED MENU and report the issue in SUGGESTIONS.`;
        sections.push('corrected_menu_structure_rules');
    }
    if (ctx.precheckEnabled && !omit.has('pre_ai_deterministic_checks')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT PRE-AI DETERMINISTIC CHECKS:\n- Allowlisted spelling, diacritic, allergen-code formatting, raw-marker placement, and accepted correction-rule replacements have already been applied before this AI review.\n- Do not re-report those already-applied deterministic edits as remaining suggestions.\n- Focus on remaining semantic, contextual, uncertain, or reviewer-needed issues.`;
        sections.push('pre_ai_deterministic_checks');
    }
    if (ctx.changedOnlyMode && !omit.has('changed_only_scope')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT SCOPE FOR THIS REVIEW:\nYou are reviewing ONLY changed excerpts from a menu revision.\nDo NOT flag unchanged baseline content.\nReturn issues only for the changed excerpts provided.\nThe CORRECTED MENU section MUST contain exactly the same lines you received, in the same order, with high-confidence corrections applied to each line. Do not add, remove, merge, split, or reorder lines.`;
        sections.push('changed_only_scope');
    }
    if (!omit.has('footer_rules')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT FOOTER RULES:\n- Do NOT review or suggest changes for the allergen legend/footer boilerplate.\n- Do NOT review or suggest changes for the standard foodborne illness warning/footer boilerplate.\n- The canonical foodborne illness warning is: ${menu_footer_1.RAW_NOTICE_TEXT}\n- Those footer lines are system-managed outside this review scope.`;
        sections.push('footer_rules');
    }
    if (!omit.has('add_on_price_rules')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT ADD-ON PRICE RULES:\n- For add-on or enhancement rows with options separated by pipes or slashes, treat a number immediately after an option as that option's price.\n- Do NOT flag an add-on option as missing a price when the option appears on the same row with a numeric price, such as \"add chorizo 5 | mushrooms V 4\".`;
        sections.push('add_on_price_rules');
    }
    if (!omit.has('standard_item_price_rules')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT STANDARD ITEM PRICE RULES:\n- A trailing whole number at the end of a standard menu item is a valid price even when there are no allergen codes before it.\n- Do NOT flag a line like \"Short Rib al Carbón, housemade tomatillo sauce, pickled red onion 54\" as Missing Price.`;
        sections.push('standard_item_price_rules');
    }
    if (!omit.has('selection_instruction_rules')) {
        finalPrompt = `${finalPrompt}\n\nIMPORTANT SELECTION INSTRUCTION RULES:\n- Standalone choice/instruction lines such as \"choose one\", \"choice of one\", \"select two\", or \"pick your entree\" are not dish entries.\n- Preserve those instruction lines in CORRECTED MENU, but do NOT flag them as Incomplete Dish Name or Missing Price.`;
        sections.push('selection_instruction_rules');
    }
    if (ctx.embeddedSetMenuAnalysis.sections.length > 0 && !omit.has('embedded_set_menu_rules')) {
        finalPrompt = `${finalPrompt}\n\n${(0, embedded_set_menu_guard_1.buildEmbeddedSetMenuPromptSection)(ctx.embeddedSetMenuAnalysis)}`;
        sections.push('embedded_set_menu_rules');
    }
    return { prompt: finalPrompt, sections };
}
