import { resolveCanonicalPolicies, permitsSeparatorVariants } from './canonical-policy';
import { involvesContextDependentTerm } from './improvement-cycle-core';

export type PreAiCorrectionSource = 'built_in' | 'accepted_correction_rule';

export type PreAiAppliedCorrection = {
    type: 'Spelling' | 'Diacritics' | 'Terminology' | 'Singular/Plural' | 'Allergen Code' | 'Raw Item' | 'Learned Rule';
    source: PreAiCorrectionSource;
    original: string;
    corrected: string;
    lineIndex: number;
    ruleId?: string;
    rule?: string;
};

export type AcceptedCorrectionRule = {
    id?: string;
    original_text?: string;
    corrected_text?: string;
    force_target_case?: boolean;
    change_type?: string | null;
    rule?: string;
    source?: string;
    status?: string;
    applies_to_menu_type?: string | null;
    is_location_specific?: boolean;
    location?: string;
    other_applicable_locations?: string[];
};

export type PreAiDeterministicOptions = {
    enabled?: boolean;
    property?: string;
    templateType?: string;
    allergenLegend?: string;
    acceptedCorrectionRules?: AcceptedCorrectionRule[];
};

export type PreAiDeterministicResult = {
    menuText: string;
    appliedCorrections: PreAiAppliedCorrection[];
    learnedRulesConsidered: number;
    learnedRulesApplied: number;
    diagnostics?: string[];
};

export type AcceptedCorrectionRulePreAiEligibility = {
    eligible: boolean;
    reason:
        | 'eligible'
        | 'not_accepted'
        | 'unsupported_change_type'
        | 'missing_exact_text'
        | 'same_text'
        | 'multiline_text'
        | 'text_too_long'
        | 'context_dependent';
    contextTerm?: string | null;
};

export type ReplacementRule = {
    from: string;
    to: string;
    type: PreAiAppliedCorrection['type'];
    forceTargetCase?: boolean;
    separatorVariants?: boolean;
};

const COMMON_ALLERGEN_CODES = new Set([
    'A', 'C', 'CE', 'D', 'DF', 'E', 'ET', 'F', 'G', 'GF', 'L', 'M', 'MO',
    'MU', 'N', 'P', 'PN', 'S', 'SE', 'SF', 'SL', 'SS', 'SU', 'SY', 'T', 'TN',
    'V', 'VG',
]);

export const BUILT_IN_REPLACEMENTS: ReplacementRule[] = [
    // Hawaiian ahi tuna has no tone mark; protect this phrase before the
    // general Spanish ají diacritic rule runs below.
    { from: 'aji tuna', to: 'ahi tuna', type: 'Spelling' },
    { from: 'ají tuna', to: 'ahi tuna', type: 'Spelling' },
    { from: 'ahí tuna', to: 'ahi tuna', type: 'Spelling' },
    { from: 'áhi tuna', to: 'ahi tuna', type: 'Spelling' },

    // Diacritics that are safe enough to apply before the AI review.
    { from: 'aji amarillo', to: 'ají amarillo', type: 'Diacritics' },
    { from: 'aji panca', to: 'ají panca', type: 'Diacritics' },
    { from: 'chile de arbol', to: 'chile de árbol', type: 'Diacritics' },
    { from: 'creme brulee', to: 'crème brûlée', type: 'Diacritics' },
    { from: 'brulee', to: 'brûlée', type: 'Diacritics' },
    { from: 'creme fraiche', to: 'crème fraîche', type: 'Diacritics' },
    { from: 'aji', to: 'ají', type: 'Diacritics' },
    { from: 'albarino', to: 'albariño', type: 'Diacritics' },
    { from: 'anejo', to: 'añejo', type: 'Diacritics' },
    { from: 'cachaca', to: 'cachaça', type: 'Diacritics' },
    { from: 'cafe', to: 'café', type: 'Diacritics' },
    { from: 'camaron', to: 'camarón', type: 'Diacritics' },
    { from: 'chicharron', to: 'chicharrón', type: 'Diacritics' },
    { from: 'cocteles', to: 'cócteles', type: 'Diacritics' },
    { from: 'crepes', to: 'crêpes', type: 'Diacritics' },
    { from: 'entree', to: 'entrée', type: 'Diacritics' },
    { from: 'flambeed', to: 'flambéed', type: 'Diacritics' },
    { from: 'genoise', to: 'génoise', type: 'Diacritics' },
    { from: 'jalapeno', to: 'jalapeño', type: 'Diacritics' },
    { from: 'pina', to: 'piña', type: 'Diacritics' },
    { from: 'puree', to: 'purée', type: 'Diacritics' },
    { from: 'rhone', to: 'rhône', type: 'Diacritics' },
    { from: 'sauteed', to: 'sautéed', type: 'Diacritics' },
    { from: 'saute', to: 'sauté', type: 'Diacritics' },
    { from: 'taquenos', to: 'taqueños', type: 'Diacritics' },
    { from: 'tequenos', to: 'tequeños', type: 'Diacritics' },
    { from: 'tequeno', to: 'tequeño', type: 'Diacritics' },
    { from: 'tajin', to: 'tajín', type: 'Diacritics' },
    { from: 'tampiquena', to: 'tampiqueña', type: 'Diacritics' },
    { from: 'huancaina', to: 'huancaína', type: 'Diacritics' },

    // Brand orthography.
    //
    // ALL CAPS is NOT a diacritic exemption. Human-approved finals carry 268 accented
    // all-caps tokens against 51 unaccented ones ("ROSÉ", "CHÂTEAU", "AÑEJO", "TEQUILEÑO"),
    // so a menu set in caps takes the same accents a title-case one does. matchCase already
    // upper-cases the accented target, so every rule above applies unchanged in caps.
    //
    // What actually varies is the brand, and that is a fact about the trademark rather than
    // anything derivable from the surrounding text: Patrón registers with the accent, Jose
    // Cuervo without it. Left to judgment, the two get decided per menu — one dessert menu
    // ended up with "PATRÓN Extra Añejo" and "PATRON EL ALTO" in the same approved final.
    // Both directions are pinned here so the answer is the same on every menu, and because
    // the whole pass re-runs after the AI, the model can neither omit nor invent them.
    { from: 'patron', to: 'Patrón', type: 'Diacritics' },
    { from: 'josé cuervo', to: 'Jose Cuervo', type: 'Diacritics' },

    // Exact spelling fixes. Contextual terminology preferences remain in the AI/human lane.
    { from: 'ceasar', to: 'caesar', type: 'Spelling' },
    { from: 'cesar', to: 'caesar', type: 'Spelling' },
    { from: 'mozarella', to: 'mozzarella', type: 'Spelling' },
    { from: 'parmesian', to: 'parmesan', type: 'Spelling' },
    { from: 'shitake', to: 'shiitake', type: 'Spelling' },
    { from: 'passion fruits', to: 'passion fruit', type: 'Spelling' },
    { from: 'passionfruit', to: 'passion fruit', type: 'Spelling' },
    { from: 'yuzu-kosho', to: 'yuzu kosho', type: 'Spelling' },
    { from: 'yuzukosho', to: 'yuzu kosho', type: 'Spelling' },
    { from: 'yuzu khoso', to: 'yuzu kosho', type: 'Spelling' },
    { from: 'dulche de leche', to: 'dulce de leche', type: 'Spelling' },
    { from: 'dry chili', to: 'dried chili', type: 'Spelling' },
    { from: 'honey comb', to: 'honeycomb', type: 'Spelling' },
    { from: 'chipothle', to: 'chipotle', type: 'Spelling' },
    { from: 'chipotl', to: 'chipotle', type: 'Spelling' },
    { from: 'nappa', to: 'napa', type: 'Spelling' },
    { from: 'sea food', to: 'seafood', type: 'Spelling' },
    { from: 'pak coy', to: 'pak choy', type: 'Spelling' },
    { from: 'cashu', to: 'cashew', type: 'Spelling' },
    { from: 'local grown', to: 'locally grown', type: 'Spelling' },
    { from: 'jasmin', to: 'jasmine', type: 'Spelling' },
    { from: 'brussels sprout', to: 'brussels sprouts', type: 'Spelling' },
    { from: 'veggies', to: 'vegetables', type: 'Spelling' },
    { from: 'chilli', to: 'chili', type: 'Spelling' },
    { from: 'pepper corn', to: 'peppercorn', type: 'Spelling' },
    { from: 'fugeo', to: 'fuego', type: 'Spelling' },
    { from: 'tamrind', to: 'tamarind', type: 'Spelling' },

    // Confirmed reviewer terminology and preparation-order corrections. These
    // are bounded phrases rather than whole-line replacements, so they survive
    // different dish names, prices, allergens, and surrounding ingredients.
    { from: 'cashew nuts sauce', to: 'cashew sauce', type: 'Terminology' },
    { from: 'cashew nut sauce', to: 'cashew sauce', type: 'Terminology' },
    { from: 'macha sauce', to: 'salsa macha', type: 'Terminology' },
    { from: 'macha salsa', to: 'salsa macha', type: 'Terminology' },
    { from: 'shimeji pickles', to: 'pickled shimeji mushroom', type: 'Terminology' },
    { from: 'shimeji pickle', to: 'pickled shimeji mushroom', type: 'Terminology' },

    // Canonical tenant terminology from the SOP vocabulary table. This is an
    // absolute business rule, so it must not depend on the review model noticing it.
    { from: 'mayonnaise', to: 'aioli', type: 'Terminology' },
    { from: 'mayo', to: 'aioli', type: 'Terminology' },
];

