import * as fs from 'fs';
import * as path from 'path';

export interface Difference {
    type: string;
    severity: 'critical' | 'warning' | 'info';
    description: string;
    docxValue?: string;
    pdfValue?: string;
    docxLineNum?: number;
    pdfLineNum?: number;
}

export interface WordDiff {
    type: 'same' | 'changed' | 'missing' | 'added';
    text?: string;
    docxText?: string;
    pdfText?: string;
    classification?: { type: string; severity: string };
}

export interface AlignmentEntry {
    type: 'match' | 'docx_only' | 'pdf_only';
    docxLine?: string;
    pdfLine?: string;
    docxIdx?: number;
    pdfIdx?: number;
    wordDiffs?: WordDiff[];
}

export interface MarkedContentExpectation {
    text: string;
    context?: string;
    active_text?: string;
    scope?: 'line' | 'fragment';
    markers?: string[];
    paragraph_index?: number;
}

export interface DesignComparisonIntent {
    removedContent?: MarkedContentExpectation[];
    requiredContent?: MarkedContentExpectation[];
}

type Rules = {
    ignoreLeadingPhrases?: string[];
    ignorableWords?: string[];
    minWordLengthForMissing?: number;
};

type PreparedLine = {
    text: string;
    index: number;
    matchTokens: string[];
    comparisonTokens: ComparisonToken[];
    allergens: string[];
    prices: string[];
};

type ComparisonToken = {
    original: string;
    exact: string;
    accentless: string;
};

const DEFAULT_RULES: Rules = {
    ignoreLeadingPhrases: ['Choice of:', 'Choice of', 'Served with', 'Served with:'],
    ignorableWords: ['of', 'the', 'a', 'an', 'with', 'and', 'or', '&'],
    minWordLengthForMissing: 3,
};

const ALLERGEN_CODES = new Set(['GF', 'V', 'VG', 'DF', 'N', 'SF', 'S', 'G', 'C', 'D', 'E', 'F']);
const COMPACT_ALLERGEN_CODES = new Set(['DG', 'DV', 'GV', 'DGV', 'DGN', 'GNV', 'DGVN']);
const ORDINALS: Record<string, string> = {
    '1st': 'first',
    '2nd': 'second',
    '3rd': 'third',
    '4th': 'fourth',
};
const LIGATURES: Record<string, string> = {
    '\ufb00': 'ff',
    '\ufb01': 'fi',
    '\ufb02': 'fl',
    '\ufb03': 'ffi',
    '\ufb04': 'ffl',
    '\ufb05': 'st',
    '\ufb06': 'st',
};

function loadRules(): Rules {
    try {
        const rulesPath = path.join(__dirname, '..', 'design-comparison-rules.json');
        return JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules || DEFAULT_RULES;
    } catch {
        return DEFAULT_RULES;
    }
}

const rules = loadRules();
const ignorableWords = new Set((rules.ignorableWords || DEFAULT_RULES.ignorableWords || []).map((word) => word.toLowerCase()));

export function normalizeExtractedText(value: string): string {
    let normalized = (value || '').normalize('NFC');
    for (const [ligature, replacement] of Object.entries(LIGATURES)) {
        normalized = normalized.split(ligature).join(replacement);
    }
    return normalized
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '-')
        .replace(/[\u00A0\u2007\u202F]/g, ' ')
        .replace(/\u00AD/g, '')
        .replace(/[‐‑‒–—―]/g, '-')
        .replace(/[ \t]+/g, ' ');
}

