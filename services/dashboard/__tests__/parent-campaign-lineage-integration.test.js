const { buildParentCampaignLineage, validateParentCampaignLineage } = require('../../../scripts/lib/parent-campaign-lineage');
const { recordParentCampaignLineage, closeCodeCandidateOwnerForLineageRepair, clearClosedCodeCandidateOwnerForLineageRepair } = require('../../../scripts/lib/proposal-verification-store');

const H = 'a'.repeat(64);
const verifier = { codeProposalVerificationFingerprint: (p) => p.fingerprint };
const claim = { attempt_id: 'old-attempt', status: 'running', proposal_sha256: H, baseline_source_sha256: H, expected_dataset_sha256: H, behavior_tests_sha256: H, prompt_sha256: H, accepted_rules_sha256: H, expected_case_ids: ['case-1'], started_at: new Date().toISOString() };
const proposal = { id: 'p-integration', status: 'pending', fingerprint: 'stable', cycle_id: 'cycle', correction_routing: [], replay_evidence: [], eval_summary: { behavior_tests: { sha256: H }, replay_retirement_policy_version: 1, code_candidate: claim } };
function client(initial) {
    let state = { ...initial, xmin: '1' };
    return { read: () => state, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state }) }) }), update: (patch) => { const q = { eq: (key, value) => { if (key === 'xmin' && `${state.xmin}` !== `${value}`) q.result = []; return q; }, is: () => q, select: async () => { if (q.result) return { data: [] }; state = { ...state, ...patch, xmin: `${Number(state.xmin) + 1}` }; return { data: [{ id: state.id }] }; } }; return q; } }) };
}
function envelope() {
    return buildParentCampaignLineage({ proposal: { ...proposal, eval_summary: { behavior_tests: { sha256: H }, replay_retirement_policy_version: 1 } }, inventory: { proposal_id: proposal.id, cycle_id: proposal.cycle_id, superseded_from_cycle_id: null, proposal_fingerprint: H, replay_policy_version: 1, query: { pagination_complete: true, table: 'prompt_proposals' }, enumeration: { complete: true, pages: 1, cutoff: 'cutoff', rows_count: 1, row_ids: [proposal.id], global_snapshot_sha256: H }, frozen_hashes: { behavior_tests_sha256: H, dataset_sha256: H, source_sha256: H, prompt_sha256: H, accepted_rules_sha256: H } } });
}

test('PostgREST-shaped xmin repair closes, replaces wrong digest, and clears owner', async () => {
    const oldDigest = 'b'.repeat(64); const current = { ...proposal, eval_summary: { ...proposal.eval_summary, parent_campaign_sha256: oldDigest } }; const c = client(current); const e = envelope();
    await closeCodeCandidateOwnerForLineageRepair(c, current, 'old-attempt', verifier);
    await recordParentCampaignLineage(c, c.read(), e, verifier, { allowClosedOwner: true, expectedAttemptId: 'old-attempt', replaceExistingDigest: true, expectedExistingDigest: oldDigest });
    await clearClosedCodeCandidateOwnerForLineageRepair(c, c.read(), 'old-attempt', verifier);
    expect(c.read().eval_summary.parent_campaign_sha256).toBe(e.parent_campaign_sha256);
    expect(c.read().eval_summary.code_candidate).toBeUndefined();
});

test('xmin race rejects a stale transition without changing state', async () => {
    const c = client(proposal); const e = envelope(); const stale = { ...proposal, xmin: '0' };
    await expect(recordParentCampaignLineage(c, stale, e, verifier)).rejects.toThrow(/concurrently|xmin|owner/);
    expect(c.read().eval_summary.code_candidate.status).toBe('running');
});

test('supplied lineage remains independently schema-valid and provider-free', () => {
    const e = envelope(); expect(() => validateParentCampaignLineage(e, { proposal })).not.toThrow();
});
