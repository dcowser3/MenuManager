import {
    DiffEdit,
    DiffToken,
    buildTokenEdits,
    tokenizeWords,
} from '@menumanager/diff-core';

const ALLERGEN_CODE_TOKENS = new Set(['c', 'd', 'e', 'f', 'g', 'n', 'v', 'vg', 'gf', 'df', 'sf', 'nf']);
const STOPWORD_TOKENS = new Set(['of', 'or', 'and', 'the', 'a', 'an', 'to', 'for', 'with', 'may']);

export type ReplacementSignal = {
    from: string;
    to: string;
    from_norm: string;
    to_norm: string;
    kind: 'diacritic' | 'punctuation' | 'spelling' | 'capitalization';
    confidence: number;
    line_index: number;
};

export type LineDiffEdit = { type: 'equal' | 'delete' | 'insert'; lines: string[]; indices: number[] };
type ModifiedLinePair = { beforeLine: string; afterLine: string; beforeLineIndex: number };
type LinePairCandidate = { deleteIndex: number; insertIndex: number; score: number };

export function extractReplacementSignals(aiDraft: string, final: string): ReplacementSignal[] {
    const aiLines = aiDraft.split('\n');
    const finalLines = final.split('\n');
    const replacements: ReplacementSignal[] = [];

    const lineEdits = diffLines(aiLines, finalLines);
    for (let i = 0; i < lineEdits.length; i += 1) {
        const current = lineEdits[i];
        if (!current) continue;

        if (current.type === 'equal') {
            continue;
        }

        const next = lineEdits[i + 1];
        if (!next || current.type !== 'delete' || next.type !== 'insert') continue;

        const linePairs = pairModifiedLines(current, next);
        for (const { beforeLine, afterLine, beforeLineIndex } of linePairs) {
            const lineReplacements = extractLineReplacements(beforeLine, afterLine, beforeLineIndex);
            replacements.push(...lineReplacements);
        }
    }

    return dedupeSignals(replacements);
}

function pairModifiedLines(deleted: LineDiffEdit, inserted: LineDiffEdit): ModifiedLinePair[] {
    const candidates: LinePairCandidate[] = [];

    for (let deleteIndex = 0; deleteIndex < deleted.lines.length; deleteIndex += 1) {
        for (let insertIndex = 0; insertIndex < inserted.lines.length; insertIndex += 1) {
            const score = modifiedLineScore(deleted.lines[deleteIndex], inserted.lines[insertIndex]);
            if (score <= 0) continue;
            candidates.push({ deleteIndex, insertIndex, score });
        }
    }

    candidates.sort((a, b) =>
        b.score - a.score ||
        a.deleteIndex - b.deleteIndex ||
        a.insertIndex - b.insertIndex
    );

    const usedDeleted = new Set<number>();
    const usedInserted = new Set<number>();
    const pairs: ModifiedLinePair[] = [];

    for (const candidate of candidates) {
        if (usedDeleted.has(candidate.deleteIndex) || usedInserted.has(candidate.insertIndex)) continue;
        usedDeleted.add(candidate.deleteIndex);
        usedInserted.add(candidate.insertIndex);
        pairs.push({
            beforeLine: deleted.lines[candidate.deleteIndex],
            afterLine: inserted.lines[candidate.insertIndex],
            beforeLineIndex: deleted.indices[candidate.deleteIndex],
        });
    }

    return pairs.sort((a, b) => a.beforeLineIndex - b.beforeLineIndex);
}

