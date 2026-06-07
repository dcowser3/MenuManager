export type PreAiCorrectionSource = 'built_in' | 'accepted_correction_rule';

export type PreAiAppliedCorrection = {
    type: 'Spelling' | 'Diacritics' | 'Allergen Code' | 'Raw Item' | 'Learned Rule';
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
};

type ReplacementRule = {
    from: string;
    to: string;
    type: PreAiAppliedCorrection['type'];
};

const COMMON_ALLERGEN_CODES = new Set([
    'A', 'C', 'CE', 'D', 'DF', 'E', 'ET', 'F', 'G', 'GF', 'L', 'M', 'MO',
    'MU', 'N', 'P', 'PN', 'S', 'SE', 'SF', 'SL', 'SS', 'SU', 'SY', 'T', 'TN',
    'V', 'VG',
]);

const BUILT_IN_REPLACEMENTS: ReplacementRule[] = [
    // Diacritics that are safe enough to apply before the AI review.
    { from: 'aji amarillo', to: 'ají amarillo', type: 'Diacritics' },
    { from: 'aji panca', to: 'ají panca', type: 'Diacritics' },
    { from: 'chile de arbol', to: 'chile de árbol', type: 'Diacritics' },
    { from: 'creme brulee', to: 'crème brûlée', type: 'Diacritics' },
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
    { from: 'tajin', to: 'tajín', type: 'Diacritics' },
    { from: 'tampiquena', to: 'tampiqueña', type: 'Diacritics' },
    { from: 'huancaina', to: 'huancaína', type: 'Diacritics' },

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

const TRAILING_PRICE_PATTERN = '(?:(?:[$€£]\\s*)?\\d{1,4}(?:,\\d{3})*(?:[.]\\d{1,2})?|MKT|MP|market\\s+price)';

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

function ruleAppliesToProperty(rule: AcceptedCorrectionRule, property: string | undefined): boolean {
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

function ruleAppliesToTemplateType(rule: AcceptedCorrectionRule, templateType: string | undefined): boolean {
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

function replacementRegExp(from: string): RegExp {
    const escaped = escapeRegExp(from);
    const startsWord = /^[A-Za-z0-9À-ÖØ-öø-ÿ]/.test(from);
    const endsWord = /[A-Za-z0-9À-ÖØ-öø-ÿ]$/.test(from);
    return new RegExp(`${startsWord ? '\\b' : ''}${escaped}${endsWord ? '\\b' : ''}`, 'gi');
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
    const re = replacementRegExp(rule.from);
    const nextLine = line.replace(re, (match, offset: number) => {
        const corrected = matchCase(match, rule.to);
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

function shouldAddRawAsterisk(line: string): boolean {
    const normalized = line.toLowerCase();
    if (!normalized.trim() || normalized.includes('*') || /consuming raw or undercooked/.test(normalized)) {
        return false;
    }
    if (/\bceviche\b/.test(normalized) && /\b(?:poached|cooked)\b/.test(normalized)) {
        return false;
    }
    if (/\boysters?\b/.test(normalized) && !/\b(?:raw\s+oysters?|oysters?\s+on\s+the\s+half\s+shell|half[-\s]shell\s+oysters?)\b/.test(normalized)) {
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
    return /\b(?:sashimi|tartare|carpaccio|crudo|ceviche|tiradito|poke|raw\s+(?:tuna|salmon|hamachi|fish|beef|oysters?)|oysters?\s+on\s+the\s+half\s+shell|half[-\s]shell\s+oysters?|sunny[-\s]side(?:[-\s]up)?\s+eggs?|sunny[-\s]side[-\s]up|poached\s+eggs?|soft[-\s]boiled)\b/i.test(line);
}

function addRawAsterisk(line: string): string {
    return normalizeRawAsteriskPlacementForLine(`${line.trimEnd()} *`);
}

function isSafeLearnedRule(rule: AcceptedCorrectionRule): boolean {
    const changeType = `${rule.change_type || ''}`.trim().toLowerCase();
    const original = `${rule.original_text || ''}`.trim();
    const corrected = `${rule.corrected_text || ''}`.trim();
    return `${rule.status || ''}`.toLowerCase() === 'accepted'
        && LEARNED_RULE_CHANGE_TYPES.has(changeType)
        && !!original
        && !!corrected
        && original !== corrected
        && !original.includes('\n')
        && !corrected.includes('\n')
        && original.length <= 240
        && corrected.length <= 240;
}

function applyAcceptedCorrectionRules(
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
        };

        for (let i = 0; i < nextLines.length; i++) {
            const result = applyReplacementRule(nextLines[i], i, replacement, 'accepted_correction_rule', {
                ruleId: rule.id,
                rule: rule.rule,
            }, {
                skipIfAlreadyCorrected: true,
            });
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

        const tresLechesResult = ensureTresLechesVegetarianCodeOnLine(nextLine, lineIndex, validAllergenCodes);
        nextLine = tresLechesResult.line;
        appliedCorrections.push(...tresLechesResult.corrections);

        const allergenResult = normalizeAllergenClusterOnLine(nextLine, lineIndex, validAllergenCodes);
        nextLine = allergenResult.line;
        appliedCorrections.push(...allergenResult.corrections);

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

    const learnedResult = applyAcceptedCorrectionRules(lines, options);
    lines = learnedResult.lines;
    appliedCorrections.push(...learnedResult.appliedCorrections);

    return {
        menuText: lines.join('\n'),
        appliedCorrections,
        learnedRulesConsidered: learnedResult.learnedRulesConsidered,
        learnedRulesApplied: learnedResult.learnedRulesApplied,
    };
}
