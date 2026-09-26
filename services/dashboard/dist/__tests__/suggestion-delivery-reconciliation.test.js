"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const suggestion_delivery_reconciliation_1 = require("../lib/suggestion-delivery-reconciliation");
const RSH_LEGEND = 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan';
describe('reconcileSuggestionsWithDeliveredMenu: allergen suggestions', () => {
    // Prod audit 47df1fe9 (2026-09-26): the model removed S from fish dishes, the
    // allergen lock restored it, and the suggestion still said the menu removed S.
    const menu = [
        'Tikin-Xic Fish, whole branzino, red chili & green tomatillo adobo marinade, creamy plantain, pickled onion, black bean purée D,G,S 45',
        'Salmon a la Talla, adobo marinade, greens G,S 38',
    ].join('\n');
    test('removes the false "corrected menu removes S" claim and marks it not applied', () => {
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(menu, menu, [{
                type: 'Allergen Code',
                confidence: 'medium',
                severity: 'normal',
                menuItem: 'Tikin-Xic Fish',
                description: 'The original S code indicates shellfish, but the visible seafood ingredient is branzino, which is fish rather than shellfish. The corrected menu removes S; the current allergen key does not define a fish code.',
                recommendation: 'Confirm the intended fish-allergen code and consider adding a fish designation to the allergen key.',
            }], RSH_LEGEND);
        const [suggestion] = result.suggestions;
        expect(suggestion.deliveryStatus).toBe('not_applied');
        expect(suggestion.deliveredValue).toBe('D,G,S');
        expect(suggestion.description).toMatch(/^Allergen codes were not changed \(kept as submitted: D,G,S\)\./);
        expect(suggestion.description).toContain('branzino, which is fish rather than shellfish');
        expect(suggestion.description).not.toMatch(/corrected menu removes/i);
        expect(suggestion.recommendation).toContain('Confirm the intended fish-allergen code');
        expect(result.diagnostics).toContain('suggestion_delivery_reconciled:allergen:Tikin-Xic Fish');
    });
    test('rewrites a "Retain F,S" claim and flags F as undefined in the key (tan dinner 2026-09-21)', () => {
        const submitted = 'Seabass & Shrimp Ceviche, cucumber, red onion, macha-aguachile, cilantro, avocado* S 23';
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(submitted, submitted, [{
                type: 'Allergen Code',
                confidence: 'medium',
                menuItem: 'Seabass & Shrimp Ceviche',
                description: "Seabass is a fish and the menu's allergen key defines fish as F; the existing S code correctly identifies shrimp.",
                recommendation: 'Retain F,S allergen codes.',
            }], RSH_LEGEND);
        const [suggestion] = result.suggestions;
        expect(suggestion.deliveryStatus).toBe('not_applied');
        expect(suggestion.recommendation).toBe("Confirm with the chef before changing this dish's allergen codes. F is not defined in this menu's allergen key.");
        // The false premise "the key defines fish as F" is removed; the true part about S stays.
        expect(suggestion.description).toBe('Allergen codes were not changed (kept as submitted: S). AI note: Seabass is a fish; the existing S code correctly identifies shrimp.');
    });
    test('keeps a literal change pair so the chef can still apply it', () => {
        const row = 'Crab Cake, remoulade D,G 24';
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(row, row, [{
                type: 'Allergen Code',
                menuItem: 'Crab Cake',
                description: 'Crab is shellfish.',
                recommendation: "Change 'D,G' to 'D,G,S'.",
            }], RSH_LEGEND);
        expect(result.suggestions[0].recommendation).toBe("Change 'D,G' to 'D,G,S'. Confirm with the chef before changing allergen codes.");
        expect(result.suggestions[0].description).toBe('Allergen codes were not changed (kept as submitted: D,G). AI note: Crab is shellfish.');
    });
    test('drops a hallucinated "code X is not defined" premise about a code the row does not carry', () => {
        const row = 'Oysters D,G 20';
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(row, row, [{
                type: 'Allergen Code', menuItem: 'Oysters', description: 'The code F is not defined in the key.', recommendation: 'Remove F.',
            }], RSH_LEGEND);
        expect(result.suggestions).toEqual([]);
        expect(result.diagnostics).toContain('unsupported_allergen_code_source_claim:F');
    });
    test('an ambiguous or missing row still never claims a change', () => {
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)('Soup D 8\nSoup G 9', 'Soup D 8\nSoup G 9', [{
                type: 'Allergen Code', menuItem: 'Soup', description: 'The S code was added.', recommendation: 'Keep the added S code.',
            }], RSH_LEGEND);
        expect(result.suggestions[0].description).toBe('Allergen codes were not changed by the AI review.');
        expect(result.suggestions[0].recommendation).toBe("Confirm with the chef before changing this dish's allergen codes.");
        expect(result.diagnostics).toContain('suggestion_delivery_row_unresolved:allergen:Soup');
    });
    test('drops exact duplicates produced by the rewrite', () => {
        const row = 'Oysters D,G 20';
        const s = { type: 'Allergen Code', menuItem: 'Oysters', description: 'The S code was added.', recommendation: 'Retain S.' };
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(row, row, [s, { ...s }], RSH_LEGEND);
        expect(result.suggestions).toHaveLength(1);
    });
    test('leaves non-allergen, non-raw suggestions untouched', () => {
        const s = { type: 'Spelling', menuItem: 'Oysters', description: 'Typo.', recommendation: "Change 'Oystres' to 'Oysters'." };
        expect((0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)('Oystres 20', 'Oysters 20', [s], RSH_LEGEND).suggestions).toEqual([s]);
    });
});
describe('reconcileSuggestionsWithDeliveredMenu: raw-marker suggestions', () => {
    test('holds a request to remove an asterisk that is still delivered', () => {
        const row = 'Seabass & Shrimp Ceviche, cilantro, avocado* S 23';
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(row, row, [{
                type: 'Raw Item', menuItem: 'Seabass & Shrimp Ceviche',
                description: 'Shrimp ceviche is cooked, so the asterisk was removed.', recommendation: 'Remove the asterisk.',
            }], RSH_LEGEND);
        const [suggestion] = result.suggestions;
        expect(suggestion.deliveryStatus).toBe('not_applied');
        // The whole model sentence claims a removal that did not happen, so it is dropped.
        expect(suggestion.description).toBe('The raw-item asterisk was kept (asterisks are never removed automatically).');
        expect(suggestion.recommendation).toMatch(/only remove the asterisk if it is fully cooked/);
    });
    test('marks an asterisk addition as applied when the delivered row has it', () => {
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)('Tuna Tartare, soy 19', 'Tuna Tartare, soy* 19', [{
                type: 'Raw Item', menuItem: 'Tuna Tartare', description: 'Raw tuna.', recommendation: 'Add an asterisk after the description.',
            }], RSH_LEGEND);
        expect(result.suggestions[0]).toMatchObject({ deliveryStatus: 'applied', deliveredValue: 'asterisk', description: 'Raw tuna.' });
    });
    test('says so when a claimed asterisk addition is not in the delivered row', () => {
        const row = 'Shrimp Ceviche, lime 18';
        const result = (0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)(row, row, [{
                type: 'Raw Item', menuItem: 'Shrimp Ceviche', description: 'An asterisk was added for the raw shrimp.', recommendation: 'Add an asterisk.',
            }], RSH_LEGEND);
        expect(result.suggestions[0]).toMatchObject({ deliveryStatus: 'not_applied', description: 'No asterisk was added to this dish.' });
    });
    test('does not treat the foodborne-illness notice as a dish raw marker', () => {
        const s = { type: 'Raw Food Notice', menuItem: 'Entire menu', description: 'Missing notice.', recommendation: 'Add the standard raw-food notice with an asterisk.' };
        expect((0, suggestion_delivery_reconciliation_1.reconcileSuggestionsWithDeliveredMenu)('Soup 8', 'Soup 8', [s], RSH_LEGEND).suggestions).toEqual([s]);
    });
});
