"use strict";
/**
 * When the model lists an objective spelling/grammar fix as a "high" confidence
 * suggestion but forgets to apply it in === CORRECTED MENU ===, merge it into the
 * corrected text so the chef UI matches the intended behavior.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractChangePair = extractChangePair;
exports.applyHighConfidenceSuggestionsToMenu = applyHighConfidenceSuggestionsToMenu;
const AUTO_APPLY_TYPES = new Set([
    'spelling',
    'grammar',
    'diacritics',
    'redundant word',
    'singular/plural',
]);
const SKIP_TYPES = new Set([
    'missing price',
    'incomplete dish name',
    'general',
    'raw item',
    'allergen code',
    'formatting',
]);
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizeConfidence(raw) {
    return `${raw || ''}`.trim().toLowerCase();
}
function normalizeType(raw) {
    return `${raw || ''}`.trim().toLowerCase();
}
/**
 * Parse "Change 'a' to 'b'", `Change "a" to "b"`, or Replace 'a' with 'b' from recommendation text.
 */
function extractChangePair(recommendation) {
    const text = `${recommendation || ''}`.trim();
    if (!text)
        return null;
    const patterns = [
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
function stripDiacritics(input) {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeForMatch(input) {
    return stripDiacritics(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function applyReplacementOnLine(line, from, to) {
    if (!line.includes(from)) {
        return null;
    }
    if (/^\w+$/.test(from)) {
        const re = new RegExp(`\\b${escapeRegExp(from)}\\b`);
        if (!re.test(line)) {
            return null;
        }
        return line.replace(re, to);
    }
    const idx = line.indexOf(from);
    if (idx === -1)
        return null;
    return line.slice(0, idx) + to + line.slice(idx + from.length);
}
function pickLineIndexForMenuItem(lines, menuItem, from) {
    const itemNorm = normalizeForMatch(menuItem || '');
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed)
            continue;
        if (itemNorm && !normalizeForMatch(trimmed).includes(itemNorm)) {
            continue;
        }
        candidates.push(i);
    }
    if (candidates.length === 0) {
        return null;
    }
    const withToken = candidates.filter((i) => lines[i].includes(from));
    if (withToken.length === 1) {
        return withToken[0];
    }
    if (withToken.length > 1) {
        return withToken[0];
    }
    if (candidates.length === 1) {
        return candidates[0];
    }
    return candidates.find((i) => lines[i].includes(from)) ?? null;
}
function shouldAutoApply(s) {
    if (normalizeConfidence(s.confidence) !== 'high') {
        return false;
    }
    const t = normalizeType(s.type);
    if (SKIP_TYPES.has(t)) {
        return false;
    }
    if (s.severity === 'critical' && (t.includes('missing price') || t.includes('incomplete'))) {
        return false;
    }
    return AUTO_APPLY_TYPES.has(t);
}
function applyHighConfidenceSuggestionsToMenu(menuText, suggestions) {
    if (!menuText || !Array.isArray(suggestions) || suggestions.length === 0) {
        return { menuText, suggestions: suggestions ? [...suggestions] : [] };
    }
    let lines = menuText.split('\n');
    const remaining = [];
    for (const s of suggestions) {
        if (!shouldAutoApply(s)) {
            remaining.push(s);
            continue;
        }
        const pair = extractChangePair(s.recommendation || '');
        if (!pair) {
            remaining.push(s);
            continue;
        }
        const lineIdx = pickLineIndexForMenuItem(lines, s.menuItem || '', pair.from);
        if (lineIdx === null) {
            remaining.push(s);
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
