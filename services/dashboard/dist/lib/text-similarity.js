"use strict";
// Text comparison utilities shared by the pre-AI A/B replay and the full
// review eval harness. Lifted verbatim from scripts/pre-ai-ab-replay.js.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeComparable = normalizeComparable;
exports.normalizeRawAsteriskStyleOnLine = normalizeRawAsteriskStyleOnLine;
exports.boundedLevenshteinSimilarity = boundedLevenshteinSimilarity;
exports.tokenDiceSimilarity = tokenDiceSimilarity;
exports.tokenCounts = tokenCounts;
function normalizeComparable(text, options = {}) {
    let value = `${text || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    value = value
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (options.normalizeRawAsteriskStyle) {
        value = value.split('\n').map(normalizeRawAsteriskStyleOnLine).join('\n');
    }
    return value;
}
function normalizeRawAsteriskStyleOnLine(line) {
    if (/^\s*\*CONSUMING RAW OR UNDERCOOKED/i.test(line)) {
        return line;
    }
    return line
        .replace(/(\S)\s+\*(?=\s|[A-Za-z]{1,3}(?:,|\s|$))/g, '$1*')
        .replace(/(\S)\*(?=([A-Za-z]{1,3})(?:,|\s|$))/g, '$1* $2');
}
function boundedLevenshteinSimilarity(a, b) {
    if (a === b)
        return 1;
    if (!a.length || !b.length)
        return 0;
    const maxLength = Math.max(a.length, b.length);
    if (maxLength > 20000) {
        return tokenDiceSimilarity(a, b);
    }
    let prev = new Array(b.length + 1);
    let curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1)
        prev[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        curr[0] = i;
        const ca = a.charCodeAt(i - 1);
        for (let j = 1; j <= b.length; j += 1) {
            const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return 1 - (prev[b.length] / maxLength);
}
function tokenDiceSimilarity(a, b) {
    const aCounts = tokenCounts(a);
    const bCounts = tokenCounts(b);
    let overlap = 0;
    let aTotal = 0;
    let bTotal = 0;
    for (const count of aCounts.values())
        aTotal += count;
    for (const count of bCounts.values())
        bTotal += count;
    for (const [token, count] of aCounts) {
        overlap += Math.min(count, bCounts.get(token) || 0);
    }
    return (2 * overlap) / Math.max(1, aTotal + bTotal);
}
function tokenCounts(text) {
    const counts = new Map();
    const tokens = `${text || ''}`.toLowerCase().match(/[\p{L}\p{N}*,$.]+/gu) || [];
    for (const token of tokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
    }
    return counts;
}
