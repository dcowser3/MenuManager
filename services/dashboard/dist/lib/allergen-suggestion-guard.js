"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardAllergenAlphabetizationSuggestions = guardAllergenAlphabetizationSuggestions;
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
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
function extractQuotedChangePair(text) {
    const trimmed = `${text || ''}`.trim();
    if (!trimmed)
        return null;
    const patterns = [
        /change\s+['']([^'']+)['']\s+to\s+['']([^'']+)['']/i,
        /change\s+"([^"]+)"\s+to\s+"([^"]+)"/i,
        /replace\s+['']([^'']+)['']\s+with\s+['']([^'']+)['']/i,
        /replace\s+"([^"]+)"\s+with\s+"([^"]+)"/i,
    ];
    for (const re of patterns) {
        const match = trimmed.match(re);
        if (match?.[1] && match?.[2]) {
            const from = match[1].trim();
            const to = match[2].trim();
            if (from && to && from !== to) {
                return { from, to };
            }
        }
    }
    return null;
}
function parseAllergenCodeList(value) {
    const normalized = `${value || ''}`.trim().replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{1,3}(?:,[A-Z]{1,3})+$/.test(normalized)) {
        return null;
    }
    return normalized.split(',');
}
function sortedCodes(codes) {
    return [...codes].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
function hasSameCodeSet(a, b) {
    if (a.length !== b.length)
        return false;
    const sortedA = sortedCodes(a);
    const sortedB = sortedCodes(b);
    return sortedA.every((code, index) => code === sortedB[index]);
}
function codesAreAlphabetized(codes) {
    const sorted = sortedCodes(codes);
    return codes.every((code, index) => code === sorted[index]);
}
function isAllergenAlphabetizationSuggestion(suggestion) {
    const combined = `${suggestion.type || ''} ${suggestion.description || ''} ${suggestion.recommendation || ''}`;
    return /allergen/i.test(combined) && /alphabet/i.test(combined);
}
function getInvalidAllergenAlphabetizationPair(suggestion) {
    if (!isAllergenAlphabetizationSuggestion(suggestion)) {
        return null;
    }
    const pair = extractQuotedChangePair(suggestion.recommendation || '');
    if (!pair) {
        return null;
    }
    const fromCodes = parseAllergenCodeList(pair.from);
    const toCodes = parseAllergenCodeList(pair.to);
    if (!fromCodes || !toCodes || !hasSameCodeSet(fromCodes, toCodes)) {
        return null;
    }
    if (codesAreAlphabetized(fromCodes) && !codesAreAlphabetized(toCodes)) {
        return {
            from: fromCodes.join(','),
            to: toCodes.join(','),
        };
    }
    return null;
}
function clusterPattern(codes) {
    return codes
        .split(',')
        .map((code) => escapeRegExp(code))
        .join('\\s*,\\s*');
}
function replaceAllergenCluster(line, from, to) {
    const re = new RegExp(`(^|\\s)${clusterPattern(to)}(?=(?:\\s+\\$?\\d|\\s*$))`, 'g');
    return line.replace(re, (_match, prefix) => `${prefix}${from}`);
}
function findMatchedLine(lines, menuItem) {
    const itemNorm = normalizeForMatch(menuItem || '');
    if (!itemNorm)
        return null;
    return lines.find((line) => normalizeForMatch(line).includes(itemNorm)) || null;
}
function restoreInvalidCorrection(correctedMenu, suggestion, pair) {
    const itemNorm = normalizeForMatch(suggestion.menuItem || '');
    const lines = correctedMenu.split('\n');
    return lines
        .map((line) => {
        if (itemNorm && !normalizeForMatch(line).includes(itemNorm)) {
            return line;
        }
        return replaceAllergenCluster(line, pair.from, pair.to);
    })
        .join('\n');
}
function guardAllergenAlphabetizationSuggestions(correctedMenu, suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return { correctedMenu, suggestions: suggestions ? [...suggestions] : [], droppedSuggestions: [] };
    }
    const kept = [];
    const droppedSuggestions = [];
    let guardedMenu = correctedMenu || '';
    for (const suggestion of suggestions) {
        const invalidPair = getInvalidAllergenAlphabetizationPair(suggestion);
        if (!invalidPair) {
            kept.push(suggestion);
            continue;
        }
        const linesBeforeRestore = guardedMenu.split('\n');
        guardedMenu = restoreInvalidCorrection(guardedMenu, suggestion, invalidPair);
        droppedSuggestions.push({
            suggestion,
            reason: 'invalid_allergen_alphabetization_recommendation',
            matchedLine: findMatchedLine(linesBeforeRestore, suggestion.menuItem || ''),
        });
    }
    return {
        correctedMenu: guardedMenu,
        suggestions: kept,
        droppedSuggestions,
    };
}