type CuratedCanonicalFoodWord = {
    canonical: string;
    maxDistance: number;
    type: 'Spelling' | 'Diacritics';
};

/**
 * Reviewer-confirmed canonical food words. Unlike BUILT_IN_REPLACEMENTS, this
 * list is matched by bounded Damerau edit distance, so an unseen adjacent
 * transposition such as FUGEO or a missing letter such as TAMRIND is corrected
 * without teaching the system every malformed spelling separately.
 */
export const CURATED_CANONICAL_FOOD_WORDS: CuratedCanonicalFoodWord[] = [
    { canonical: 'fuego', maxDistance: 1, type: 'Spelling' },
    { canonical: 'tamarind', maxDistance: 2, type: 'Spelling' },
    { canonical: 'brûlée', maxDistance: 1, type: 'Diacritics' },
    { canonical: 'tequeño', maxDistance: 1, type: 'Diacritics' },
];

const LEARNED_RULE_CHANGE_TYPES = new Set([
    '',
    'diacritic',
    'diacritics',
    'spelling',
    'typo',
    'grammar',
    'terminology',
    'punctuation',
]);

export const TRAILING_PRICE_PATTERN = '(?:(?:[$€£]\\s*)?\\d{1,4}(?:,\\d{3})*(?:[.]\\d{1,2})?|MKT|MP|market\\s+price)';

/** Shared trailing-price grammar for deterministic rules and source-bound delivery. */
export function splitTrailingPrice(line: string): { body: string; price: string } {
    const value = `${line || ''}`;
    const match = value.match(new RegExp(`\\s+(${TRAILING_PRICE_PATTERN}(?:\\s*\\|\\s*${TRAILING_PRICE_PATTERN})?(?:\\s*(?:pp|PP))?)\\s*$`, 'i'));
    return match && match.index !== undefined
        ? { body: value.slice(0, match.index).trimEnd(), price: value.slice(match.index) }
        : { body: value, price: '' };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function boundedDamerauDistance(left: string, right: string, maxDistance: number): number {
    const a = stripDiacritics(left).toLowerCase();
    const b = stripDiacritics(right).toLowerCase();
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
        let rowMin = maxDistance + 1;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
            if (
                i > 1
                && j > 1
                && a[i - 1] === b[j - 2]
                && a[i - 2] === b[j - 1]
            ) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
            }
            rowMin = Math.min(rowMin, matrix[i][j]);
        }
        if (rowMin > maxDistance) return maxDistance + 1;
    }
    return matrix[a.length][b.length];
}

