'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIGEST = /^[a-f0-9]{64}$/;
const VERSION = 1;

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}

function sha256(value) {
    return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(canonical(value)))).digest('hex');
}

function requireDigest(value, label) {
    if (!DIGEST.test(value || '')) throw new Error(`Parent campaign lineage requires a valid ${label} digest.`);
    return value;
}

function requireEnumeration(enumeration) {
    if (!enumeration || enumeration.complete !== true || !Number.isInteger(enumeration.pages) || enumeration.pages < 1
        || !Number.isInteger(enumeration.rows_count) || enumeration.rows_count < 1 || !Array.isArray(enumeration.row_ids)
        || enumeration.row_ids.length !== enumeration.rows_count || new Set(enumeration.row_ids).size !== enumeration.row_ids.length
        || !enumeration.cutoff || !enumeration.query || enumeration.query.pagination_complete !== true
        || !DIGEST.test(enumeration.global_snapshot_sha256 || '')) {
        throw new Error('Parent campaign lineage requires a complete pending-proposal enumeration.');
    }
    return {
        complete: true,
        cutoff: enumeration.cutoff,
        pages: enumeration.pages,
        query: canonical(enumeration.query),
        row_ids: [...enumeration.row_ids],
        rows_count: enumeration.rows_count,
        global_snapshot_sha256: enumeration.global_snapshot_sha256,
    };
}

function readImmutablePendingSnapshot(outputRoot, snapshotSha256) {
    requireDigest(snapshotSha256, 'pending enumeration snapshot');
    const file = path.join(path.resolve(outputRoot), `pending-preparation-inventory-${snapshotSha256}.json`);
    const bytes = fs.readFileSync(file);
    const snapshot = JSON.parse(bytes);
    const { snapshot_sha256: actual, ...body } = snapshot;
    if (actual !== snapshotSha256 || sha256(body) !== snapshotSha256) throw new Error('Pending enumeration snapshot bytes or self-hash changed.');
    if (body.schema_version !== 1 || body.source !== 'prompt_proposals' || body.query?.pagination_complete !== true
        || body.enumeration?.complete !== true || !Array.isArray(body.rows) || body.enumeration.count !== body.rows.length
        || new Set(body.rows.map((row) => row.id)).size !== body.rows.length) throw new Error('Pending enumeration snapshot is incomplete.');
    return {
        complete: true,
        cutoff: body.enumeration.cutoff,
        pages: body.enumeration.pages,
        query: body.query,
        row_ids: body.rows.map((row) => row.id),
        rows_count: body.rows.length,
        global_snapshot_sha256: snapshotSha256,
    };
}

function buildParentCampaignLineage(options = {}) {
    const proposal = options.proposal;
    const inventory = options.inventory;
    const frozen = options.frozenHashes || inventory?.frozen_hashes;
    if (!proposal?.id || !inventory?.proposal_id || inventory.proposal_id !== proposal.id) throw new Error('Parent campaign lineage proposal identity is incomplete.');
    if (inventory.cycle_id !== (proposal.cycle_id || null) || inventory.superseded_from_cycle_id !== (proposal.superseded_from_cycle_id || null)) throw new Error('Parent campaign lineage cycle identity differs from the proposal.');
    const proposalFingerprint = requireDigest(options.proposalFingerprint || inventory.proposal_fingerprint, 'proposal');
    const body = {
        schema_version: VERSION,
        source: 'prepared_proposal_inputs',
        proposal: { id: proposal.id, cycle_id: proposal.cycle_id || null, superseded_from_cycle_id: proposal.superseded_from_cycle_id || null, proposal_fingerprint: proposalFingerprint },
        replay_policy_version: inventory.replay_policy_version,
        frozen_hashes: {
            behavior_tests_sha256: requireDigest(frozen?.behavior_tests_sha256, 'behavior tests'),
            dataset_sha256: requireDigest(frozen?.dataset_sha256, 'dataset'),
            source_sha256: requireDigest(frozen?.source_sha256, 'source'),
            prompt_sha256: requireDigest(frozen?.prompt_sha256, 'prompt'),
            accepted_rules_sha256: requireDigest(frozen?.accepted_rules_sha256, 'accepted rules'),
        },
        pending_enumeration: requireEnumeration(options.pendingEnumeration || { ...(inventory.enumeration || {}), ...(options.enumeration || {}), query: options.enumeration?.query || inventory.query }),
    };
    const parent_campaign_sha256 = sha256(body);
    return Object.freeze({ ...body, parent_campaign_sha256 });
}

function validateParentCampaignLineage(envelope, options = {}) {
    if (!envelope || envelope.schema_version !== VERSION || envelope.source !== 'prepared_proposal_inputs') throw new Error('Parent campaign lineage envelope version/source is invalid.');
    if (Object.prototype.hasOwnProperty.call(envelope, 'attempt_id') || Object.prototype.hasOwnProperty.call(envelope, 'authorization_id') || Object.prototype.hasOwnProperty.call(envelope, 'owner')) throw new Error('Parent campaign lineage must not contain owner or attempt identities.');
    const { parent_campaign_sha256: actual, ...body } = envelope;
    requireDigest(actual, 'parent campaign');
    if (sha256(body) !== actual) throw new Error('Parent campaign lineage digest changed.');
    if (options.proposal && (body.proposal.id !== options.proposal.id || body.proposal.cycle_id !== (options.proposal.cycle_id || null))) throw new Error('Parent campaign lineage proposal identity changed.');
    requireEnumeration(body.pending_enumeration);
    return Object.freeze(envelope);
}

function persistParentCampaignLineage(attemptRoot, envelope, recovery = {}) {
    validateParentCampaignLineage(envelope);
    const root = path.resolve(attemptRoot);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const write = (name, value) => {
        const file = path.join(root, name);
        const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(canonical(value), null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temp, file);
        fs.chmodSync(file, 0o600);
        return file;
    };
    const lineagePath = write('parent-campaign-lineage.json', envelope);
    const recoveryEvidence = { schema_version: 1, source: 'parent_campaign_lineage_recovery', parent_campaign_sha256: envelope.parent_campaign_sha256, proposal: envelope.proposal, frozen_hashes: envelope.frozen_hashes, pending_enumeration: envelope.pending_enumeration, ...recovery };
    const recoveryPath = write('parent-campaign-lineage-recovery.json', recoveryEvidence);
    return { lineagePath, recoveryPath, parentCampaignSha256: envelope.parent_campaign_sha256 };
}

module.exports = { VERSION, canonical, sha256, buildParentCampaignLineage, validateParentCampaignLineage, persistParentCampaignLineage, readImmutablePendingSnapshot };
