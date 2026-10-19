/**
 * The one price grammar for every deterministic price check.
 *
 * Each check used to carry its own narrow price regex, and every miss became a
 * prod incident: a chef's real price was read as "no price", so a guard
 * stripped it or a check raised a blocking Missing Price critical (Maya Dubai
 * 2026-10-19: "76/326" and "80-345"). Price recognition lives here only; checks
 * import these helpers instead of writing their own pattern.
 *
 * Recognized (as a trailing price): 14, $12, 12.50, 1,450, 2450, AED 80, 80AED,
 * 78 AED, MP, MKT, Market Price, and multi-prices joined by | / - or an en dash
 * (16 | 80, 76/326, 80-345), optionally followed by pp / per person / each.
 * Not a price: a bare vintage year (2015), an apostrophe year ('99), and a zero
 * amount ("HEINEKEN 0.0").
 */

export const CURRENCY_CODES = ['AED', 'USD', 'QAR', 'SAR', 'EUR', 'GBP', 'CAD', 'AUD'] as const;

const CURRENCY_SYMBOL = String.raw`[$€£]`;
const CURRENCY_CODE = `(?:${CURRENCY_CODES.join('|')})`;

/** A number as chefs write it: 14, 12.50, 12,50, 1,450, 2450. */
export const PRICE_NUMBER_SOURCE = String.raw`\d{1,4}(?:,\d{3})*(?:[.,]\d{1,2})?`;

/** One amount with optional currency: $12, AED 80, 80AED, MP, Market Price. */
export const PRICE_AMOUNT_SOURCE = String.raw`(?:(?:${CURRENCY_SYMBOL}\s*|${CURRENCY_CODE}\s?)?${PRICE_NUMBER_SOURCE}(?:\s?${CURRENCY_CODE}\b)?|MKT\b|MP\b|market\s+price\b)`;

/** Glass | bottle, half | full: "76 | 326", "76/326", "80-345", "80–345". */
export const PRICE_SEPARATOR_SOURCE = String.raw`\s*[|/–-]\s*`;

/** One or more amounts joined by price separators. */
export const PRICE_SHAPE_SOURCE = `${PRICE_AMOUNT_SOURCE}(?:${PRICE_SEPARATOR_SOURCE}${PRICE_AMOUNT_SOURCE})*`;

/** Unit after a price: "68 pp", "50.00PP", "22 per person", "4 each". */
export const PRICE_UNIT_SOURCE = String.raw`(?:\s*(?:pp\b|per\s+person\b|each\b))`;

const ALLERGEN_CLUSTER_SOURCE = String.raw`[A-Z]{1,3}(?:,[A-Z]{1,3})*`;

const TRAILING_PRICE_RE = new RegExp(
    String.raw`^(?<before>.*?)(?<separator>\s+)(?<price>${PRICE_SHAPE_SOURCE}${PRICE_UNIT_SOURCE}?)(?<trailing>\s*)$`,
    'i'
);
// Loose boundary: the price may be glued to the name by a hyphen, pipe or slash
// ("Clarita-80/345") and may be followed by a raw marker and allergen codes
// ("Mercado 76/326*", "Truffle Fries 16 D,V"). Used to ask "is this line priced?".
const LINE_PRICE_RE = new RegExp(
    String.raw`(?:^|[\s\-|/–])(?<price>${PRICE_SHAPE_SOURCE}${PRICE_UNIT_SOURCE}?)\*?(?:\s+${ALLERGEN_CLUSTER_SOURCE})?\s*$`,
    'i'
);
const BARE_YEAR_RE = /^(?:19|20)\d{2}$/;

export type TrailingPrice = {
    /** The price as written, unit included ("76/326", "68 pp"). */
    price: string;
    /** The line before the price, without the separating whitespace. */
    before: string;
    /** Index in the line where the separating whitespace starts. */
    index: number;
    /** Whitespace after the price, if any. */
    trailing: string;
};

export type PriceShapeOptions = {
    /**
     * Accept a bare year ("2015") as a price. Only for callers that restore the
     * submitter's value; a year must never be stripped or block as a price.
     */
    allowYear?: boolean;
};

/** Every number in a value, normalized ("1,450" -> "1450", "12.50" -> "12.5"). */
export function priceNumbers(value: string): string[] {
    return ((value || '').match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || [])
        .map((token) => String(Number(token.replace(/,/g, ''))));
}

/** "2015", "1999": a vintage, not a price, when written with nothing else. */
export function isBareYearPrice(price: string): boolean {
    return BARE_YEAR_RE.test((price || '').replace(/\*/g, '').trim());
}

/** "0", "0.0", "0 | 0": part of a name ("HEINEKEN 0.0"), never a price. */
export function isZeroPrice(price: string): boolean {
    const numbers = priceNumbers(price);
    return numbers.length > 0 && numbers.every((n) => Number(n) === 0);
}

function acceptPrice(price: string, options: PriceShapeOptions): boolean {
    if (isZeroPrice(price)) return false;
    if (!options.allowYear && isBareYearPrice(price)) return false;
    return true;
}

/** The trailing price on a line, separated from the text by whitespace. */
export function matchTrailingPrice(line: string, options: PriceShapeOptions = {}): TrailingPrice | null {
    const match = `${line || ''}`.match(TRAILING_PRICE_RE);
    if (!match?.groups) return null;
    const price = (match.groups.price || '').trim();
    if (!price || !acceptPrice(price, options)) return null;
    return {
        price,
        before: match.groups.before || '',
        index: (match.groups.before || '').length,
        trailing: match.groups.trailing || '',
    };
}

/** Split a line into its text and trailing price (price keeps its leading space). */
export function splitTrailingPrice(line: string, options: PriceShapeOptions = {}): { body: string; price: string } {
    const value = `${line || ''}`;
    const match = matchTrailingPrice(value, options);
    return match
        ? { body: value.slice(0, match.index).trimEnd(), price: value.slice(match.index) }
        : { body: value, price: '' };
}

/**
 * True when a line ends in a price, tolerating a raw marker and allergen codes
 * after it. Used to clear "Missing Price" criticals, so it must know every
 * shape chefs type; a miss leaves a false blocking critical.
 */
export function lineHasPrice(line: string, options: PriceShapeOptions = {}): boolean {
    const compact = `${line || ''}`.trim();
    const match = compact.match(LINE_PRICE_RE);
    if (!match?.groups?.price) return false;
    return acceptPrice(match.groups.price, options);
}

/** A whole line that is only a price ("68 pp", "$60", "95/145"). */
export function isStandalonePrice(line: string, options: PriceShapeOptions = {}): boolean {
    const compact = `${line || ''}`.trim();
    if (!new RegExp(`^${PRICE_SHAPE_SOURCE}${PRICE_UNIT_SOURCE}?$`, 'i').test(compact)) return false;
    // A standalone word price ("MP") at the top of a menu is not package evidence.
    if (priceNumbers(compact).length === 0) return false;
    return acceptPrice(compact, options);
}
