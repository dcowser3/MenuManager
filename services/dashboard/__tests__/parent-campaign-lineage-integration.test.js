const { buildParentCampaignLineage, validateParentCampaignLineage } = require('../../../scripts/lib/parent-campaign-lineage');
const { sha256 } = require('../../../scripts/lib/parent-campaign-lineage');
const { repairParentCampaignLineage } = require('../../../scripts/lib/parent-campaign-lineage-repair');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

test('actual repair resumes after interruption following digest replacement', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-repair-integration-'));
    try {
        const repairProposal = { ...proposal, fingerprint: H }; const proposalRoot = path.join(root, 'proposal'); fs.mkdirSync(proposalRoot, { recursive: true });
        const snapshotBody = { schema_version: 1, source: 'prompt_proposals', query: { pagination_complete: true, table: 'prompt_proposals' }, enumeration: { complete: true, count: 1, pages: 1, cutoff: 'cutoff' }, rows: [{ id: repairProposal.id, proposal_fingerprint: H }] };
        const snapshotDigest = sha256(snapshotBody); fs.writeFileSync(path.join(root, `pending-preparation-inventory-${snapshotDigest}.json`), `${JSON.stringify({ ...snapshotBody, snapshot_sha256: snapshotDigest })}\n`);
        const behavior = { schema_version: 1, records: [], tests: [], contextualTests: [] }; fs.writeFileSync(path.join(proposalRoot, 'behavior-tests.json'), `${JSON.stringify(behavior)}\n`);
        fs.writeFileSync(path.join(proposalRoot, 'prompt.txt'), 'prompt\n'); fs.writeFileSync(path.join(proposalRoot, 'dataset.jsonl'), '{"case_id":"case-1"}\n'); fs.writeFileSync(path.join(proposalRoot, 'rules.json'), '{"rules":[]}\n');
        require(require.resolve('ts-node/register/transpile-only', { paths: [process.cwd()] })); const behaviorHash = require(path.join(process.cwd(), 'services/dashboard/lib/learning-behavior-tests.ts')).hashBehaviorArtifact(behavior); const digestBytes = (file) => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        const inventory = { proposal_id: repairProposal.id, cycle_id: repairProposal.cycle_id, superseded_from_cycle_id: null, proposal_fingerprint: H, replay_policy_version: 1, enumeration: { complete: true, pages: 1, cutoff: 'cutoff', count: 1, row_ids: [repairProposal.id], global_snapshot_sha256: snapshotDigest }, query: snapshotBody.query, frozen_hashes: { behavior_tests_sha256: behaviorHash, dataset_sha256: digestBytes(path.join(proposalRoot, 'dataset.jsonl')), source_sha256: H, prompt_sha256: digestBytes(path.join(proposalRoot, 'prompt.txt')), accepted_rules_sha256: H } };
        fs.writeFileSync(path.join(proposalRoot, 'preparation-inventory.json'), `${JSON.stringify(inventory)}\n`);
        let interrupted = true; const c = client({ ...repairProposal, eval_summary: { ...repairProposal.eval_summary, parent_campaign_sha256: 'b'.repeat(64) }, xmin: '1' }); const read = async () => { const current = c.read(); if (interrupted && current.eval_summary?.parent_campaign_sha256 !== 'b'.repeat(64)) { interrupted = false; throw new Error('injected interruption'); } return current; };
        const verification = { codeProposalVerificationFingerprint: (p) => p.fingerprint, hashCodeImplementation: () => H, hashAcceptedRules: () => H };
        const opts = { client: c, proposal: repairProposal, attemptRoot: proposalRoot, outputRoot: root, expectedAttemptId: 'old-attempt', expectedExistingParentCampaignSha256: 'b'.repeat(64), repoRoot: process.cwd(), verification, readCurrentProposal: read };
        await expect(repairParentCampaignLineage(opts)).rejects.toThrow('injected interruption');
        const resumed = await repairParentCampaignLineage({ ...opts, readCurrentProposal: async () => c.read() });
        expect(resumed.status).toBe('repaired'); expect(c.read().eval_summary.code_candidate).toBeUndefined(); expect(c.read().eval_summary.parent_campaign_sha256).toMatch(/^[a-f0-9]{64}$/); expect(c.read().fingerprint).toBe(H);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
