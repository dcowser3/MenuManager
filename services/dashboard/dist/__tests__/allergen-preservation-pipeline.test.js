"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const review_pipeline_1 = require("../lib/review-pipeline");
const review_response_contract_1 = require("../lib/review-response-contract");
test('the complete post-AI pipeline cannot remove submitted allergen codes', () => {
    const original = 'Truffle Mac, aged cheddar D,G 24';
    const feedback = [
        review_response_contract_1.AI_REVIEW_FENCES.correctedMenuStart,
        'Truffle Mac, aged cheddar G 24',
        review_response_contract_1.AI_REVIEW_FENCES.correctedMenuEnd,
        review_response_contract_1.AI_REVIEW_FENCES.suggestionsStart,
        JSON.stringify([{
                type: 'Allergen Code',
                confidence: 'high',
                menuItem: 'Truffle Mac',
                description: 'Remove the dairy code.',
                recommendation: "Change 'D,G' to 'G'.",
            }]),
        review_response_contract_1.AI_REVIEW_FENCES.suggestionsEnd,
    ].join('\n');
    const result = (0, review_pipeline_1.runPostAiPipeline)({
        feedback,
        preCheckedReviewBody: original,
        effectiveReviewAllergens: 'D contains dairy | G contains gluten',
        acceptedCorrectionRules: [],
        embeddedSetMenuAnalysis: { sections: [], issues: [] },
        precheckEnabled: true,
    });
    expect(result.correctedMenuSanitized).toBe(original);
    expect(result.allergenIntegrityGuard.changes).toEqual([
        expect.objectContaining({ preservedCodes: ['D'] }),
    ]);
    expect(result.finalSuggestions).toEqual([]);
});