export function normalizeCuratedFoodSpellingsOnLine(
    line: string,
    lineIndex: number
): { line: string; corrections: PreAiAppliedCorrection[] } {
    const corrections: PreAiAppliedCorrection[] = [];
    const tokenPattern = /\p{L}+(?:['’]\p{L}+)?/gu;
    const nextLine = line.replace(tokenPattern, (found) => {
        const foundFolded = stripDiacritics(found).toLowerCase();
        const candidates = CURATED_CANONICAL_FOOD_WORDS
            .map((entry) => ({
                entry,
                canonicalFolded: stripDiacritics(entry.canonical).toLowerCase(),
                distance: boundedDamerauDistance(found, entry.canonical, entry.maxDistance),
            }))
            .filter(({ entry, canonicalFolded, distance }) => (
                distance <= entry.maxDistance
                && foundFolded[0] === canonicalFolded[0]
                && foundFolded.at(-1) === canonicalFolded.at(-1)
                && foundFolded !== `${canonicalFolded}s`
                && foundFolded !== `${canonicalFolded}es`
            ))
            .sort((a, b) => a.distance - b.distance || a.entry.canonical.localeCompare(b.entry.canonical));

        if (!candidates.length) return found;
        if (candidates.length > 1 && candidates[0].distance === candidates[1].distance) return found;

        const best = candidates[0];
        const corrected = matchCase(found, best.entry.canonical);
        if (found === corrected) return found;
        corrections.push({
            type: best.entry.type,
            source: 'built_in',
            original: found,
            corrected,
            lineIndex,
            rule: `Use reviewer-confirmed canonical food spelling "${best.entry.canonical}".`,
        });
        return corrected;
    });
    return { line: nextLine, corrections };
}

function normalizeScope(value: string | undefined): string {
    return stripDiacritics(`${value || ''}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isGlobalRuleLocation(value: string | undefined): boolean {
    const normalized = normalizeScope(value);
    return !normalized || normalized === 'all properties global rule';
}

export function ruleAppliesToProperty(rule: AcceptedCorrectionRule, property: string | undefined): boolean {
    if (!rule.is_location_specific || isGlobalRuleLocation(rule.location)) {
        return true;
    }

    const propertyKey = normalizeScope(property);
    if (!propertyKey) {
        return false;
    }

    if (normalizeScope(rule.location) === propertyKey) {
        return true;
    }

    return (rule.other_applicable_locations || [])
        .some((location) => normalizeScope(location) === propertyKey);
}

function normalizeTemplateScope(value: string | undefined | null): string {
    const normalized = `${value || ''}`.toLowerCase().trim();
    if (!normalized || normalized === 'all') {
        return 'all';
    }
    if (normalized === 'food' || normalized === 'beverage' || normalized === 'food_beverage') {
        return normalized;
    }
    if (normalized === 'non_beverage') {
        return 'food';
    }
    return normalized;
}

export function ruleAppliesToTemplateType(rule: AcceptedCorrectionRule, templateType: string | undefined): boolean {
    const ruleScope = normalizeTemplateScope(rule.applies_to_menu_type);
    if (ruleScope === 'all') {
        return true;
    }

    const submittedScope = normalizeTemplateScope(templateType || 'food');
    if (submittedScope === 'food_beverage') {
        return ruleScope === 'food' || ruleScope === 'beverage';
    }

    return ruleScope === submittedScope;
}

function isAllUpper(value: string): boolean {
    const letters = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    return !!letters && letters === letters.toUpperCase();
}

function isAllLower(value: string): boolean {
    const letters = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    return !!letters && letters === letters.toLowerCase();
}

function isTitleLike(value: string): boolean {
    const words = value.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || [];
    return words.length > 0 && words.every((word) => word[0] === word[0].toUpperCase());
}

function titleCaseLike(value: string): string {
    return value.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g, (word) =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
}

function matchCase(source: string, target: string): string {
    if (isAllUpper(source)) {
        return target.toUpperCase();
    }
    if (isAllLower(source)) {
        return target.toLowerCase();
    }
    if (isTitleLike(source)) {
        return titleCaseLike(target);
    }
    return target;
}

function replacementRegExp(from: string, separatorVariants = false): RegExp {
    const escaped = separatorVariants
        ? from.split(/[ \u00a0\-\u2010\u2011]+/).map(escapeRegExp).join('[ \u00a0\u2010\u2011-]*')
        : escapeRegExp(from);
    const startsWord = /^[A-Za-z0-9À-ÖØ-öø-ÿ]/.test(from);
    const endsWord = /[A-Za-z0-9À-ÖØ-öø-ÿ]$/.test(from);
    return new RegExp(`${startsWord ? '\\b' : ''}${escaped}${endsWord ? '\\b' : ''}`, 'gi');
}

function accentInsensitiveIndex(input: string): { normalized: string; map: Array<{ start: number; end: number }> } {
    let normalized = '';
    const map: Array<{ start: number; end: number }> = [];

    for (let index = 0; index < input.length;) {
        const codePoint = input.codePointAt(index);
        const char = String.fromCodePoint(codePoint || 0);
        let end = index + char.length;
        let cluster = char;

        while (end < input.length) {
            const nextCodePoint = input.codePointAt(end);
            const nextChar = String.fromCodePoint(nextCodePoint || 0);
            if (!/[\u0300-\u036f]/.test(nextChar)) break;
            cluster += nextChar;
            end += nextChar.length;
        }

        const stripped = stripDiacritics(cluster);
        for (const outputChar of stripped) {
            normalized += outputChar;
            map.push({ start: index, end });
        }
        index = end;
    }

    return { normalized, map };
}

function applyAccentInsensitiveReplacementRule(
    line: string,
    lineIndex: number,
    rule: ReplacementRule,
    source: PreAiCorrectionSource,
    metadata: Partial<PreAiAppliedCorrection> = {},
    settings: { skipIfAlreadyCorrected?: boolean } = {}
): { line: string; corrections: PreAiAppliedCorrection[] } {
    const normalizedFrom = stripDiacritics(rule.from);
    if (!normalizedFrom) {
        return { line, corrections: [] };
    }

    const { normalized, map } = accentInsensitiveIndex(line);
    const re = replacementRegExp(normalizedFrom, rule.separatorVariants);
    const corrections: PreAiAppliedCorrection[] = [];
    let nextLine = '';
    let lastOriginalIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(normalized)) !== null) {
        if (!match[0]) continue;
        const startMap = map[match.index];
        const endMap = map[match.index + match[0].length - 1];
        if (!startMap || !endMap) continue;

        const original = line.slice(startMap.start, endMap.end);
        const corrected = rule.forceTargetCase ? rule.to : matchCase(original, rule.to);
        nextLine += line.slice(lastOriginalIndex, startMap.start);

        if (
            original === corrected
            || (
                settings.skipIfAlreadyCorrected
                && corrected.length > original.length
                && line.slice(startMap.start, startMap.start + corrected.length).toLowerCase() === corrected.toLowerCase()
            )
        ) {
            nextLine += original;
        } else {
            nextLine += corrected;
            corrections.push({
                type: rule.type,
                source,
                original,
                corrected,
                lineIndex,
                ...metadata,
            });
        }

        lastOriginalIndex = endMap.end;
    }

    if (!corrections.length) {
        return { line, corrections: [] };
    }

    nextLine += line.slice(lastOriginalIndex);
    return { line: nextLine, corrections };
}

function applyReplacementRule(
    line: string,
    lineIndex: number,
    rule: ReplacementRule,
    source: PreAiCorrectionSource,
    metadata: Partial<PreAiAppliedCorrection> = {},
    settings: { skipIfAlreadyCorrected?: boolean } = {}
): { line: string; corrections: PreAiAppliedCorrection[] } {
    const corrections: PreAiAppliedCorrection[] = [];
    const re = replacementRegExp(rule.from, rule.separatorVariants);
    const nextLine = line.replace(re, (match, offset: number) => {
        const corrected = rule.forceTargetCase ? rule.to : matchCase(match, rule.to);
        if (match === corrected) {
            return match;
        }
        if (
            settings.skipIfAlreadyCorrected
            && corrected.length > match.length
            && line.slice(offset, offset + corrected.length).toLowerCase() === corrected.toLowerCase()
        ) {
            return match;
        }
        corrections.push({
            type: rule.type,
            source,
            original: match,
            corrected,
            lineIndex,
            ...metadata,
        });
        return corrected;
    });

    return { line: nextLine, corrections };
}

type SingularIngredientPattern = {
    pattern: RegExp;
    corrected: string;
};

const CONSERVATIVE_SINGULAR_INGREDIENT_PATTERNS: SingularIngredientPattern[] = [
    // Dish-name modifier: the ingredient noun modifying Tequeños is singular.
    { pattern: /^(\s*)(prawns)(?=\s+tequeños?\b)/iu, corrected: 'prawn' },

    // Bare comma-delimited ingredients. Prepared/count phrases such as
    // "sautéed prawns" and "three pickles" deliberately do not match.
    { pattern: /(,\s*)(cucumber\s+pickles)(?=\s*,)/giu, corrected: 'pickle' },
    { pattern: /(,\s*)(jalapeños)(?=\s*,)/giu, corrected: 'jalapeño' },
    { pattern: /(,\s*)(prawns)(?=\s*,)/giu, corrected: 'prawn' },
    { pattern: /(,\s*)(pickles)(?=\s*,)/giu, corrected: 'pickle' },
];

/**
 * Apply only the high-signal subset of the SOP's singular-ingredient rule. The
 * general rule remains contextual; this guard targets bare list nouns and the
 * verified Prawn Tequeños modifier while preserving counted/prepared plurals.
 */
export function normalizeSingularIngredientFormsOnLine(
    line: string,
    lineIndex: number
): { line: string; corrections: PreAiAppliedCorrection[] } {
    let nextLine = line;
    const corrections: PreAiAppliedCorrection[] = [];

    for (const { pattern, corrected } of CONSERVATIVE_SINGULAR_INGREDIENT_PATTERNS) {
        pattern.lastIndex = 0;
        nextLine = nextLine.replace(pattern, (match, prefix: string, original: string) => {
            const replacement = matchCase(original, corrected);
            if (original === replacement) return match;
            corrections.push({
                type: 'Singular/Plural',
                source: 'built_in',
                original,
                corrected: replacement,
                lineIndex,
                rule: 'Ingredient descriptions use singular nouns unless a listed exception or an explicit count applies.',
            });
            return `${prefix}${replacement}`;
        });
    }

    // A standalone side can carry only an allergen cluster and optional price, so it
    // has no comma delimiter to identify it as a menu item.
    const standalone = nextLine.match(/^(\s*)(pickles)(\s+.+)$/iu);
    if (standalone) {
        const suffix = standalone[3].trim();
        const metadataOnly = /^[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*(?:\s+(?:(?:[$€£]\s*)?\d{1,4}(?:[.]\d{1,2})?|MKT|MP))?$/u.test(suffix);
        if (metadataOnly) {
            const replacement = matchCase(standalone[2], 'pickle');
            nextLine = `${standalone[1]}${replacement}${standalone[3]}`;
            corrections.push({
                type: 'Singular/Plural',
                source: 'built_in',
                original: standalone[2],
                corrected: replacement,
                lineIndex,
                rule: 'Ingredient descriptions use singular nouns unless a listed exception or an explicit count applies.',
            });
        }
    }

    return { line: nextLine, corrections };
}

function learnedRuleUsesAccentInsensitiveMatching(rule: AcceptedCorrectionRule): boolean {
    const changeType = `${rule.change_type || ''}`.trim().toLowerCase();
    if (!['diacritic', 'diacritics', 'spelling', 'typo'].includes(changeType)) {
        return false;
    }
    const original = `${rule.original_text || ''}`;
    const corrected = `${rule.corrected_text || ''}`;
    return stripDiacritics(original) !== original || stripDiacritics(corrected) !== corrected;
}

function parseAllergenCodesFromLegend(legend: string | undefined): Set<string> {
    const codes = new Set(COMMON_ALLERGEN_CODES);
    const text = `${legend || ''}`;
    const patterns = [
        /\b([A-Za-z]{1,3})\s+(?:contains\s+)?[A-Za-z][A-Za-z\s/&-]+(?=\s*\||$)/g,
        /\(\s*([A-Za-z]{1,3})\s*\)\s*[A-Za-z][A-Za-z\s/&-]+/g,
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            if (match[1]) {
                codes.add(match[1].toUpperCase());
            }
        }
    }

    return codes;
}

function sortCodes(codes: string[]): string[] {
    return [...codes].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function normalizeAllergenClusterOnLine(
    line: string,
    lineIndex: number,
    validCodes: Set<string>
): { line: string; corrections: PreAiAppliedCorrection[] } {
    const original = line || '';
    if (!original.trim()) {
        return { line: original, corrections: [] };
    }

    const priceMatch = original.match(new RegExp(`(\\s+${TRAILING_PRICE_PATTERN}(?:\\s*\\|\\s*${TRAILING_PRICE_PATTERN})?(?:\\s*(?:pp|PP))?)\\s*$`, 'i'));
    const priceSuffix = priceMatch?.[1] || '';
    const withoutPrice = priceMatch ? original.slice(0, priceMatch.index).trimEnd() : original.trimEnd();
    const clusterMatch = withoutPrice.match(/(\s+\*?\s*)([A-Za-z]{1,3}(?:\s*,\s*[A-Za-z]{1,3})*)\s*$/);
    if (!clusterMatch?.[2]) {
        return { line: original, corrections: [] };
    }

    const rawCodes = clusterMatch[2];
    const codes = rawCodes.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
    if (codes.length === 0 || codes.some((code) => !validCodes.has(code))) {
        return { line: original, corrections: [] };
    }

    const normalizedCodes = sortCodes([...new Set(codes)]).join(',');
    if (rawCodes === normalizedCodes) {
        return { line: original, corrections: [] };
    }

    const prefix = withoutPrice.slice(0, clusterMatch.index);
    const markerPrefix = clusterMatch[1].includes('*') ? '* ' : ' ';
    const corrected = `${prefix}${markerPrefix}${normalizedCodes}${priceSuffix}`.trimEnd();
    return {
        line: corrected,
        corrections: [{
            type: 'Allergen Code',
            source: 'built_in',
            original: rawCodes,
            corrected: normalizedCodes,
            lineIndex,
        }],
    };
}

function ensureTresLechesVegetarianCodeOnLine(
    line: string,
    lineIndex: number,
    validCodes: Set<string>
): { line: string; corrections: PreAiAppliedCorrection[] } {
    const original = line || '';
    if (!/\btres\s+leches\b/i.test(original)) {
        return { line: original, corrections: [] };
    }

    const priceMatch = original.match(new RegExp(`(\\s+${TRAILING_PRICE_PATTERN}(?:\\s*\\|\\s*${TRAILING_PRICE_PATTERN})?(?:\\s*(?:pp|PP))?)\\s*$`, 'i'));
    const priceSuffix = priceMatch?.[1] || '';
    const withoutPrice = priceMatch ? original.slice(0, priceMatch.index).trimEnd() : original.trimEnd();
    const clusterMatch = withoutPrice.match(/(\s+\*?\s*)([A-Za-z]{1,3}(?:\s*,\s*[A-Za-z]{1,3})*)\s*$/);

    if (clusterMatch?.[2]) {
        const rawCodes = clusterMatch[2];
        const codes = rawCodes.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
        if (codes.length === 0 || codes.some((code) => !validCodes.has(code))) {
            return { line: original, corrections: [] };
        }
        if (codes.includes('V')) {
            return { line: original, corrections: [] };
        }

        const normalizedCodes = sortCodes([...new Set([...codes, 'V'])]).join(',');
        const prefix = withoutPrice.slice(0, clusterMatch.index);
        const markerPrefix = clusterMatch[1].includes('*') ? '* ' : ' ';
        const corrected = `${prefix}${markerPrefix}${normalizedCodes}${priceSuffix}`.trimEnd();
        return {
            line: corrected,
            corrections: [{
                type: 'Allergen Code',
                source: 'built_in',
                original: rawCodes,
                corrected: normalizedCodes,
                lineIndex,
                rule: 'Tres Leches always needs a vegetarian symbol V.',
            }],
        };
    }

    if (!priceSuffix) {
        return { line: original, corrections: [] };
    }

    const corrected = `${withoutPrice} V${priceSuffix}`.trimEnd();
    return {
        line: corrected,
        corrections: [{
            type: 'Allergen Code',
            source: 'built_in',
            original: withoutPrice,
            corrected,
            lineIndex,
            rule: 'Tres Leches always needs a vegetarian symbol V.',
        }],
    };
}

export function ensureCotijaCheeseModifierOnLine(
    line: string,
    lineIndex: number
): { line: string; corrections: PreAiAppliedCorrection[] } {
    const original = line || '';
    // Cotija is an ingredient spelling that must be followed by "cheese" in
    // menu descriptions. Do not alter already-correct text or hyphenated
    // adjective forms such as "cotija-style".
    const pattern = /\bcotija\b(?!\s+cheese\b)(?!-[A-Za-z])/gi;
    const corrections: PreAiAppliedCorrection[] = [];
    const corrected = original.replace(pattern, (match) => {
        const replacement = matchCase(match, 'cotija cheese');
        corrections.push({
            type: 'Terminology',
            source: 'built_in',
            original: match,
            corrected: replacement,
            lineIndex,
            rule: 'Cotija must include the cheese modifier.',
        });
        return replacement;
    });

    return { line: corrected, corrections };
}

function normalizeRawAsteriskPlacementForLine(line: string): string {
    const original = line || '';
    const originalTrimmed = original.trim();
    const starCount = (originalTrimmed.match(/\*/g) || []).length;
    if (starCount !== 1) {
        return original;
    }

    const compactedInlineMarker = original
        .replace(/(\S)\s+\*/g, '$1*')
        .replace(/\*([A-Z]{1,3})(?=(?:,|\s|$))/g, '* $1');
    const trimmed = compactedInlineMarker.trim();
    if (!trimmed || !trimmed.includes('*') || /consuming raw or undercooked/i.test(trimmed)) {
        return original;
    }

    if (trimmed.includes('|')) {
        return compactedInlineMarker;
    }

    const firstStar = trimmed.indexOf('*');
    const firstComma = trimmed.indexOf(',');
    if (firstComma !== -1 && firstStar !== -1 && firstStar < firstComma) {
        return compactedInlineMarker;
    }

    let working = trimmed.replace(/\*/g, '').replace(/\s{2,}/g, ' ').trim();
    let trailingPrice = '';
    let trailingAllergens = '';

    const priceMatch = working.match(new RegExp(`\\s+(${TRAILING_PRICE_PATTERN}(?:\\s*\\|\\s*${TRAILING_PRICE_PATTERN})?)\\s*$`, 'i'));
    if (priceMatch) {
        trailingPrice = priceMatch[1];
        working = working.slice(0, priceMatch.index).trim();
    }

    const allergenMatch = working.match(/\s+([A-Z]{1,3}(?:,[A-Z]{1,3})*)\s*$/);
    if (allergenMatch) {
        trailingAllergens = allergenMatch[1];
        working = working.slice(0, allergenMatch.index).trim();
    }

    working = working.replace(/\s*[-–—:]\s*$/, '').trim();

    if (!trailingAllergens && !trailingPrice) {
        if (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9 '&-]+$/.test(working) && !working.includes(',')) {
            return original;
        }
        if (working.includes(' | ') && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(working)) {
            return original;
        }
    }

    if (trailingAllergens || trailingPrice) {
        return `${working}*${trailingAllergens ? ` ${trailingAllergens}` : ''}${trailingPrice ? ` ${trailingPrice}` : ''}`.trim();
    }

    return `${working}*`;
}

const RAW_ASTERISK_TERM_PATTERN = /\b(?:sashimi|tartare|carpaccio|crudo|ceviche|tiradito|poke|raw\s+(?:tuna|salmon|hamachi|fish|beef|oysters?)|oysters?\s+on\s+the\s+half\s+shell|half[-\s]shell\s+oysters?|sunny[-\s]side(?:[-\s]up)?\s+eggs?|sunny[-\s]side[-\s]up|poached\s+eggs?|soft[-\s]boiled|rib[-\s]?eye|hollandaise|bearnaise|béarnaise|caesar\s+dressing|tiramisu|cured\s+egg\s+yolk|meringue|egg[-\s]+white)\b/i;
const INDEPENDENT_RAW_TERM_PATTERN = /\b(?:sashimi|tartare|carpaccio|crudo|tiradito|poke|raw|uncooked|undercooked|oysters?\s+on\s+the\s+half\s+shell|half[-\s]shell\s+oysters?|sunny[-\s]side(?:[-\s]up)?\s+eggs?|sunny[-\s]side[-\s]up|poached\s+eggs?|soft[-\s]boiled|hollandaise|bearnaise|béarnaise|caesar\s+dressing|tiramisu|cured\s+egg\s+yolk|meringue|egg[-\s]+white)\b/i;

function isCookedShrimpCevicheLine(line: string): boolean {
    const normalized = `${line || ''}`.toLowerCase();
    return /\b(?:shrimp|prawn)\s+ceviche\b/.test(normalized)
        && !INDEPENDENT_RAW_TERM_PATTERN.test(normalized);
}

/** Shrimp ceviche is cooked under the approved house rule unless raw is explicit. */
export function normalizeShrimpCevicheRawMarkerOnLine(
    line: string,
    lineIndex: number
): { line: string; corrections: PreAiAppliedCorrection[] } {
    if (!isCookedShrimpCevicheLine(line) || !line.includes('*')) {
        return { line, corrections: [] };
    }
    const corrected = line.replace(/\s*\*\s*/g, (match) => (/\s/.test(match) ? ' ' : ''))
        .replace(/\s{2,}/g, ' ')
        .trimEnd();
    if (corrected === line) return { line, corrections: [] };
    return {
        line: corrected,
        corrections: [{
            type: 'Raw Item',
            source: 'built_in',
            original: line,
            corrected,
            lineIndex,
            rule: 'Shrimp ceviche is treated as cooked unless raw or undercooked content is explicit.',
        }],
    };
}

function shouldAddRawAsterisk(line: string): boolean {
    const normalized = line.toLowerCase();
    if (!normalized.trim() || normalized.includes('*') || /consuming raw or undercooked/.test(normalized)) {
        return false;
    }
    // Preparation names such as tiradito/tartare also describe plant-based
    // dishes. An explicitly vegan name is not evidence of raw animal food.
    if (/^\s*vegan\b/i.test(line)) {
        return false;
    }
    if (/\bceviche\b/.test(normalized) && /\b(?:poached|cooked)\b/.test(normalized)) {
        return false;
    }
    if (isCookedShrimpCevicheLine(line)) {
        return false;
    }
    if (/\boysters?\b/.test(normalized) && !/\b(?:raw\s+oysters?|oysters?\s+on\s+the\s+half\s+shell|half[-\s]shell\s+oysters?)\b/.test(normalized)) {
        return false;
    }
    const hasNewRawEggTerm = /\b(?:hollandaise|bearnaise|béarnaise|caesar\s+dressing|tiramisu|cured\s+egg\s+yolk|meringue|egg[-\s]+white)\b/.test(normalized);
    if (hasNewRawEggTerm && /\b(?:braised|slow[-\s]?roasted|confit|well[-\s]?done)\b/.test(normalized)) {
        return false;
    }
    if (/:/.test(line) && /\b[A-Z]{1,3}\s*,/.test(line)) {
        return false;
    }
    const hasPrice = new RegExp(`\\s+${TRAILING_PRICE_PATTERN}(?:\\s*(?:pp|PP))?\\s*$`, 'i').test(line);
    const hasTrailingAllergenCluster = /\s+[A-Z]{1,3}(?:,[A-Z]{1,3})*\s*$/.test(line.trim());
    const hasDescriptionComma = line.includes(',');
    if (!hasPrice && (!hasTrailingAllergenCluster || !hasDescriptionComma)) {
        return false;
    }
    return RAW_ASTERISK_TERM_PATTERN.test(line);
}

function addRawAsterisk(line: string): string {
    const trimmed = line.trimEnd();
    const descriptionComma = trimmed.search(/,\s*(?=[^,]*\p{Ll})/u);
    const rawTermMatch = trimmed.match(RAW_ASTERISK_TERM_PATTERN);
    if (descriptionComma > 0 && rawTermMatch?.index !== undefined && rawTermMatch.index < descriptionComma) {
        return `${trimmed.slice(0, descriptionComma).trimEnd()}*${trimmed.slice(descriptionComma)}`;
    }
    return normalizeRawAsteriskPlacementForLine(`${trimmed} *`);
}

export function getAcceptedCorrectionRulePreAiEligibility(rule: AcceptedCorrectionRule): AcceptedCorrectionRulePreAiEligibility {
    const changeType = `${rule.change_type || ''}`.trim().toLowerCase();
    const original = `${rule.original_text || ''}`.trim();
    const corrected = `${rule.corrected_text || ''}`.trim();
    if (`${rule.status || ''}`.toLowerCase() !== 'accepted') {
        return { eligible: false, reason: 'not_accepted' };
    }
    // Context-dependent terms (tartare/tartar, berry/berries, …) can never be
    // applied as blind replacements — the correct form depends on the dish/usage,
    // so they belong in the AI prompt, not the deterministic pass. This mirrors
    // the guard the improvement cycle already applies to LLM-proposed rules, and
    // it neutralizes any such rule that reached the DB before that routing
    // existed (e.g. a human-saved "berry" → "berries").
    const contextTerm = involvesContextDependentTerm(original, corrected);
    if (contextTerm) {
        return { eligible: false, reason: 'context_dependent', contextTerm };
    }
    // Capitalization rules are deterministic only when they explicitly opt in
    // to the stored target casing. Without the flag, preserve the historical
    // source-casing behavior and do not activate a broad case rewrite.
    if (!LEARNED_RULE_CHANGE_TYPES.has(changeType) && !(changeType === 'capitalization' && rule.force_target_case === true)) {
        return { eligible: false, reason: 'unsupported_change_type' };
    }
    if (!original || !corrected) {
        return { eligible: false, reason: 'missing_exact_text' };
    }
    if (original === corrected) {
        return { eligible: false, reason: 'same_text' };
    }
    if (original.includes('\n') || corrected.includes('\n')) {
        return { eligible: false, reason: 'multiline_text' };
    }
    if (original.length > 240 || corrected.length > 240) {
        return { eligible: false, reason: 'text_too_long' };
    }
    return { eligible: true, reason: 'eligible' };
}

function isSafeLearnedRule(rule: AcceptedCorrectionRule): boolean {
    return getAcceptedCorrectionRulePreAiEligibility(rule).eligible;
}

function applyAcceptedCorrectionRulesOnce(
    lines: string[],
    options: PreAiDeterministicOptions
): {
    lines: string[];
    appliedCorrections: PreAiAppliedCorrection[];
    learnedRulesConsidered: number;
    learnedRulesApplied: number;
} {
    const applicableRules = (options.acceptedCorrectionRules || [])
        .filter(isSafeLearnedRule)
        .filter((rule) => ruleAppliesToProperty(rule, options.property))
        .filter((rule) => ruleAppliesToTemplateType(rule, options.templateType));
    let nextLines = [...lines];
    const appliedCorrections: PreAiAppliedCorrection[] = [];
    const appliedRuleIds = new Set<string>();

    for (const rule of applicableRules) {
        const replacement: ReplacementRule = {
            from: `${rule.original_text || ''}`.trim(),
            to: `${rule.corrected_text || ''}`.trim(),
            type: 'Learned Rule',
            forceTargetCase: rule.force_target_case === true,
            separatorVariants: permitsSeparatorVariants(rule.original_text || '', rule.corrected_text || ''),
        };

        for (let i = 0; i < nextLines.length; i++) {
            const metadata = {
                ruleId: rule.id,
                rule: rule.rule,
            };
            const settings = { skipIfAlreadyCorrected: true };
            const result = learnedRuleUsesAccentInsensitiveMatching(rule)
                ? applyAccentInsensitiveReplacementRule(nextLines[i], i, replacement, 'accepted_correction_rule', metadata, settings)
                : applyReplacementRule(nextLines[i], i, replacement, 'accepted_correction_rule', metadata, settings);
            if (result.corrections.length > 0) {
                nextLines[i] = result.line;
                appliedCorrections.push(...result.corrections);
                if (rule.id) {
                    appliedRuleIds.add(rule.id);
                }
            }
        }
    }

    return {
        lines: nextLines,
        appliedCorrections,
        learnedRulesConsidered: applicableRules.length,
        learnedRulesApplied: appliedRuleIds.size || appliedCorrections.length,
    };
}

export type FinalTermCanonicalizationResult = PreAiDeterministicResult & { diagnostics: string[] };

/** Bounded term-only closure. A cycle, competing result, or expanding rule preserves the input row. */
export function canonicalizeFinalTerms(menuText: string, options: PreAiDeterministicOptions = {}): FinalTermCanonicalizationResult {
    const rules = (options.acceptedCorrectionRules || []).filter(rule =>
        ['spelling', 'typo', 'diacritic', 'diacritics', 'terminology', 'capitalization'].includes(`${rule.change_type || ''}`.trim().toLowerCase())
        && JSON.stringify(`${rule.original_text || ''}`.match(/\d+(?:[.,]\d+)?/g)) === JSON.stringify(`${rule.corrected_text || ''}`.match(/\d+(?:[.,]\d+)?/g))
    );
    return resolveAcceptedRules(menuText, { ...options, acceptedCorrectionRules: rules });
}

function resolveAcceptedRules(menuText: string, options: PreAiDeterministicOptions): FinalTermCanonicalizationResult {
    const diagnostics: string[] = [];
    const appliedCorrections: PreAiAppliedCorrection[] = [];
    const policyView = resolveCanonicalPolicies(options.acceptedCorrectionRules || [], options);
    const eligibleRules = policyView.rules;
    diagnostics.push(...policyView.conflicts.map(conflict => `term_policy_conflict:rules:${conflict.ruleIds.join(',')}`));
    if (options.enabled === false) return { menuText, appliedCorrections, diagnostics, learnedRulesConsidered: 0, learnedRulesApplied: 0 };
    const lines = menuText.split('\n').map((original, lineIndex) => {
        const settle = (rules: AcceptedCorrectionRule[]) => {
            let line = original;
            const seen = new Set<string>();
            const corrections: PreAiAppliedCorrection[] = [];
            for (let pass = 0; pass < 8; pass++) {
                if (seen.has(line)) return null;
                seen.add(line);
                const result = applyAcceptedCorrectionRulesOnce([line], { ...options, acceptedCorrectionRules: rules });
                if (result.lines[0] === line) return result.appliedCorrections.length ? null : { line, corrections };
                if (result.lines[0].length > original.length + 1024) return null;
                line = result.lines[0];
                corrections.push(...result.appliedCorrections.map(c => ({ ...c, lineIndex })));
            }
            return null;
        };
        const competingTargets = new Map<string, Set<string>>();
        for (const rule of eligibleRules) {
            const key = `${rule.original_text || ''}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
            const targets = competingTargets.get(key) || new Set<string>();
            targets.add(`${rule.corrected_text || ''}`);
            competingTargets.set(key, targets);
        }
        const competing = eligibleRules.some(rule => competingTargets.get(`${rule.original_text || ''}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())!.size > 1
            && applyAcceptedCorrectionRulesOnce([original], { ...options, acceptedCorrectionRules: [rule] }).appliedCorrections.length > 0);
        if (competing) {
            diagnostics.push(`term_policy_conflict:line:${lineIndex}`);
            return original;
        }
        const forward = settle(eligibleRules);
        const reverse = settle([...eligibleRules].reverse());
        if (!forward || !reverse || forward.line !== reverse.line) {
            diagnostics.push(`term_policy_conflict:line:${lineIndex}`);
            return original;
        }
        appliedCorrections.push(...forward.corrections);
        return forward.line;
    });
    return { menuText: lines.join('\n'), appliedCorrections, diagnostics,
        learnedRulesConsidered: eligibleRules.length,
        learnedRulesApplied: new Set(appliedCorrections.map(c => c.ruleId || `${c.original}→${c.corrected}`)).size };
}

export function runPreAiDeterministicChecks(
    menuText: string,
    options: PreAiDeterministicOptions = {}
): PreAiDeterministicResult {
    if (options.enabled === false || !menuText) {
        return {
            menuText,
            appliedCorrections: [],
            learnedRulesConsidered: 0,
            learnedRulesApplied: 0,
        };
    }

    const validAllergenCodes = parseAllergenCodesFromLegend(options.allergenLegend);
    let lines = `${menuText || ''}`.split('\n');
    const appliedCorrections: PreAiAppliedCorrection[] = [];

    lines = lines.map((line, lineIndex) => {
        let nextLine = line;
        for (const rule of BUILT_IN_REPLACEMENTS) {
            const result = applyReplacementRule(nextLine, lineIndex, rule, 'built_in');
            nextLine = result.line;
            appliedCorrections.push(...result.corrections);
        }

        const spellingResult = normalizeCuratedFoodSpellingsOnLine(nextLine, lineIndex);
        nextLine = spellingResult.line;
        appliedCorrections.push(...spellingResult.corrections);

        const singularResult = normalizeSingularIngredientFormsOnLine(nextLine, lineIndex);
        nextLine = singularResult.line;
        appliedCorrections.push(...singularResult.corrections);

        const tresLechesResult = ensureTresLechesVegetarianCodeOnLine(nextLine, lineIndex, validAllergenCodes);
        nextLine = tresLechesResult.line;
        appliedCorrections.push(...tresLechesResult.corrections);

        const cotijaResult = ensureCotijaCheeseModifierOnLine(nextLine, lineIndex);
        nextLine = cotijaResult.line;
        appliedCorrections.push(...cotijaResult.corrections);

        const allergenResult = normalizeAllergenClusterOnLine(nextLine, lineIndex, validAllergenCodes);
        nextLine = allergenResult.line;
        appliedCorrections.push(...allergenResult.corrections);

        const shrimpCevicheResult = normalizeShrimpCevicheRawMarkerOnLine(nextLine, lineIndex);
        nextLine = shrimpCevicheResult.line;
        appliedCorrections.push(...shrimpCevicheResult.corrections);

        const normalizedRaw = normalizeRawAsteriskPlacementForLine(nextLine);
        if (normalizedRaw !== nextLine) {
            appliedCorrections.push({
                type: 'Raw Item',
                source: 'built_in',
                original: nextLine,
                corrected: normalizedRaw,
                lineIndex,
            });
            nextLine = normalizedRaw;
        }

        if (shouldAddRawAsterisk(nextLine)) {
            const withAsterisk = addRawAsterisk(nextLine);
            if (withAsterisk !== nextLine) {
                appliedCorrections.push({
                    type: 'Raw Item',
                    source: 'built_in',
                    original: nextLine,
                    corrected: withAsterisk,
                    lineIndex,
                });
                nextLine = withAsterisk;
            }
        }

        return nextLine;
    });

    const learnedResult = resolveAcceptedRules(lines.join('\n'), options);
    lines = learnedResult.menuText.split('\n');
    appliedCorrections.push(...learnedResult.appliedCorrections);

    return {
        menuText: lines.join('\n'),
        appliedCorrections,
        learnedRulesConsidered: learnedResult.learnedRulesConsidered,
        learnedRulesApplied: learnedResult.learnedRulesApplied,
        diagnostics: learnedResult.diagnostics,
    };
}
