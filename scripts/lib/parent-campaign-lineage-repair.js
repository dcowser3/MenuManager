'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { buildParentCampaignLineage, persistParentCampaignLineage, validateParentCampaignLineage, readImmutablePendingSnapshot } = require('./parent-campaign-lineage');
const { recordParentCampaignLineage, closeCodeCandidateOwnerForLineageRepair, clearClosedCodeCandidateOwnerForLineageRepair, loadVerificationModule } = require('./proposal-verification-store');

function readAttemptInputs(attemptRoot) {
    const root = path.resolve(attemptRoot);
    const inventory = JSON.parse(fs.readFileSync(path.join(root, 'preparation-inventory.json'), 'utf8'));
    if (!inventory.frozen_hashes) throw new Error('Lineage repair requires frozen preparation hashes.');
    return { root, inventory };
}

function digestBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function actualFrozenHashes(root, repoRoot, verification) {
    const prompt = fs.readFileSync(path.join(root, 'prompt.txt'));
    const dataset = fs.readFileSync(path.join(root, 'dataset.jsonl'));
    const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules.json'), 'utf8'));
    const behaviorPath = path.join(root, 'behavior-tests.json');
    const behavior = JSON.parse(fs.readFileSync(behaviorPath, 'utf8'));
    const { sha256: _ignored, ...behaviorBody } = behavior;
    let behaviorModule;
    try { require(require.resolve('ts-node/register/transpile-only', { paths: [repoRoot] })); behaviorModule = require(path.join(repoRoot, 'services/dashboard/lib/learning-behavior-tests.ts')); }
    catch { behaviorModule = require(path.join(repoRoot, 'services/dashboard/dist/lib/learning-behavior-tests')); }
    return {
        behavior_tests_sha256: behaviorModule.hashBehaviorArtifact(behaviorBody),
        dataset_sha256: digestBytes(dataset),
        source_sha256: verification.hashCodeImplementation(repoRoot),
        prompt_sha256: digestBytes(prompt),
        accepted_rules_sha256: verification.hashAcceptedRules(rules.rules || []),
    };
}
function substantiveProjection(proposal) {
    const clone = JSON.parse(JSON.stringify(proposal));
    delete clone.xmin;
    if (clone.eval_summary) {
        delete clone.eval_summary.parent_campaign_sha256;
        delete clone.eval_summary.code_candidate;
        delete clone.eval_summary.code_verification;
    }
    return clone;
}

/**
 * Resumable, zero-provider repair for a prepared owner that predates the
 * parent lineage field. It never changes proposal content or approval state.
 */
async function repairParentCampaignLineage(options = {}) {
    const verification = options.verification || loadVerificationModule(options.repoRoot);
    const { root, inventory } = readAttemptInputs(options.attemptRoot);
    const proposal = options.proposal;
    const originalSubstantive = substantiveProjection(proposal);
    const assertSubstantive = (current) => { if (!isDeepStrictEqual(substantiveProjection(current), originalSubstantive)) throw new Error('Lineage repair substantive proposal state changed.'); };
    const snapshot = readImmutablePendingSnapshot(options.outputRoot || path.join(options.repoRoot, 'tmp', 'code-proposals'), inventory.enumeration.global_snapshot_sha256);
    const actualHashes = actualFrozenHashes(root, options.repoRoot, verification);
    for (const [field, value] of Object.entries(actualHashes)) {
        if (inventory.frozen_hashes[field] !== value) throw new Error(`Lineage repair frozen ${field} differs from preserved bytes.`);
    }
    const proposalFingerprint = verification.codeProposalVerificationFingerprint(proposal);
    if (proposalFingerprint !== inventory.proposal_fingerprint) throw new Error('Lineage repair substantive proposal fingerprint changed.');
    const snapshotRow = (JSON.parse(fs.readFileSync(path.join(options.outputRoot || path.join(options.repoRoot, 'tmp', 'code-proposals'), `pending-preparation-inventory-${inventory.enumeration.global_snapshot_sha256}.json`), 'utf8')).rows || []).find((row) => row.id === proposal.id);
    if (!snapshotRow || snapshotRow.proposal_fingerprint !== proposalFingerprint) throw new Error('Lineage repair proposal is absent or changed in the immutable pending snapshot.');
    const lineage = buildParentCampaignLineage({
        proposal,
        inventory,
        proposalFingerprint,
        frozenHashes: actualHashes,
        pendingEnumeration: snapshot,
    });
    validateParentCampaignLineage(lineage, { proposal });
    const recovery = persistParentCampaignLineage(root, lineage, { repair: true, prior_owner_attempt_id: options.expectedAttemptId });
    let current = await options.readCurrentProposal(options.client, proposal.id);
    assertSubstantive(current);
    if (!current || current.status !== 'pending') throw new Error('Lineage repair requires the exact pending proposal.');
    if (options.expectedExistingParentCampaignSha256 && current.eval_summary?.parent_campaign_sha256 !== options.expectedExistingParentCampaignSha256 && current.eval_summary?.parent_campaign_sha256 !== lineage.parent_campaign_sha256) throw new Error('Lineage repair existing parent digest differs from the explicitly authorized old or validated new digest.');
    const owner = current.eval_summary?.code_candidate;
    if (owner?.status === 'running') {
        if (owner.attempt_id !== options.expectedAttemptId) throw new Error('Lineage repair owner attempt differs from the expected attempt.');
        current = await closeCodeCandidateOwnerForLineageRepair(options.client, current, options.expectedAttemptId, verification);
        assertSubstantive(current);
    } else if (owner && !(owner.status === 'blocked' && owner.reason === 'parent_campaign_lineage_repair' && owner.attempt_id === options.expectedAttemptId)) {
        throw new Error('Lineage repair found a different terminal or active owner.');
    }
    if (current.eval_summary?.parent_campaign_sha256 !== lineage.parent_campaign_sha256) {
        current = await recordParentCampaignLineage(options.client, current, lineage, verification, { allowClosedOwner: true, expectedAttemptId: options.expectedAttemptId, replaceExistingDigest: !!options.expectedExistingParentCampaignSha256, expectedExistingDigest: options.expectedExistingParentCampaignSha256 });
        assertSubstantive(current);
    }
    current = await options.readCurrentProposal(options.client, proposal.id);
    assertSubstantive(current);
    if (current.eval_summary?.code_candidate?.status === 'blocked') {
        current = await clearClosedCodeCandidateOwnerForLineageRepair(options.client, current, options.expectedAttemptId, verification);
    }
    const readback = await options.readCurrentProposal(options.client, proposal.id);
    assertSubstantive(readback);
    if (readback.status !== 'pending' || readback.eval_summary?.parent_campaign_sha256 !== lineage.parent_campaign_sha256 || readback.eval_summary?.code_candidate || readback.eval_summary?.code_verification) throw new Error('Lineage repair readback changed owner/content state.');
    return { status: 'repaired', parentCampaignSha256: lineage.parent_campaign_sha256, recovery, proposal: readback };
}

module.exports = { readAttemptInputs, repairParentCampaignLineage };
