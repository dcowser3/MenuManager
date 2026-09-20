import {
    assessReplayRetirement,
    isReplayRetirementVerified,
    isReplayRetirementPolicyCurrent,
    unverifiedReplayResolutionIds,
    OriginalReviewAudit,
    replayOriginalResponseDeterministically,
} from '../lib/replay-retirement';
import { AI_REVIEW_FENCES } from '../lib/review-response-contract';

const original = 'Cheese Board, house-made bread D,G 12';
const corrected = 'Cheese Board, housemade bread D,G 12';
const feedback = (menu: string) => `${AI_REVIEW_FENCES.correctedMenuStart}\n${menu}\n${AI_REVIEW_FENCES.correctedMenuEnd}\n${AI_REVIEW_FENCES.suggestionsStart}\n[]\n${AI_REVIEW_FENCES.suggestionsEnd}`;
const audit: OriginalReviewAudit = {
    id: 'original-audit', attempt_id: 'attempt-1', created_at: '2026-09-01T20:56:01Z',
    event_type: 'completed', review_mode: 'full', model: 'original-review-model',
    ai_request: { text: original }, ai_response: { rawFeedback: feedback(original) },
    final_result: { correctedMenu: original },
};
const context = { templateType: 'food', menuType: 'standard', allergens: 'D dairy | G gluten' };
const rule = { id: 'accepted-housemade', status: 'accepted', original_text: 'house-made', corrected_text: 'housemade', change_type: 'terminology' };
const input = () => ({
    observedStatus: 'now_correct' as const,
    originalAudit: audit,
    submissionAttemptId: 'attempt-1',
    submittedMenu: original,
    correctionApplied: (menu: string) => menu.split('\n').includes(corrected),
});

