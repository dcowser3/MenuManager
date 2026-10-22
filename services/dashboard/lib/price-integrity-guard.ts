import { CURRENCY_CODES, isBareYearPrice, matchTrailingPrice, priceNumbers } from './price-shapes';

export type PriceIntegritySuggestion = {
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
};

export type PriceIntegrityGuardChange = {
    lineIndex: number;
    reason: 'added_price' | 'changed_price';
    menuItem: string;
    originalLine: string;
    correctedLine: string;
    guardedLine: string;
    originalPrice: string | null;
    correctedPrice: string;
};

export type PriceIntegrityGuardResult = {
    correctedMenu: string;
    suggestions: PriceIntegritySuggestion[];
    changes: PriceIntegrityGuardChange[];
};

type TrailingPriceMatch = {
    price: string;
    normalizedPrice: string;
    lineWithoutPrice: string;
};

// Unparsed numeric tail on a submitted line ("Clarita-80/345", "Mercado -76/326").
// A leading apostrophe keeps a two-digit vintage intact ("'99").
const SUBMITTED_NUMERIC_TAIL_RE = /['\u2019]?[$\u20ac\u00a3]?\d[\d.,/|\s\u2013-]*\*?\s*$/u;

const CURRENCY_CODE_RE = new RegExp(`${CURRENCY_CODES.join('|')}`, 'gi');

function normalizePriceValue(value: string): string {
    return (value || '')
        .split(/\s*[|/\u2013]\s*|(?<=\d)\s*-\s*(?=[$\u20ac\u00a3]?\d)/)
        .map((part) => {
            const compact = part
                .toLowerCase()
                .replace(/market\s+price/g, 'mp')
                .replace(CURRENCY_CODE_RE, '')
                .replace(/,(\d{1,2})$/, '.$1')
                .replace(/[\u20ac\u00a3$,\s]/g, '')
                .replace(/(?:pp|perperson|each)$/i, '');
            if (/^\d+(?:\.\d+)?$/.test(compact)) {
                return String(Number(compact));
            }
            return compact;
        })
        .join('|');
}

function extractTrailingPrice(line: string): TrailingPriceMatch | null {
    // Years are read as prices here so an AI rewrite of a vintage ('99 -> 1999)
    // can be restored; guardCorrectedMenuPrices never strips one.
    const match = matchTrailingPrice(line, { allowYear: true });
    if (!match) {
        return null;
    }

    return {
        price: match.price,
        normalizedPrice: normalizePriceValue(match.price),
        lineWithoutPrice: `${match.before}${match.trailing}`.trimEnd(),
    };
}

/**
 * Price on a submitted line, tolerating raw markers next to the price
 * ("Chimichurri *29", "Chimichurri 29*"). The submitted side must never be
 * read as price-less just because of marker placement.
 */
function extractSubmittedTrailingPrice(line: string): TrailingPriceMatch | null {
    return extractTrailingPrice(line)
        || extractTrailingPrice((line || '').replace(/\*/g, ' ').replace(/[ \t]{2,}/g, ' ').trimEnd());
}

/**
 * True when the submitted line already ends in the corrected price digits, even
 * glued to the previous word ("Chimichurri29*"). Stripping that price would
 * delete the chef's price, so the guard must leave it alone.
 */
function submittedLineEndsWithPriceDigits(line: string, normalizedPrice: string): boolean {
    if (!/^\d+(?:\.\d+)?$/.test(normalizedPrice)) {
        return false;
    }
    const escaped = normalizedPrice.replace(/\./g, '\\.');
    return new RegExp(`(?:^|[^\\d.,])[$\u20ac\u00a3]?${escaped}(?:\\.0{1,2})?\\*?\\s*$`).test(line || '');
}

/**
 * True when every number in the corrected price already appears on the
 * submitted line, in whatever format the chef typed it ("76/326",
 * "Clarita-80/345", "Chimichurri29*"). The AI only reformatted the chef's
 * price, so the guard must leave it alone. Stripping is reserved for prices
 * whose numbers are nowhere in the submission: that is the only case the guard
 * can be sure the AI invented them.
 */
function submittedLineContainsPriceNumbers(line: string, price: string): boolean {
    const correctedNumbers = priceNumbers(price);
    if (correctedNumbers.length === 0) {
        return false;
    }
    const submittedNumbers = new Set(priceNumbers(line));
    return correctedNumbers.every((token) => submittedNumbers.has(token));
}

function stripTrailingAllergenCluster(line: string): string {
    return (line || '').replace(/\s+[A-Z]{1,3}(?:,[A-Z]{1,3})*\s*$/u, '').trim();
}

function deriveMenuItem(line: string): string {
    const withoutPrice = extractTrailingPrice(line)?.lineWithoutPrice || line;
    const withoutAllergens = stripTrailingAllergenCluster(withoutPrice);
    const firstSegment = withoutAllergens.split(',')[0]?.trim();
    return (firstSegment || withoutAllergens || line || 'Menu item').trim().slice(0, 160);
}

function normalizeForSuggestionMatch(input: string): string {
    return (input || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasMissingPriceSuggestionForMenuItem(
    suggestions: PriceIntegritySuggestion[],
    menuItem: string
): boolean {
    const target = normalizeForSuggestionMatch(menuItem);
    if (!target) {
        return false;
    }

    return suggestions.some((suggestion) => {
        const type = `${suggestion.type || ''}`.trim().toLowerCase();
        if (type !== 'missing price') {
            return false;
        }
        const suggestionItem = normalizeForSuggestionMatch(suggestion.menuItem || '');
        const combined = normalizeForSuggestionMatch(
            `${suggestion.menuItem || ''} ${suggestion.description || ''} ${suggestion.recommendation || ''}`
        );
        return combined.includes(target) || (!!suggestionItem && target.includes(suggestionItem));
    });
}

function buildMissingPriceSuggestion(menuItem: string): PriceIntegritySuggestion {
    return {
        type: 'Missing Price',
        confidence: 'high',
        severity: 'critical',
        menuItem,
        description: 'This item was submitted without a price. An AI-added price was removed because prices must come from the submitter or reviewer.',
        recommendation: 'Add the correct price manually, or override this critical issue if the line should not have an item price.',
    };
}

function nonEmptyLineRefs(lines: string[]): Array<{ line: string; index: number }> {
    return lines
        .map((line, index) => ({ line, index }))
        .filter((entry) => entry.line.trim());
}

function buildOriginalLineLookup(
    originalLineRefs: Array<{ line: string; index: number }>
): Map<string, Array<{ line: string; index: number }>> {
    const lookup = new Map<string, Array<{ line: string; index: number }>>();

    for (const ref of originalLineRefs) {
        const key = normalizeForSuggestionMatch(deriveMenuItem(ref.line));
        if (!key) {
            continue;
        }
        const existing = lookup.get(key) || [];
        existing.push(ref);
        lookup.set(key, existing);
    }

    return lookup;
}

function significantWords(line: string): string[] {
    return normalizeForSuggestionMatch(line).split(' ').filter((word) => word.length > 2 && /[a-z]/.test(word));
}

function wordsMostlyOn(line: string, correctedWords: Set<string>): boolean {
    const words = significantWords(line);
    if (words.length === 0) return false;
    const found = words.filter((word) => correctedWords.has(word)).length;
    return found / words.length >= 0.6;
}

// A price typed on its own line or table cell sits below the item, at most
// after one wrapped description line.
const FOLLOWING_PRICE_LINES = 2;

/**
 * True when the chef typed this price on a line below the item and the AI
 * merged it onto the item line: "Pinot Noir - Savart, Champagne" / "1,980",
 * "Pork Belly Guacamole, ..." / "D,G 18", or a wrapped description whose last
 * line ends in the price. The price came from
 * the submitter, so stripping it would delete their content and block them.
 * Only lines the AI visibly merged count; a price copied from the next item's
 * own line (or from any line above) is still treated as invented.
 */
function priceTypedOnMergedFollowingLine(
    originalLineRefs: Array<{ line: string; index: number }>,
    pairedPosition: number,
    correctedPrice: TrailingPriceMatch
): boolean {
    const numbers = priceNumbers(correctedPrice.price);
    if (numbers.length === 0) return false;
    const correctedWords = new Set(significantWords(correctedPrice.lineWithoutPrice));

    // The guard pairs lines by first segment, so two "Cabernet Sauvignon, ..."
    // wines can be crossed. Also start from the submitted line the AI line
    // actually came from.
    const starts = new Set<number>(pairedPosition >= 0 ? [pairedPosition] : []);
    originalLineRefs.forEach((ref, position) => {
        if (significantWords(ref.line).length >= 2 && wordsMostlyOn(ref.line, correctedWords)) {
            starts.add(position);
        }
    });

    for (const start of starts) {
        for (let offset = 1; offset <= FOLLOWING_PRICE_LINES; offset++) {
            const following = originalLineRefs[start + offset]?.line.trim();
            if (!following) break;
            const followingNumbers = new Set(priceNumbers(following));
            if (numbers.every((n) => followingNumbers.has(n))) {
                // A cell with no words ("1,980", "16000", "D,G 18") is the
                // item's price; a line with words must have been merged.
                if (significantWords(following).length === 0) return true;
                const body = matchTrailingPrice(following, { allowYear: true })?.before || following;
                if (wordsMostlyOn(body, correctedWords)) return true;
                break;
            }
            // A wrapped description line in between must itself be merged.
            if (!wordsMostlyOn(following, correctedWords)) break;
        }
    }
    return false;
}

export function guardCorrectedMenuPrices(
    originalMenu: string,
    correctedMenu: string,
    suggestions: PriceIntegritySuggestion[]
): PriceIntegrityGuardResult {
    if (!correctedMenu) {
        return { correctedMenu, suggestions: suggestions ? [...suggestions] : [], changes: [] };
    }

    const originalLineRefs = nonEmptyLineRefs((originalMenu || '').split('\n'));
    const correctedLines = correctedMenu.split('\n');
    const correctedLineRefs = nonEmptyLineRefs(correctedLines);
    const nextSuggestions = suggestions ? [...suggestions] : [];
    const changes: PriceIntegrityGuardChange[] = [];

    if (originalLineRefs.length === 0) {
        return { correctedMenu, suggestions: nextSuggestions, changes };
    }

    const guardedLines = [...correctedLines];
    const originalLineLookup = buildOriginalLineLookup(originalLineRefs);
    const lineCountsAlign = originalLineRefs.length === correctedLineRefs.length;

    for (let i = 0; i < correctedLineRefs.length; i++) {
        const correctedRef = correctedLineRefs[i];
        const correctedLine = correctedRef.line;
        const correctedKey = normalizeForSuggestionMatch(deriveMenuItem(correctedLine));
        const matchedOriginalRefs = correctedKey ? originalLineLookup.get(correctedKey) || [] : [];
        const originalRef = lineCountsAlign
            ? originalLineRefs[i]
            : matchedOriginalRefs.length === 1
                ? matchedOriginalRefs[0]
                : null;

        if (!originalRef) {
            continue;
        }

        const originalLine = originalRef.line;
        const originalPrice = extractSubmittedTrailingPrice(originalLine);
        const correctedPrice = extractTrailingPrice(correctedLine);

        if (!correctedPrice) {
            continue;
        }

        if (!originalPrice && submittedLineEndsWithPriceDigits(originalLine, correctedPrice.normalizedPrice)) {
            continue;
        }

        if (submittedLineContainsPriceNumbers(originalLine, correctedPrice.price)) {
            continue;
        }

        if (!originalPrice && priceTypedOnMergedFollowingLine(
            originalLineRefs,
            originalLineRefs.indexOf(originalRef),
            correctedPrice
        )) {
            continue;
        }


        const menuItem = deriveMenuItem(originalLine || correctedLine);
        let guardedLine: string | null = null;
        let reason: PriceIntegrityGuardChange['reason'] | null = null;
        const unparsedSubmittedTail = originalPrice
            ? null
            : (originalLine.replace(/\*/g, '').match(SUBMITTED_NUMERIC_TAIL_RE)?.[0] || '').trim();

        if (!originalPrice && unparsedSubmittedTail) {
            // The chef typed something price-like that we cannot parse. That is
            // not proof the line had no price, so restore what they typed
            // instead of deleting it and blocking them with a critical.
            guardedLine = `${correctedPrice.lineWithoutPrice} ${unparsedSubmittedTail}`.trimEnd();
            reason = 'changed_price';
        } else if (!originalPrice && isBareYearPrice(correctedPrice.price)) {
            // A bare year is a vintage, not a price; never strip it or block.
            continue;
        } else if (!originalPrice) {
            guardedLine = correctedPrice.lineWithoutPrice;
            reason = 'added_price';
            if (!hasMissingPriceSuggestionForMenuItem(nextSuggestions, menuItem)) {
                nextSuggestions.push(buildMissingPriceSuggestion(menuItem));
            }
        } else if (originalPrice.normalizedPrice !== correctedPrice.normalizedPrice) {
            guardedLine = `${correctedPrice.lineWithoutPrice} ${originalPrice.price}`.trimEnd();
            reason = 'changed_price';
        }

        if (!guardedLine || !reason || guardedLine === correctedLine) {
            continue;
        }

        guardedLines[correctedRef.index] = guardedLine;
        changes.push({
            lineIndex: correctedRef.index,
            reason,
            menuItem,
            originalLine,
            correctedLine,
            guardedLine,
            originalPrice: originalPrice?.price || unparsedSubmittedTail || null,
            correctedPrice: correctedPrice.price,
        });
    }

    return {
        correctedMenu: guardedLines.join('\n'),
        suggestions: nextSuggestions,
        changes,
    };
}
