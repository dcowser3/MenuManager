"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDishQualityText = normalizeDishQualityText;
exports.buildExactDuplicateKey = buildExactDuplicateKey;
exports.buildSameNameCategoryKey = buildSameNameCategoryKey;
exports.buildDishQualityContext = buildDishQualityContext;
exports.analyzeApprovedDishQuality = analyzeApprovedDishQuality;
exports.findDishSourceContext = findDishSourceContext;
const CATEGORY_WORDS = new Set([
    'a la carte',
    'antojitos',
    'appetizer',
    'appetizers',
    'beverage',
    'beverages',
    'breakfast',
    'brunch',
    'cocktail',
    'cocktails',
    'dessert',
    'desserts',
    'dinner',
    'entree',
    'entrees',
    'entradas',
    'especialidades',
    'fajitas',
    'for the table',
    'happy hour',
    'lunch',
    'mas',
    'mains',
    'postres',
    'raw bar',
    'salad',
    'salads',
    'side',
    'sides',
    'soup',
    'starters',
    'tacos',
    'wine',
    'wines',
]);
const EXCLUDE_CODES = new Set([
    'beverage_heading_as_name',
    'layout_leader_in_name',
    'pricing_grid_as_dish',
    'instruction_text_name',
    'package_or_course_label',
    'price_only_name',
    'modifier_row_name',
]);
const BEVERAGE_HEADING_WORDS = new Set([
    'anejo',
    'blanco',
    'cerveza',
    'cerveza local',
    'cervezalocal',
    'cocktails',
    'cocteles',
    'drink',
    'drinks',
    'espumoso',
    'extra anejo',
    'extraanejo',
    'flights',
    'happy hour',
    'happyhour',
    'house infused tequila',
    'houseinfusedtequila',
    'margaritas',
    'mezcal',
    'mineral water',
    'pick me up',
    'pick me ups',
    'reposado',
    'rojo',
    'rosado',
    'vino by the bottle',
    'vino by the glass',
    'vinobythebottle',
    'vinobytheglass',
    'zero proof',
]);
const SEVERITY_RANK = {
    high: 3,
    medium: 2,
    info: 1,
};
function compactText(value) {
    return `${value || ''}`.replace(/\s+/g, ' ').trim();
}
function normalizeDishQualityText(value) {
    return compactText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[_/|]+/g, ' ')
        .replace(/[^a-z0-9$]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function buildExactDuplicateKey(dish) {
    return [
        compactText(dish.source_submission_id),
        normalizeDishQualityText(dish.dish_name),
        normalizeDishQualityText(dish.menu_category),
        normalizeDishQualityText(dish.description),
        compactText(dish.price),
    ].join('|');
}
function buildSameNameCategoryKey(dish) {
    return [
        compactText(dish.source_submission_id),
        normalizeDishQualityText(dish.dish_name),
    ].join('|');
}
function buildDishQualityContext(dishes) {
    const exactDuplicateCounts = new Map();
    const sameNameCategoryValues = new Map();
    for (const dish of dishes) {
        const exactKey = buildExactDuplicateKey(dish);
        exactDuplicateCounts.set(exactKey, (exactDuplicateCounts.get(exactKey) || 0) + 1);
        const nameKey = buildSameNameCategoryKey(dish);
        const categories = sameNameCategoryValues.get(nameKey) || new Set();
        categories.add(normalizeDishQualityText(dish.menu_category));
        sameNameCategoryValues.set(nameKey, categories);
    }
    const sameNameCategoryCounts = new Map();
    for (const [key, categories] of sameNameCategoryValues.entries()) {
        sameNameCategoryCounts.set(key, categories.size);
    }
    return {
        exactDuplicateCounts,
        sameNameCategoryCounts,
    };
}
function addIssue(issues, code, severity, reason) {
    issues.push({ code, severity, reason });
}
function hasAllergenCluster(value) {
    return /(?:^|[\s,*])\*?(?:C|D|E|G|M|N|P|PN|S|SE|SL|SS|SY|TN|V|VG)(?:\s*,\s*(?:C|D|E|G|M|N|P|PN|S|SE|SL|SS|SY|TN|V|VG)){1,}(?:$|[\s,.])/i
        .test(value);
}
function hasMenuPriceGlue(value) {
    const text = compactText(value);
    return /(?:[$€£]\s*\d+\s*[A-Za-zÀ-ÿ]){2,}/.test(text)
        || /\b(?:a\s*la\s*carte|la\s*carte)\s*pricing[a-z]/i.test(text)
        || /\bpricing(?:antojitos|tacos|especialidades|postres|mas)\b/i.test(text)
        || /\b(?:antojitos|tacos|especialidades|postres|mas)\s*-\s*[$€£]?\d+/i.test(text);
}
function isPricingName(name, description) {
    const normalizedName = normalizeDishQualityText(name);
    return normalizedName === 'pricing'
        || hasMenuPriceGlue(name)
        || hasMenuPriceGlue(description)
        || /\b(?:a\s*la\s*carte|la\s*carte)\s*pricing\b/i.test(name);
}
function isInstructionLike(value) {
    return /^(?:served\s+with|served\s+for\s+the\s+table|host\s+chooses?|choose\b|choice\s+of\b|select\b|crafted\s+by|created\s+by|cocktails?\s+creations?\s+by|please\s+add|existing\s+menu\s+edits|new\s+menu\s+development|missing\s+description|separate\s+value|raw\s+protein|allergen\s+key|we\s+also\s+want\s+to\s+run)\b/i
        .test(compactText(value));
}
function isPackageOrCourseLabel(value) {
    return /^(?:\d+|one|two|three|four|five)\s+courses?\b/i.test(compactText(value))
        || /^\d+(?:st|nd|rd|th)\s+course\b/i.test(compactText(value))
        || /^\d+\s+tacos?\s+per\s+order\b/i.test(compactText(value))
        || /^\d+\s*(?:oz|gr)\s+with\s+\d+\s+sides?\b/i.test(compactText(value))
        || /^\d+\s*(?:piece|pc|pcs)\b/i.test(compactText(value));
}
function isModifierRow(value) {
    return /^(?:add|adds|additions?|enhancements?|option\s+to\s+add|substitute|make\s+it)\b/i
        .test(compactText(value));
}
function isPriceOnly(value) {
    return /^(?:[$€£]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(compactText(value));
}
function looksLikeKnownCategory(value) {
    const normalized = normalizeDishQualityText(value);
    return CATEGORY_WORDS.has(normalized) || /\bstation$/.test(normalized);
}
function cleanBeverageHeadingText(value) {
    return compactText(value)
        .replace(/\s*\((?:formerly|formally)\s+["'“”]?[^)]*["'“”]?\)\s*/ig, ' ')
        .replace(/[*_#]+/g, ' ')
        .replace(/\s*[-–—]+\s*$/g, '')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .trim();
}
function looksLikeBeverageHeading(value) {
    const normalized = normalizeDishQualityText(cleanBeverageHeadingText(value));
    const compact = normalized.replace(/\s+/g, '');
    return BEVERAGE_HEADING_WORDS.has(normalized) || BEVERAGE_HEADING_WORDS.has(compact);
}
function hasLayoutLeaderRun(value) {
    return /[.·•…]{2,}/.test(compactText(value));
}
function looksLikeShortTitle(value) {
    const text = compactText(value);
    const words = text.split(/\s+/).filter(Boolean);
    return words.length > 0 &&
        words.length <= 4 &&
        words.every((word) => /^[A-ZÀ-Þ0-9]/.test(word));
}
function looksLikeBeverageIngredientText(value) {
    const text = compactText(value);
    return /[-–—,/]/.test(text) &&
        /\b(?:agave|anejo|añejo|aquafaba|bitters?|blanco|bourbon|brandy|cafe|café|citrus|cointreau|espresso|gin|grapefruit|lemon|licor|lime|liqueur|mezcal|orange|reposado|rum|sotol|syrup|tequila|vodka|whiskey|whisky|wine)\b/i.test(text);
}
function looksLikeDescription(value) {
    const text = compactText(value);
    if (!text) {
        return false;
    }
    const commaCount = (text.match(/,/g) || []).length;
    const normalized = normalizeDishQualityText(text);
    const hasIngredientWords = /\b(?:adobo|aioli|arugula|avocado|bean|beans|beef|butter|carrot|cheese|chicken|chili|cilantro|coconut|corn|crema|crab|egg|figs?|garlic|glaze|guacamole|hibiscus|lemon|lettuce|lime|mole|onion|orange|pepita|potato|puree|radish|roasted|salsa|sauce|shrimp|tomatillo|tomato|tortilla|vinaigrette)\b/.test(normalized);
    return commaCount >= 2
        || (commaCount >= 1 && hasIngredientWords)
        || hasAllergenCluster(text)
        || text.length > 80;
}
function highestSeverity(issues) {
    return issues.reduce((highest, issue) => {
        if (!highest || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[highest]) {
            return issue.severity;
        }
        return highest;
    }, undefined);
}
function dispositionForIssues(issues) {
    if (issues.some((issue) => EXCLUDE_CODES.has(issue.code))) {
        return 'exclude';
    }
    return issues.length > 0 ? 'review' : 'keep';
}
function analyzeApprovedDishQuality(dish, context = {}) {
    const issues = [];
    const name = compactText(dish.dish_name);
    const category = compactText(dish.menu_category);
    const description = compactText(dish.description);
    const price = compactText(dish.price);
    if (!name) {
        addIssue(issues, 'missing_name', 'high', 'Dish row has no name.');
    }
    if (!compactText(dish.source_submission_id)) {
        addIssue(issues, 'missing_source_submission', 'high', 'Dish row has no source submission.');
    }
    if (isPricingName(name, description)) {
        addIssue(issues, 'pricing_grid_as_dish', 'high', 'Dish row looks like pricing grid or menu pricing text.');
    }
    if (name && looksLikeBeverageHeading(name)) {
        addIssue(issues, 'beverage_heading_as_name', 'high', 'Dish name looks like a beverage section heading.');
    }
    if (name && hasLayoutLeaderRun(name)) {
        addIssue(issues, 'layout_leader_in_name', 'high', 'Dish name still contains visual leader dots or similar layout artifacts.');
    }
    if (description && looksLikeShortTitle(description) && looksLikeBeverageIngredientText(name)) {
        addIssue(issues, 'beverage_name_description_swap', 'medium', 'Dish name looks like beverage ingredients while description looks like the actual item name.');
    }
    if (isInstructionLike(name)) {
        addIssue(issues, 'instruction_text_name', 'high', 'Dish name looks like menu instructions or attribution.');
    }
    if (isPackageOrCourseLabel(name)) {
        addIssue(issues, 'package_or_course_label', 'high', 'Dish name looks like a package, course, or count label.');
    }
    if (isModifierRow(name)) {
        addIssue(issues, 'modifier_row_name', 'medium', 'Dish name looks like a modifier rather than a standalone item.');
    }
    if (isPriceOnly(name)) {
        addIssue(issues, 'price_only_name', 'high', 'Dish name is only a price.');
    }
    if (category && looksLikeDescription(category)) {
        addIssue(issues, 'category_description_contamination', 'high', 'Menu category looks like a dish description.');
    }
    else if (category && normalizeDishQualityText(name) === normalizeDishQualityText(category)) {
        addIssue(issues, 'name_equals_category', 'medium', 'Dish name is identical to menu category.');
    }
    if (description && hasMenuPriceGlue(description)) {
        addIssue(issues, 'description_contains_pricing_grid', 'high', 'Description contains menu pricing grid text.');
    }
    if (description && hasAllergenCluster(description)) {
        addIssue(issues, 'description_contains_allergen_cluster', 'medium', 'Description still appears to contain allergen codes.');
    }
    if (name && looksLikeKnownCategory(name) && !price && !description) {
        addIssue(issues, 'category_as_name', 'medium', 'Dish name looks like a section heading.');
    }
    if (name && !description && price) {
        addIssue(issues, 'bare_low_info_dish', 'info', 'Dish has a name and price but no description.');
    }
    const exactDuplicateCount = context.exactDuplicateCounts?.get(buildExactDuplicateKey(dish)) || 0;
    if (exactDuplicateCount > 1) {
        addIssue(issues, 'exact_duplicate_within_submission', 'info', 'Exact same dish row appears more than once for this source submission.');
    }
    return {
        issues,
        disposition: dispositionForIssues(issues),
        highestSeverity: highestSeverity(issues),
    };
}
function findDishSourceContext(menuText, dish) {
    const lines = `${menuText || ''}`.split(/\r?\n/).map((line) => compactText(line)).filter(Boolean);
    if (lines.length === 0) {
        return { sourceLine: '', previousLine: '', nextLine: '', context: '' };
    }
    const normalizedName = normalizeDishQualityText(dish.dish_name);
    const normalizedDescription = normalizeDishQualityText(compactText(dish.description).split(/\s+/).slice(0, 5).join(' '));
    const normalizedCategory = normalizeDishQualityText(dish.menu_category);
    if (normalizedName.length >= 4) {
        let bestMatch;
        for (let index = 0; index < lines.length; index += 1) {
            const normalizedLine = normalizeDishQualityText(lines[index]);
            if (!normalizedLine.includes(normalizedName)) {
                continue;
            }
            let score = 100;
            if (normalizedDescription.length >= 4 && normalizedLine.includes(normalizedDescription)) {
                score += 40;
            }
            if (normalizedCategory.length >= 4 && lineHasRecentCategory(lines, index, normalizedCategory)) {
                score += 60;
            }
            if (!bestMatch || score > bestMatch.score) {
                bestMatch = { index, score };
            }
        }
        if (bestMatch) {
            return buildDishSourceContext(lines, bestMatch.index);
        }
    }
    const candidates = [
        compactText(dish.dish_name),
        compactText(dish.description).split(/\s+/).slice(0, 5).join(' '),
    ].filter((candidate) => candidate.length >= 4);
    for (const candidate of candidates) {
        const normalizedCandidate = normalizeDishQualityText(candidate);
        const index = lines.findIndex((line) => normalizeDishQualityText(line).includes(normalizedCandidate));
        if (index >= 0) {
            return buildDishSourceContext(lines, index);
        }
    }
    return { sourceLine: '', previousLine: '', nextLine: '', context: '' };
}
function lineHasRecentCategory(lines, index, normalizedCategory) {
    const start = Math.max(0, index - 8);
    for (let lineIndex = index - 1; lineIndex >= start; lineIndex -= 1) {
        const normalizedLine = normalizeDishQualityText(lines[lineIndex]);
        if (normalizedLine === normalizedCategory || normalizedLine.includes(normalizedCategory)) {
            return true;
        }
    }
    return false;
}
function buildDishSourceContext(lines, index) {
    return {
        sourceLine: lines[index] || '',
        previousLine: lines[index - 1] || '',
        nextLine: lines[index + 1] || '',
        context: lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join(' | '),
        lineNumber: index + 1,
    };
}
//# sourceMappingURL=dish-quality.js.map