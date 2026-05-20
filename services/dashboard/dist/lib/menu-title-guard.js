"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preserveLeadingMenuTitle = preserveLeadingMenuTitle;
function isStandaloneMenuTitle(line) {
    return /^menu$/i.test(`${line || ''}`.trim());
}
function firstNonEmptyLineIndex(lines) {
    return lines.findIndex((line) => line.trim().length > 0);
}
/**
 * A leading "Menu" line is a document title, not a singular category heading.
 * Keep it exactly as submitted even if the model deletes it or pluralizes it.
 */
function preserveLeadingMenuTitle(originalMenu, correctedMenu) {
    const originalLines = `${originalMenu || ''}`.split('\n');
    const originalTitleIndex = firstNonEmptyLineIndex(originalLines);
    if (originalTitleIndex < 0 || !isStandaloneMenuTitle(originalLines[originalTitleIndex])) {
        return { correctedMenu, restored: false, originalTitleLine: null };
    }
    const originalTitleLine = originalLines[originalTitleIndex];
    const correctedLines = `${correctedMenu || ''}`.split('\n');
    const correctedTitleIndex = firstNonEmptyLineIndex(correctedLines);
    if (correctedTitleIndex >= 0 && isStandaloneMenuTitle(correctedLines[correctedTitleIndex])) {
        if (correctedLines[correctedTitleIndex] === originalTitleLine) {
            return { correctedMenu, restored: false, originalTitleLine };
        }
        const updated = [...correctedLines];
        updated[correctedTitleIndex] = originalTitleLine;
        return {
            correctedMenu: updated.join('\n'),
            restored: true,
            originalTitleLine,
        };
    }
    if (correctedTitleIndex >= 0 && /^menus$/i.test(correctedLines[correctedTitleIndex].trim())) {
        const updated = [...correctedLines];
        updated[correctedTitleIndex] = originalTitleLine;
        return {
            correctedMenu: updated.join('\n'),
            restored: true,
            originalTitleLine,
        };
    }
    const updated = [...correctedLines];
    if (correctedTitleIndex < 0) {
        updated.splice(0, updated.length, originalTitleLine);
    }
    else {
        updated.splice(correctedTitleIndex, 0, originalTitleLine);
    }
    return {
        correctedMenu: updated.join('\n'),
        restored: true,
        originalTitleLine,
    };
}
