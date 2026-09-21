const { recordCodeVerification, shouldDraftCodeProposal } = require('../../../scripts/lib/proposal-verification-store');
const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const verifier = {
    REPLAY_RETIREMENT_POLICY_VERSION: 1,
    codeProposalVerificationFingerprint: (p) => p.fingerprint,
    assessCodeProposalVerification: (p) => p.eval_summary.code_verification.valid ? null : { error: 'proof failed' },
};
const original = { id: 'p1', status: 'pending', fingerprint: 'one', code_recommendations: [{}], eval_summary: { replay_retirement_policy_version: 1, behavior_tests: { sha256: HASH_B } } };
const claim = (attempt_id = 'attempt-a', started_at = new Date().toISOString()) => ({
    attempt_id, status: 'running', proposal_sha256: HASH, baseline_source_sha256: HASH_B,
    expected_dataset_sha256: HASH, behavior_tests_sha256: HASH_B, prompt_sha256: HASH, accepted_rules_sha256: HASH_B,
    expected_case_ids: ['menu-1', 'menu-2'], started_at,
    authorization_hash: HASH, scope_hash: HASH_B, c2b_handoff_sha256: HASH,
    candidate_source_sha256: HASH_B, draft_patch_sha256: HASH,
    draft_content_sha256: HASH_B, draft_response_sha256: HASH,
});
const withClaim = (candidate) => ({ ...original, eval_summary: { ...original.eval_summary, code_candidate: candidate } });
function fakeClient(current = original, updated = [{ id: 'p1' }]) {
    const writes = [];
    const filters = [];
    return {
        writes, filters,
        from: () => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: current }) }) }),
            update: (patch) => {
                writes.push(patch);
                const q = { eq: (key, value) => { filters.push([key, value]); return q; }, is: (key, value) => { filters.push([key, value]); return q; }, select: async () => ({ data: updated }) };
                return q;
            },
        }),
    };
}

test('automatic queue requires current replay policy and does not redraft an unchanged failure every poll', () => {
    expect(shouldDraftCodeProposal(original, HASH_B, verifier)).toBe(true);
    expect(shouldDraftCodeProposal({ ...original, eval_summary: {} }, 'source', verifier)).toBe(false);
    const failed = { ...original, eval_summary: { ...original.eval_summary, code_candidate: { ...claim(), status: 'failed', proposal_sha256: 'one' } } };
    expect(shouldDraftCodeProposal(failed, HASH_B, verifier)).toBe(false);
    expect(shouldDraftCodeProposal(failed, HASH, verifier)).toBe(true);
    expect(shouldDraftCodeProposal(failed, HASH_B, verifier, true)).toBe(true);
    expect(shouldDraftCodeProposal({ ...original, eval_summary: { replay_retirement_policy_version: 0 } }, 'source', verifier)).toBe(false);
});

test('recording evidence preserves other evaluation data and uses an optimistic pending-only write', async () => {
    const active = withClaim(claim());
    const client = fakeClient(active);
    const result = await recordCodeVerification(client, original, { attempt_id: 'attempt-a', code_verification: { status: 'passed', proposal_sha256: 'one', valid: true } }, verifier);
    expect(result.replay_retirement_policy_version).toBe(1);
    expect(client.writes[0]).not.toHaveProperty('status');
    expect(client.filters).toContainEqual(['status', 'pending']);
    expect(client.filters).toContainEqual(['eval_summary->code_candidate->>attempt_id', 'attempt-a']);
    expect(client.filters).toContainEqual(['eval_summary->code_candidate->>status', 'running']);
    expect(client.filters).not.toContainEqual(['eval_summary', JSON.stringify(active.eval_summary)]);
});

test('initial claim pins the absent owner and behavior artifact identity without serializing eval_summary', async () => {
    const client = fakeClient(original);
    await recordCodeVerification(client, original, { code_candidate: claim() }, verifier);
    expect(client.filters).toContainEqual(['eval_summary->code_candidate', null]);
    expect(client.filters).toContainEqual(['eval_summary->behavior_tests->>sha256', HASH_B]);
    expect(client.filters.some(([field]) => field === 'eval_summary')).toBe(false);
});

