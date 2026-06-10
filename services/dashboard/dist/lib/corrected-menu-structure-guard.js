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
function normalizeLineForMatch(line) {
    return (line || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function tokenizeLineForMatch(line) {
    return (normalizeLineForMatch(line).match(/[a-z0-9]+/g) || [])
        .filter((token) => token.length > 1 || /\d/.test(token));
}
function isMeaningfulSubmittedLine(line) {
    const normalized = normalizeLineForMatch(line);
    if (!normalized)
        return false;
    const tokens = tokenizeLineForMatch(line);
    return tokens.length >= 2 || tokens.some((token) => token.length >= 4);
}
function levenshteinDistance(a, b) {
    if (a === b)
        return 0;
    if (!a)
        return b.length;
    if (!b)
        return a.length;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = Array.from({ length: b.length + 1 }, () => 0);
    for (let i = 1; i <= a.length; i++) {
        current[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitutionCost);
        }
        for (let j = 0; j <= b.length; j++) {
            previous[j] = current[j];
        }
    }
    return previous[b.length];
}
function lineSimilarity(a, b) {
    const left = normalizeLineForMatch(a);
    const right = normalizeLineForMatch(b);
    const longest = Math.max(left.length, right.length);
    if (longest === 0)
        return 1;
    return 1 - (levenshteinDistance(left, right) / longest);
}
function countCoveredTokens(originalTokens, correctedTokens) {
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
    return covered;
}
function submittedLineMatchesCorrectedLine(originalLine, correctedLine) {
    const originalNormalized = normalizeLineForMatch(originalLine);
    const correctedNormalized = normalizeLineForMatch(correctedLine);
    if (!originalNormalized || !correctedNormalized)
        return false;
    if (originalNormalized === correctedNormalized)
        return true;
    if (correctedNormalized.includes(originalNormalized))
        return true;
    const originalTokens = tokenizeLineForMatch(originalLine);
    const correctedTokens = tokenizeLineForMatch(correctedLine);
    if (originalTokens.length > 0) {
        const coverage = countCoveredTokens(originalTokens, correctedTokens) / originalTokens.length;
        if (coverage >= 0.75)
            return true;
    }
    return lineSimilarity(originalLine, correctedLine) >= 0.82;
}
function findMissingMeaningfulSubmittedLines(originalMenu, correctedMenu) {
    const correctedLines = (correctedMenu || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    return (originalMenu || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(isMeaningfulSubmittedLine)
        .filter((originalLine) => !correctedLines.some((correctedLine) => submittedLineMatchesCorrectedLine(originalLine, correctedLine)));
}
function countTokenCoverage(originalTokens, correctedTokens) {
    if (originalTokens.length === 0)
        return 1;
    return countCoveredTokens(originalTokens, correctedTokens) / originalTokens.length;
}
function assessCorrectedMenuStructure(originalMenu, correctedMenu) {
    const original = (originalMenu || '').trim();
    const corrected = (correctedMenu || '').trim();
    const originalTokens = tokenizeForCoverage(original);
    const correctedTokens = tokenizeForCoverage(corrected);
    const originalLineCount = countNonEmptyLines(original);
    const correctedLineCount = countNonEmptyLines(corrected);
    const missingMeaningfulLines = findMissingMeaningfulSubmittedLines(original, corrected);
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
        missingMeaningfulLineCount: missingMeaningfulLines.length,
        missingMeaningfulLineSamples: missingMeaningfulLines.slice(0, 5),
    };
    const reasons = [];
    if (metrics.correctedLineCount < metrics.originalLineCount) {
        reasons.push('corrected_menu_dropped_lines');
    }
    if (metrics.missingMeaningfulLineCount > 0) {
        reasons.push('missing_submitted_line');
    }
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
