// Text-driven pricing layout: which lines of a menu are governed by a single
// package price (prix fixe / bottomless / "includes N courses") and which are
// priced dish by dish (a la carte). The Menu Type dropdown is only a hint;
// this module reads the menu itself so mixed menus and mislabeled submissions
// are reviewed by what they actually contain.

export type PricingSectionKind = 'prix_fixe' | 'a_la_carte';

export type PricingRegion = {
    kind: PricingSectionKind;
    /** Inclusive, 0-based indexes into menuText.split('\n'). */
    startLine: number;
    endLine: number;
    /** Line that opened the region (package header); null for an implicit whole-menu region. */
    headerLine: string | null;
    /** True when the header came from the menu text rather than the dropdown alone. */
    detected: boolean;
};

export type PricingLayout = {
    regions: PricingRegion[];
    prixFixeRegions: PricingRegion[];
    hasPrixFixe: boolean;
    hasALaCarte: boolean;
    /** Dropdown said one thing but the text says another. */
    mismatch: 'standard_has_prix_fixe' | 'prix_fixe_has_a_la_carte' | null;
};

const PACKAGE_HEADER_PATTERNS: RegExp[] = [
    /\bprix\s*fixe\b/i,
    /\bpre-?\s?fix(?:e)?\b/i,
    /\btasting\s+menu\b/i,
    /\b(?:two|three|four|five|six|seven|\d+)[\s-]+course\b/i,
    /\bincludes\s+(?:\w+\s+)?courses?\b/i,
    /\bbottomless\b/i,
];

// Weaker signals: only trusted when the submitter said prix fixe / combined,
// so a lone "95 pp" tasting add-on inside a standard menu doesn't swallow the
// dishes that follow it.
const WEAK_PACKAGE_HEADER_PATTERNS: RegExp[] = [
    /\bendless\b.*\b(?:\$?\d{2,4})\b/i,
    /\b\d{2,4}(?:\.\d{1,2})?\s*(?:pp|p\.p\.|per\s+(?:person|guest))\b/i,
];

const A_LA_CARTE_HEADING = /^(?:[-–—=_*\s]{5,}|a\s*la\s*carte|à\s*la\s*carte|regular\s+menu|enhancements?|table\s+enhancements?|add[-\s]?ons?|beverages?|drinks?|cocktails?|wines?|beers?|spirits|libations|bebidas|happy\s+hour)\s*$/i;

const FOOTER_START = /^(?:allergen key|[a-z]{1,3}\s+contains\b|\*?\s*consuming raw|all prices)/i;

function norm(line: string): string {
    return `${line || ''}`.replace(/\s+/g, ' ').trim();
}

function wordCount(line: string): number {
    return norm(line).split(' ').filter(Boolean).length;
}

function looksLikeDishLine(line: string): boolean {
    // Dish rows are "Name, ingredient, ingredient ...". Package headers are short labels.
    return (norm(line).match(/,/g) || []).length >= 2;
}

/** A line that opens a package-priced region (not a dish, not a long sentence). */
export function isPackageHeaderLine(line: string, allowWeakSignals = true): boolean {
    const text = norm(line);
    if (!text || looksLikeDishLine(text)) return false;
    const patterns = allowWeakSignals ? [...PACKAGE_HEADER_PATTERNS, ...WEAK_PACKAGE_HEADER_PATTERNS] : PACKAGE_HEADER_PATTERNS;
    if (!patterns.some((pattern) => pattern.test(text))) return false;
    // Explanatory sentences ("Bottomless Brunch includes all Specialty items, and must ...")
    // are not headers unless they are short or carry a per-person price.
    const hasPerPersonPrice = /\b\d{2,4}(?:\.\d{1,2})?\s*(?:pp|p\.p\.|per\s+(?:person|guest))\b/i.test(text);
    return hasPerPersonPrice || wordCount(text) <= 12;
}

function isALaCarteBoundary(line: string): boolean {
    return A_LA_CARTE_HEADING.test(norm(line));
}

const TRAILING_DISH_PRICE = /[A-Za-z)*]\s+[$€£]?\d{1,3}(?:\.\d{1,2})?\s*$/;

// A stray title line ("Endless Bubbles & Brunch") is not an a la carte section.
function isSubstantialALaCarte(lines: string[], region: PricingRegion): boolean {
    if (region.kind !== 'a_la_carte') return false;
    return lines.slice(region.startLine, region.endLine + 1).some((l) => norm(l) && !isALaCarteBoundary(l) && (TRAILING_DISH_PRICE.test(norm(l)) || looksLikeDishLine(l)));
}

