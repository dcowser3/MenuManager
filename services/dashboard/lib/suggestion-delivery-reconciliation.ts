/**
 * Suggestion / delivery consistency.
 *
 * The model writes its suggestions against ITS OWN corrected menu. Deterministic
 * guards then change that menu (allergen codes are locked to what the chef
 * submitted, raw asterisks are add-only, prices are protected, ...). Without a
 * final reconciliation, a suggestion can tell the chef "the corrected menu
 * removes S" while the delivered menu still has S.
 *
 * This is the last suggestion stage of the post-AI pipeline. It compares the
 * submitted (pre-AI) row with the DELIVERED row, which is the single source of
 * truth regardless of which guard reverted what, and makes every allergen and
 * raw-marker suggestion describe the delivered state:
 *
 * - `deliveryStatus` / `deliveredValue` are set from the delivered row.
 * - Sentences that claim the menu was changed are removed from the model's
 *   reasoning when the delivered row does not contain that change.
 * - Allergen suggestions are always advisory (codes are locked), so their
 *   recommendation asks the chef to confirm and flags codes the menu's key
 *   does not define. A literal "Change 'X' to 'Y'" is kept so the chef can
 *   still apply it with one click.
 * - Raw-marker suggestions that ask to remove an asterisk are held (asterisks
 *   are never removed automatically).
 */

import { COMMON_ALLERGEN_CODES, allergenCodesOnLine, legendDefinedCodes } from './allergen-source-preservation';

export type DeliveryStatus = 'applied' | 'not_applied';

export type DeliveryFields = {
    /** Whether the delivered menu contains the change this suggestion talks about. */
    deliveryStatus?: DeliveryStatus;
    /** Delivered value for the suggestion's field, e.g. allergen codes "D,G" or "asterisk". */
    deliveredValue?: string;
};

export type DeliverySuggestion = {
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
} & DeliveryFields;

export type SuggestionDeliveryResult<T> = {
    suggestions: Array<T & DeliveryFields>;
    diagnostics: string[];
};

type Category = 'allergen' | 'raw_marker' | 'other';

// A clause claims the MENU was edited (as opposed to describing a dish).
const CHANGE_ASSERTION = new RegExp([
    String.raw`\b(?:corrected|updated|revised|reviewed)\s+menu\b`,
    String.raw`\bthe\s+menu\s+now\b`,
    String.raw`\b(?:has|have|was|were)\s+(?:been\s+)?(?:added|removed|deleted|dropped|changed|replaced|updated|applied|retained|kept)\b`,
    String.raw`\b(?:I|we)\s+(?:have\s+)?(?:added|removed|deleted|changed|replaced|updated|retained|kept)\b`,
    String.raw`\b(?:added|removed|deleted|replaced)\s+(?:the\s+)?(?:[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*\s+)?(?:allergen\s+)?(?:codes?|asterisk|marker)\b`,
].join('|'), 'i');

