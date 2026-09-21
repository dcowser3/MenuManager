import { runPostAiPipeline } from '../lib/review-pipeline';
import { AI_REVIEW_FENCES } from '../lib/review-response-contract';

test('the complete post-AI pipeline cannot remove submitted allergen codes', () => {
    const original = 'Truffle Mac, aged cheddar D,G 24';
    const feedback = [
        AI_REVIEW_FENCES.correctedMenuStart,
        'Truffle Mac, aged cheddar G 24',
        AI_REVIEW_FENCES.correctedMenuEnd,
        AI_REVIEW_FENCES.suggestionsStart,
        JSON.stringify([{
            type: 'Allergen Code',
            confidence: 'high',
            menuItem: 'Truffle Mac',
            description: 'Remove the dairy code.',
            recommendation: "Change 'D,G' to 'G'.",
        }]),
        AI_REVIEW_FENCES.suggestionsEnd,
    ].join('\n');

    const result = runPostAiPipeline({
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
