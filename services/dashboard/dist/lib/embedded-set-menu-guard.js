"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeEmbeddedSetMenus = analyzeEmbeddedSetMenus;
exports.buildEmbeddedSetMenuPromptSection = buildEmbeddedSetMenuPromptSection;
exports.guardEmbeddedSetMenuPrices = guardEmbeddedSetMenuPrices;
const PRICE_NUMBER_PATTERN = String.raw `\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?`;
const CURRENCY_PREFIX_PATTERN = String.raw `(?:(?:AED|QAR|USD|MXN)\s*)?(?:[$€£]\s*)?`;
const CURRENCY_SUFFIX_PATTERN = String.raw `(?:\s*(?:AED|QAR|USD|MXN))?`;
const SET_PRICE_TAIL_REGEX = new RegExp(String.raw `\s+(${CURRENCY_PREFIX_PATTERN}${PRICE_NUMBER_PATTERN}${CURRENCY_SUFFIX_PATTERN})\s*$`, 'i');
const PREMIUM_PRICE_TAIL_REGEX = new RegExp(String.raw `\s+\+\s*(${CURRENCY_PREFIX_PATTERN}${PRICE_NUMBER_PATTERN}${CURRENCY_SUFFIX_PATTERN})\s*$`, 'i');
function stripDiacritics(input) {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeForMatch(input) {
    return stripDiacritics(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizePrice(input) {
    return `${input || ''}`.replace(/\s+/g, '').replace(/[$€£]/g, '').toUpperCase();
}
function splitLines(text) {
    return `${text || ''}`.split('\n');
}
function isFooterBoundary(line) {
    const normalized = normalizeForMatch(line);
    return /^allergen key/.test(normalized)
        || /consuming raw or undercooked/.test(normalized)
        || /^all prices/.test(normalized);
}
function isPackageTitleLine(line) {
    const trimmed = `${line || ''}`.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed.includes(',') || !SET_PRICE_TAIL_REGEX.test(trimmed)) {
        return false;
    }
    const withoutPrice = trimmed.replace(SET_PRICE_TAIL_REGEX, '').trim();
    const normalized = normalizeForMatch(withoutPrice);
    if (!normalized || normalized.split(/\s+/).length > 8) {
        return false;
    }
    return /\b(?:quick|lunch|brunch|dinner|set|prix|fixe|prefix|pre fixe|package|menu|special|experience|choice)\b/.test(normalized);
}
function isChoiceInstructionLine(line) {
    const normalized = normalizeForMatch(line);
    return /\b(?:choice|choose|select|pick)\b.*\b(?:one|1|two|2|any)\b/.test(normalized)
        || /\b(?:one|1)\s+(?:appetizer|starter)\b.*\b(?:one|1)\s+(?:entree|main|specialty|specialties)\b/.test(normalized);
}
function isSetOptionHeading(line) {
    const trimmed = `${line || ''}`.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed.includes(',') || SET_PRICE_TAIL_REGEX.test(trimmed) || PREMIUM_PRICE_TAIL_REGEX.test(trimmed)) {
        return false;
    }
    const normalized = normalizeForMatch(trimmed);
    return /^(?:appetizers?|starters?|specialties|mains?|main course|entrees?|desserts?|sides?|soups?|salads?|on the go|first course|second course|third course|course \d+)$/.test(normalized);
}
function hasNearbyChoiceInstruction(lines, titleIndex) {
    const maxIndex = Math.min(lines.length - 1, titleIndex + 4);
    for (let i = titleIndex + 1; i <= maxIndex; i++) {
        if (isChoiceInstructionLine(lines[i])) {
            return i;
        }
    }
    return -1;
}
function hasSetHeadingAfterChoice(lines, choiceIndex) {
    const maxIndex = Math.min(lines.length - 1, choiceIndex + 12);
    for (let i = choiceIndex + 1; i <= maxIndex; i++) {
        if (isSetOptionHeading(lines[i])) {
            return true;
        }
    }
    return false;
}
function findSectionEnd(lines, titleIndex) {
    for (let i = titleIndex + 1; i < lines.length; i++) {
        if (isFooterBoundary(lines[i])) {
            return i - 1;
        }
        if (i > titleIndex + 1 && isPackageTitleLine(lines[i]) && hasNearbyChoiceInstruction(lines, i) !== -1) {
            return i - 1;
        }
    }
    return lines.length - 1;
}
function lineHasPremiumPrice(line) {
    return PREMIUM_PRICE_TAIL_REGEX.test(`${line || ''}`.trim());
}
function extractBarePrice(line) {
    const trimmed = `${line || ''}`.replace(/\s+/g, ' ').trim();
    if (!trimmed || lineHasPremiumPrice(trimmed)) {
        return null;
    }
    const match = trimmed.match(SET_PRICE_TAIL_REGEX);
    if (!match?.[1]) {
        return null;
    }
    const withoutPrice = trimmed.slice(0, match.index).trim();
    if (!/[A-Za-z]/.test(withoutPrice)) {
        return null;
    }
    return match[1].trim();
}
function stripTrailingDietarySuffix(line) {
    return `${line || ''}`
        .replace(/\s+\*?\s*[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*\s*$/g, '')
        .replace(/\s+\*\s*$/g, '')
        .trim();
}
function extractMenuItem(line, price) {
    const withoutPrice = `${line || ''}`.replace(SET_PRICE_TAIL_REGEX, '').trim();
    const withoutDietarySuffix = stripTrailingDietarySuffix(withoutPrice);
    const beforeComma = withoutDietarySuffix.split(',')[0]?.trim();
    return beforeComma || withoutDietarySuffix || withoutPrice.replace(price, '').trim();
}
function isSkippableSectionLine(line) {
    return !`${line || ''}`.trim()
        || isFooterBoundary(line)
        || isPackageTitleLine(line)
        || isChoiceInstructionLine(line)
        || isSetOptionHeading(line);
}
function collectIssues(lines, section) {
    const issues = [];
    for (let i = section.choiceLineIndex + 1; i <= section.endLineIndex; i++) {
        const line = lines[i] || '';
        if (isSkippableSectionLine(line)) {
            continue;
        }
        const price = extractBarePrice(line);
        if (!price) {
            continue;
        }
        issues.push({
            sectionTitle: section.title,
            lineIndex: i,
            line,
            menuItem: extractMenuItem(line, price),
            price,
        });
    }
    return issues;
}
function analyzeEmbeddedSetMenus(menuText) {
    const lines = splitLines(menuText);
    const sections = [];
    const issues = [];
    for (let i = 0; i < lines.length; i++) {
        if (!isPackageTitleLine(lines[i])) {
            continue;
        }
        const choiceLineIndex = hasNearbyChoiceInstruction(lines, i);
        if (choiceLineIndex === -1 || !hasSetHeadingAfterChoice(lines, choiceLineIndex)) {
            continue;
        }
        const section = {
            title: lines[i].replace(/\s+/g, ' ').trim(),
            titleLineIndex: i,
            choiceLineIndex,
            startLineIndex: i,
            endLineIndex: findSectionEnd(lines, i),
            choiceInstruction: lines[choiceLineIndex].replace(/\s+/g, ' ').trim(),
        };
        sections.push(section);
        issues.push(...collectIssues(lines, section));
    }
    return { sections, issues };
}
function buildEmbeddedSetMenuPromptSection(analysis) {
    const summaries = analysis.sections
        .map((section) => `- ${section.title}: ${section.choiceInstruction}`)
        .join('\n');
    return `IMPORTANT EMBEDDED SET-MENU RULES:
Detected embedded set/prix-fixe section(s) inside an otherwise standard menu:
${summaries}

- Treat these as included package sections, not normal a la carte menu sections.
- Included dishes inside these sections do NOT need individual prices; do NOT flag them as Missing Price.
- If an included dish has a trailing bare item price, flag it as type "Set Menu Item Price" with severity "critical".
- Do NOT delete, rewrite, or remove that bare price in CORRECTED MENU; leave the original line unchanged and report the issue in SUGGESTIONS.
- Explicit plus prices such as "+5", "+ 5", "+ AED 50", or "+$5" are premium/supplement upcharges and are allowed.
- Normal a la carte dishes outside these detected sections still require prices.`;
}
function issueKey(issue) {
    return `${normalizeForMatch(issue.sectionTitle)}::${normalizeForMatch(issue.menuItem)}::${normalizePrice(issue.price)}`;
}
function suggestionMatchesIssue(suggestion, issue) {
    const itemNorm = normalizeForMatch(issue.menuItem);
    if (!itemNorm) {
        return false;
    }
    const suggestionItemNorm = normalizeForMatch(suggestion.menuItem || '');
    const combinedNorm = normalizeForMatch(`${suggestion.menuItem || ''} ${suggestion.description || ''} ${suggestion.recommendation || ''}`);
    return (!!suggestionItemNorm && (suggestionItemNorm.includes(itemNorm) || itemNorm.includes(suggestionItemNorm)))
        || combinedNorm.includes(itemNorm);
}
function isSetPriceLikeSuggestion(suggestion) {
    const type = normalizeForMatch(suggestion.type || '');
    const combined = normalizeForMatch(`${suggestion.description || ''} ${suggestion.recommendation || ''}`);
    return type.includes('set menu item price')
        || /(?:set|prix fixe|package|included).*(?:bare|individual|item).*price/.test(combined)
        || /(?:bare|individual|item).*price.*(?:set|prix fixe|package|included)/.test(combined);
}
function isMissingPriceSuggestion(suggestion) {
    const type = normalizeForMatch(suggestion.type || '');
    const combined = normalizeForMatch(`${suggestion.description || ''} ${suggestion.recommendation || ''}`);
    return type.includes('missing price') || /(?:missing|no).*price/.test(combined);
}
function findLineForSuggestionInOriginal(suggestion, originalLines, analysis) {
    const itemNorm = normalizeForMatch(suggestion.menuItem || '');
    const combinedNorm = normalizeForMatch(`${suggestion.menuItem || ''} ${suggestion.description || ''} ${suggestion.recommendation || ''}`);
    if (!itemNorm && !combinedNorm) {
        return null;
    }
    for (const section of analysis.sections) {
        for (let i = section.choiceLineIndex + 1; i <= section.endLineIndex; i++) {
            const line = originalLines[i] || '';
            if (isSkippableSectionLine(line)) {
                continue;
            }
            const lineNorm = normalizeForMatch(line);
            if ((itemNorm && lineNorm.includes(itemNorm)) || (lineNorm && combinedNorm.includes(lineNorm.split(' ').slice(0, 3).join(' ')))) {
                return line;
            }
        }
    }
    return null;
}
function findCorrectedLineIndex(correctedLines, issue, usedIndexes) {
    const itemNorm = normalizeForMatch(issue.menuItem);
    if (!itemNorm) {
        return -1;
    }
    for (let i = 0; i < correctedLines.length; i++) {
        if (usedIndexes.has(i)) {
            continue;
        }
        const lineNorm = normalizeForMatch(correctedLines[i] || '');
        if (lineNorm.includes(itemNorm)) {
            return i;
        }
    }
    return -1;
}
function removeTrailingPremiumPrice(line, issue) {
    const match = `${line || ''}`.trim().match(PREMIUM_PRICE_TAIL_REGEX);
    if (!match?.[1]) {
        return line;
    }
    if (normalizePrice(match[1]) !== normalizePrice(issue.price)) {
        return line;
    }
    return `${line || ''}`.replace(PREMIUM_PRICE_TAIL_REGEX, '').trimEnd();
}
function restoreBarePrice(line, issue) {
    const barePrice = extractBarePrice(line);
    if (barePrice && normalizePrice(barePrice) === normalizePrice(issue.price)) {
        return line;
    }
    const withoutPremium = removeTrailingPremiumPrice(line, issue).trimEnd();
    return `${withoutPremium} ${issue.price}`;
}
function synthesizeSetMenuItemPriceSuggestion(issue) {
    const premiumExample = /^(?:AED|QAR|USD|MXN)\b/i.test(issue.price.trim())
        ? `+ ${issue.price.trim()}`
        : `+${issue.price.trim().replace(/^\$/, '')}`;
    return {
        type: 'Set Menu Item Price',
        confidence: 'high',
        severity: 'critical',
        menuItem: issue.menuItem,
        description: `The ${issue.menuItem} line appears inside the ${issue.sectionTitle} set-menu section but has a trailing bare item price (${issue.price}). Included set-menu dishes should not show individual item prices.`,
        recommendation: `Remove the bare price '${issue.price}' from ${issue.menuItem}. If it is intended as a premium option, write it with a plus sign, such as '${premiumExample}'.`,
    };
}
function normalizeExistingSetMenuSuggestion(suggestion) {
    return {
        ...suggestion,
        type: 'Set Menu Item Price',
        confidence: suggestion.confidence || 'high',
        severity: 'critical',
    };
}
function guardEmbeddedSetMenuPrices(originalMenu, correctedMenu, suggestions, existingAnalysis) {
    const analysis = existingAnalysis || analyzeEmbeddedSetMenus(originalMenu);
    if (analysis.sections.length === 0) {
        return {
            correctedMenu,
            suggestions: suggestions ? [...suggestions] : [],
            restoredPrices: [],
            synthesizedSuggestions: [],
            droppedSuggestions: [],
        };
    }
    const originalLines = splitLines(originalMenu);
    const keptSuggestions = [];
    const synthesizedSuggestions = [];
    const droppedSuggestions = [];
    const coveredIssueKeys = new Set();
    for (const suggestion of suggestions || []) {
        const matchingIssue = analysis.issues.find((issue) => suggestionMatchesIssue(suggestion, issue));
        const matchedSetLine = findLineForSuggestionInOriginal(suggestion, originalLines, analysis);
        if (matchingIssue && isSetPriceLikeSuggestion(suggestion)) {
            keptSuggestions.push(normalizeExistingSetMenuSuggestion(suggestion));
            coveredIssueKeys.add(issueKey(matchingIssue));
            continue;
        }
        if (isMissingPriceSuggestion(suggestion) && matchedSetLine) {
            droppedSuggestions.push({
                suggestion,
                reason: 'included_set_menu_item_does_not_require_individual_price',
                matchedLine: matchedSetLine,
            });
            continue;
        }
        keptSuggestions.push(suggestion);
    }
    const correctedLines = splitLines(correctedMenu);
    const usedCorrectedIndexes = new Set();
    const restoredPrices = [];
    for (const issue of analysis.issues) {
        const correctedLineIndex = findCorrectedLineIndex(correctedLines, issue, usedCorrectedIndexes);
        if (correctedLineIndex !== -1) {
            usedCorrectedIndexes.add(correctedLineIndex);
            const before = correctedLines[correctedLineIndex];
            const after = restoreBarePrice(before, issue);
            if (after !== before) {
                correctedLines[correctedLineIndex] = after;
                restoredPrices.push(issue);
            }
        }
        if (!coveredIssueKeys.has(issueKey(issue))) {
            const synthesized = synthesizeSetMenuItemPriceSuggestion(issue);
            keptSuggestions.push(synthesized);
            synthesizedSuggestions.push(synthesized);
            coveredIssueKeys.add(issueKey(issue));
        }
    }
    return {
        correctedMenu: correctedLines.join('\n'),
        suggestions: keptSuggestions,
        restoredPrices,
        synthesizedSuggestions,
        droppedSuggestions,
    };
}