test('large behavior evidence stays out of the CAS query and competing claims fail closed', async () => {
    const largeSummary = {
        ...original,
        eval_summary: {
            ...original.eval_summary,
            behavior_tests: { sha256: HASH_B, records: [{ explanation: 'private '.repeat(20000) }] },
        },
    };
    const competingClaim = fakeClient(largeSummary, []);
    await expect(recordCodeVerification(competingClaim, largeSummary, { code_candidate: claim() }, verifier)).rejects.toThrow('concurrently');
    expect(competingClaim.filters.some(([field]) => field === 'eval_summary')).toBe(false);
    expect(competingClaim.filters.every(([, value]) => typeof value !== 'string' || !value.includes('private'))).toBe(true);
    expect(JSON.stringify(competingClaim.filters).length).toBeLessThan(4096);

    const active = withClaim(claim());
    const staleOwner = fakeClient({ ...active, eval_summary: { ...active.eval_summary, code_candidate: { ...active.eval_summary.code_candidate, attempt_id: 'newer-owner' } } }, []);
    await expect(recordCodeVerification(staleOwner, original, { code_candidate: { ...claim(), status: 'verified' } }, verifier)).rejects.toThrow('ownership changed');
    expect(staleOwner.writes).toEqual([]);
});

test('invalid, stale or no-longer-pending proof cannot be written', async () => {
    const invalid = fakeClient(withClaim(claim()));
    await expect(recordCodeVerification(invalid, original, { attempt_id: 'attempt-a', code_verification: { status: 'passed', proposal_sha256: 'one', valid: false } }, verifier)).rejects.toThrow('proof failed');
    expect(invalid.writes).toEqual([]);
    const stale = fakeClient({ ...original, fingerprint: 'changed' });
    await expect(recordCodeVerification(stale, original, {}, verifier)).rejects.toThrow('changed');
    expect(stale.writes).toEqual([]);
    await expect(recordCodeVerification(fakeClient({ ...original, status: 'approved' }), original, {}, verifier)).rejects.toThrow('no longer pending');
    await expect(recordCodeVerification(fakeClient(original, []), original, { code_candidate: claim() }, verifier)).rejects.toThrow('concurrently');
});

test('a second host cannot steal a fresh running claim even with a changed source or force', async () => {
    const active = withClaim(claim());
    expect(shouldDraftCodeProposal(active, HASH, verifier, true)).toBe(false);
    const secondHost = fakeClient(active);
    await expect(recordCodeVerification(secondHost, original, { code_candidate: claim('attempt-b') }, verifier))
        .rejects.toThrow('already running');
    expect(secondHost.writes).toEqual([]);
});

test('same owner may update progress metadata but cannot rewrite frozen identity while running', async () => {
    const active = withClaim(claim());
    const progress = { ...claim(), phase: 'verification', completed: 2 };
    const result = await recordCodeVerification(fakeClient(active), original, { code_candidate: progress }, verifier);
    expect(result.code_candidate.phase).toBe('verification');
    await expect(recordCodeVerification(fakeClient(active), original, {
        code_candidate: { ...progress, expected_case_ids: ['menu-2', 'menu-1'] },
    }, verifier)).rejects.toThrow('frozen ordered case list');
    await expect(recordCodeVerification(fakeClient(active), original, {
        code_candidate: { ...progress, baseline_source_sha256: HASH },
    }, verifier)).rejects.toThrow('baseline_source_sha256');
});

test('an expired running attempt can be replaced but its late result cannot overwrite the new owner', async () => {
    const expired = claim('attempt-old', new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());
    const current = withClaim(expired);
    expect(shouldDraftCodeProposal(current, HASH_B, verifier)).toBe(true);
    const successor = claim('attempt-new');
    const reclaimed = await recordCodeVerification(fakeClient(current), original, { code_candidate: successor }, verifier);
    expect(reclaimed.code_candidate.attempt_id).toBe('attempt-new');
    const lateWorker = fakeClient(withClaim(successor));
    await expect(recordCodeVerification(lateWorker, original, {
        code_candidate: { ...expired, status: 'failed' },
    }, verifier)).rejects.toThrow('ownership changed');
    expect(lateWorker.writes).toEqual([]);
});

test('completion belongs to the running owner and cannot later be replaced by a failure', async () => {
    const active = claim();
    const done = { ...active, status: 'verified' };
    const result = await recordCodeVerification(fakeClient(withClaim(active)), original, {
        code_candidate: done, code_verification: { status: 'passed', proposal_sha256: 'one', valid: true },
    }, verifier);
    expect(result.code_candidate.status).toBe('verified');
    const closed = fakeClient(withClaim(done));
    await expect(recordCodeVerification(closed, original, { code_candidate: { ...done, status: 'failed' } }, verifier))
        .rejects.toThrow('already finished');
    expect(closed.writes).toEqual([]);
});

test('proof-only uploads cannot bypass an active owner', async () => {
    const active = withClaim(claim());
    const proof = { status: 'passed', proposal_sha256: 'one', valid: true };
    for (const attempt_id of [undefined, 'attempt-other']) {
        const client = fakeClient(active);
        await expect(recordCodeVerification(client, original, { attempt_id, code_verification: proof }, verifier))
            .rejects.toThrow('ownership');
        expect(client.writes).toEqual([]);
    }
    const result = await recordCodeVerification(fakeClient(active), original, { attempt_id: 'attempt-a', code_verification: proof }, verifier);
    expect(result.code_verification).toEqual(proof);
    await expect(recordCodeVerification(fakeClient(original), original, { attempt_id: 'attempt-a', code_verification: proof }))
        .rejects.toThrow('ownership');
});

