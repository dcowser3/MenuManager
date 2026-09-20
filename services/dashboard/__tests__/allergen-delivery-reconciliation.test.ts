import { reconcileAllergenDeliveryClaims } from '../lib/allergen-delivery-reconciliation';

describe('delivered allergen claim reconciliation', () => {
    test('holds a claim whose code is absent from delivered bytes', () => {
        const result = reconcileAllergenDeliveryClaims('Oysters D,G', 'Oysters D,G', [{
            type: 'Allergen Code', menuItem: 'Oysters', description: 'The S code was added.', recommendation: 'Retain the added S code.',
        }]);
        expect(result.suggestions[0].recommendation).toMatch(/not applied/i);
        expect(result.diagnostics).toContain('allergen_delivery_claim_held:Oysters');
    });

    test('keeps a claim when the delivered row contains the code', () => {
        const finding = { type: 'Allergen Code', menuItem: 'Oysters', description: 'The S code was added.', recommendation: 'Retain the added S code.' };
        expect(reconcileAllergenDeliveryClaims('Oysters D,G', 'Oysters D,G,S', [finding])).toEqual({ suggestions: [finding], diagnostics: [] });
    });
});
