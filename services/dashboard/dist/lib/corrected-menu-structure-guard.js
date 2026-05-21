"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessCorrectedMenuStructure = assessCorrectedMenuStructure;
const MIN_TOKENS_FOR_COVERAGE_GUARD = 80;
const MIN_CHARS_FOR_LENGTH_GUARD = 1000;
const MIN_LINES_FOR_LINE_GUARD = 8;
function countNonEmptyLines(text) {
    return (text || '').split('\n').filter((line) => line.trim()).length;
}
function tokenizeForCoverage(text) {
    return ((text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9]+/g) || [])
        .filter((token) => token.length > 1);
}
function countTokenCoverage(originalTokens, correctedTokens) {
    if (originalTokens.length === 0)
        return 1;
    const correctedCounts = new Map();
    for (const token of correctedTokens) {
        correctedCounts.set(token, (correctedCounts.get(token) || 0) + 1);
    }
    let covered = 0;
    for (const token of originalTokens) {
        const available = correctedCounts.get(token) || 0;
        if (available <= 0)
            continue;
        covered++;
        if (available === 1) {
            correctedCounts.delete(token);
        }
        else {
            correctedCounts.set(token, available - 1);
        }
    }
    return covered / originalTokens.length;
}
function assessCorrectedMenuStructure(originalMenu, correctedMenu) {
    const original = (originalMenu || '').trim();
    const corrected = (correctedMenu || '').trim();
    const originalTokens = tokenizeForCoverage(original);
    const correctedTokens = tokenizeForCoverage(corrected);
    const originalLineCount = countNonEmptyLines(original);
    const correctedLineCount = countNonEmptyLines(corrected);
    const metrics = {
        originalLength: original.length,
        correctedLength: corrected.length,
        lengthRatio: original.length ? corrected.length / original.length : 1,
        originalTokenCount: originalTokens.length,
        correctedTokenCount: correctedTokens.length,
        tokenCoverage: countTokenCoverage(originalTokens, correctedTokens),
        originalLineCount,
        correctedLineCount,
        lineRatio: originalLineCount ? correctedLineCount / originalLineCount : 1,
    };
    const reasons = [];
    if (metrics.originalTokenCount >= MIN_TOKENS_FOR_COVERAGE_GUARD &&
        metrics.tokenCoverage < 0.72) {
        reasons.push('low_token_coverage');
    }
    if (metrics.originalLength >= MIN_CHARS_FOR_LENGTH_GUARD &&
        metrics.lengthRatio < 0.55) {
        reasons.push('corrected_text_much_shorter');
    }
    if (metrics.originalLineCount >= MIN_LINES_FOR_LINE_GUARD &&
        metrics.correctedLineCount < Math.max(3, Math.floor(metrics.originalLineCount * 0.6))) {
        reasons.push('too_few_lines');
    }
    return {
        safe: reasons.length === 0,
        reasons,
        metrics,
    };
}
