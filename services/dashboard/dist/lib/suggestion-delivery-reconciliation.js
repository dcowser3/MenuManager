"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileSuggestionsWithDeliveredMenu = reconcileSuggestionsWithDeliveredMenu;
const allergen_source_preservation_1 = require("./allergen-source-preservation");
// A clause claims the MENU was edited (as opposed to describing a dish).
const CHANGE_ASSERTION = new RegExp([
    String.raw `\b(?:corrected|updated|revised|reviewed)\s+menu\b`,
    String.raw `\bthe\s+menu\s+now\b`,
    String.raw `\b(?:has|have|was|were)\s+(?:been\s+)?(?:added|removed|deleted|dropped|changed|replaced|updated|applied|retained|kept)\b`,
    String.raw `\b(?:I|we)\s+(?:have\s+)?(?:added|removed|deleted|changed|replaced|updated|retained|kept)\b`,
    String.raw `\b(?:added|removed|deleted|replaced)\s+(?:the\s+)?(?:[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*\s+)?(?:allergen\s+)?(?:codes?|asterisk|marker)\b`,
].join('|'), 'i');
// Recommendations that presuppose the change was already made.
const APPLIED_RECOMMENDATION = /^\s*(?:retain|keep|leave|maintain)\b|\b(?:added|removed)\s+(?:code|asterisk|marker)s?\b/i;
const ASTERISK_REMOVAL = /\b(?:remov\w*|delet\w*|drop\w*|omit\w*)\b[^.;]*\b(?:asterisk|raw[- ]?(?:item\s+)?marker|\*)|(?:asterisk|raw[- ]?(?:item\s+)?marker)[^.;]*\b(?:remov\w*|delet\w*|not\s+needed|unnecessary|should\s+not)\b/i;
const ASTERISK_ADDITION = /\b(?:add\w*|includ\w*|insert\w*|mark\w*)\b[^.;]*\b(?:asterisk|raw[- ]?(?:item\s+)?marker|\*)/i;
const CODE_LIST = /(?:['"‘’“”]([A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)['"‘’“”])|\b([A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)\b(?=\s+(?:allergen\s+)?codes?\b)|\b(?:[Aa]dd(?:ing)?|[Rr]etain(?:ing)?|[Ii]nclud(?:e|ing)|[Aa]pply(?:ing)?)\s+(?:the\s+)?([A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*)\b(?![a-z])/g;
const normalize = (value) => `${value || ''}`.normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function isMenuWide(menuItem) {
    return /^\s*(?:entire|whole|full|all)\s+(?:menu|dishes|items)\s*$|^\s*(?:menu|general|n\/a)\s*$/i.test(`${menuItem || ''}`);
}
function categorize(suggestion) {
    const type = `${suggestion.type || ''}`.toLowerCase();
    if (/allergen/.test(type))
        return 'allergen';
    // The foodborne-illness footer notice is a separate, menu-wide finding.
    if (/notice|warning|footer|disclaimer/.test(type))
        return 'other';
    const text = `${suggestion.description || ''} ${suggestion.recommendation || ''}`;
    if (/\braw\b|undercook/.test(type) || /\basterisk\b/i.test(text))
        return 'raw_marker';
    return 'other';
}
/** Unique row index whose dish text starts with (preferred) or contains the menu item. */
function findRow(lines, menuItem) {
    const item = normalize(menuItem);
    if (!item)
        return null;
    const normalized = lines.map(normalize);
    const starts = normalized.map((line, index) => (line.startsWith(item) ? index : -1)).filter(index => index >= 0);
    if (starts.length === 1)
        return starts[0];
    if (starts.length > 1)
        return null;
    const contains = normalized.map((line, index) => (line.includes(item) ? index : -1)).filter(index => index >= 0);
    return contains.length === 1 ? contains[0] : null;
}
function deliveredRowFor(submittedLines, deliveredLines, submittedIndex, menuItem) {
    if (submittedIndex !== null && submittedLines.length === deliveredLines.length)
        return submittedIndex;
    return findRow(deliveredLines, menuItem);
}
function splitClauses(text) {
    return `${text || ''}`.split(/(?<=[.;!?])\s+/).map(part => part.trim()).filter(Boolean);
}
/** Drop clauses that claim the menu was edited; keep the model's reasoning about the dish. */
const CLAIM_REASON = /\b(?:because|since|as)\s+(.+)$/i;
/**
 * Drop clauses that claim the menu was edited, but keep the model's reasoning
 * about the dish: "The S code was removed because octopus is a mollusc ..." keeps
 * "Octopus is a mollusc ...".
 */
function withoutChangeClaims(text) {
    const kept = [];
    for (const clause of splitClauses(text)) {
        if (!CHANGE_ASSERTION.test(clause)) {
            kept.push(clause);
            continue;
        }
        const reason = clause.match(CLAIM_REASON)?.[1]?.trim();
        if (reason && !CHANGE_ASSERTION.test(reason))
            kept.push(sentence(reason));
    }
    return kept.join(' ').replace(/[;,]\s*$/, '.').trim();
}
const ADD_WORDS = /\b(?:add(?:ed|ing|s)?|retain(?:ed|ing|s)?|keep|includ(?:e|ed|es|ing)|appl(?:y|ied|ies|ying))\b/i;
const REMOVE_WORDS = /\b(?:remov(?:e|ed|es|ing)|drop(?:ped|s|ping)?|delet(?:e|ed|es|ing))\b/i;
/** What the model wanted to change, stated as a proposal the chef can act on. */
function proposalSummary(text, submittedCodes, knownCodes) {
    const clauses = splitClauses(text).flatMap(clause => clause.split(/;\s*/));
    const additions = new Set();
    const removals = new Set();
    for (const clause of clauses) {
        const codes = mentionedCodes(clause, knownCodes);
        if (!codes.length)
            continue;
        if (REMOVE_WORDS.test(clause))
            codes.filter(code => submittedCodes.includes(code)).forEach(code => removals.add(code));
        else if (ADD_WORDS.test(clause))
            codes.filter(code => !submittedCodes.includes(code)).forEach(code => additions.add(code));
    }
    const parts = [];
    if (additions.size)
        parts.push(`adding ${[...additions].join(',')}`);
    if (removals.size)
        parts.push(`removing ${[...removals].join(',')}`);
    return { additions: [...additions], removals: [...removals], summary: parts.length ? `AI suggests ${parts.join(' and ')}.` : '' };
}
// "the menu's allergen key defines fish as F" when the key has no F.
const KEY_DEFINES_PHRASE = /(\s*(?:,\s*)?(?:\band\s+)?(?:the\s+)?(?:menu['’]s\s+|current\s+)?(?:allergen\s+)?(?:key|legend)\s+(?:defines|includes|has|lists|uses)\b[^.;,]*?\b(?:as\s+)?)([A-Z]{1,3})\b(?![a-z])/g;
/** Remove phrases asserting the allergen key defines a code it does not define. */
function withoutFalseKeyClaims(text, legendCodes) {
    if (!legendCodes.size)
        return text;
    return `${text || ''}`
        .replace(KEY_DEFINES_PHRASE, (whole, _lead, code) => (legendCodes.has(code.toUpperCase()) ? whole : ''))
        .replace(/\s+([;,.])/g, '$1')
        .replace(/;\s*;/g, ';')
        .replace(/^[;,\s]+/, '')
        .trim();
}
function mentionedCodes(text, knownCodes) {
    const found = new Set();
    for (const match of `${text || ''}`.matchAll(CODE_LIST)) {
        const list = match[1] || match[2] || match[3] || '';
        for (const code of list.split(/\s*,\s*/)) {
            const upper = code.trim().toUpperCase();
            if (upper && knownCodes.has(upper))
                found.add(upper);
        }
    }
    return [...found];
}
function sentence(text) {
    const trimmed = `${text || ''}`.trim().replace(/[;,]$/, '');
    if (!trimmed)
        return '';
    const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}
function codesLabel(codes) {
    return codes.length ? codes.join(',') : 'none';
}
function reconcileAllergen(suggestion, submittedRow, deliveredRow, legend, diagnostics) {
    const description = `${suggestion.description || ''}`;
    const recommendation = `${suggestion.recommendation || ''}`;
    const legendCodes = (0, allergen_source_preservation_1.legendDefinedCodes)(legend);
    const submittedCodes = submittedRow !== null ? (0, allergen_source_preservation_1.allergenCodesOnLine)(submittedRow, legend) : [];
    const deliveredCodes = deliveredRow !== null ? (0, allergen_source_preservation_1.allergenCodesOnLine)(deliveredRow, legend) : [];
    // A claim that a code "is not defined" about a code the submitted row does
    // not even carry is a hallucinated premise; drop it (existing behavior).
    const undefinedClaim = description.match(/\bcode\s+([A-Z]{1,3})\s+is\s+not\s+defined\b/i);
    if (undefinedClaim && submittedRow !== null && !submittedCodes.includes(undefinedClaim[1].toUpperCase())) {
        diagnostics.push(`unsupported_allergen_code_source_claim:${undefinedClaim[1].toUpperCase()}`);
        return null;
    }
    // Menu-wide findings (e.g. the "no allergen program" critical on "Entire menu")
    // are not about a dish row; leave them exactly as written.
    if (submittedRow === null && isMenuWide(suggestion.menuItem))
        return suggestion;
    // A row we cannot resolve is only rewritten when its text claims a change.
    if (submittedRow === null && !CHANGE_ASSERTION.test(description) && !APPLIED_RECOMMENDATION.test(recommendation))
        return suggestion;
    const rowChanged = submittedRow !== null && deliveredRow !== null
        && (submittedCodes.length !== deliveredCodes.length || submittedCodes.some(code => !deliveredCodes.includes(code)));
    if (rowChanged) {
        // Only possible for menus without a legend (no allergen program to lock).
        return { ...suggestion, deliveryStatus: 'applied', deliveredValue: codesLabel(deliveredCodes) };
    }
    const knownCodes = new Set([...allergen_source_preservation_1.COMMON_ALLERGEN_CODES, ...legendCodes, ...submittedCodes, ...deliveredCodes]);
    const proposed = mentionedCodes(`${description} ${recommendation}`, knownCodes);
    const undefinedCodes = legendCodes.size ? proposed.filter(code => !legendCodes.has(code)) : [];
    const reasoning = withoutFalseKeyClaims(withoutChangeClaims(description), legendCodes);
    const proposal = proposalSummary(`${description} ${recommendation}`, submittedCodes, knownCodes);
    const status = submittedRow === null
        ? 'Allergen codes were not changed by the AI review.'
        : `Allergen codes were not changed (kept as submitted: ${codesLabel(submittedCodes)}).`;
    const hasChangePair = /\b(?:change|replace)\s+['"‘“]/i.test(recommendation);
    // "Retain the G allergen code unless ..." presupposes G was added. Turn it into
    // a proposal that keeps the model's condition: "Consider adding G unless ...".
    const appliedRecommendation = !hasChangePair && APPLIED_RECOMMENDATION.test(recommendation);
    const reframed = appliedRecommendation && proposal.additions.length
        ? recommendation.replace(/^\s*(?:retain|keep|leave|maintain)\s+(?:the\s+)?(?:added\s+)?(?:[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*\s+)?(?:allergen\s+)?(?:codes?\s*)?/i, `Consider adding ${proposal.additions.join(',')} `)
        : '';
    const recommendationBase = !recommendation.trim() || (appliedRecommendation && !reframed)
        ? "Confirm with the chef before changing this dish's allergen codes."
        : reframed
            ? `${sentence(reframed.replace(/\s+/g, ' ').replace(/\s+([.,;])/g, '$1'))} Confirm with the chef before changing allergen codes.`
            : /\b(?:confirm|verify|check)\b/i.test(recommendation)
                ? sentence(recommendation)
                : `${sentence(recommendation)} Confirm with the chef before changing allergen codes.`;
    const undefinedNote = undefinedCodes.length
        ? ` ${undefinedCodes.join(',')} ${undefinedCodes.length === 1 ? 'is' : 'are'} not defined in this menu's allergen key.`
        : '';
    const next = {
        ...suggestion,
        description: [status, proposal.summary, reasoning ? `AI note: ${sentence(reasoning)}` : ''].filter(Boolean).join(' '),
        recommendation: `${recommendationBase}${undefinedNote}`,
        deliveryStatus: 'not_applied',
        deliveredValue: codesLabel(submittedRow !== null ? submittedCodes : deliveredCodes),
    };
    if (next.description !== suggestion.description || next.recommendation !== suggestion.recommendation) {
        diagnostics.push(`suggestion_delivery_reconciled:allergen:${suggestion.menuItem || 'unknown'}`);
    }
    if (submittedRow === null)
        diagnostics.push(`suggestion_delivery_row_unresolved:allergen:${suggestion.menuItem || 'unknown'}`);
    return next;
}
function reconcileRawMarker(suggestion, submittedRow, deliveredRow, diagnostics) {
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
function reconcileSuggestionsWithDeliveredMenu(submittedMenu, deliveredMenu, suggestions, allergenLegend = '') {
    const diagnostics = [];
    const submittedLines = `${submittedMenu || ''}`.split('\n');
    const deliveredLines = `${deliveredMenu || ''}`.split('\n');
    const reconciled = [];
    const seen = new Set();
    for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
        const category = categorize(suggestion);
        let next = suggestion;
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
        if (!next)
            continue;
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