// Recommendations that presuppose the change was already made.
const APPLIED_RECOMMENDATION = /^\s*(?:retain|keep|leave|maintain)\b|\b(?:added|removed)\s+(?:code|asterisk|marker)s?\b/i;
const ASTERISK_REMOVAL = /\b(?:remov\w*|delet\w*|drop\w*|omit\w*)\b[^.;]*\b(?:asterisk|raw[- ]?(?:item\s+)?marker|\*)|(?:asterisk|raw[- ]?(?:item\s+)?marker)[^.;]*\b(?:remov\w*|delet\w*|not\s+needed|unnecessary|should\s+not)\b/i;
const ASTERISK_ADDITION = /\b(?:add\w*|includ\w*|insert\w*|mark\w*)\b[^.;]*\b(?:asterisk|raw[- ]?(?:item\s+)?marker|\*)/i;
const CODE_LIST = /(?:['"‘’“”]([A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)['"‘’“”])|\b([A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)\b(?=\s+(?:allergen\s+)?codes?\b)|\b(?:[Aa]dd(?:ing)?|[Rr]etain(?:ing)?|[Ii]nclud(?:e|ing)|[Aa]pply(?:ing)?)\s+(?:the\s+)?([A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)\b(?![a-z])/g;

const normalize = (value: string): string => `${value || ''}`.normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function categorize(suggestion: DeliverySuggestion): Category {
    const type = `${suggestion.type || ''}`.toLowerCase();
    if (/allergen/.test(type)) return 'allergen';
    // The foodborne-illness footer notice is a separate, menu-wide finding.
    if (/notice|warning|footer|disclaimer/.test(type)) return 'other';
    const text = `${suggestion.description || ''} ${suggestion.recommendation || ''}`;
    if (/\braw\b|undercook/.test(type) || /\basterisk\b/i.test(text)) return 'raw_marker';
    return 'other';
}

/** Unique row index whose dish text starts with (preferred) or contains the menu item. */
function findRow(lines: string[], menuItem: string): number | null {
    const item = normalize(menuItem);
    if (!item) return null;
    const normalized = lines.map(normalize);
    const starts = normalized.map((line, index) => (line.startsWith(item) ? index : -1)).filter(index => index >= 0);
    if (starts.length === 1) return starts[0];
    if (starts.length > 1) return null;
    const contains = normalized.map((line, index) => (line.includes(item) ? index : -1)).filter(index => index >= 0);
    return contains.length === 1 ? contains[0] : null;
}

function deliveredRowFor(submittedLines: string[], deliveredLines: string[], submittedIndex: number | null, menuItem: string): number | null {
    if (submittedIndex !== null && submittedLines.length === deliveredLines.length) return submittedIndex;
    return findRow(deliveredLines, menuItem);
}

function splitClauses(text: string): string[] {
    return `${text || ''}`.split(/(?<=[.;!?])\s+/).map(part => part.trim()).filter(Boolean);
}

/** Drop clauses that claim the menu was edited; keep the model's reasoning about the dish. */
function withoutChangeClaims(text: string): string {
    const kept = splitClauses(text).filter(clause => !CHANGE_ASSERTION.test(clause));
    return kept.join(' ').replace(/[;,]\s*$/, '.').trim();
}

// "the menu's allergen key defines fish as F" when the key has no F.
const KEY_DEFINES_PHRASE = /(\s*(?:,\s*)?(?:\band\s+)?(?:the\s+)?(?:menu['’]s\s+|current\s+)?(?:allergen\s+)?(?:key|legend)\s+(?:defines|includes|has|lists|uses)\b[^.;,]*?\b(?:as\s+)?)([A-Z]{1,3})\b(?![a-z])/g;

/** Remove phrases asserting the allergen key defines a code it does not define. */
function withoutFalseKeyClaims(text: string, legendCodes: Set<string>): string {
    if (!legendCodes.size) return text;
    return `${text || ''}`
        .replace(KEY_DEFINES_PHRASE, (whole: string, _lead: string, code: string) => (legendCodes.has(code.toUpperCase()) ? whole : ''))
        .replace(/\s+([;,.])/g, '$1')
        .replace(/;\s*;/g, ';')
        .replace(/^[;,\s]+/, '')
        .trim();
}

function mentionedCodes(text: string, knownCodes: Set<string>): string[] {
    const found = new Set<string>();
    for (const match of `${text || ''}`.matchAll(CODE_LIST)) {
        const list = match[1] || match[2] || match[3] || '';
        for (const code of list.split(/\s*,\s*/)) {
            const upper = code.trim().toUpperCase();
            if (upper && knownCodes.has(upper)) found.add(upper);
        }
    }
    return [...found];
}

function sentence(text: string): string {
    const trimmed = `${text || ''}`.trim().replace(/[;,]$/, '');
    if (!trimmed) return '';
    const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function codesLabel(codes: string[]): string {
    return codes.length ? codes.join(',') : 'none';
}

function reconcileAllergen<T extends DeliverySuggestion>(
    suggestion: T,
    submittedRow: string | null,
    deliveredRow: string | null,
    legend: string,
    diagnostics: string[],
): (T & DeliveryFields) | null {
    const description = `${suggestion.description || ''}`;
    const recommendation = `${suggestion.recommendation || ''}`;
    const legendCodes = legendDefinedCodes(legend);
    const submittedCodes = submittedRow !== null ? allergenCodesOnLine(submittedRow, legend) : [];
    const deliveredCodes = deliveredRow !== null ? allergenCodesOnLine(deliveredRow, legend) : [];

    // A claim that a code "is not defined" about a code the submitted row does
    // not even carry is a hallucinated premise; drop it (existing behavior).
    const undefinedClaim = description.match(/\bcode\s+([A-Z]{1,3})\s+is\s+not\s+defined\b/i);
    if (undefinedClaim && submittedRow !== null && !submittedCodes.includes(undefinedClaim[1].toUpperCase())) {
        diagnostics.push(`unsupported_allergen_code_source_claim:${undefinedClaim[1].toUpperCase()}`);
        return null;
    }

    const rowChanged = submittedRow !== null && deliveredRow !== null
        && (submittedCodes.length !== deliveredCodes.length || submittedCodes.some(code => !deliveredCodes.includes(code)));
    if (rowChanged) {
        // Only possible for menus without a legend (no allergen program to lock).
        return { ...suggestion, deliveryStatus: 'applied', deliveredValue: codesLabel(deliveredCodes) };
    }

    const knownCodes = new Set<string>([...COMMON_ALLERGEN_CODES, ...legendCodes, ...submittedCodes, ...deliveredCodes]);
    const proposed = mentionedCodes(`${description} ${recommendation}`, knownCodes);
    const undefinedCodes = legendCodes.size ? proposed.filter(code => !legendCodes.has(code)) : [];

    const reasoning = withoutFalseKeyClaims(withoutChangeClaims(description), legendCodes);
    const status = submittedRow === null
        ? 'Allergen codes were not changed by the AI review.'
        : `Allergen codes were not changed (kept as submitted: ${codesLabel(submittedCodes)}).`;
    const hasChangePair = /\b(?:change|replace)\s+['"‘“]/i.test(recommendation);
    const recommendationBase = !recommendation.trim() || (APPLIED_RECOMMENDATION.test(recommendation) && !hasChangePair)
        ? "Confirm with the chef before changing this dish's allergen codes."
        : /\b(?:confirm|verify|check)\b/i.test(recommendation)
            ? sentence(recommendation)
            : `${sentence(recommendation)} Confirm with the chef before changing allergen codes.`;
    const undefinedNote = undefinedCodes.length
        ? ` ${undefinedCodes.join(',')} ${undefinedCodes.length === 1 ? 'is' : 'are'} not defined in this menu's allergen key.`
        : '';

    const next: T & DeliveryFields = {
        ...suggestion,
        description: reasoning ? `${status} AI note: ${sentence(reasoning)}` : status,
        recommendation: `${recommendationBase}${undefinedNote}`,
        deliveryStatus: 'not_applied',
        deliveredValue: codesLabel(submittedRow !== null ? submittedCodes : deliveredCodes),
    };
    if (next.description !== suggestion.description || next.recommendation !== suggestion.recommendation) {
        diagnostics.push(`suggestion_delivery_reconciled:allergen:${suggestion.menuItem || 'unknown'}`);
    }
    if (submittedRow === null) diagnostics.push(`suggestion_delivery_row_unresolved:allergen:${suggestion.menuItem || 'unknown'}`);
    return next;
}

function reconcileRawMarker<T extends DeliverySuggestion>(
    suggestion: T,
    submittedRow: string | null,
    deliveredRow: string | null,
    diagnostics: string[],
): T & DeliveryFields {
    if (deliveredRow === null) {
        diagnostics.push(`suggestion_delivery_row_unresolved:raw_marker:${suggestion.menuItem || 'unknown'}`);
        return suggestion;
    }
    const description = `${suggestion.description || ''}`;
    const recommendation = `${suggestion.recommendation || ''}`;
    const text = `${description} ${recommendation}`;
    const submittedHas = submittedRow !== null && submittedRow.includes('*');
    const deliveredHas = deliveredRow.includes('*');

    if (ASTERISK_REMOVAL.test(text) && deliveredHas) {
        diagnostics.push(`suggestion_delivery_reconciled:raw_marker_removal_held:${suggestion.menuItem || 'unknown'}`);
        const reasoning = withoutChangeClaims(description);
        return {
            ...suggestion,
            description: `The raw-item asterisk was kept (asterisks are never removed automatically).${reasoning ? ` AI note: ${sentence(reasoning)}` : ''}`,
            recommendation: 'Confirm with the chef whether this dish is served raw or undercooked; only remove the asterisk if it is fully cooked.',
            deliveryStatus: 'not_applied',
            deliveredValue: 'asterisk',
        };
    }
    if (ASTERISK_ADDITION.test(text)) {
        if (deliveredHas) {
            return { ...suggestion, deliveryStatus: 'applied', deliveredValue: 'asterisk' };
        }
        diagnostics.push(`suggestion_delivery_reconciled:raw_marker_addition_not_applied:${suggestion.menuItem || 'unknown'}`);
        const reasoning = withoutChangeClaims(description);
        return {
            ...suggestion,
            description: `No asterisk was added to this dish.${reasoning ? ` AI note: ${sentence(reasoning)}` : ''}`,
            deliveryStatus: 'not_applied',
            deliveredValue: submittedHas ? 'asterisk' : 'none',
        };
    }
    // Advisory raw-item note with no add/remove request: leave it as written.
    return suggestion;
}

/**
 * Make allergen and raw-marker suggestions truthful about the delivered menu.
 * `submittedMenu` is the pre-AI text; `deliveredMenu` is the final corrected menu.
 */
export function reconcileSuggestionsWithDeliveredMenu<T extends DeliverySuggestion>(
    submittedMenu: string,
    deliveredMenu: string,
    suggestions: T[],
    allergenLegend = '',
): SuggestionDeliveryResult<T> {
    const diagnostics: string[] = [];
    const submittedLines = `${submittedMenu || ''}`.split('\n');
    const deliveredLines = `${deliveredMenu || ''}`.split('\n');
    const reconciled: Array<T & DeliveryFields> = [];
    const seen = new Set<string>();

    for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
        const category = categorize(suggestion);
        let next: (T & DeliveryFields) | null = suggestion;
        if (category !== 'other') {
            const menuItem = `${suggestion.menuItem || ''}`;
            const submittedIndex = findRow(submittedLines, menuItem);
            const deliveredIndex = deliveredRowFor(submittedLines, deliveredLines, submittedIndex, menuItem);
            const submittedRow = submittedIndex !== null ? submittedLines[submittedIndex] : null;
            const deliveredRow = deliveredIndex !== null ? deliveredLines[deliveredIndex] : null;
            next = category === 'allergen'
                ? reconcileAllergen(suggestion, submittedRow, deliveredRow, allergenLegend, diagnostics)
                : reconcileRawMarker(suggestion, submittedRow, deliveredRow, diagnostics);
        }
        if (!next) continue;
        const key = JSON.stringify([next.type, next.menuItem, next.description, next.recommendation]);
        if (seen.has(key)) {
            diagnostics.push(`suggestion_delivery_duplicate_dropped:${next.menuItem || 'unknown'}`);
            continue;
        }
        seen.add(key);
        reconciled.push(next);
    }
    return { suggestions: reconciled, diagnostics };
}
