"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardCorrectedMenuPrices = guardCorrectedMenuPrices;
const PRICE_SEGMENT = String.raw `(?:(?:[$\u20ac\u00a3]\s*)?\d{1,4}(?:,\d{3})*(?:[.]\d{1,2})?|MKT|MP|market\s+price)`;
const TRAILING_PRICE_RE = new RegExp(String.raw `^(?<before>.*?)(?<separator>\s+)(?<price>${PRICE_SEGMENT}(?:\s*\|\s*${PRICE_SEGMENT})*)(?<pp>\s*(?:pp|PP))?(?<trailing>\s*)$`, 'i');
function normalizePriceValue(value) {
    return (value || '')
        .split('|')
        .map((part) => {
        const compact = part
            .toLowerCase()
            .replace(/market\s+price/g, 'mp')
            .replace(/[\u20ac\u00a3$,\s]/g, '')
            .replace(/pp$/i, '');
        if (/^\d+(?:\.\d+)?$/.test(compact)) {
            return String(Number(compact));
        }
        return compact;
    })
        .join('|');
}
function extractTrailingPrice(line) {
    const match = (line || '').match(TRAILING_PRICE_RE);
    if (!match?.groups) {
        return null;
    }
    const price = `${match.groups.price || ''}${match.groups.pp || ''}`.trim();
    if (!price) {
        return null;
    }
    return {
        price,
        normalizedPrice: normalizePriceValue(price),
        lineWithoutPrice: `${match.groups.before || ''}${match.groups.trailing || ''}`.trimEnd(),
    };
}
function stripTrailingAllergenCluster(line) {
    return (line || '').replace(/\s+[A-Z]{1,3}(?:,[A-Z]{1,3})*\s*$/u, '').trim();
}
function deriveMenuItem(line) {
    const withoutPrice = extractTrailingPrice(line)?.lineWithoutPrice || line;
    const withoutAllergens = stripTrailingAllergenCluster(withoutPrice);
    const firstSegment = withoutAllergens.split(',')[0]?.trim();
    return (firstSegment || withoutAllergens || line || 'Menu item').trim().slice(0, 160);
}
function normalizeForSuggestionMatch(input) {
    return (input || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function hasMissingPriceSuggestionForMenuItem(suggestions, menuItem) {
    const target = normalizeForSuggestionMatch(menuItem);
    if (!target) {
        return false;
    }
    return suggestions.some((suggestion) => {
        const type = `${suggestion.type || ''}`.trim().toLowerCase();
        if (type !== 'missing price') {
            return false;
        }
        const suggestionItem = normalizeForSuggestionMatch(suggestion.menuItem || '');
        const combined = normalizeForSuggestionMatch(`${suggestion.menuItem || ''} ${suggestion.description || ''} ${suggestion.recommendation || ''}`);
        return combined.includes(target) || (!!suggestionItem && target.includes(suggestionItem));
    });
}
function buildMissingPriceSuggestion(menuItem) {
    return {
        type: 'Missing Price',
        confidence: 'high',
        severity: 'critical',
        menuItem,
        description: 'This item was submitted without a price. An AI-added price was removed because prices must come from the submitter or reviewer.',
        recommendation: 'Add the correct price manually, or override this critical issue if the line should not have an item price.',
    };
}
function nonEmptyLineRefs(lines) {
    return lines
        .map((line, index) => ({ line, index }))
        .filter((entry) => entry.line.trim());
}
function buildOriginalLineLookup(originalLineRefs) {
    const lookup = new Map();
    for (const ref of originalLineRefs) {
        const key = normalizeForSuggestionMatch(deriveMenuItem(ref.line));
        if (!key) {
            continue;
        }
        const existing = lookup.get(key) || [];
        existing.push(ref);
        lookup.set(key, existing);
    }
    return lookup;
}
function guardCorrectedMenuPrices(originalMenu, correctedMenu, suggestions) {
    if (!correctedMenu) {
        return { correctedMenu, suggestions: suggestions ? [...suggestions] : [], changes: [] };
    }
    const originalLineRefs = nonEmptyLineRefs((originalMenu || '').split('\n'));
    const correctedLines = correctedMenu.split('\n');
    const correctedLineRefs = nonEmptyLineRefs(correctedLines);
    const nextSuggestions = suggestions ? [...suggestions] : [];
    const changes = [];
    if (originalLineRefs.length === 0) {
        return { correctedMenu, suggestions: nextSuggestions, changes };
    }
    const guardedLines = [...correctedLines];
    const originalLineLookup = buildOriginalLineLookup(originalLineRefs);
    const lineCountsAlign = originalLineRefs.length === correctedLineRefs.length;
    for (let i = 0; i < correctedLineRefs.length; i++) {
        const correctedRef = correctedLineRefs[i];
        const correctedLine = correctedRef.line;
        const correctedKey = normalizeForSuggestionMatch(deriveMenuItem(correctedLine));
        const matchedOriginalRefs = correctedKey ? originalLineLookup.get(correctedKey) || [] : [];
        const originalRef = lineCountsAlign
            ? originalLineRefs[i]
            : matchedOriginalRefs.length === 1
                ? matchedOriginalRefs[0]
                : null;
        if (!originalRef) {
            continue;
        }
        const originalLine = originalRef.line;
        const originalPrice = extractTrailingPrice(originalLine);
        const correctedPrice = extractTrailingPrice(correctedLine);
        if (!correctedPrice) {
            continue;
        }
        const menuItem = deriveMenuItem(originalLine || correctedLine);
        let guardedLine = null;
        let reason = null;
        if (!originalPrice) {
            guardedLine = correctedPrice.lineWithoutPrice;
            reason = 'added_price';
            if (!hasMissingPriceSuggestionForMenuItem(nextSuggestions, menuItem)) {
                nextSuggestions.push(buildMissingPriceSuggestion(menuItem));
            }
        }
        else if (originalPrice.normalizedPrice !== correctedPrice.normalizedPrice) {
            guardedLine = `${correctedPrice.lineWithoutPrice} ${originalPrice.price}`.trimEnd();
            reason = 'changed_price';
        }
        if (!guardedLine || !reason || guardedLine === correctedLine) {
            continue;
        }
        guardedLines[correctedRef.index] = guardedLine;
        changes.push({
            lineIndex: correctedRef.index,
            reason,
            menuItem,
            originalLine,
            correctedLine,
            guardedLine,
            originalPrice: originalPrice?.price || null,
            correctedPrice: correctedPrice.price,
        });
    }
    return {
        correctedMenu: guardedLines.join('\n'),
        suggestions: nextSuggestions,
        changes,
    };
}
