"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTECTED_TERMS = void 0;
exports.restoreProtectedTerms = restoreProtectedTerms;
exports.PROTECTED_TERMS = ['picked herbs', 'twice-baked'];
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function protectedTermPattern(protectedTerm) {
    const flexibleSeparators = escapeRegExp(protectedTerm).replace(/[\s-]+/g, '[^a-z0-9]*');
    return new RegExp(`\\b${flexibleSeparators}\\b`, 'gi');
}
function normalizedProtectionText(value) {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}
function editDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= right.length; j += 1) {
            current[j] = left[i - 1] === right[j - 1]
                ? previous[j - 1]
                : Math.min(previous[j - 1], previous[j], current[j - 1]) + 1;
        }
        for (let j = 0; j <= right.length; j += 1)
            previous[j] = current[j];
    }
    return previous[right.length];
}
function restoreProtectedTermOnLine(originalLine, correctedLine, protectedTerm) {
    const termPattern = protectedTermPattern(protectedTerm);
    const matches = [...originalLine.matchAll(termPattern)];
    let nextLine = correctedLine;
    let restored = false;
    for (const match of matches) {
        const start = match.index ?? -1;
        if (start < 0)
            continue;
        const originalTerm = match[0];
        const target = normalizedProtectionText(originalTerm);
        const targetWordCount = originalTerm.trim().split(/\s+/).length;
        const tokens = [...nextLine.matchAll(/\S+/g)].map((token) => ({
            text: token[0],
            start: token.index || 0,
            end: (token.index || 0) + token[0].length,
        }));
        const originalWordIndex = originalLine.slice(0, start).trim()
            ? originalLine.slice(0, start).trim().split(/\s+/).length
            : 0;
        let best = null;
        for (let tokenStart = 0; tokenStart < tokens.length; tokenStart += 1) {
            for (let tokenEnd = tokenStart; tokenEnd < Math.min(tokens.length, tokenStart + targetWordCount + 2); tokenEnd += 1) {
                const candidateText = nextLine.slice(tokens[tokenStart].start, tokens[tokenEnd].end);
                const candidateNormalized = normalizedProtectionText(candidateText);
                if (!candidateNormalized)
                    continue;
                const distance = editDistance(target, candidateNormalized);
                if (distance > 1)
                    continue;
                const positionDistance = Math.abs(tokenStart - originalWordIndex);
                if (!best || distance < best.distance || (distance === best.distance && positionDistance < best.positionDistance)) {
                    best = {
                        start: tokens[tokenStart].start,
                        end: tokens[tokenEnd].end,
                        distance,
                        positionDistance,
                    };
                }
            }
        }
        if (!best)
            continue;
        const candidateText = nextLine.slice(best.start, best.end);
        const leadingPunctuation = candidateText.match(/^[,.;:!?]+/)?.[0] || '';
        const trailingPunctuation = candidateText.match(/[,.;:!?]+$/)?.[0] || '';
        const replacement = `${leadingPunctuation}${originalTerm}${trailingPunctuation}`;
        const candidate = `${nextLine.slice(0, best.start)}${replacement}${nextLine.slice(best.end)}`;
        if (candidate !== nextLine) {
            nextLine = candidate;
            restored = true;
        }
    }
    return { line: nextLine, restored };
}
/**
 * Restore protected phrases after model output has been parsed and before the
 * remaining post-AI guards run. This is intentionally anchored to phrases
 * present in the submitted menu, so the guard cannot introduce a protected
 * term into unrelated output.
 */
function restoreProtectedTerms(originalMenu, correctedMenu, protectedTerms = exports.PROTECTED_TERMS) {
    const originalLines = `${originalMenu || ''}`.split('\n');
    const correctedLines = `${correctedMenu || ''}`.split('\n');
    const nextLines = [...correctedLines];
    const restoredTerms = [];
    for (let lineIndex = 0; lineIndex < originalLines.length; lineIndex += 1) {
        const originalLine = originalLines[lineIndex];
        if (!originalLine)
            continue;
        let correctedLine = nextLines[lineIndex];
        if (correctedLine === undefined)
            continue;
        for (const protectedTerm of protectedTerms) {
            const protectedTermNormalized = normalizedProtectionText(protectedTerm);
            if (!protectedTermNormalized || !normalizedProtectionText(originalLine).includes(protectedTermNormalized)) {
                continue;
            }
            const result = restoreProtectedTermOnLine(originalLine, correctedLine, protectedTerm);
            correctedLine = result.line;
            if (result.restored && !restoredTerms.includes(protectedTerm)) {
                restoredTerms.push(protectedTerm);
            }
        }
        nextLines[lineIndex] = correctedLine;
    }
    return {
        correctedMenu: nextLines.join('\n'),
        restoredTerms,
    };
}
