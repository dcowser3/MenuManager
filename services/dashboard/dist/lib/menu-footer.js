"use strict";
// Menu footer normalization: allergen legends, raw-undercooked notice, and
// price/welcome boilerplate detection. Extracted verbatim from services/dashboard/index.ts
// so the offline review pipeline (eval harness) shares the exact production behavior.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAW_NOTICE_PATTERN = exports.RAW_NOTICE_TEXT = exports.canonicalRawNoticeText = exports.DEFAULT_RAW_NOTICE_TEXT = void 0;
exports.isCanonicalRawNoticeLine = isCanonicalRawNoticeLine;
exports.isAnyRawNoticeLine = isAnyRawNoticeLine;
exports.menuNeedsRawNotice = menuNeedsRawNotice;
exports.ensureRawNoticeInMenu = ensureRawNoticeInMenu;
exports.readRawNoticeNotNeeded = readRawNoticeNotNeeded;
exports.containsAnyRawNotice = containsAnyRawNotice;
exports.containsCanonicalRawNotice = containsCanonicalRawNotice;
exports.isGenericMissingCanonicalRawNoticeFinding = isGenericMissingCanonicalRawNoticeFinding;
exports.normalizeWhitespace = normalizeWhitespace;
exports.isLikelyAllergenLegendLine = isLikelyAllergenLegendLine;
exports.isLikelyRawNoticeLine = isLikelyRawNoticeLine;
exports.parseParenthesizedAllergenLegend = parseParenthesizedAllergenLegend;
exports.isLikelyAllergenLegendHeader = isLikelyAllergenLegendHeader;
exports.extractAllergenLegendLine = extractAllergenLegendLine;
exports.normalizeAllergenLegend = normalizeAllergenLegend;
exports.normalizeMenuFooter = normalizeMenuFooter;
exports.stripManagedFooterText = stripManagedFooterText;
const tenant_config_1 = require("@menumanager/tenant-config");
exports.DEFAULT_RAW_NOTICE_TEXT = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';
const canonicalRawNoticeText = () => (0, tenant_config_1.getTenantConfig)().rulebook.rawNoticeText || exports.DEFAULT_RAW_NOTICE_TEXT;
exports.canonicalRawNoticeText = canonicalRawNoticeText;
exports.RAW_NOTICE_TEXT = exports.DEFAULT_RAW_NOTICE_TEXT;
exports.RAW_NOTICE_PATTERN = /\*?\s*consuming raw or undercooked meats,\s*poultry,\s*seafood(?:,\s*shellfish)?,\s*or eggs may increase your risk of foodborne illness\.?/i;
const normalizedNotice = (value) => (value || '').replace(/^\s*\*\s*/, '').replace(/[.!?\s]+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function isCanonicalRawNoticeLine(line) {
    const observed = normalizedNotice(line);
    const canonical = normalizedNotice((0, exports.canonicalRawNoticeText)());
    return !!observed && (observed === canonical || observed === canonical.replace(', shellfish', ''));
}
/**
 * Any foodborne-illness notice line, standard wording or a venue's own
 * ("Consuming raw or undercooked items may increase ... foodborne illness").
 * Only the standard wording is a managed footer (stripped from the AI's input,
 * see isLikelyRawNoticeLine); this broader test answers "is a notice already
 * there?", so a venue notice is never followed by a second, appended one.
 */
function isAnyRawNoticeLine(line) {
    if (isCanonicalRawNoticeLine(line))
        return true;
    const normalized = normalizeWhitespace(line).toLowerCase();
    return normalized.includes('raw or undercooked') && normalized.includes('foodborne illness');
}
// Preparations that are always raw or undercooked. Word-bounded (the old
// substring check matched "raw" inside "strawberry"), and deliberately narrow:
// plain "raw" ("raw honey") and "rare" ("rare bourbon") are not dishes. The raw
// marker (*) is the main signal; pre-AI rules add it to clear raw dishes.
const RAW_ITEM_TERMS = /\b(?:undercooked|tartare|carpaccio|crudo|sashimi|tiradito|medium[-\s]rare)\b/i;
/**
 * Does this menu need the foodborne-illness notice? Yes when any dish line
 * carries a raw marker (*) or names a raw preparation. The notice line itself
 * and other footer lines never count.
 */
function menuNeedsRawNotice(text) {
    return `${text || ''}`.split('\n').some((line) => {
        const trimmed = line.trim();
        if (!trimmed || isAnyRawNoticeLine(trimmed))
            return false;
        return trimmed.includes('*') || RAW_ITEM_TERMS.test(trimmed);
    });
}
/**
 * The notice is owned by code and kept visible in the menu text. The review
 * strips it from what the AI sees; this puts it back on the returned menu:
 * the chef's own notice line if they had one, otherwise the standard notice
 * when the menu needs it and the chef has not said it does not.
 */
function ensureRawNoticeInMenu(menuText, submittedText, options = {}) {
    const menu = `${menuText || ''}`.replace(/\s+$/, '');
    if (containsAnyRawNotice(menu))
        return { text: menu, added: false };
    const submittedNotice = `${submittedText || ''}`.split('\n').map((line) => line.trim()).find((line) => isAnyRawNoticeLine(line));
    if (submittedNotice)
        return { text: `${menu}\n\n${submittedNotice}`, added: false };
    if (options.notNeeded || !menuNeedsRawNotice(menu))
        return { text: menu, added: false };
    return { text: `${menu}\n\n${(0, exports.canonicalRawNoticeText)()}`, added: true };
}
/**
 * The chef's "this menu doesn't need the raw/undercooked notice" choice, read from
 * a form body (or its stored copy). suppressRawNotice is the older name for it.
 */
function readRawNoticeNotNeeded(formBody) {
    let body = formBody;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        }
        catch {
            body = null;
        }
    }
    if (!body || typeof body !== 'object')
        return false;
    return `${body.rawNoticeNotNeeded}` === 'true' || `${body.suppressRawNotice}` === 'true';
}
function containsAnyRawNotice(value) {
    return `${value || ''}`.split(/[|\n]/).some((segment) => isAnyRawNoticeLine(segment));
}
function containsCanonicalRawNotice(value) {
    return (value || '').split(/[|\n]/).some(segment => isCanonicalRawNoticeLine(segment));
}
function isGenericMissingCanonicalRawNoticeFinding(suggestion) {
    const type = `${suggestion?.type || ''}`.trim().toLowerCase();
    const item = `${suggestion?.menuItem || ''}`.trim().toLowerCase();
    const combined = `${type} ${suggestion?.description || ''} ${suggestion?.recommendation || ''}`.trim().toLowerCase();
    const wholeMenu = !item || /^(entire menu|whole menu|menu|general)$/.test(item);
    const rawFoodDomain = /\b(raw|undercooked|foodborne|raw[-\s]?food|raw[-\s]?consumption)\b/.test(combined);
    // Models word the same finding many ways ("warning", "notice", "advisory",
    // "footer", "disclaimer", "statement"); matching only two of them let a managed
    // notice still raise a critical (incident Tan CRS DDLM Event, 2026-10-13).
    const noticeNoun = '(warning|notice|advisory|footer|disclaimer|disclosure|statement|language)';
    const genericWarning = new RegExp(`(standard|canonical|required|foodborne|raw or undercooked).*${noticeNoun}`).test(combined)
        || new RegExp(`${noticeNoun}.*(standard|canonical|required|foodborne|raw or undercooked)`).test(combined);
    const missing = /\b(missing|absent|add|include)\b/.test(combined);
    const dishSpecific = /(marker|asterisk|dish|item|steak|tartare|specific)/.test(combined);
    const quotedOrNegated = /\b(todo|quoted|quote|not missing|already present|do not add|don't add)\b/.test(combined);
    return wholeMenu && rawFoodDomain && genericWarning && missing && !dishSpecific && !quotedOrNegated;
}
function normalizeWhitespace(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}
function isLikelyAllergenLegendLine(line) {
    const normalized = normalizeWhitespace(line);
    if (!normalized || !normalized.includes('|'))
        return false;
    const parts = normalized.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3)
        return false;
    const codeParts = parts.filter((part) => /^\*?[A-Z]{1,3}\s+.+/.test(part));
    return codeParts.length >= Math.max(2, Math.floor(parts.length * 0.6));
}
function isLikelyRawNoticeLine(line) {
    return isCanonicalRawNoticeLine(line);
}
function parseParenthesizedAllergenLegend(line) {
    const normalized = normalizeWhitespace(line);
    if (!normalized || !normalized.includes('(') || !normalized.includes(')'))
        return '';
    const footerBody = normalized.split(/\b(?:ALL\s+PRICES|WE\s+WELCOME|CONSUMPTION\s+OF\s+RAW|CONSUMING\s+RAW|FOODBORNE\s+ILLNESS)\b/i)[0];
    const pattern = /\(\s*([A-Za-z]{1,3})\s*\)\s*([A-Za-z][A-Za-z\s/&-]*?)(?=\s*\(\s*[A-Za-z]{1,3}\s*\)|$)/g;
    const pairs = [];
    let match;
    while ((match = pattern.exec(footerBody)) !== null) {
        const code = match[1].toUpperCase();
        const label = normalizeWhitespace(match[2]).toLowerCase();
        if (label) {
            pairs.push({ code, label });
        }
    }
    if (pairs.length < 4)
        return '';
    const keywordHits = pairs.filter(({ label }) => /(allergen|gluten|dairy|fish|nuts?|egg|vegan|vegetarian|crustacean|soy|sesame|celery|mustard|shellfish|sulphites?|lupin)/i.test(label)).length;
    if (keywordHits < 2)
        return '';
    return pairs.map(({ code, label }) => `${code} ${label}`).join(' | ');
}
function isLikelyAllergenLegendHeader(line) {
    return /^allergen\s+key(?:\s+\(optional\))?$/i.test(normalizeWhitespace(line));
}
function extractAllergenLegendLine(line) {
    if (isLikelyAllergenLegendLine(line)) {
        return normalizeAllergenLegend(line);
    }
    return parseParenthesizedAllergenLegend(line);
}
function normalizeAllergenLegend(text) {
    const normalized = (text || '').trim();
    if (!normalized)
        return '';
    const lines = normalized
        .split('\n')
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);
    if (lines.length === 1 && lines[0].includes('|')) {
        return lines[0]
            .split('|')
            .map((part) => normalizeWhitespace(part))
            .filter(Boolean)
            .join(' | ');
    }
    return lines.join(' | ');
}
function normalizeMenuFooter(text, fallbackAllergens = '') {
    const lines = (text || '').split('\n').map((line) => line.trim());
    const menuLines = [];
    let allergenLines = [];
    const preservedFooterLines = [];
    let hadRawNotice = false;
    let inFooter = false;
    for (const line of lines) {
        const allergenLine = extractAllergenLegendLine(line);
        const isHeader = isLikelyAllergenLegendHeader(line);
        const isRawNotice = isCanonicalRawNoticeLine(line);
        const isPriceFooter = /^all\s+prices\b/i.test(normalizeWhitespace(line));
        const isWelcomeFooter = /^we\s+welcome\s+enquiries\b/i.test(normalizeWhitespace(line));
        if (allergenLine || isHeader) {
            inFooter = true;
            if (allergenLine)
                allergenLines.push(allergenLine);
            continue;
        }
        if (isRawNotice)
            hadRawNotice = true;
        if (inFooter || isPriceFooter || isWelcomeFooter || isRawNotice) {
            if (line)
                preservedFooterLines.push(line);
            continue;
        }
        menuLines.push(line);
    }
    while (menuLines.length && menuLines[0] === '')
        menuLines.shift();
    while (menuLines.length && menuLines[menuLines.length - 1] === '')
        menuLines.pop();
    const collapsed = [];
    let prevEmpty = false;
    for (const line of menuLines) {
        if (!line) {
            if (!prevEmpty)
                collapsed.push('');
            prevEmpty = true;
        }
        else {
            collapsed.push(line);
            prevEmpty = false;
        }
    }
    const extractedAllergenLine = allergenLines.join(' | ');
    return {
        body: collapsed.join('\n'),
        normalizedAllergenLine: normalizeAllergenLegend(extractedAllergenLine || fallbackAllergens),
        hadRawNotice,
        preservedFooterText: preservedFooterLines.join('\n'),
    };
}
function stripManagedFooterText(text, fallbackAllergens = '') {
    return normalizeMenuFooter(text, fallbackAllergens).body;
}
