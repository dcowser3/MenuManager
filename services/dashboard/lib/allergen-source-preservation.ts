/** Preserve chef-authored allergen semantics across model and delivery lanes. */

import { splitTrailingPrice } from './pre-ai-deterministic-rules';

export type AllergenPreservationResult = {
    menuText: string;
    diagnostics: string[];
    restoredRows: number;
};

const normalizeRow = (value: string): string => `${value || ''}`.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();

function configuredCodes(legend: string): Set<string> {
    const codes = new Set<string>();
    for (const segment of `${legend || ''}`.split(/[|\n]/)) {
        const match = segment.trim().match(/^([A-Za-z]{1,3})\b/);
        if (match?.[1]) codes.add(match[1].toUpperCase());
    }
    return codes;
}

function extractCodes(line: string, validCodes: Set<string>): { codes: string[]; body: string; price: string } {
    const priced = splitTrailingPrice(line);
    const match = priced.body.match(/(?:^|\s)(\*?[A-Z]{1,3}(?:\s*,\s*\*?[A-Z]{1,3})*)\s*$/);
    if (!match || match.index === undefined) return { codes: [], body: priced.body, price: priced.price };
    const codes = match[1].split(/\s*,\s*/).map(code => code.replace(/^\*/, '').toUpperCase());
    if (!codes.length || codes.some(code => !validCodes.has(code))) return { codes: [], body: priced.body, price: priced.price };
    return { codes, body: priced.body.slice(0, match.index).trimEnd(), price: priced.price };
}

function renderWithCodes(line: string, codes: string[], validCodes: Set<string>): string {
    const priced = splitTrailingPrice(line);
    const current = extractCodes(line, validCodes);
    return `${current.body.trimEnd()}${codes.length ? ` ${codes.join(',')}` : ''}${priced.price}`.trimEnd();
}

function editDistance(left: string, right: string): number {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let diagonal = row[0]; row[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[right.length];
}

function rowEvidence(source: string, candidate: string): { score: number; matched: number } {
    const sourceTokens = normalizeRow(source).split(' ').filter(Boolean);
    const candidateTokens = normalizeRow(candidate).split(' ').filter(Boolean);
    const available = [...candidateTokens]; let matched = 0;
    for (const token of sourceTokens) {
        const index = available.findIndex(other => other === token
            || editDistance(token, other) <= Math.max(1, Math.floor(Math.min(token.length, other.length) * 0.4)));
        if (index >= 0) { matched += 1; available.splice(index, 1); }
    }
    return { matched, score: matched / Math.max(sourceTokens.length, candidateTokens.length, 1) };
}

export function preserveSubmittedAllergenCodes(submittedMenu: string, candidateMenu: string, allergenLegend: string): AllergenPreservationResult {
    const validCodes = configuredCodes(allergenLegend);
    if (!validCodes.size || !submittedMenu || !candidateMenu) return { menuText: candidateMenu, diagnostics: [], restoredRows: 0 };
    const sourceRows = submittedMenu.split('\n').map((line, index) => ({ index, parsed: extractCodes(line, validCodes) }));
    const candidateLines = candidateMenu.split('\n');
    const used = new Set<number>(); const diagnostics: string[] = []; let restoredRows = 0;
    for (const source of sourceRows) {
        const candidates = candidateLines.map((line, index) => ({ line, index, parsed: extractCodes(line, validCodes) }))
            .filter(item => !used.has(item.index));
        const exact = candidates.filter(item => normalizeRow(item.parsed.body) === normalizeRow(source.parsed.body));
        let matches = exact;
        if (matches.length !== 1) {
            const fuzzy = candidates.map(item => ({ ...item, ...rowEvidence(source.parsed.body, item.parsed.body) }))
                .filter(item => item.score >= 0.75 || (item.matched >= 2 && item.score >= 0.6))
                .sort((a, b) => b.score - a.score || b.matched - a.matched);
            const best = fuzzy[0]; const tied = best && fuzzy.filter(item => best.score - item.score < 0.05);
            matches = best && tied?.length === 1 ? [best] : [];
        }
        if (source.parsed.codes.length > 0 && matches.length !== 1) {
            return { menuText: submittedMenu, diagnostics: [...diagnostics, `allergen_row_mapping_ambiguous:${source.index}`, `duplicate_row_fallback:${source.index}`], restoredRows: 0 };
        }
        if (matches.length !== 1) continue;
        const target = matches[0]; used.add(target.index);
        if (source.parsed.codes.length !== target.parsed.codes.length || source.parsed.codes.some(code => !target.parsed.codes.includes(code))) {
            candidateLines[target.index] = renderWithCodes(target.line, source.parsed.codes, validCodes);
            restoredRows += 1;
            diagnostics.push(`${source.parsed.codes.length ? 'submitted_allergen_codes_preserved' : 'model_allergen_codes_removed'}:${source.index}`);
        }
    }
    candidateLines.forEach((line, index) => {
        if (used.has(index)) return;
        const parsed = extractCodes(line, validCodes);
        if (!parsed.codes.length) return;
        candidateLines[index] = renderWithCodes(line, [], validCodes);
        restoredRows += 1; diagnostics.push(`model_allergen_codes_removed:unmatched:${index}`);
    });
    return { menuText: candidateLines.join('\n'), diagnostics, restoredRows };
}