function stripAccents(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function stripLeadingPhrases(line: string): string {
    let result = line.trim();
    for (const phrase of rules.ignoreLeadingPhrases || []) {
        if (result.toLowerCase().startsWith(phrase.toLowerCase())) {
            result = result.slice(phrase.length).trim();
        }
    }
    return result;
}

function editDistance(a: string, b: string): number {
    const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
    for (let i = 1; i <= b.length; i++) {
        let diagonal = rows[0];
        rows[0] = i;
        for (let j = 1; j <= a.length; j++) {
            const previous = rows[j];
            rows[j] = Math.min(
                rows[j] + 1,
                rows[j - 1] + 1,
                diagonal + (a[j - 1] === b[i - 1] ? 0 : 1),
            );
            diagonal = previous;
        }
    }
    return rows[a.length];
}

function collapseTrackedEditDuplicate(token: string): string {
    const plain = stripAccents(token).toLowerCase();
    let best: { score: number; value: string } | null = null;

    for (let split = 4; split <= token.length - 4; split++) {
        const left = plain.slice(0, split);
        const right = plain.slice(split);
        if (Math.abs(left.length - right.length) > 2) continue;
        const score = 1 - editDistance(left, right) / Math.max(left.length, right.length);
        if (score >= 0.8 && (!best || score > best.score)) {
            best = { score, value: token.slice(split) };
        }
    }

    return best?.value || token;
}

function rawWordTokens(line: string): string[] {
    return (normalizeExtractedText(stripLeadingPhrases(line)).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [])
        .map(collapseTrackedEditDuplicate);
}

function expandAllergenToken(token: string): string[] {
    if (/\d/.test(token)) return [];
    const cleaned = token.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (ALLERGEN_CODES.has(cleaned)) return [cleaned];
    if (token === token.toUpperCase() && COMPACT_ALLERGEN_CODES.has(cleaned)) return cleaned.split('');
    return [];
}

function extractAllergens(line: string): string[] {
    const codes = new Set<string>();
    for (const token of rawWordTokens(line)) {
        for (const code of expandAllergenToken(token)) codes.add(code);
    }
    return [...codes].sort();
}

function canonicalNumber(value: string): string {
    return value
        .replace(/[$+\s]/g, '')
        .replace(/pp$/i, '')
        .split('/')
        .map((part) => String(Number(part)))
        .join('/');
}

function extractPrices(line: string): string[] {
    const normalized = normalizeExtractedText(line);
    const prices = new Set<string>();
    const candidatePattern = /[$+]?\s*\d+(?:\.\d{1,2})?(?:\s*pp)?(?:\s*\/\s*\d+(?:\.\d{1,2})?)?/gi;
    let match: RegExpExecArray | null;

    while ((match = candidatePattern.exec(normalized)) !== null) {
        const raw = match[0].trim();
        const numeric = Number((raw.match(/\d+(?:\.\d+)?/) || ['0'])[0]);
        const remainder = normalized.slice(match.index + match[0].length);
        const explicit = /[$+]|pp|\//i.test(raw);
        const atLineEnd = remainder.trim().length === 0;
        const followedByTimeOrOrdinal = /^(?:\s*(?:am|pm|st|nd|rd|th))\b/i.test(remainder);
        if (numeric > 500 || followedByTimeOrOrdinal || (!explicit && !atLineEnd)) continue;
        prices.add(canonicalNumber(raw));
    }

    return [...prices];
}

function isPriceOnly(line: string): boolean {
    return /^[+\s$]*\d+(?:\.\d{1,2})?(?:\s*pp)?$/i.test(line.trim());
}

function isAllergenLegend(line: string): boolean {
    const normalized = line.trim();
    if (/^allergen\s+key/i.test(normalized)) return true;
    if (!normalized.includes('|')) return false;
    const codeDefinitions = normalized.match(/(?:\([A-Za-z]{1,3}\)|\b[A-Z]{1,3}\b)\s+(?:contains?\s+)?(?:dairy|gluten|nuts?|shellfish|fish|egg|vegan|vegetarian|soy|sesame|celery|crustaceans?)/gi) || [];
    return codeDefinitions.length >= 3;
}

function isRawNotice(line: string): boolean {
    const value = stripAccents(line).toLowerCase();
    return value.includes('raw or undercooked') || value.includes('foodborne illness');
}

function isManagedBoilerplate(line: string): boolean {
    const normalized = line.trim();
    return isAllergenLegend(normalized)
        || isRawNotice(normalized)
        || /^\d+(?:\.\d+)?%\s+service charge\b/i.test(normalized)
        || /^all prices\b/i.test(normalized)
        || /^we welcome enquiries\b/i.test(normalized);
}

function isEditorialInstruction(line: string): boolean {
    return /^\(\s*(?:e\.g\.|remove|delete|add|replace|change|designer|note\b)/i.test(line.trim());
}

function normalizeMatchToken(token: string): string {
    const lower = stripAccents(token).toLowerCase().replace(/[’']/g, '');
    if (ORDINALS[lower]) return ORDINALS[lower];
    if (lower.length > 5 && lower.endsWith('s') && !lower.endsWith('ss')) return lower.slice(0, -1);
    return lower;
}

function comparisonTokens(line: string): ComparisonToken[] {
    return rawWordTokens(line)
        .filter((token) => !/\d/.test(token) || Boolean(ORDINALS[token.toLowerCase()]))
        .filter((token) => expandAllergenToken(token).length === 0)
        .map((original) => {
            const ordinal = ORDINALS[original.toLowerCase()];
            return {
                original,
                exact: ordinal || original.toLowerCase().replace(/[’']/g, ''),
                accentless: ordinal || stripAccents(original).toLowerCase().replace(/[’']/g, ''),
            };
        })
        .filter((token) => {
            const clean = token.accentless;
            return !ignorableWords.has(clean) && clean.length >= (rules.minWordLengthForMissing || 0);
        });
}

function matchTokens(line: string): string[] {
    return comparisonTokens(line).map((token) => normalizeMatchToken(token.accentless));
}

function prepareLines(text: string): { lines: PreparedLine[]; excluded: PreparedLine[] } {
    const rawLines = normalizeExtractedText(text)
        .split(/\r?\n/)
        .map((text, index) => ({ text: text.trim().replace(/\s+/g, ' '), index }))
        .filter(({ text }) => text.length > 0);
    const included: Array<{ text: string; index: number }> = [];
    const excluded: Array<{ text: string; index: number }> = [];

    for (const line of rawLines) {
        if (isManagedBoilerplate(line.text) || isEditorialInstruction(line.text)) {
            excluded.push(line);
        } else {
            included.push(line);
        }
    }

    // Designer proofs commonly move a standalone +price to the preceding or
    // following heading. Fold only explicit enhancement prices; a standalone
    // package price such as "$85 pp" remains independently reviewable.
    for (let index = 0; index < included.length; index++) {
        const current = included[index];
        if (!isPriceOnly(current.text) || !current.text.includes('+')) continue;
        const previous = included[index - 1];
        const next = included[index + 1];
        const previousLooksLikeHeading = previous && previous.text === previous.text.toUpperCase() && rawWordTokens(previous.text).length <= 5;
        if (previousLooksLikeHeading) {
            previous.text = `${previous.text} ${current.text}`;
        } else if (next) {
            next.text = `${next.text} ${current.text}`;
        } else if (previous) {
            previous.text = `${previous.text} ${current.text}`;
        }
        included.splice(index, 1);
        index--;
    }

    const hydrate = (line: { text: string; index: number }): PreparedLine => ({
        ...line,
        matchTokens: matchTokens(line.text),
        comparisonTokens: comparisonTokens(line.text),
        allergens: extractAllergens(line.text),
        prices: extractPrices(line.text),
    });

    return { lines: included.map(hydrate), excluded: excluded.map(hydrate) };
}

function tokenCounts(tokens: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return counts;
}

function countOverlap(expected: string[], actual: string[]): number {
    const available = tokenCounts(actual);
    let overlap = 0;
    for (const token of expected) {
        const count = available.get(token) || 0;
        if (count > 0) {
            overlap++;
            available.set(token, count - 1);
        }
    }
    return overlap;
}

function selectedTokens(indices: number[], lines: PreparedLine[]): string[] {
    return indices.flatMap((index) => lines[index].matchTokens);
}

function selectPdfLines(source: PreparedLine, pdfLines: PreparedLine[], usedPdf: Set<number>): number[] {
    const selected: number[] = [];
    let coveredTokens: string[] = [];

    for (let pass = 0; pass < 4; pass++) {
        const coveredAllergens = new Set(selected.flatMap((index) => pdfLines[index].allergens));
        const coveredPrices = new Set(selected.flatMap((index) => pdfLines[index].prices));
        const currentCoverage = source.matchTokens.length
            ? countOverlap(source.matchTokens, coveredTokens) / source.matchTokens.length
            : 0;
        const structuredContentCovered = source.allergens.every((code) => coveredAllergens.has(code))
            && (isSectionPriceOwner(source) || source.prices.every((price) => coveredPrices.has(price)));
        if (selected.length > 0 && currentCoverage >= 0.75 && structuredContentCovered) break;

        let best: { index: number; contribution: number; score: number } | null = null;
        const beforeOverlap = countOverlap(source.matchTokens, coveredTokens);

        for (let index = 0; index < pdfLines.length; index++) {
            if (usedPdf.has(index) || selected.includes(index)) continue;
            const target = pdfLines[index];
            const afterOverlap = countOverlap(source.matchTokens, [...coveredTokens, ...target.matchTokens]);
            const contribution = afterOverlap - beforeOverlap;
            const exactLine = source.matchTokens.join(' ') === target.matchTokens.join(' ') && source.matchTokens.length > 0;
            const sharedAllergen = source.allergens.some((code) => target.allergens.includes(code));
            const sharedPrice = !isSectionPriceOwner(source)
                && source.prices.some((price) => target.prices.includes(price));
            const oneStrongToken = contribution === 1
                && source.matchTokens.some((token) => target.matchTokens.includes(token) && token.length >= 5)
                && Math.min(source.matchTokens.length, target.matchTokens.length) <= 2;
            if (!exactLine && contribution < 2 && !oneStrongToken
                && !((sharedAllergen || sharedPrice) && selected.length > 0)) continue;

            const containment = source.matchTokens.length ? afterOverlap / source.matchTokens.length : 0;
            const score = contribution * 10 + containment + (exactLine ? 20 : 0)
                + (sharedAllergen ? 0.5 : 0) + (sharedPrice ? 0.5 : 0);
            if (!best || score > best.score) best = { index, contribution, score };
        }

        if (!best) break;
        selected.push(best.index);
        coveredTokens = selectedTokens(selected, pdfLines);
    }

    const overlap = countOverlap(source.matchTokens, coveredTokens);
    const coverage = source.matchTokens.length ? overlap / source.matchTokens.length : 0;
    const commaAnchor = source.text.includes(',')
        ? matchTokens(stripLeadingPhrases(source.text).split(',')[0])
        : [];
    const anchorCovered = commaAnchor.length === 0 || countOverlap(commaAnchor, coveredTokens) > 0;
    const exactSingle = selected.length === 1
        && source.matchTokens.join(' ') === pdfLines[selected[0]].matchTokens.join(' ')
        && source.matchTokens.length > 0;
    const fuzzyOverlap = (() => {
        const available = [...coveredTokens];
        let matched = 0;
        for (const token of source.matchTokens) {
            const index = available.findIndex((candidate) => similarity(token, candidate) >= 0.68);
            if (index >= 0) {
                matched++;
                available.splice(index, 1);
            }
        }
        return source.matchTokens.length ? matched / source.matchTokens.length : 0;
    })();
    const allergenOnlyMatch = source.matchTokens.length === 0
        && source.allergens.some((code) => selected.some((index) => pdfLines[index].allergens.includes(code)));

    if (!anchorCovered || (!exactSingle && !allergenOnlyMatch && coverage < 0.55 && fuzzyOverlap < 0.9)) return [];
    return selected;
}

function similarity(a: string, b: string): number {
    return 1 - editDistance(a, b) / Math.max(a.length, b.length, 1);
}

function compareLexicalTokens(docx: PreparedLine, pdfLines: PreparedLine[]): { differences: Difference[]; wordDiffs: WordDiff[] } {
    const differences: Difference[] = [];
    const wordDiffs: WordDiff[] = [];
    const remainingPdf = pdfLines.flatMap((line) => line.comparisonTokens).map((token) => ({ ...token, used: false }));
    const unmatchedDocx: ComparisonToken[] = [];

    for (const token of docx.comparisonTokens) {
        let matchIndex = remainingPdf.findIndex((candidate) => !candidate.used && candidate.exact === token.exact);
        if (matchIndex >= 0) {
            remainingPdf[matchIndex].used = true;
            wordDiffs.push({ type: 'same', text: token.original });
            continue;
        }

        matchIndex = remainingPdf.findIndex((candidate) => !candidate.used && candidate.accentless === token.accentless);
        if (matchIndex >= 0) {
            const candidate = remainingPdf[matchIndex];
            candidate.used = true;
            differences.push({
                type: 'diacritical',
                severity: 'warning',
                description: `"${token.original}" changed to "${candidate.original}"`,
                docxValue: token.original,
                pdfValue: candidate.original,
            });
            wordDiffs.push({
                type: 'changed',
                docxText: token.original,
                pdfText: candidate.original,
                classification: { type: 'diacritical', severity: 'warning' },
            });
            continue;
        }

        unmatchedDocx.push(token);
    }

    for (const token of unmatchedDocx) {
        const compoundStart = remainingPdf.findIndex((candidate, index) => {
            const next = remainingPdf[index + 1];
            return !candidate.used && Boolean(next && !next.used)
                && `${candidate.accentless}${next.accentless}` === token.accentless;
        });
        if (compoundStart >= 0) {
            const first = remainingPdf[compoundStart];
            const second = remainingPdf[compoundStart + 1];
            first.used = true;
            second.used = true;
            const replacement = `${first.original} ${second.original}`;
            differences.push({
                type: 'spelling',
                severity: 'warning',
                description: `"${token.original}" changed to "${replacement}"`,
                docxValue: token.original,
                pdfValue: replacement,
            });
            wordDiffs.push({
                type: 'changed',
                docxText: token.original,
                pdfText: replacement,
                classification: { type: 'spelling', severity: 'warning' },
            });
            continue;
        }

        let best: { index: number; score: number } | null = null;
        for (let index = 0; index < remainingPdf.length; index++) {
            const candidate = remainingPdf[index];
            if (candidate.used) continue;
            const score = similarity(token.accentless, candidate.accentless);
            if (score >= 0.68 && (!best || score > best.score)) best = { index, score };
        }

        if (best) {
            const candidate = remainingPdf[best.index];
            candidate.used = true;
            differences.push({
                type: 'spelling',
                severity: 'warning',
                description: `"${token.original}" changed to "${candidate.original}"`,
                docxValue: token.original,
                pdfValue: candidate.original,
            });
            wordDiffs.push({
                type: 'changed',
                docxText: token.original,
                pdfText: candidate.original,
                classification: { type: 'spelling', severity: 'warning' },
            });
        } else {
            differences.push({
                type: 'missing',
                severity: 'critical',
                description: `Word missing in PDF: "${token.original}"`,
                docxValue: token.original,
            });
            wordDiffs.push({ type: 'missing', text: token.original });
        }
    }

    for (const token of remainingPdf.filter((candidate) => !candidate.used)) {
        differences.push({
            type: 'extra',
            severity: 'warning',
            description: `Extra word in PDF: "${token.original}"`,
            pdfValue: token.original,
        });
        wordDiffs.push({ type: 'added', text: token.original });
    }

    return { differences, wordDiffs };
}

function isSectionPriceOwner(line: PreparedLine): boolean {
    const letters = line.text.replace(/[^\p{L}]+/gu, ' ').trim();
    return letters.length > 0 && letters === letters.toUpperCase() && line.matchTokens.length <= 3;
}

function appendStructuredDifferences(
    differences: Difference[],
    wordDiffs: WordDiff[],
    source: PreparedLine,
    targets: PreparedLine[],
    globalDocxPrices: Map<string, PreparedLine[]>,
    globalPdfPrices: Map<string, PreparedLine[]>,
): void {
    const targetAllergens = new Set(targets.flatMap((line) => line.allergens));
    const sourceAllergens = new Set(source.allergens);
    for (const code of sourceAllergens) {
        if (!targetAllergens.has(code)) {
            differences.push({
                type: 'allergen',
                severity: 'critical',
                description: `Allergen code missing in PDF: "${code}"`,
                docxValue: code,
            });
            wordDiffs.push({ type: 'missing', text: code });
        }
    }
    for (const code of targetAllergens) {
        if (!sourceAllergens.has(code)) {
            differences.push({
                type: 'allergen',
                severity: 'critical',
                description: `Allergen code added or changed in PDF: "${code}"`,
                pdfValue: code,
            });
            wordDiffs.push({ type: 'added', text: code });
        }
    }

    const targetPrices = new Set(targets.flatMap((line) => line.prices));
    const sourcePrices = new Set(source.prices);
    for (const price of sourcePrices) {
        const relocatedGroupPrice = isSectionPriceOwner(source) && (globalPdfPrices.get(price)?.length || 0) > 0;
        if (!targetPrices.has(price) && !relocatedGroupPrice) {
            differences.push({
                type: 'price',
                severity: 'critical',
                description: `Price missing or changed in PDF: "${price}"`,
                docxValue: price,
            });
        }
    }
    for (const price of targetPrices) {
        const sourceOwners = globalDocxPrices.get(price) || [];
        const inheritedGroupPrice = sourceOwners.some(isSectionPriceOwner) && (globalPdfPrices.get(price)?.length || 0) > 1;
        if (!sourcePrices.has(price) && !inheritedGroupPrice) {
            differences.push({
                type: 'price',
                severity: 'critical',
                description: `Price added or changed in PDF: "${price}"`,
                pdfValue: price,
            });
        }
    }
}

function groupPriceOwners(lines: PreparedLine[]): Map<string, PreparedLine[]> {
    const owners = new Map<string, PreparedLine[]>();
    for (const line of lines) {
        for (const price of line.prices) {
            owners.set(price, [...(owners.get(price) || []), line]);
        }
    }
    return owners;
}

function isInformationalPdfLine(line: PreparedLine): boolean {
    const normalized = stripAccents(line.text).toLowerCase();
    return /^by\s+chef\b/.test(normalized)
        || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(normalized)
        || /^(?:breakfast|brunch|lunch|dinner|menu)$/.test(normalized);
}

function isRelocatedPriceLine(line: PreparedLine, globalDocxPrices: Map<string, PreparedLine[]>): boolean {
    return isPriceOnly(line.text)
        && line.prices.length > 0
        && line.prices.every((price) => (globalDocxPrices.get(price)?.length || 0) > 0);
}

function layoutCoverage(expected: string[], actual: string[]): number {
    if (expected.length === 0) return 0;
    return countOverlap(expected, actual) / expected.length;
}

function fuzzyTokenCoverage(expected: string[], actual: string[]): number {
    if (expected.length === 0) return 0;
    const available = [...actual];
    let matched = 0;
    for (const token of expected) {
        const index = available.findIndex((candidate) => similarity(token, candidate) >= 0.82);
        if (index >= 0) {
            matched++;
            available.splice(index, 1);
        }
    }
    return matched / expected.length;
}

function lineAnchorTokens(value: string): string[] {
    const beforeDescription = value.includes(',') ? value.split(',', 1)[0] : value;
    const tokens = matchTokens(beforeDescription);
    return tokens.length > 4 ? tokens.slice(0, 4) : tokens;
}

function findRemovalEvidence(
    expectation: MarkedContentExpectation,
    pdfLines: PreparedLine[],
    alignments: AlignmentEntry[],
): { text: string; lineIndex?: number } | null {
    const scope = expectation.scope || 'fragment';
    if (scope === 'line') {
        const anchor = lineAnchorTokens(expectation.text);
        if (anchor.length === 0) return null;
        const matchedLine = pdfLines.find((line) => fuzzyTokenCoverage(anchor, line.matchTokens) >= 0.75);
        return matchedLine ? { text: matchedLine.text, lineIndex: matchedLine.index } : null;
    }

    const removalTokens = matchTokens(expectation.text);
    if (removalTokens.length === 0) return null;
    const activeText = normalizeExtractedText(expectation.active_text || '').trim().replace(/\s+/g, ' ');
    const sourceAlignment = alignments.find((alignment) =>
        alignment.type === 'match'
        && normalizeExtractedText(alignment.docxLine || '').trim().replace(/\s+/g, ' ') === activeText
    );
    if (sourceAlignment?.pdfLine) {
        const targetTokens = matchTokens(sourceAlignment.pdfLine);
        if (fuzzyTokenCoverage(removalTokens, targetTokens) >= 1) {
            return { text: sourceAlignment.pdfLine, lineIndex: sourceAlignment.pdfIdx };
        }
    }

    return null;
}

function applyMarkedContentIntent(
    differences: Difference[],
    alignments: AlignmentEntry[],
    docxLines: PreparedLine[],
    pdfLines: PreparedLine[],
    intent: DesignComparisonIntent,
): void {
    for (const expectation of intent.requiredContent || []) {
        const activeText = normalizeExtractedText(expectation.active_text || expectation.text).trim().replace(/\s+/g, ' ');
        const source = docxLines.find((line) => line.text === activeText);
        if (!source) continue;

        for (const difference of differences) {
            if (difference.docxLineNum !== source.index || difference.severity !== 'critical') continue;
            if (difference.type === 'missing') {
                difference.type = 'required_addition_missing';
                difference.description = expectation.scope === 'fragment'
                    ? `Yellow-highlighted required content is missing from the PDF: "${expectation.text}"`
                    : 'Yellow-highlighted required menu item is missing or incomplete in the PDF';
            }
        }
    }

    for (const expectation of intent.removedContent || []) {
        const evidence = findRemovalEvidence(expectation, pdfLines, alignments);
        if (!evidence) continue;

        // Replace the generic extra-content symptom with one explicit blocking
        // failure that describes the approved redline intent.
        for (const difference of differences) {
            const sameLine = evidence.lineIndex !== undefined && difference.pdfLineNum === evidence.lineIndex;
            const sameFragment = difference.type === 'extra'
                && difference.pdfValue
                && fuzzyTokenCoverage(matchTokens(expectation.text), matchTokens(difference.pdfValue)) >= 1;
            if (sameLine || sameFragment) difference.severity = 'info';
        }

        differences.push({
            type: 'removal_failed',
            severity: 'critical',
            description: expectation.scope === 'line'
                ? 'Red/struck menu item marked for removal is still present in the PDF'
                : `Red/struck content marked for removal is still present in the PDF: "${expectation.text}"`,
            docxValue: expectation.text,
            pdfValue: evidence.text,
            pdfLineNum: evidence.lineIndex,
        });
    }
}

function downgradeLayoutOnlyDifferences(
    differences: Difference[],
    docxLines: PreparedLine[],
    pdfLines: PreparedLine[],
): void {
    const allDocxTokens = docxLines.flatMap((line) => line.matchTokens);
    const allPdfTokens = pdfLines.flatMap((line) => line.matchTokens);
    const docxCounts = tokenCounts(allDocxTokens);
    const pdfCounts = tokenCounts(allPdfTokens);

    for (const difference of differences) {
        if (difference.severity === 'info') continue;

        if (difference.description === 'Line missing in PDF' && difference.docxLineNum !== undefined) {
            const source = docxLines.find((line) => line.index === difference.docxLineNum);
            if (source && layoutCoverage(source.matchTokens, allPdfTokens) >= 0.75) {
                difference.severity = 'info';
                difference.description = 'Source line is present elsewhere in the proof layout';
            }
            continue;
        }

        if (difference.description === 'Extra line in PDF' && difference.pdfLineNum !== undefined) {
            const target = pdfLines.find((line) => line.index === difference.pdfLineNum);
            if (target && layoutCoverage(target.matchTokens, allDocxTokens) >= 0.75) {
                difference.severity = 'info';
                difference.description = 'Proof line is present elsewhere in the source layout';
            }
            continue;
        }

        if (difference.type === 'missing' && difference.description.startsWith('Word missing') && difference.docxValue) {
            const token = normalizeMatchToken(collapseTrackedEditDuplicate(difference.docxValue));
            if ((docxCounts.get(token) || 0) <= (pdfCounts.get(token) || 0)) {
                difference.severity = 'info';
                difference.description = `Word appears elsewhere in the proof layout: "${difference.docxValue}"`;
            }
            continue;
        }

        if (difference.type === 'extra' && difference.description.startsWith('Extra word') && difference.pdfValue) {
            const token = normalizeMatchToken(collapseTrackedEditDuplicate(difference.pdfValue));
            if ((pdfCounts.get(token) || 0) <= (docxCounts.get(token) || 0)) {
                difference.severity = 'info';
                difference.description = `Word appears elsewhere in the source layout: "${difference.pdfValue}"`;
            }
        }
    }
}

export function compareMenuTexts(
    docxText: string,
    pdfText: string,
    intent: DesignComparisonIntent = {},
): { differences: Difference[]; alignments: AlignmentEntry[] } {
    const docxPrepared = prepareLines(docxText);
    const pdfPrepared = prepareLines(pdfText);
    const differences: Difference[] = [];
    const alignments: AlignmentEntry[] = [];
    const usedPdf = new Set<number>();
    const globalDocxPrices = groupPriceOwners(docxPrepared.lines);
    const globalPdfPrices = groupPriceOwners(pdfPrepared.lines);

    for (const source of docxPrepared.lines) {
        const selectedIndices = selectPdfLines(source, pdfPrepared.lines, usedPdf);
        if (selectedIndices.length === 0) {
            alignments.push({ type: 'docx_only', docxLine: source.text, docxIdx: source.index });
            differences.push({
                type: 'missing',
                severity: 'critical',
                description: 'Line missing in PDF',
                docxValue: source.text,
                docxLineNum: source.index,
            });
            continue;
        }

        selectedIndices.forEach((index) => usedPdf.add(index));
        const targets = selectedIndices.map((index) => pdfPrepared.lines[index]);
        const lexical = compareLexicalTokens(source, targets);
        appendStructuredDifferences(
            lexical.differences,
            lexical.wordDiffs,
            source,
            targets,
            globalDocxPrices,
            globalPdfPrices,
        );
        for (const difference of lexical.differences) {
            differences.push({
                ...difference,
                docxLineNum: source.index,
                pdfLineNum: targets[0]?.index,
            });
        }
        alignments.push({
            type: 'match',
            docxLine: source.text,
            pdfLine: targets.map((line) => line.text).join(' / '),
            docxIdx: source.index,
            pdfIdx: targets[0]?.index,
            wordDiffs: lexical.wordDiffs,
        });
    }

    for (let index = 0; index < pdfPrepared.lines.length; index++) {
        if (usedPdf.has(index)) continue;
        const line = pdfPrepared.lines[index];
        const informational = isInformationalPdfLine(line) || isRelocatedPriceLine(line, globalDocxPrices);
        alignments.push({ type: 'pdf_only', pdfLine: line.text, pdfIdx: line.index });
        differences.push({
            type: 'extra',
            severity: informational ? 'info' : 'warning',
            description: informational ? 'Proof metadata not present in source' : 'Extra line in PDF',
            pdfValue: line.text,
            pdfLineNum: line.index,
        });
    }

    for (const line of docxPrepared.excluded) {
        alignments.push({ type: 'docx_only', docxLine: line.text, docxIdx: line.index });
        differences.push({
            type: 'managed',
            severity: 'info',
            description: 'Managed footer or editorial note excluded from menu-content comparison',
            docxValue: line.text,
            docxLineNum: line.index,
        });
    }
    for (const line of pdfPrepared.excluded) {
        alignments.push({ type: 'pdf_only', pdfLine: line.text, pdfIdx: line.index });
        differences.push({
            type: 'managed',
            severity: 'info',
            description: 'Managed proof boilerplate excluded from menu-content comparison',
            pdfValue: line.text,
            pdfLineNum: line.index,
        });
    }

    downgradeLayoutOnlyDifferences(differences, docxPrepared.lines, pdfPrepared.lines);
    applyMarkedContentIntent(differences, alignments, docxPrepared.lines, pdfPrepared.lines, intent);

    return { differences, alignments };
}
