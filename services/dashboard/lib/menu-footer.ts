// Menu footer normalization: allergen legends, raw-undercooked notice, and
// price/welcome boilerplate detection. Extracted verbatim from services/dashboard/index.ts
// so the offline review pipeline (eval harness) shares the exact production behavior.

export const RAW_NOTICE_TEXT = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';
export const RAW_NOTICE_PATTERN = /\*?\s*consuming raw or undercooked meats,\s*poultry,\s*seafood(?:,\s*shellfish)?,\s*or eggs may increase your risk of foodborne illness\.?/i;

export type MenuFooterMetadata = {
    body: string;
    normalizedAllergenLine: string;
    hadRawNotice: boolean;
    preservedFooterText: string;
};

export function normalizeWhitespace(value: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

export function isLikelyAllergenLegendLine(line: string): boolean {
    const normalized = normalizeWhitespace(line);
    if (!normalized || !normalized.includes('|')) return false;
    const parts = normalized.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return false;
    const codeParts = parts.filter((part) => /^\*?[A-Z]{1,3}\s+.+/.test(part));
    return codeParts.length >= Math.max(2, Math.floor(parts.length * 0.6));
}

export function isLikelyRawNoticeLine(line: string): boolean {
    const normalized = normalizeWhitespace(line).toLowerCase();
    if (!normalized) return false;
    return normalized.includes('raw or undercooked') && normalized.includes('foodborne illness');
}

export function parseParenthesizedAllergenLegend(line: string): string {
    const normalized = normalizeWhitespace(line);
    if (!normalized || !normalized.includes('(') || !normalized.includes(')')) return '';

    const footerBody = normalized.split(
        /\b(?:ALL\s+PRICES|WE\s+WELCOME|CONSUMPTION\s+OF\s+RAW|CONSUMING\s+RAW|FOODBORNE\s+ILLNESS)\b/i
    )[0];

    const pattern = /\(\s*([A-Za-z]{1,3})\s*\)\s*([A-Za-z][A-Za-z\s/&-]*?)(?=\s*\(\s*[A-Za-z]{1,3}\s*\)|$)/g;
    const pairs: Array<{ code: string; label: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(footerBody)) !== null) {
        const code = match[1].toUpperCase();
        const label = normalizeWhitespace(match[2]).toLowerCase();
        if (label) {
            pairs.push({ code, label });
        }
    }

    if (pairs.length < 4) return '';
    const keywordHits = pairs.filter(({ label }) =>
        /(allergen|gluten|dairy|fish|nuts?|egg|vegan|vegetarian|crustacean|soy|sesame|celery|mustard|shellfish|sulphites?|lupin)/i.test(label)
    ).length;
    if (keywordHits < 2) return '';

    return pairs.map(({ code, label }) => `${code} ${label}`).join(' | ');
}

export function isLikelyAllergenLegendHeader(line: string): boolean {
    return /^allergen\s+key(?:\s+\(optional\))?$/i.test(normalizeWhitespace(line));
}

export function extractAllergenLegendLine(line: string): string {
    if (isLikelyAllergenLegendLine(line)) {
        return normalizeAllergenLegend(line);
    }
    return parseParenthesizedAllergenLegend(line);
}

export function normalizeAllergenLegend(text: string): string {
    const normalized = (text || '').trim();
    if (!normalized) return '';

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

export function normalizeMenuFooter(text: string, fallbackAllergens = ''): MenuFooterMetadata {
    const lines = (text || '').split('\n').map((line) => line.trim());
    const menuLines: string[] = [];
    let allergenLines: string[] = [];
    const preservedFooterLines: string[] = [];
    let hadRawNotice = false;
    let inFooter = false;

    for (const line of lines) {
        const allergenLine = extractAllergenLegendLine(line);
        const isHeader = isLikelyAllergenLegendHeader(line);
        const isRawNotice = isLikelyRawNoticeLine(line);
        const isPriceFooter = /^all\s+prices\b/i.test(normalizeWhitespace(line));
        const isWelcomeFooter = /^we\s+welcome\s+enquiries\b/i.test(normalizeWhitespace(line));

        if (allergenLine || isHeader) {
            inFooter = true;
            if (allergenLine) allergenLines.push(allergenLine);
            continue;
        }

        if (isRawNotice) hadRawNotice = true;

        if (inFooter || isPriceFooter || isWelcomeFooter || isRawNotice) {
            if (line) preservedFooterLines.push(line);
            continue;
        }

        menuLines.push(line);
    }

    while (menuLines.length && menuLines[0] === '') menuLines.shift();
    while (menuLines.length && menuLines[menuLines.length - 1] === '') menuLines.pop();

    const collapsed: string[] = [];
    let prevEmpty = false;
    for (const line of menuLines) {
        if (!line) {
            if (!prevEmpty) collapsed.push('');
            prevEmpty = true;
        } else {
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

export function stripManagedFooterText(text: string, fallbackAllergens = ''): string {
    return normalizeMenuFooter(text, fallbackAllergens).body;
}
