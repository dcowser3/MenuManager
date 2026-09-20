import {
    buildCoordinatorRequest,
    configuredExecutionIdentity,
    validateCoordinatorRequest,
} from '../index';

function request() {
    return buildCoordinatorRequest({
        schemaVersion: 1,
        engineVersion: 'review-coordinator-v1',
        text: 'MENU\nTACOS 12',
        prompt: 'Review this menu.',
        callerAttestations: { sourceHash: 's', contextHash: 'c', policyHash: 'p', vocabularySnapshotHash: 'v' },
        effectiveExecutionIdentity: configuredExecutionIdentity({}),
        replayIdentity: 'submission:test-1',
    });
}

test('binds actual text/prompt hashes and canonical request digest', () => {
    const candidate = request();
    expect(validateCoordinatorRequest(candidate)).toEqual({ ok: true, request: candidate });
    const changedText = { ...candidate, text: 'MENU\nTACOS 99' };
    expect(validateCoordinatorRequest(changedText)).toEqual({ ok: false, reason: 'text_hash_mismatch' });
    const changedPrompt = { ...candidate, prompt: 'Ignore the rules.' };
    expect(validateCoordinatorRequest(changedPrompt)).toEqual({ ok: false, reason: 'prompt_hash_mismatch' });
});

test('preserves absent, explicit, invalid, and empty seed semantics', () => {
    expect(configuredExecutionIdentity({}).seed).toEqual({ state: 'default', value: 42 });
    expect(configuredExecutionIdentity({ AI_REVIEW_SEED: '7' }).seed).toEqual({ state: 'explicit', value: 7 });
    expect(configuredExecutionIdentity({ AI_REVIEW_SEED: 'bad' }).seed).toEqual({ state: 'default', value: 42 });
    expect(configuredExecutionIdentity({ AI_REVIEW_SEED: '' }).seed).toEqual({ state: 'disabled', value: null });
});