export function diffLines(before: string[], after: string[]): LineDiffEdit[] {
    const beforeNorm = before.map((line) => normalizeLine(line));
    const afterNorm = after.map((line) => normalizeLine(line));
    const m = beforeNorm.length;
    const n = afterNorm.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            if (beforeNorm[i] === afterNorm[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const edits: LineDiffEdit[] = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (beforeNorm[i] === afterNorm[j]) {
            pushLineEdit(edits, 'equal', before[i], i);
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            pushLineEdit(edits, 'delete', before[i], i);
            i += 1;
        } else {
            pushLineEdit(edits, 'insert', after[j], j);
            j += 1;
        }
    }

    while (i < m) {
        pushLineEdit(edits, 'delete', before[i], i);
        i += 1;
    }
    while (j < n) {
        pushLineEdit(edits, 'insert', after[j], j);
        j += 1;
    }

    return edits;
}

function pushLineEdit(edits: LineDiffEdit[], type: LineDiffEdit['type'], line: string, idx: number): void {
    const last = edits[edits.length - 1];
    if (last && last.type === type) {
        last.lines.push(line);
        last.indices.push(idx);
        return;
    }
    edits.push({ type, lines: [line], indices: [idx] });
}

function normalizeLine(line: string): string {
    // Only normalize whitespace; preserve case and diacritics so real edits survive line diffing.
    return normalizeWhitespace((line || ''));
}

export function linesLikelySameContext(beforeLine: string, afterLine: string): boolean {
    const beforeTokens = tokenizeWords(beforeLine).map((t) => normalizeToken(stripDiacritics(t))).filter(Boolean);
    const afterTokens = tokenizeWords(afterLine).map((t) => normalizeToken(stripDiacritics(t))).filter(Boolean);
    if (!beforeTokens.length || !afterTokens.length) return false;

    const beforeSet = new Set(beforeTokens);
    let overlap = 0;
    for (const token of afterTokens) {
        if (beforeSet.has(token)) overlap += 1;
    }
    const ratio = overlap / Math.max(beforeTokens.length, afterTokens.length);
    return ratio >= 0.5;
}

function modifiedLineScore(beforeLine: string, afterLine: string): number {
    if (!learningLinesLikelySameContext(beforeLine, afterLine)) return 0;
    if (!dishIdentityLikelySame(beforeLine, afterLine)) return 0;

    const beforeTokens = comparableLineTokens(beforeLine);
    const afterTokens = comparableLineTokens(afterLine);
    const overlapScore = tokenOverlapRatio(beforeTokens, afterTokens);
    const sequenceScore = tokenSequenceRatio(beforeTokens, afterTokens);
    const score = (overlapScore + sequenceScore) / 2;
    return score >= 0.5 ? score : 0;
}

function learningLinesLikelySameContext(beforeLine: string, afterLine: string): boolean {
    const beforeTokens = comparableLineTokens(beforeLine);
    const afterTokens = comparableLineTokens(afterLine);
    if (!beforeTokens.length || !afterTokens.length) return false;

    return tokenOverlapRatio(beforeTokens, afterTokens) >= 0.5;
}

function dishIdentityLikelySame(beforeLine: string, afterLine: string): boolean {
    const beforeIdentity = comparableLineTokens(extractDishIdentityText(beforeLine));
    const afterIdentity = comparableLineTokens(extractDishIdentityText(afterLine));
    if (!beforeIdentity.length || !afterIdentity.length) return true;

    return tokenOverlapRatio(beforeIdentity, afterIdentity) >= 0.67;
}

function extractDishIdentityText(line: string): string {
    const trimmed = normalizeWhitespace(line);
    const commaIndex = trimmed.indexOf(',');
    return commaIndex > 0 ? trimmed.slice(0, commaIndex) : trimmed;
}

function comparableLineTokens(line: string): string[] {
    return tokenizeWords(line)
        .map((t) => normalizeToken(stripDiacritics(t)))
        .filter((token) =>
            token &&
            token.length >= 2 &&
            !isMostlyNumeric(token) &&
            !STOPWORD_TOKENS.has(token) &&
            !ALLERGEN_CODE_TOKENS.has(token)
        );
}

function tokenOverlapRatio(beforeTokens: string[], afterTokens: string[]): number {
    const beforeSet = new Set(beforeTokens);
    const afterSet = new Set(afterTokens);
    if (!beforeSet.size || !afterSet.size) return 0;

    let overlap = 0;
    for (const token of afterSet) {
        if (beforeSet.has(token)) overlap += 1;
    }
    return overlap / Math.max(beforeSet.size, afterSet.size);
}

function tokenSequenceRatio(beforeTokens: string[], afterTokens: string[]): number {
    if (!beforeTokens.length || !afterTokens.length) return 0;

    const dp: number[][] = Array.from(
        { length: beforeTokens.length + 1 },
        () => Array(afterTokens.length + 1).fill(0)
    );

    for (let i = beforeTokens.length - 1; i >= 0; i -= 1) {
        for (let j = afterTokens.length - 1; j >= 0; j -= 1) {
            if (beforeTokens[i] === afterTokens[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    return dp[0][0] / Math.max(beforeTokens.length, afterTokens.length);
}

export function extractLineReplacements(before: string, after: string, lineIndex: number): ReplacementSignal[] {
    const beforeTokens = tokenizeWords(before);
    const afterTokens = tokenizeWords(after);

    const edits = buildTokenEditsFromWords(beforeTokens, afterTokens);
    const replacements: ReplacementSignal[] = [];

    for (let i = 0; i < edits.length; i += 1) {
        const current = edits[i];
        const next = edits[i + 1];

        if (!current || !next) continue;
        if (current.type !== 'delete' || next.type !== 'insert') continue;

        const pairCount = Math.min(current.tokens.length, next.tokens.length);
        for (let j = 0; j < pairCount; j += 1) {
            const from = current.tokens[j].value;
            const to = next.tokens[j].value;
            if (!isHighSignalReplacement(from, to)) continue;

            const kind = classifyReplacementKind(from, to);
            replacements.push({
                from,
                to,
                from_norm: normalizeToken(from),
                to_norm: normalizeToken(to),
                kind,
                confidence: baseSignalConfidence(from, to, kind),
                line_index: lineIndex,
            });
        }
    }

    return replacements;
}

function buildTokenEditsFromWords(beforeTokens: string[], afterTokens: string[]): DiffEdit[] {
    return buildTokenEdits(
        beforeTokens.map((value, idx) => wordToDiffToken(value, idx)),
        afterTokens.map((value, idx) => wordToDiffToken(value, idx))
    );
}

function wordToDiffToken(value: string, idx: number): DiffToken {
    return {
        value,
        start: idx,
        end: idx + value.length,
        type: 'word',
        normalized: value.replace(/[\u2018\u2019`]/g, "'").trim(),
    };
}

function normalizeToken(token: string): string {
    return (token || '').toLowerCase().replace(/[’'`]/g, "'").trim();
}

function normalizeWhitespace(input: string): string {
    return (input || '').replace(/\s+/g, ' ').trim();
}

function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) dp[i][0] = i;
    for (let j = 0; j <= n; j += 1) dp[0][j] = j;

    for (let i = 1; i <= m; i += 1) {
        for (let j = 1; j <= n; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function containsLetter(input: string): boolean {
    return /[\p{L}]/u.test(input);
}

function isMostlyNumeric(input: string): boolean {
    const compact = (input || '').replace(/[^\p{N}]/gu, '');
    return compact.length > 0 && compact.length >= Math.ceil((input || '').length * 0.6);
}

function isHighSignalReplacement(from: string, to: string): boolean {
    const fromNorm = normalizeToken(from);
    const toNorm = normalizeToken(to);
    if (!fromNorm || !toNorm) return false;
    if (fromNorm === toNorm && from.trim() === to.trim()) return false;
    if (fromNorm.length < 3 || toNorm.length < 3) return false;
    if (!containsLetter(fromNorm) || !containsLetter(toNorm)) return false;
    if (fromNorm.length > 40 || toNorm.length > 40) return false;
    if (isMostlyNumeric(fromNorm) || isMostlyNumeric(toNorm)) return false;
    if (STOPWORD_TOKENS.has(fromNorm) || STOPWORD_TOKENS.has(toNorm)) return false;
    if (ALLERGEN_CODE_TOKENS.has(fromNorm) || ALLERGEN_CODE_TOKENS.has(toNorm)) return false;

    const fromPlain = stripDiacritics(fromNorm);
    const toPlain = stripDiacritics(toNorm);
    if (fromPlain === toPlain) return true;

    const fromNoPunc = fromPlain.replace(/[^a-z0-9]/g, '');
    const toNoPunc = toPlain.replace(/[^a-z0-9]/g, '');
    if (fromNoPunc && fromNoPunc === toNoPunc) return true;

    const distance = levenshteinDistance(fromPlain, toPlain);
    const maxLen = Math.max(fromPlain.length, toPlain.length) || 1;
    return distance <= 3 || distance / maxLen <= 0.4;
}

function classifyReplacementKind(from: string, to: string): ReplacementSignal['kind'] {
    const fromNorm = normalizeToken(from);
    const toNorm = normalizeToken(to);
    const fromPlain = stripDiacritics(fromNorm);
    const toPlain = stripDiacritics(toNorm);

    if (fromNorm === toNorm && from.trim() !== to.trim()) return 'capitalization';
    if (fromPlain === toPlain && fromNorm !== toNorm) return 'diacritic';
    const fromNoPunc = fromPlain.replace(/[^a-z0-9]/g, '');
    const toNoPunc = toPlain.replace(/[^a-z0-9]/g, '');
    if (fromNoPunc === toNoPunc && fromNorm !== toNorm) return 'punctuation';
    return 'spelling';
}

function baseSignalConfidence(from: string, to: string, kind: ReplacementSignal['kind']): number {
    const fromPlain = stripDiacritics(normalizeToken(from));
    const toPlain = stripDiacritics(normalizeToken(to));
    const distance = levenshteinDistance(fromPlain, toPlain);
    const maxLen = Math.max(fromPlain.length, toPlain.length) || 1;
    const ratio = distance / maxLen;

    let confidence = 0.55;
    if (kind === 'diacritic') confidence += 0.2;
    if (kind === 'capitalization') confidence += 0.15;
    if (kind === 'punctuation') confidence += 0.1;
    if (ratio <= 0.2) confidence += 0.15;
    if (ratio > 0.5) confidence -= 0.15;
    return clamp(confidence, 0.35, 0.95);
}

function dedupeSignals(signals: ReplacementSignal[]): ReplacementSignal[] {
    const seen = new Set<string>();
    const out: ReplacementSignal[] = [];

    for (const signal of signals) {
        const key = `${signal.from_norm}=>${signal.to_norm}@${signal.line_index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(signal);
    }
    return out;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
