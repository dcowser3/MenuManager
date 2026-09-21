"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardCorrectedMenuAllergens = guardCorrectedMenuAllergens;
const COMMON_ALLERGEN_CODES = new Set([
    'A', 'C', 'CE', 'D', 'DF', 'E', 'ET', 'F', 'G', 'GF', 'L', 'M', 'MO',
    'MU', 'N', 'P', 'PN', 'S', 'SE', 'SF', 'SL', 'SS', 'SU', 'SY', 'T', 'TN',
    'V', 'VG',
]);
const TRAILING_PRICE = /\s+(?:(?:[$\u20ac\u00a3]\s*)?\d{1,4}(?:,\d{3})*(?:[.]\d{1,2})?|MKT|MP|market\s+price)(?:\s*\|\s*(?:(?:[$\u20ac\u00a3]\s*)?\d{1,4}(?:,\d{3})*(?:[.]\d{1,2})?|MKT|MP|market\s+price))*(?:\s*(?:pp|per\s+person|each))?\s*$/i;
function configuredCodes(allergenLegend) {
    const codes = new Set(COMMON_ALLERGEN_CODES);
    const legend = `${allergenLegend || ''}`;
    const patterns = [
        /(?:^|[|\n])\s*\(?([A-Za-z]{1,3})\)?\s*(?:=|-|:|\s+(?:contains\s+)?)\s*[A-Za-z]/g,
        /\(\s*([A-Za-z]{1,3})\s*\)\s*[A-Za-z]/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(legend)) !== null) {
            if (match[1])
                codes.add(match[1].toUpperCase());
        }
    }
    return codes;
}
function extractLineAllergens(line, validCodes) {
    const price = line.match(TRAILING_PRICE);
    const beforePrice = price ? line.slice(0, price.index) : line.trimEnd();
    const cluster = beforePrice.match(/(?:^|\s)([A-Za-z]{1,3}(?:\s*,\s*[A-Za-z]{1,3})*)\s*$/);
    if (!cluster?.[1] || cluster.index === undefined)
        return null;
    const codes = cluster[1].split(',').map(code => code.trim().toUpperCase()).filter(Boolean);
    if (codes.length === 0 || codes.some(code => !validCodes.has(code)))
        return null;
    const clusterOffset = cluster[0].indexOf(cluster[1]);
    const start = cluster.index + clusterOffset;
    return { codes: [...new Set(codes)], start, end: start + cluster[1].length };
}
function sortCodes(codes) {
    return [...new Set(codes)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
function restoreMissingCodes(line, originalCodes, validCodes) {
    const corrected = extractLineAllergens(line, validCodes);
    const correctedCodes = corrected?.codes || [];
    const missing = originalCodes.filter(code => !correctedCodes.includes(code));
    if (missing.length === 0)
        return { line, preservedCodes: [] };
    const merged = sortCodes([...correctedCodes, ...originalCodes]).join(',');
    if (corrected) {
        return {
            line: `${line.slice(0, corrected.start)}${merged}${line.slice(corrected.end)}`,
            preservedCodes: missing,
        };
    }
    const price = line.match(TRAILING_PRICE);
    const insertionPoint = price?.index ?? line.trimEnd().length;
    const before = line.slice(0, insertionPoint).trimEnd();
    const after = line.slice(insertionPoint);
    return {
        line: `${before} ${merged}${after}`,
        preservedCodes: missing,
    };
}
function extractQuotedChangePair(text) {
    const patterns = [
        /change\s+['’]([^'’]+)['’]\s+to\s+['’]([^'’]+)['’]/i,
        /change\s+"([^"]+)"\s+to\s+"([^"]+)"/i,
        /replace\s+['’]([^'’]+)['’]\s+with\s+['’]([^'’]+)['’]/i,
        /replace\s+"([^"]+)"\s+with\s+"([^"]+)"/i,
    ];
    for (const pattern of patterns) {
        const match = `${text || ''}`.match(pattern);
        if (match?.[1] && match?.[2])
            return { from: match[1].trim(), to: match[2].trim() };
    }
    return null;
}
function parseCodeValue(value, validCodes) {
    const normalized = `${value || ''}`.trim().replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{1,3}(?:,[A-Z]{1,3})*$/.test(normalized))
        return null;
    const codes = normalized.split(',');
    return codes.every(code => validCodes.has(code)) ? codes : null;
}
function recommendsRemovingAllergen(suggestion, validCodes) {
    const combined = `${suggestion.type || ''} ${suggestion.description || ''} ${suggestion.recommendation || ''}`;
    if (!/allergen/i.test(combined))
        return false;
    const pair = extractQuotedChangePair(suggestion.recommendation || '');
    if (!pair)
        return false;
    const from = parseCodeValue(pair.from, validCodes);
    const to = parseCodeValue(pair.to, validCodes);
    return !!from && !!to && from.some(code => !to.includes(code));
}
/**
 * Enforce the one-way allergen invariant at the final AI-review boundary:
 * codes present before model review may be retained or added to, never removed.
 */
function guardCorrectedMenuAllergens(originalMenu, correctedMenu, suggestions, allergenLegend) {
    const validCodes = configuredCodes(allergenLegend);
    const originalLines = `${originalMenu || ''}`.split('\n');
    const correctedLines = `${correctedMenu || ''}`.split('\n');
    const nextSuggestions = Array.isArray(suggestions) ? [...suggestions] : [];
    const droppedSuggestions = nextSuggestions.filter(suggestion => recommendsRemovingAllergen(suggestion, validCodes));
    const keptSuggestions = nextSuggestions.filter(suggestion => !droppedSuggestions.includes(suggestion));
    if (originalLines.length !== correctedLines.length) {
        return {
            correctedMenu: originalMenu,
            suggestions: keptSuggestions,
            changes: [],
            droppedSuggestions,
            usedFullMenuFallback: true,
        };
    }
    const guardedLines = [...correctedLines];
    const changes = [];
    originalLines.forEach((originalLine, lineIndex) => {
        const original = extractLineAllergens(originalLine, validCodes);
        if (!original)
            return;
        const restored = restoreMissingCodes(guardedLines[lineIndex], original.codes, validCodes);
        if (restored.line === guardedLines[lineIndex])
            return;
        changes.push({
            lineIndex,
            originalLine,
            correctedLine: guardedLines[lineIndex],
            guardedLine: restored.line,
            preservedCodes: restored.preservedCodes,
        });
        guardedLines[lineIndex] = restored.line;
    });
    return {
        correctedMenu: guardedLines.join('\n'),
        suggestions: keptSuggestions,
        changes,
        droppedSuggestions,
        usedFullMenuFallback: false,
    };
}