export function analyzePricingLayout(menuText: string, menuType?: string): PricingLayout {
    const lines = `${menuText || ''}`.split('\n');
    const allowWeak = menuType === 'prix_fixe' || menuType === 'combined';
    let lastContent = lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
        if (FOOTER_START.test(norm(lines[i])) && norm(lines[i])) { lastContent = i - 1; break; }
    }
    while (lastContent > 0 && !norm(lines[lastContent])) lastContent--;

    const regions: PricingRegion[] = [];
    let open: PricingRegion | null = null;
    let carteStart: number | null = null;

    const closeCarte = (endLine: number) => {
        if (carteStart !== null && endLine >= carteStart) {
            regions.push({ kind: 'a_la_carte', startLine: carteStart, endLine, headerLine: null, detected: true });
        }
        carteStart = null;
    };
    const closePrix = (endLine: number) => {
        if (open) { open.endLine = Math.max(open.startLine, endLine); regions.push(open); open = null; }
    };

    for (let i = 0; i <= lastContent; i++) {
        const line = lines[i];
        if (!norm(line)) continue;
        if (isPackageHeaderLine(line, allowWeak)) {
            if (!open) {
                closeCarte(i - 1);
                open = { kind: 'prix_fixe', startLine: i, endLine: i, headerLine: norm(line), detected: true };
            }
            continue;
        }
        if (isALaCarteBoundary(line)) {
            if (open) closePrix(i - 1);
            if (carteStart === null) carteStart = i;
            continue;
        }
        if (!open && carteStart === null) carteStart = i;
    }
    if (open) closePrix(lastContent);
    closeCarte(lastContent);

    regions.sort((a, b) => a.startLine - b.startLine);
    let prixFixeRegions = regions.filter((region) => region.kind === 'prix_fixe');

    // Dropdown says the whole menu is prix fixe and no package header was found:
    // trust it, and treat everything as one prix fixe region.
    if (menuType === 'prix_fixe' && prixFixeRegions.length === 0) {
        const whole: PricingRegion = { kind: 'prix_fixe', startLine: 0, endLine: Math.max(0, lastContent), headerLine: null, detected: false };
        return { regions: [whole], prixFixeRegions: [whole], hasPrixFixe: true, hasALaCarte: false, mismatch: null };
    }

    const hasALaCarte = regions.some((region) => isSubstantialALaCarte(lines, region));
    const hasPrixFixe = prixFixeRegions.length > 0;
    let mismatch: PricingLayout['mismatch'] = null;
    if (menuType === 'standard' && hasPrixFixe) mismatch = 'standard_has_prix_fixe';
    if (menuType === 'prix_fixe' && hasALaCarte && hasPrixFixe) mismatch = 'prix_fixe_has_a_la_carte';
    return { regions, prixFixeRegions, hasPrixFixe, hasALaCarte, mismatch };
}

export function regionText(menuText: string, region: PricingRegion): string {
    return `${menuText || ''}`.split('\n').slice(region.startLine, region.endLine + 1).join('\n');
}

export function lineIndexInPrixFixeRegion(layout: PricingLayout, lineIndex: number): boolean {
    return layout.prixFixeRegions.some((region) => lineIndex >= region.startLine && lineIndex <= region.endLine);
}

function normalizeForMatch(input: string): string {
    return `${input || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Finds the menu line a suggestion's menuItem refers to; -1 when it cannot be located. */
export function findLineIndexForMenuItem(menuText: string, menuItem: string): number {
    const target = normalizeForMatch(menuItem);
    if (!target) return -1;
    const lines = `${menuText || ''}`.split('\n');
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
        const candidate = normalizeForMatch(lines[i]);
        if (!candidate) continue;
        if (candidate === target || candidate.startsWith(target) || target.startsWith(candidate) && candidate.split(' ').length >= 2) return i;
        if (best === -1 && candidate.includes(target)) best = i;
    }
    return best;
}

/** Human-readable layout for the AI prompt (1-based line numbers). Empty when there is nothing to say. */
export function renderPricingLayoutForPrompt(menuText: string, layout: PricingLayout, menuType?: string): string {
    if (!layout.prixFixeRegions.some((region) => region.detected)) return '';
    const lines = `${menuText || ''}`.split('\n');
    const parts = layout.regions.map((region) => {
        const range = `lines ${region.startLine + 1}-${region.endLine + 1}`;
        if (region.kind === 'prix_fixe') {
            const header = region.headerLine ? ` (package header: "${region.headerLine}")` : '';
            return `- ${range}${header}: PRIX FIXE / PACKAGE section. It is priced by the package price in its header (PP/pp means per person). Dishes here do NOT need individual prices. Do NOT flag Missing Price on them.`;
        }
        if (!isSubstantialALaCarte(lines, region)) return '';
        const first = norm(lines.slice(region.startLine, region.endLine + 1).find((l) => norm(l) && !isALaCarteBoundary(l)) || '');
        return `- ${range}${first ? ` (starts "${first.slice(0, 50)}")` : ''}: A LA CARTE section. Every dish here needs its own price. Flag Missing Price normally.`;
    });
    const declared = menuType === 'combined'
        ? 'The submitter declared this a COMBINED menu (a la carte plus a prix fixe section).'
        : `The submitter selected menu type "${menuType || 'unspecified'}", but the menu text was analyzed and contains package-priced sections.`;
    return `**PRICING SECTIONS (detected from the menu text):**\n${declared} Apply pricing rules per section:\n${parts.filter(Boolean).join('\n')}\nEach prix fixe section needs a clearly labeled package price in or right under its header; numbered courses are only expected when the section is laid out as courses.`;
}
