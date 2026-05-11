/**
 * When the model lists an objective spelling/grammar fix as a "high" confidence
 * suggestion but forgets to apply it in === CORRECTED MENU ===, merge it into the
 * corrected text so the chef UI matches the intended behavior.
 */

export type SuggestionForAutoApply = {
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
};

const AUTO_APPLY_TYPES = new Set([
    'spelling',
    'grammar',
    'diacritics',
    'redundant word',
    'singular/plural',
    'raw item',
]);

const SKIP_TYPES = new Set([
    'missing price',
    'incomplete dish name',
    'general',
    'allergen code',
    'formatting',
]);

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeConfidence(raw: string | undefined): string {
    return `${raw || ''}`.trim().toLowerCase();
}

function normalizeType(raw: string | undefined): string {
    return `${raw || ''}`.trim().toLowerCase();
}

function hasExactTokenOrPhrase(line: string, value: string): boolean {
    if (!value) return false;
    if (/^\w+$/.test(value)) {
        return new RegExp(`\\b${escapeRegExp(value)}\\b`).test(line);
    }
    return line.includes(value);
}

/**
 * Parse "Change 'a' to 'b'", `Change "a" to "b"`, or Replace 'a' with 'b' from recommendation text.
 */
export function extractChangePair(recommendation: string): { from: string; to: string } | null {
    const text = `${recommendation || ''}`.trim();
    if (!text) return null;

    const patterns: RegExp[] = [
        /change\s+['']([^'']+)['']\s+to\s+['']([^'']+)['']/i,
        /change\s+"([^"]+)"\s+to\s+"([^"]+)"/i,
        /replace\s+['']([^'']+)['']\s+with\s+['']([^'']+)['']/i,
        /replace\s+"([^"]+)"\s+with\s+"([^"]+)"/i,
    ];

    for (const re of patterns) {
        const m = text.match(re);
        if (m && m[1] !== undefined && m[2] !== undefined) {
            const from = m[1].trim();
            const to = m[2].trim();
            if (from && from !== to) {
                return { from, to };
            }
        }
    }
    return null;
}

function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(input: string): string {
    return stripDiacritics(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function applyReplacementOnLine(line: string, from: string, to: string): string | null {
    if (!hasExactTokenOrPhrase(line, from)) {
        return null;
    }
    if (/^\w+$/.test(from)) {
        const re = new RegExp(`\\b${escapeRegExp(from)}\\b`);
        return line.replace(re, to);
    }
    const idx = line.indexOf(from);
    if (idx === -1) return null;
    return line.slice(0, idx) + to + line.slice(idx + from.length);
}

function pickLineIndexForMenuItem(
    lines: string[],
    menuItem: string,
    from: string,
    to: string
): number | null {
    const itemNorm = normalizeForMatch(menuItem || '');
    const candidates: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (itemNorm && !normalizeForMatch(trimmed).includes(itemNorm)) {
            continue;
        }
        candidates.push(i);
    }
    if (candidates.length === 0) {
        return null;
    }
    const withToken = candidates.filter((i) => hasExactTokenOrPhrase(lines[i], from));
    if (withToken.length === 1) {
        return withToken[0];
    }
    if (withToken.length > 1) {
        return withToken[0];
    }
    const withReplacement = candidates.filter((i) => hasExactTokenOrPhrase(lines[i], to));
    if (withReplacement.length === 1) {
        return withReplacement[0];
    }
    if (candidates.length === 1) {
        return candidates[0];
    }
    return candidates.find((i) => hasExactTokenOrPhrase(lines[i], from)) ?? null;
}

function pickLineIndexForMenuItemOnly(lines: string[], menuItem: string): number | null {
    const itemNorm = normalizeForMatch(menuItem || '');
    if (!itemNorm) return null;

    const candidates: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (normalizeForMatch(trimmed).includes(itemNorm)) {
            candidates.push(i);
        }
    }

    return candidates[0] ?? null;
}

function hasLetters(input: string): boolean {
    return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(input);
}

