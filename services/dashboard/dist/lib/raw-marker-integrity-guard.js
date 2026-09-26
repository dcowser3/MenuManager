"use strict";
/**
 * Raw-marker (asterisk) integrity guard.
 *
 * Policy: raw markers are add-only. A marker that was on a line before model
 * review is never removed by the model or by later post-processing. Moving a
 * marker to its canonical position is allowed; dropping it is not. When a
 * submitted marker is missing from the corrected line, the guard reinserts one
 * at the end of the description, before any allergen codes and price. When
 * only the marker's position changed, the submitted (pre-AI canonical) placement
 * is kept.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertRawMarker = insertRawMarker;
exports.guardCorrectedMenuRawMarkers = guardCorrectedMenuRawMarkers;
const RAW_NOTICE_PATTERN = /consuming\s+raw\s+or\s+undercooked/i;
const TRAILING_PRICE = /\s+(?:(?:[$€£]\s*)?\d{1,4}(?:,\d{3})*(?:[.]\d{1,2})?|MKT|MP|market\s+price)(?:\s*\|\s*(?:(?:[$€£]\s*)?\d{1,4}(?:,\d{3})*(?:[.]\d{1,2})?|MKT|MP|market\s+price))*(?:\s*(?:pp|per\s+person|each))?\s*$/i;
const TRAILING_ALLERGENS = /\s+[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*\s*$/;
function withoutMarkers(line) {
    return `${line || ''}`.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}
function compact(line) {
    return `${line || ''}`.replace(/\s+/g, '');
}
function markerCount(line) {
    return (`${line || ''}`.match(/\*/g) || []).length;
}
/** Insert one raw marker at the end of the description (before codes and price). */
function insertRawMarker(line) {
    const leading = (line.match(/^\s*/) || [''])[0];
    let working = line.slice(leading.length).trimEnd();
    let suffix = '';
    const price = working.match(TRAILING_PRICE);
    if (price && price.index !== undefined && price.index > 0) {
        suffix = working.slice(price.index) + suffix;
        working = working.slice(0, price.index);
    }
    const allergens = working.match(TRAILING_ALLERGENS);
    if (allergens && allergens.index !== undefined && allergens.index > 0) {
        suffix = working.slice(allergens.index) + suffix;
        working = working.slice(0, allergens.index);
    }
    working = working.trimEnd();
    if (!working)
        return line;
    return `${leading}${working}*${suffix}`;
}
function guardCorrectedMenuRawMarkers(originalMenu, correctedMenu) {
    const originalLines = `${originalMenu || ''}`.split('\n');
    const correctedLines = `${correctedMenu || ''}`.split('\n');
    if (originalLines.length !== correctedLines.length) {
        // Rows cannot be aligned. Only fail closed when a marker was actually lost.
        const lost = markerCount(originalMenu) > markerCount(correctedMenu);
        return {
            correctedMenu: lost ? originalMenu : correctedMenu,
            changes: [],
            usedFullMenuFallback: lost,
        };
    }
    const guardedLines = [...correctedLines];
    const changes = [];
    originalLines.forEach((originalLine, lineIndex) => {
        if (RAW_NOTICE_PATTERN.test(originalLine))
            return;
        if (markerCount(originalLine) === 0)
            return;
        const current = guardedLines[lineIndex];
        if (!current.trim())
            return;
        let guardedLine = current;
        if (withoutMarkers(current) === withoutMarkers(originalLine)
            && compact(current) !== compact(originalLine)) {
            // Only the marker moved to a different word. Keep the submitted
            // placement (spacing-only fixes around the marker are allowed).
            guardedLine = originalLine;
        }
        else if (markerCount(current) === 0) {
            guardedLine = insertRawMarker(current);
        }
        if (guardedLine === current)
            return;
        changes.push({ lineIndex, originalLine, correctedLine: current, guardedLine });
        guardedLines[lineIndex] = guardedLine;
    });
    return {
        correctedMenu: guardedLines.join('\n'),
        changes,
        usedFullMenuFallback: false,
    };
}
