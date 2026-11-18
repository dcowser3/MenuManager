"use strict";
// Line comparison shared by the Basic AI check (changed-only scope) and the
// submit-time zero-change guard, so footer/allergen handling and normalization
// match exactly. Callers strip the managed footer before comparing.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeReviewLine = normalizeReviewLine;
exports.extractChangedLinesForReview = extractChangedLinesForReview;
exports.countMenuLineChanges = countMenuLineChanges;
function normalizeReviewLine(line) {
    return (line || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[“”"]/g, '"')
        .replace(/[’']/g, "'")
        .trim();
}
// Lines in currentText that do not appear in baselineText (insertions and
// edits). This is the Basic AI check's changed-only scope; it does not see
// pure deletions.
function extractChangedLinesForReview(baselineText, currentText) {
    const baseLines = `${baselineText || ''}`.split('\n').map(l => l.trim()).filter(Boolean);
    const baseSet = new Set(baseLines.map(normalizeReviewLine));
    const changedLines = [];
    const changedIndices = [];
    for (const [index, line] of `${currentText || ''}`.split('\n').entries()) {
        if (!line.trim())
            continue;
        const norm = normalizeReviewLine(line);
        if (!baseSet.has(norm)) {
            changedLines.push(line.trim());
            changedIndices.push(index);
        }
    }
    return {
        text: changedLines.join('\n'),
        changedLineCount: changedLines.length,
        changedIndices,
    };
}
// Symmetric version for the zero-change guard: a removed line is a real edit
// even though the changed-only scope above cannot see it. Uses the same
// comparison in both directions.
function countMenuLineChanges(baselineText, currentText) {
    const added = extractChangedLinesForReview(baselineText, currentText).changedLineCount;
    const removed = extractChangedLinesForReview(currentText, baselineText).changedLineCount;
    return { added, removed, total: added + removed };
}