test('missing attempt identity and unprovable expiry fail closed', async () => {
    await expect(recordCodeVerification(fakeClient(), original, { code_candidate: { status: 'running' } }, verifier))
        .rejects.toThrow('attempt_id');
    const invalid = withClaim({ ...claim(), started_at: 'invalid' });
    expect(shouldDraftCodeProposal(invalid, HASH_B, verifier, true)).toBe(false);
    await expect(recordCodeVerification(fakeClient(invalid), original, { code_candidate: claim('other') }, verifier))
        .rejects.toThrow('already running');
});

test('a fresh attempt clears previous proof and keeps frozen dataset and B6-D1 behavior immutable', async () => {
    const previous = { ...original, eval_summary: { ...original.eval_summary,
        code_candidate: { ...claim('old'), status: 'verified' },
        code_verification: { status: 'passed', valid: true },
    } };
    const active = { ...claim('new'), expected_dataset_sha256: HASH, expected_case_ids: ['a', 'b'], behavior_tests_sha256: HASH_B };
    const result = await recordCodeVerification(fakeClient(previous), original, { code_candidate: active }, verifier);
    expect(result).not.toHaveProperty('code_verification');
    await expect(recordCodeVerification(fakeClient(withClaim(active)), original, {
        code_candidate: { ...active, status: 'verified', expected_case_ids: ['a'] },
    }, verifier)).rejects.toThrow('frozen ordered case list');
    await expect(recordCodeVerification(fakeClient(withClaim(active)), original, {
        code_candidate: { ...active, status: 'verified', behavior_tests_sha256: 'changed' },
    }, verifier)).rejects.toThrow('behavior_tests_sha256');
});

test('new running claims require every immutable identity field and unique case IDs', async () => {
    for (const field of ['proposal_sha256', 'baseline_source_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256']) {
        const candidate = { ...claim(), [field]: 'placeholder' };
        await expect(recordCodeVerification(fakeClient(), original, { code_candidate: candidate }, verifier)).rejects.toThrow(field);
    }
    await expect(recordCodeVerification(fakeClient(), original, { code_candidate: { ...claim(), expected_case_ids: [] } }, verifier)).rejects.toThrow('expected_case_ids');
    await expect(recordCodeVerification(fakeClient(), original, { code_candidate: { ...claim(), expected_case_ids: ['menu-1', 'menu-1'] } }, verifier)).rejects.toThrow('expected_case_ids');
});

test('candidate ownership status transitions are allowlisted', async () => {
    for (const status of ['', 'draft', 'active', 'complete']) {
        await expect(recordCodeVerification(fakeClient(), original, { code_candidate: { ...claim(), status } }, verifier))
            .rejects.toThrow('status must be running, verified, failed, or blocked');
    }
    await expect(recordCodeVerification(fakeClient(), original, { code_candidate: { ...claim(), status: 'verified' } }, verifier))
        .rejects.toThrow('ownership');
});

test('post-draft identities may be added once to the running owner and are required thereafter', async () => {
    const initial = claim();
    for (const field of ['authorization_hash', 'scope_hash', 'c2b_handoff_sha256', 'candidate_source_sha256', 'draft_patch_sha256', 'draft_content_sha256', 'draft_response_sha256']) delete initial[field];
    const bound = claim();
    const current = withClaim(initial);
    const added = await recordCodeVerification(fakeClient(current), original, { code_candidate: bound }, verifier);
    expect(added.code_candidate.c2b_handoff_sha256).toBe(HASH);
    await expect(recordCodeVerification(fakeClient(withClaim(bound)), original, { code_candidate: { ...bound, candidate_source_sha256: HASH } }, verifier)).rejects.toThrow(/frozen candidate_source_sha256/);
    await expect(recordCodeVerification(fakeClient(withClaim(bound)), original, { code_candidate: { ...bound, status: 'verified' } }, verifier)).resolves.toBeTruthy();
});

test('failed or declaration-only proof is not persisted even when the declared status is not passed', async () => {
    const client = fakeClient(withClaim(claim()));
    await expect(recordCodeVerification(client, withClaim(claim()), {
        attempt_id: 'attempt-a', code_verification: { status: 'failed', proposal_sha256: 'one', valid: false },
    }, verifier)).rejects.toThrow('proof failed');
    expect(client.writes).toEqual([]);
});