function isObjectiveReplacementSuggestion(s: SuggestionForAutoApply, pair: { from: string; to: string }): boolean {
    if (!hasLetters(pair.from) && !hasLetters(pair.to)) {
        return false;
    }
    const combined = `${s.description || ''} ${s.recommendation || ''}`;
    return /spelling|misspell|typo|incorrect spelling|correct spelling|grammar|diacritic/i.test(combined);
}

function shouldAutoApply(s: SuggestionForAutoApply, pair: { from: string; to: string } | null): boolean {
    const t = normalizeType(s.type);
    if (SKIP_TYPES.has(t)) {
        return false;
    }
    if (s.severity === 'critical' && (t.includes('missing price') || t.includes('incomplete'))) {
        return false;
    }
    if (!AUTO_APPLY_TYPES.has(t)) {
        return false;
    }
    if (pair && !hasLetters(pair.from) && !hasLetters(pair.to)) {
        return false;
    }
    return normalizeConfidence(s.confidence) === 'high' || (!!pair && isObjectiveReplacementSuggestion(s, pair));
}

function lineAlreadyHasReplacement(line: string, from: string, to: string): boolean {
    return !hasExactTokenOrPhrase(line, from) && hasExactTokenOrPhrase(line, to);
}

function isRawAsteriskSuggestion(s: SuggestionForAutoApply): boolean {
    if (normalizeType(s.type) !== 'raw item') {
        return false;
    }
    const combined = `${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
    return normalizeConfidence(s.confidence) === 'high' && /asterisk|\*/.test(combined);
}

function applyRawAsteriskOnLine(line: string): string | null {
    const leadingWhitespace = line.match(/^\s*/)?.[0] || '';
    let working = line.trim();
    if (!working || working.includes('*')) {
        return null;
    }

    let trailingPrice = '';
    let trailingAllergens = '';

    const priceMatch = working.match(/\s+(\$?\d+(?:[.,]\d+)?(?:\s*\|\s*\$?\d+(?:[.,]\d+)?)?)\s*$/);
    if (priceMatch) {
        trailingPrice = priceMatch[1];
        working = working.slice(0, priceMatch.index).trim();
    }

    const allergenMatch = working.match(/\s+([A-Z]{1,3}(?:,[A-Z]{1,3})*)\s*$/);
    if (allergenMatch) {
        trailingAllergens = allergenMatch[1];
        working = working.slice(0, allergenMatch.index).trim();
    }

    return `${leadingWhitespace}${working} *${trailingAllergens ? ` ${trailingAllergens}` : ''}${trailingPrice ? ` ${trailingPrice}` : ''}`.trimEnd();
}

export function applyHighConfidenceSuggestionsToMenu(
    menuText: string,
    suggestions: SuggestionForAutoApply[]
): { menuText: string; suggestions: SuggestionForAutoApply[] } {
    if (!menuText || !Array.isArray(suggestions) || suggestions.length === 0) {
        return { menuText, suggestions: suggestions ? [...suggestions] : [] };
    }

    let lines = menuText.split('\n');
    const remaining: SuggestionForAutoApply[] = [];

    for (const s of suggestions) {
        if (isRawAsteriskSuggestion(s)) {
            const lineIdx = pickLineIndexForMenuItemOnly(lines, s.menuItem || '');
            if (lineIdx !== null) {
                const updated = applyRawAsteriskOnLine(lines[lineIdx]);
                if (updated !== null) {
                    lines = [...lines];
                    lines[lineIdx] = updated;
                    continue;
                }
            }
        }

        const pair = extractChangePair(s.recommendation || '');
        if (!shouldAutoApply(s, pair)) {
            remaining.push(s);
            continue;
        }
        if (!pair) {
            remaining.push(s);
            continue;
        }

        const lineIdx = pickLineIndexForMenuItem(lines, s.menuItem || '', pair.from, pair.to);
        if (lineIdx === null) {
            remaining.push(s);
            continue;
        }

        if (lineAlreadyHasReplacement(lines[lineIdx], pair.from, pair.to)) {
            continue;
        }

        const updated = applyReplacementOnLine(lines[lineIdx], pair.from, pair.to);
        if (updated === null) {
            remaining.push(s);
            continue;
        }

        lines = [...lines];
        lines[lineIdx] = updated;
    }

    return {
        menuText: lines.join('\n'),
        suggestions: remaining,
    };
}