describe('replay retirement proof', () => {
    test('a single or cached successful backend sample cannot retire a correction', () => {
        const result = assessReplayRetirement(input());
        expect(result.status).toBe('verification_required');
        expect(result.observed_status).toBe('now_correct');
        expect(isReplayRetirementVerified(result)).toBe(false);
    });

    test('missing or mismatched original audit provenance fails closed', () => {
        for (const originalAudit of [null, { ...audit, attempt_id: 'unrelated-attempt' }, { ...audit, event_type: 'malformed_response' }, { ...audit, review_mode: 'changed_only' }]) {
            const result = assessReplayRetirement({ ...input(), originalAudit });
            expect(result.status).toBe('verification_required');
            expect(result.retirement_evidence.eligible).toBe(false);
        }
    });

    test('an API/submission difference is unattributed because a human may have edited the result', () => {
        const originalFinal = 'Snow Crab Claws & Crab Legs S\nVegan Tiradito, cucumber VG';
        const saved = 'Snow Crab Claws & Crab Legs\nS Vegan Tiradito, cucumber';
        for (const observedStatus of ['now_correct', 'still_missed'] as const) {
            const result = assessReplayRetirement({
                ...input(), observedStatus,
                originalAudit: { ...audit, final_result: { correctedMenu: originalFinal } },
                submittedMenu: saved,
                correctionApplied: (menu) => menu.split('\n').includes('Snow Crab Claws & Crab Legs S'),
            });
            expect(result.status).toBe('delivery_mismatch');
            expect(result.retirement_evidence).toMatchObject({ original_final_correct: true, submitted_correct: false, eligible: false });
            expect(result.retirement_evidence.post_review_attribution).toBe('unknown');
            expect(result.retirement_evidence.reason).toContain('A human may have edited');
        }
    });

    test('current accepted guard repairs the frozen original failure without another model call', () => {
        const replay = replayOriginalResponseDeterministically(audit, context, [rule]);
        expect(replay).toMatchObject({ correctedMenu: corrected, parsedMenu: original, model_calls: 0, appliedRuleIds: ['accepted-housemade'] });
        const result = assessReplayRetirement({ ...input(), deterministicReplay: replay });
        expect(result.status).toBe('now_correct');
        expect(isReplayRetirementVerified(result)).toBe(true);
        expect(result.retirement_evidence.original_audit_id).toBe('original-audit');
        expect(result.retirement_evidence.original_response_sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    test('a compound correction still detects a lost delivered allergen while spelling was also missing', () => {
        const result = assessReplayRetirement({
            ...input(),
            originalAudit: { ...audit, final_result: { correctedMenu: 'Salad, carrots D,G' } },
            submittedMenu: 'Salad, carrots\nD,G Fruit Display',
            correctionApplied: (menu) => menu.split('\n').includes('Salad, carrot D,G'),
            correctionProgress: (menu) => ({ applied_changes: menu.split('\n').includes('Salad, carrots D,G') ? ['add:D', 'add:,', 'add:G'] : [] }),
        });
        expect(result.status).toBe('delivery_mismatch');
        expect(result.retirement_evidence).toMatchObject({
            original_final_correct: false, submitted_correct: false,
            delivery_changes_lost: ['add:D', 'add:,', 'add:G'], eligible: false,
        });
    });

    test('same failed response still failing the guard cannot be retired because a new model sample passed', () => {
        const replay = replayOriginalResponseDeterministically(audit, context, []);
        const result = assessReplayRetirement({ ...input(), deterministicReplay: replay });
        expect(result.status).toBe('verification_required');
        expect(result.retirement_evidence.deterministic_replay_correct).toBe(false);
    });

    test('an already-correct original response is not a proven repair of a failed model response', () => {
        const replay = replayOriginalResponseDeterministically({ ...audit, ai_response: { rawFeedback: feedback(corrected) } }, context, [rule]);
        const result = assessReplayRetirement({ ...input(), deterministicReplay: replay });
        expect(result.status).toBe('verification_required');
        expect(result.retirement_evidence.original_response_correct).toBe(true);
    });

    test('genuine still-missed observations remain actionable', () => {
        const result = assessReplayRetirement({ ...input(), observedStatus: 'still_missed' });
        expect(result.status).toBe('still_missed');
        expect(isReplayRetirementVerified(result)).toBe(false);
    });

    test('malformed response and changed-only provenance cannot manufacture a deterministic proof', () => {
        expect(replayOriginalResponseDeterministically({ ...audit, ai_response: { rawFeedback: 'no fences' } }, context, [rule])).toBeNull();
        expect(replayOriginalResponseDeterministically({ ...audit, review_mode: 'changed_only' }, context, [rule])).toBeNull();
    });

    test('legacy successes and incomplete eligible flags fail closed', () => {
        expect(isReplayRetirementVerified({ status: 'now_correct' })).toBe(false);
        const result = assessReplayRetirement(input());
        result.retirement_evidence.eligible = true;
        expect(isReplayRetirementVerified({ ...result, status: 'now_correct' })).toBe(false);
    });

    test('a pending proposal generated under the old retirement policy requires refresh', () => {
        expect(isReplayRetirementPolicyCurrent(null)).toBe(false);
        expect(isReplayRetirementPolicyCurrent({ replay_retirement_policy_version: 0 })).toBe(false);
        expect(isReplayRetirementPolicyCurrent({ replay_retirement_policy_version: 1 })).toBe(true);
    });

    test('supersede recovers exact unverified legacy ids without reviving proven or unrelated corrections', () => {
        const verified = assessReplayRetirement({ ...input(), deterministicReplay: replayOriginalResponseDeterministically(audit, context, [rule]) });
        expect(unverifiedReplayResolutionIds({
            replay_evidence: [
                { correction_id: 'legacy-crab', status: 'now_correct' },
                { correction_id: 'legacy-housemade', status: 'now_correct' },
                { correction_id: 'verified', ...verified },
                { correction_id: 'missed', status: 'still_missed' },
            ],
            correction_routing: [
                { correction_id: 'legacy-crab', replay_status: 'now_correct' },
                { correction_id: 'routing-only-legacy', replay_status: 'now_correct' },
                { correction_id: 'verified', replay_status: 'now_correct' },
            ],
        })).toEqual(['legacy-crab', 'legacy-housemade', 'routing-only-legacy']);
    });
});
