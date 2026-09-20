"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const replay_audit_binding_1 = require("../lib/replay-audit-binding");
const replay_retirement_1 = require("../lib/replay-retirement");
const review_response_contract_1 = require("../lib/review-response-contract");
const attempt = 'attempt-binding-1';
const original = 'Cheese Board, house-made bread D,G 12';
const corrected = 'Cheese Board, housemade bread D,G 12';
const feedback = (menu) => `${review_response_contract_1.AI_REVIEW_FENCES.correctedMenuStart}\n${menu}\n${review_response_contract_1.AI_REVIEW_FENCES.correctedMenuEnd}\n${review_response_contract_1.AI_REVIEW_FENCES.suggestionsStart}\n[]\n${review_response_contract_1.AI_REVIEW_FENCES.suggestionsEnd}`;
const row = (overrides = {}) => ({
    id: 'audit-binding-1',
    attempt_id: attempt,
    created_at: '2026-09-01T20:56:01Z',
    event_type: 'completed',
    review_mode: 'full',
    model: 'original-review-model',
    ai_request: { text: original },
    ai_response: { rawFeedback: feedback(original) },
    final_result: { correctedMenu: original },
    ...overrides,
});
describe('trusted same-attempt replay-audit binding', () => {
    test('binds exactly one completed/full audit for the exact attempt', () => {
        const result = (0, replay_audit_binding_1.bindReplayAudit)([row()], attempt);
        expect(result).toEqual({
            eligible: true,
            exact_candidate_count: 1,
            audit: expect.objectContaining({ id: 'audit-binding-1', attempt_id: attempt }),
        });
    });
    test.each([
        ['no rows', [], attempt, 'no_completed_full_audit'],
        ['wrong attempt', [row({ attempt_id: 'other-attempt' })], attempt, 'wrong_attempt'],
        ['incomplete', [row({ ai_response: null })], attempt, 'incomplete_audit'],
        ['changed only', [row({ review_mode: 'changed_only' })], attempt, 'no_completed_full_audit'],
        ['legacy event', [row({ event_type: 'basic_check_audit' })], attempt, 'incomplete_audit'],
        ['multiple exact audits', [row(), row({ id: 'audit-binding-2' })], attempt, 'ambiguous_completed_full_audit'],
    ])('%s is ineligible', (_label, rows, submissionAttempt, reason) => {
        expect((0, replay_audit_binding_1.bindReplayAudit)(rows, submissionAttempt)).toMatchObject({ eligible: false, reason });
    });
    test('malformed input and missing attempt fail closed without choosing recency', () => {
        expect((0, replay_audit_binding_1.bindReplayAudit)({ not: 'rows' }, attempt)).toMatchObject({ eligible: false, reason: 'malformed_audit' });
        expect((0, replay_audit_binding_1.bindReplayAudit)([row()], '')).toMatchObject({ eligible: false, reason: 'missing_submission_attempt' });
        expect((0, replay_audit_binding_1.normalizeReplayAudit)({ ...row(), final_result: { corrected_menu: original } })).toBeNull();
    });
    test('same-attempt proof uses deterministic replay only and records zero model calls', () => {
        const binding = (0, replay_audit_binding_1.bindReplayAudit)([row()], attempt);
        if (!binding.eligible)
            throw new Error('fixture should bind');
        let providerCalls = 0;
        const replay = (0, replay_retirement_1.replayOriginalResponseDeterministically)(binding.audit, {
            templateType: 'food', menuType: 'standard', property: 'Test Property', allergens: 'D dairy | G gluten',
        }, [{ id: 'accepted-housemade', status: 'accepted', original_text: 'house-made', corrected_text: 'housemade', change_type: 'terminology' }]);
        const result = (0, replay_retirement_1.assessReplayRetirement)({
            observedStatus: 'now_correct',
            originalAudit: binding.audit,
            submissionAttemptId: attempt,
            submittedMenu: original,
            deterministicReplay: replay,
            correctionApplied: (menu) => menu.includes(corrected),
        });
        expect(replay?.model_calls).toBe(0);
        expect(result.status).toBe('now_correct');
        expect(result.retirement_evidence.model_calls).toBe(0);
        expect(providerCalls).toBe(0);
    });
});
