'use strict';

const fs = require('fs');
const path = require('path');
const { buildParentCampaignLineage, persistParentCampaignLineage, validateParentCampaignLineage } = require('./parent-campaign-lineage');
const { recordParentCampaignLineage, closeCodeCandidateOwnerForLineageRepair, clearClosedCodeCandidateOwnerForLineageRepair, loadVerificationModule } = require('./proposal-verification-store');

function readAttemptInputs(attemptRoot) {
    const root = path.resolve(attemptRoot);
    const inventory = JSON.parse(fs.readFileSync(path.join(root, 'preparation-inventory.json'), 'utf8'));
    if (!inventory.frozen_hashes) throw new Error('Lineage repair requires frozen preparation hashes.');
    return { root, inventory };
}

/**
 * Resumable, zero-provider repair for a prepared owner that predates the
 * parent lineage field. It never changes proposal content or approval state.
 */
async function repairParentCampaignLineage(options = {}) {
    const verification = options.verification || loadVerificationModule(options.repoRoot);
    const { root, inventory } = readAttemptInputs(options.attemptRoot);
    const proposal = options.proposal;
    const lineage = buildParentCampaignLineage({
        proposal,
        inventory,
        proposalFingerprint: inventory.proposal_fingerprint,
        frozenHashes: inventory.frozen_hashes,
        enumeration: options.enumeration ? { ...options.enumeration, query: { ...(options.enumeration.query || {}), pagination_complete: true } } : { ...(inventory.enumeration || {}), query: inventory.query },
    });
    validateParentCampaignLineage(lineage, { proposal });
    const recovery = persistParentCampaignLineage(root, lineage, { repair: true, prior_owner_attempt_id: options.expectedAttemptId });
    let current = await options.readCurrentProposal(options.client, proposal.id);
    if (!current || current.status !== 'pending') throw new Error('Lineage repair requires the exact pending proposal.');
    const owner = current.eval_summary?.code_candidate;
    if (owner?.status === 'running') {
        if (owner.attempt_id !== options.expectedAttemptId) throw new Error('Lineage repair owner attempt differs from the expected attempt.');
        current = await closeCodeCandidateOwnerForLineageRepair(options.client, current, options.expectedAttemptId, verification);
    } else if (owner && !(owner.status === 'blocked' && owner.reason === 'parent_campaign_lineage_repair' && owner.attempt_id === options.expectedAttemptId)) {
        throw new Error('Lineage repair found a different terminal or active owner.');
    }
    if (current.eval_summary?.parent_campaign_sha256 !== lineage.parent_campaign_sha256) {
        current = await recordParentCampaignLineage(options.client, current, lineage, verification, { allowClosedOwner: true, expectedAttemptId: options.expectedAttemptId });
    }
    current = await options.readCurrentProposal(options.client, proposal.id);
    if (current.eval_summary?.code_candidate?.status === 'blocked') {
        current = await clearClosedCodeCandidateOwnerForLineageRepair(options.client, current, options.expectedAttemptId, verification);
    }
    const readback = await options.readCurrentProposal(options.client, proposal.id);
    if (readback.status !== 'pending' || readback.eval_summary?.parent_campaign_sha256 !== lineage.parent_campaign_sha256 || readback.eval_summary?.code_candidate || readback.eval_summary?.code_verification) throw new Error('Lineage repair readback changed owner/content state.');
    return { status: 'repaired', parentCampaignSha256: lineage.parent_campaign_sha256, recovery, proposal: readback };
}

module.exports = { readAttemptInputs, repairParentCampaignLineage };
