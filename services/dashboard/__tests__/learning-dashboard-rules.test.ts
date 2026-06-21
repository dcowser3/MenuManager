import {
    isPromptProposalConsumedCorrectionRule,
    listActionablePendingCorrectionRules,
} from '../lib/learning-dashboard-rules';

describe('learning dashboard rule buckets', () => {
    test('treats prompt-cycle metadata as consumed proposal evidence', () => {
        expect(isPromptProposalConsumedCorrectionRule({ prompt_cycle_id: '2026-06-21' })).toBe(true);
        expect(isPromptProposalConsumedCorrectionRule({ consumed_at: '2026-06-21T12:00:00Z' })).toBe(true);
        expect(isPromptProposalConsumedCorrectionRule({ prompt_cycle_id: ' ', consumed_at: '' })).toBe(false);
    });

    test('keeps consumed correction evidence out of actionable pending rules', () => {
        const rules = [
            { id: 'needs-review', status: 'pending' },
            { id: 'cycle-consumed', status: 'pending', prompt_cycle_id: '2026-06-21' },
            { id: 'timestamp-consumed', status: 'pending', consumed_at: '2026-06-21T12:00:00Z' },
            { id: 'accepted-live-rule', status: 'accepted' },
        ];

        expect(listActionablePendingCorrectionRules(rules).map((rule) => rule.id)).toEqual(['needs-review']);
    });
});
