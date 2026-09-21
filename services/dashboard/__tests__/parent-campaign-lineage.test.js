const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildParentCampaignLineage, validateParentCampaignLineage, persistParentCampaignLineage, readImmutablePendingSnapshot, sha256 } = require('../../../scripts/lib/parent-campaign-lineage');

const HASH = (n) => `${n}`.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a');
function fixture() {
    const proposal = { id: 'proposal-1', cycle_id: '2026-09-21', status: 'pending', correction_routing: [], replay_evidence: [] };
    const inventory = { proposal_id: proposal.id, cycle_id: proposal.cycle_id, superseded_from_cycle_id: null, proposal_fingerprint: HASH('p'), replay_policy_version: 1, query: { table: 'prompt_proposals', status: 'pending', pagination_complete: true }, enumeration: { complete: true, pages: 2, cutoff: '2026-09-21T00:00:00.000Z', rows_count: 1, row_ids: [proposal.id], global_snapshot_sha256: HASH('e') }, frozen_hashes: { behavior_tests_sha256: HASH('b'), dataset_sha256: HASH('d'), source_sha256: HASH('s'), prompt_sha256: HASH('r'), accepted_rules_sha256: HASH('a') } };
    return { proposal, inventory };
}

test('builds and validates canonical lineage without owner identities', () => {
    const { proposal, inventory } = fixture();
    const lineage = buildParentCampaignLineage({ proposal, inventory });
    expect(lineage.parent_campaign_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateParentCampaignLineage({ ...lineage, attempt_id: 'leak' })).toThrow(/owner or attempt/);
    expect(() => validateParentCampaignLineage({ ...lineage, frozen_hashes: { ...lineage.frozen_hashes, source_sha256: HASH('changed') } })).toThrow(/digest changed/);
    expect(() => buildParentCampaignLineage({ proposal, inventory: { ...inventory, enumeration: { ...inventory.enumeration, complete: false } } })).toThrow(/complete/);
});

test('persists private lineage and recovery evidence', () => {
    const { proposal, inventory } = fixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-lineage-'));
    try {
        const lineage = buildParentCampaignLineage({ proposal, inventory });
        const result = persistParentCampaignLineage(root, lineage, { repair: true });
        expect(result.parentCampaignSha256).toBe(lineage.parent_campaign_sha256);
        expect(fs.statSync(result.lineagePath).mode & 0o077).toBe(0);
        expect(JSON.parse(fs.readFileSync(result.recoveryPath)).parent_campaign_sha256).toBe(lineage.parent_campaign_sha256);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('requires the immutable pending snapshot bytes and self-hash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-snapshot-'));
    try {
        const body = { schema_version: 1, source: 'prompt_proposals', query: { pagination_complete: true }, enumeration: { complete: true, count: 1, pages: 1, cutoff: '2026-09-21T00:00:00.000Z' }, rows: [{ id: 'proposal-1' }] };
        const digest = sha256(body);
        fs.writeFileSync(path.join(root, `pending-preparation-inventory-${digest}.json`), `${JSON.stringify({ ...body, snapshot_sha256: digest })}\n`);
        expect(readImmutablePendingSnapshot(root, digest).row_ids).toEqual(['proposal-1']);
        fs.appendFileSync(path.join(root, `pending-preparation-inventory-${digest}.json`), 'tampered');
        expect(() => readImmutablePendingSnapshot(root, digest)).toThrow(/self-hash|JSON/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects a supplied envelope when its snapshot root or substantive binding is unavailable', () => {
    const { proposal, inventory } = fixture();
    const lineage = buildParentCampaignLineage({ proposal, inventory });
    expect(() => validateParentCampaignLineage({ ...lineage, pending_enumeration: { ...lineage.pending_enumeration, global_snapshot_sha256: 'b'.repeat(64) } }, { proposal })).toThrow(/digest changed|snapshot/);
});
