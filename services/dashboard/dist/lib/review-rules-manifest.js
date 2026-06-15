"use strict";
// Review-rules manifest: a single generated catalog of EVERY rule the review
// process applies in code, across all layers. Data-driven entries (built-in
// replacements, prompt sections, forced-critical types) are imported from the
// real implementation arrays so they cannot drift; functional rules and guards
// carry hand-authored metadata with a pointer to their implementation.
//
// Regenerate docs/references/code-rules-manifest.{md,json} with:
//   npm run rules:manifest
// A jest test fails when the committed markdown is stale.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReviewRulesManifest = buildReviewRulesManifest;
exports.renderRulesManifestMarkdown = renderRulesManifestMarkdown;
const pre_ai_deterministic_rules_1 = require("./pre-ai-deterministic-rules");
const qa_prompt_builder_1 = require("./qa-prompt-builder");
const review_pipeline_1 = require("./review-pipeline");
const PRE_AI_FILE = 'services/dashboard/lib/pre-ai-deterministic-rules.ts';
const PROMPT_BUILDER_FILE = 'services/dashboard/lib/qa-prompt-builder.ts';
const REVIEW_PIPELINE_FILE = 'services/dashboard/lib/review-pipeline.ts';
const MENU_FOOTER_FILE = 'services/dashboard/lib/menu-footer.ts';
// Functional rules and guards that cannot be serialized as data. Every guard
// module wired into runPostAiPipeline MUST have at least one entry here — the
// completeness test enforces it.
const FUNCTIONAL_ENTRIES = [
    {
        id: 'pre-ai/allergen-cluster-normalization',
        layer: 'pre_ai_deterministic',
        category: 'allergen_codes',
        title: 'Allergen code cluster formatting',
        description: 'Allergen-code clusters on a dish line are normalized to uppercase, comma-separated with no spaces, in alphabetical order. Only runs on clusters of known allergen codes.',
        examples: [{ before: 'crispy squid g, d,V 18', after: 'crispy squid D,G,V 18' }],
        implementation: { file: PRE_AI_FILE, exportName: 'normalizeAllergenClusterOnLine' },
        source: 'code_metadata',
    },
    {
        id: 'pre-ai/tres-leches-vegetarian-code',
        layer: 'pre_ai_deterministic',
        category: 'allergen_codes',
        title: 'Tres Leches requires vegetarian code',
        description: 'Tres Leches dessert lines must carry the V (vegetarian) allergen code; it is added to the cluster when missing. Curated code guard promoted from accepted human-review explanations.',
        examples: [{ before: 'tres leches, vanilla cream D,G 14', after: 'tres leches, vanilla cream D,G,V 14' }],
        implementation: { file: PRE_AI_FILE, exportName: 'ensureTresLechesVegetarianCodeOnLine' },
        source: 'code_metadata',
    },
    {
        id: 'pre-ai/raw-asterisk-placement',
        layer: 'pre_ai_deterministic',
        category: 'raw_markers',
        title: 'Raw-marker spacing normalization (pre-AI, conservative)',
        description: 'When a dish line has exactly one raw marker, spacing drift is fixed: the marker attaches to the last dish/description word and is separated from allergen codes. Lines with zero or multiple markers are left for the post-AI pass.',
        examples: [{ before: 'tuna tartare , avocado * D 18', after: 'tuna tartare, avocado* D 18' }],
        implementation: { file: PRE_AI_FILE, exportName: 'normalizeRawAsteriskPlacementForLine' },
        source: 'code_metadata',
    },
    {
        id: 'pre-ai/raw-asterisk-insertion',
        layer: 'pre_ai_deterministic',
        category: 'raw_markers',
        title: 'Missing raw-marker insertion for strong raw terms',
        description: 'Adds a missing raw marker to dishes containing strong raw/undercooked terms: tartare, sashimi, raw/uncooked ceviche, crudo, tiradito, poke, raw or half-shell oysters, explicit raw tuna/salmon/hamachi/fish/beef, poached egg, sunny-side-up egg.',
        examples: [{ before: 'salmon sashimi, ponzu 19', after: 'salmon sashimi, ponzu* 19' }],
        implementation: { file: PRE_AI_FILE, exportName: 'shouldAddRawAsterisk' },
        source: 'code_metadata',
    },
    {
        id: 'pre-ai/accepted-correction-rules',
        layer: 'pre_ai_deterministic',
        category: 'learned_rules',
        title: 'Accepted reviewer correction rules (exact replacements)',
        description: 'Accepted correction_rules rows with safe change types (spelling, diacritic, terminology, grammar, punctuation; both texts <= 240 chars) are applied as exact replacements when the rule scope matches the submitted property and template type. Broad content rules stay reviewer/prompt material. See the dynamic_correction_rule entries for the currently accepted set.',
        implementation: { file: PRE_AI_FILE, exportName: 'applyAcceptedCorrectionRules' },
        source: 'code_metadata',
    },
    {
        id: 'pre-ai/footer-normalization',
        layer: 'pre_ai_deterministic',
        category: 'footer',
        title: 'Managed footer extraction before review',
        description: 'Allergen legend lines, the canonical foodborne-illness notice, and price/welcome boilerplate are detected and removed from the review body before deterministic checks and the AI call; the extracted allergen legend becomes the effective allergen key when none was provided.',
        implementation: { file: MENU_FOOTER_FILE, exportName: 'normalizeMenuFooter' },
        source: 'code_metadata',
    },
    {
        id: 'parse/severity-default-normal',
        layer: 'parse_normalization',
        category: 'severity',
        title: 'Missing severity defaults to normal',
        description: 'AI suggestions without a severity are assigned severity "normal" before any critical forcing runs.',
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'parseAIResponse' },
        source: 'code_metadata',
    },
    {
        id: 'parse/prix-fixe-phrase-critical',
        layer: 'parse_normalization',
        category: 'severity',
        title: 'Prix-fixe top-price and course-numbering phrases force critical',
        description: 'Suggestions whose description/recommendation mention a prix fixe price at the top of the menu, or prix-fixe course numbering, are forced to critical severity even when the AI omitted the type.',
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'parseAIResponse' },
        source: 'code_metadata',
    },
    {
        id: 'parse/missing-price-description-fallback',
        layer: 'parse_normalization',
        category: 'severity',
        title: 'Missing price / dish-name description fallback',
        description: 'Non-critical suggestions whose description matches missing-price or missing/incomplete-dish-name phrasing are reclassified to the corresponding critical type (safety net for mistyped AI output).',
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'parseAIResponse' },
        source: 'code_metadata',
    },
    {
        id: 'parse/raw-asterisk-canonicalization',
        layer: 'parse_normalization',
        category: 'raw_markers',
        title: 'Raw-marker canonicalization (post-AI, aggressive)',
        description: 'Every raw marker on a dish line of the AI-corrected menu is stripped and exactly one is reinserted at the canonical position: attached to the last description word, before trailing allergen codes and price. Titles, legends, and the raw notice are skipped.',
        examples: [{ before: 'Steak Tartare*, capers, egg yolk D,G 24', after: 'Steak Tartare, capers, egg yolk* D,G 24' }],
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'normalizeRawAsteriskPlacement' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/deterministic-re-run',
        layer: 'post_ai_guard',
        category: 'deterministic',
        title: 'Post-AI deterministic cleanup',
        description: 'The full deterministic pre-AI pass is re-applied to the AI-corrected menu so the model cannot reintroduce drift (unsorted allergen clusters, spaced raw markers, reverted replacements).',
        implementation: { file: PRE_AI_FILE, exportName: 'runPreAiDeterministicChecks' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/menu-title-guard',
        layer: 'post_ai_guard',
        category: 'structure',
        title: 'Leading menu title preservation',
        description: 'Restores a leading "Menu"/"Menus" title line when the AI-corrected output dropped it.',
        implementation: { file: 'services/dashboard/lib/menu-title-guard.ts', exportName: 'preserveLeadingMenuTitle' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/structure-guard',
        layer: 'post_ai_guard',
        category: 'structure',
        title: 'Corrected-menu structure guard',
        description: 'Rejects an AI-corrected menu that distorts line structure (merged, split, omitted, or reordered lines) and falls back to the pre-AI text; suggestions still apply.',
        implementation: { file: 'services/dashboard/lib/corrected-menu-structure-guard.ts', exportName: 'assessCorrectedMenuStructure' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/allergen-suggestion-guard',
        layer: 'post_ai_guard',
        category: 'allergen_codes',
        title: 'Allergen alphabetization suggestion guard',
        description: 'Drops AI suggestions asking to alphabetize allergen codes when the corrected menu already has them in the required order.',
        implementation: { file: 'services/dashboard/lib/allergen-suggestion-guard.ts', exportName: 'guardAllergenAlphabetizationSuggestions' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/high-confidence-auto-apply',
        layer: 'post_ai_guard',
        category: 'auto_apply',
        title: 'High-confidence suggestion auto-apply',
        description: 'High-confidence spelling/grammar suggestions with an extractable from->to pair are applied directly to the corrected menu and removed from the remaining suggestion list.',
        implementation: { file: 'services/dashboard/lib/apply-high-confidence-suggestions.ts', exportName: 'applyHighConfidenceSuggestionsToMenu' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/embedded-set-menu-guard',
        layer: 'post_ai_guard',
        category: 'pricing',
        title: 'Embedded set-menu price guard',
        description: 'For detected embedded set menus (package title + total price + choice-of headings): restores included set-section dish prices the AI removed, drops false Missing Price suggestions for included dishes, and synthesizes critical Set Menu Item Price suggestions for bare included-item prices.',
        implementation: { file: 'services/dashboard/lib/embedded-set-menu-guard.ts', exportName: 'guardEmbeddedSetMenuPrices' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/price-integrity-guard',
        layer: 'post_ai_guard',
        category: 'pricing',
        title: 'Price integrity guard',
        description: 'Prevents the AI from adding or changing trailing prices: corrected-menu prices are reconciled against the submitted text and unauthorized price edits are reverted.',
        implementation: { file: 'services/dashboard/lib/price-integrity-guard.ts', exportName: 'guardCorrectedMenuPrices' },
        source: 'code_metadata',
    },
    {
        id: 'post-ai/footer-strip',
        layer: 'post_ai_guard',
        category: 'footer',
        title: 'Managed footer strip on corrected output',
        description: 'The corrected menu is stripped of managed footer content (allergen legend, raw notice, price/welcome boilerplate) before reconciliation, mirroring the pre-review normalization.',
        implementation: { file: MENU_FOOTER_FILE, exportName: 'stripManagedFooterText' },
        source: 'code_metadata',
    },
    {
        id: 'reconcile/critical-resolution',
        layer: 'reconciliation',
        category: 'severity',
        title: 'Resolved-critical reconciliation',
        description: 'Critical suggestions already resolved in the corrected menu are dropped: Missing Price when the matched line (including continuation lines) now ends in a price; Incomplete Dish Name when the line gained substance or the flagged token is gone.',
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics' },
        source: 'code_metadata',
    },
    {
        id: 'reconcile/selection-instruction-critical-filter',
        layer: 'reconciliation',
        category: 'severity',
        title: 'Selection instruction critical false-positive filter',
        description: 'Incomplete Dish Name critical suggestions are dropped when the matched line is a standalone selection instruction such as "choose one", "choice of one", "select two", or "pick your entree". These lines are preserved as menu instructions, not dish entries.',
        examples: [{ before: 'choose one -> Incomplete Dish Name critical', after: 'choose one -> no blocker' }],
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics' },
        source: 'code_metadata',
    },
    {
        id: 'reconcile/prix-fixe-enforcement',
        layer: 'reconciliation',
        category: 'prix_fixe',
        title: 'Prix-fixe deterministic critical checks',
        description: 'For prix fixe menus: synthesizes a critical PRICING STRUCTURE suggestion when no top-level price (incl. PP/per-person/pairing formats) appears in the first five lines, synthesizes critical COURSE NUMBERING when two or more course headings lack numbers, and removes AI course-numbering false positives when numbers are present. Prix fixe menus are exempt from per-dish missing-price criticals.',
        implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'enforcePrixFixeCriticalChecks' },
        source: 'code_metadata',
    },
];
function buildReviewRulesManifest(opts = {}) {
    const entries = [];
    for (const replacement of pre_ai_deterministic_rules_1.BUILT_IN_REPLACEMENTS) {
        entries.push({
            id: `pre-ai/replacement/${replacement.from.replace(/\s+/g, '-')}`,
            layer: 'pre_ai_deterministic',
            category: replacement.type.toLowerCase(),
            title: `${replacement.from} -> ${replacement.to}`,
            description: `Built-in exact ${replacement.type.toLowerCase()} replacement applied before the AI review (word-boundary, case-preserving).`,
            examples: [{ before: replacement.from, after: replacement.to }],
            implementation: { file: PRE_AI_FILE, exportName: 'BUILT_IN_REPLACEMENTS' },
            data: replacement,
            source: 'code_data',
        });
    }
    entries.push(...FUNCTIONAL_ENTRIES);
    for (const [sectionId, meta] of Object.entries(qa_prompt_builder_1.QA_PROMPT_SECTIONS)) {
        entries.push({
            id: `prompt/${sectionId}`,
            layer: 'prompt_section',
            category: 'prompt',
            title: `Prompt section: ${sectionId}`,
            description: `${meta.description} Applies when: ${meta.appliesWhen}.`,
            implementation: { file: PROMPT_BUILDER_FILE, exportName: 'buildFinalPrompt' },
            data: { sectionId, ...meta },
            source: 'code_data',
        });
    }
    for (const type of review_pipeline_1.FORCED_CRITICAL_EXACT_TYPES) {
        entries.push({
            id: `parse/forced-critical/${type.toLowerCase().replace(/\s+/g, '-')}`,
            layer: 'parse_normalization',
            category: 'severity',
            title: `Forced critical type: ${type}`,
            description: `AI suggestions with the exact type "${type}" are always forced to critical severity (blocks submission until overridden).`,
            implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'FORCED_CRITICAL_EXACT_TYPES' },
            data: { type, match: 'exact' },
            source: 'code_data',
        });
    }
    for (const type of review_pipeline_1.FORCED_CRITICAL_NORMALIZED_TYPES) {
        entries.push({
            id: `parse/forced-critical/${type.replace(/\s+/g, '-')}`,
            layer: 'parse_normalization',
            category: 'severity',
            title: `Forced critical type: ${type}`,
            description: `AI suggestions whose lowercased type equals "${type}" are always forced to critical severity.`,
            implementation: { file: REVIEW_PIPELINE_FILE, exportName: 'FORCED_CRITICAL_NORMALIZED_TYPES' },
            data: { type, match: 'lowercased' },
            source: 'code_data',
        });
    }
    for (const rule of opts.acceptedCorrectionRules || []) {
        entries.push({
            id: `dynamic/correction-rule/${rule.id || `${rule.original_text}->${rule.corrected_text}`}`,
            layer: 'dynamic_correction_rule',
            category: `${rule.change_type || 'replacement'}`,
            title: rule.original_text && rule.corrected_text
                ? `${rule.original_text} -> ${rule.corrected_text}`
                : `${rule.rule || 'manual guidance'}`.slice(0, 80),
            description: [
                rule.rule ? `Reviewer rule: ${rule.rule}` : 'Accepted reviewer replacement.',
                rule.is_location_specific ? `Location-specific: ${rule.location}${(rule.other_applicable_locations || []).length ? ` (+ ${(rule.other_applicable_locations || []).join(', ')})` : ''}.` : 'Global scope.',
                `Menu scope: ${rule.applies_to_menu_type || 'all'}.`,
            ].join(' '),
            implementation: { file: PRE_AI_FILE, exportName: 'applyAcceptedCorrectionRules' },
            data: rule,
            source: 'db_accepted_rule',
        });
    }
    return { entries };
}
const LAYER_ORDER = [
    'pre_ai_deterministic',
    'prompt_section',
    'parse_normalization',
    'post_ai_guard',
    'reconciliation',
    'dynamic_correction_rule',
];
const LAYER_TITLES = {
    pre_ai_deterministic: 'Layer 1 — Deterministic pre-AI checks (before the model runs)',
    prompt_section: 'Layer 2 — Runtime prompt sections (instructions added to the base prompt)',
    parse_normalization: 'Layer 3 — Response parsing and severity normalization',
    post_ai_guard: 'Layer 4 — Post-AI guards (model output corrections)',
    reconciliation: 'Layer 5 — Reconciliation and deterministic critical checks',
    dynamic_correction_rule: 'Dynamic — Accepted reviewer correction rules (from the database)',
};
function renderRulesManifestMarkdown(manifest, opts = {}) {
    const lines = [
        '# Code Rules Manifest',
        '',
        '> GENERATED FILE — do not edit by hand. Regenerate with `npm run rules:manifest`.',
        '> A jest test (`review-rules-manifest.test.ts`) fails when this file is stale.',
        '',
        'Every rule the menu-review process applies in code, across all layers. The base AI prompt',
        '(`sop-processor/qa_prompt.txt`) carries the natural-language rules; this manifest covers',
        'everything else. Dynamic accepted correction rules are appended at generation time and are',
        'not part of the committed copy.',
        '',
    ];
    for (const layer of LAYER_ORDER) {
        const entries = manifest.entries.filter((entry) => entry.layer === layer);
        if (layer === 'dynamic_correction_rule' && !opts.includeDynamic) {
            continue;
        }
        if (!entries.length)
            continue;
        lines.push(`## ${LAYER_TITLES[layer]}`, '');
        const replacementEntries = entries.filter((entry) => entry.id.startsWith('pre-ai/replacement/'));
        const otherEntries = entries.filter((entry) => !entry.id.startsWith('pre-ai/replacement/'));
        if (replacementEntries.length) {
            lines.push(`### Built-in exact replacements (${replacementEntries.length})`, '');
            lines.push('| From | To | Type |');
            lines.push('|------|----|------|');
            for (const entry of replacementEntries) {
                const data = entry.data;
                lines.push(`| ${data.from} | ${data.to} | ${data.type} |`);
            }
            lines.push('');
        }
        for (const entry of otherEntries) {
            lines.push(`### ${entry.title}`);
            lines.push('');
            lines.push(entry.description);
            if (entry.examples?.length) {
                for (const example of entry.examples) {
                    lines.push(`- \`${example.before}\` -> \`${example.after}\``);
                }
            }
            lines.push('');
            lines.push(`- id: \`${entry.id}\` · category: ${entry.category} · implementation: \`${entry.implementation.file}${entry.implementation.exportName ? `#${entry.implementation.exportName}` : ''}\``);
            lines.push('');
        }
    }
    return lines.join('\n');
}
