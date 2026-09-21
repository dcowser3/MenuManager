'use strict';

/**
 * Small outer coordinator for the human approval handoff. It selects one
 * owner-bound human explanation group from the improvement-cycle proposal,
 * prepares the existing code-candidate attempt, and stops before any provider
 * call when the separate code-candidate authorization/ledger is absent.
 */
const fs = require('fs');
const path = require('path');
const { prepareCodeProposalAttempt } = require('./code-proposal-preparation');
const { runPreparedCodeProposalLifecycle } = require('./code-proposal-lifecycle');

function routedRows(proposal) {
    return (Array.isArray(proposal?.correction_routing) ? proposal.correction_routing : [])
        .filter((row) => row?.lane === 'code_recommendation')
        .sort((a, b) => `${a.correction_id}`.localeCompare(`${b.correction_id}`));
}

function deliveryHeld(proposal) {
    const evidence = new Map((Array.isArray(proposal?.replay_evidence) ? proposal.replay_evidence : [])
        .filter((row) => row?.correction_id)
        .map((row) => [row.correction_id, row]));
    return routedRows(proposal)
        .filter((route) => route.replay_status === 'delivery_mismatch' || evidence.get(route.correction_id)?.status === 'delivery_mismatch')
        .map((route) => ({ correction_id: route.correction_id, status: 'delivery_verification_required', route: { ...route }, replay_evidence: evidence.get(route.correction_id) ? { ...evidence.get(route.correction_id) } : null }));
}

function selectBoundHumanExplanationGroup(proposal, correctionId) {
    const routes = routedRows(proposal);
    const route = correctionId ? routes.find((row) => row.correction_id === correctionId) : routes[0];
    if (!route) throw new Error('No code_recommendation human explanation is available for manual review.');
    const replayEvidence = (proposal.replay_evidence || []).filter((row) => row?.correction_id === route.correction_id);
    if (replayEvidence.length !== 1) throw new Error(`Human explanation ${route.correction_id} has no unique replay evidence.`);
    const behavior = proposal.eval_summary?.behavior_tests;
    const behaviorRecord = (behavior?.records || []).find((row) => row?.correctionId === route.correction_id);
    if (!behaviorRecord || behaviorRecord.expectationAuthority !== 'human_explanation') throw new Error(`Human explanation ${route.correction_id} is not bound to the frozen behavior artifact.`);
    return Object.freeze({
        correctionId: route.correction_id,
        route: { ...route },
        replayEvidence: { ...replayEvidence[0] },
        behaviorRecord: { ...behaviorRecord },
        rawHumanExplanation: {
            original_text: route.original_text,
            corrected_text: route.corrected_text,
            source: route.source || 'human',
            rule: route.rule || null,
            change_type: route.change_type || null,
        },
    });
}

function markBlocked(attempt, reason) {
    const file = path.join(attempt.artifactDirectory, 'candidate', 'progress.json');
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    const next = { ...existing, phase: 'analysis', state: 'blocked', reason, updated_at: new Date().toISOString() };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
    return next;
}

async function prepareManualCodeProposalReview(options = {}) {
    const boundGroup = selectBoundHumanExplanationGroup(options.proposal, options.correctionId);
    const heldDelivery = deliveryHeld(options.proposal);
    const prepared = await (options.prepareAttempt || prepareCodeProposalAttempt)({
        ...options,
        proposal: options.proposal,
    });
    const authorization = options.authorization || (options.authorizationFile && fs.existsSync(options.authorizationFile)
        ? JSON.parse(fs.readFileSync(options.authorizationFile, 'utf8'))
        : null);
    if (!authorization || authorization.stage !== 'code-candidate' || authorization.status !== 'active') {
        const progress = markBlocked(prepared, 'code_candidate_authorization_required');
        return { status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0, attemptId: prepared.attemptId, artifactDirectory: prepared.artifactDirectory, boundGroup, deliveryHolds: heldDelivery, progress };
    }
    if (!options.validatedDraftResult) {
        return { status: 'ready_for_manual_review', reason: 'validated_draft_required', providerCalls: 0, attemptId: prepared.attemptId, artifactDirectory: prepared.artifactDirectory, boundGroup, deliveryHolds: heldDelivery, progress: JSON.parse(fs.readFileSync(path.join(prepared.artifactDirectory, 'candidate', 'progress.json'), 'utf8')) };
    }
    if (heldDelivery.length) {
        return { status: 'ready_for_manual_review', reason: 'delivery_verification_required', providerCalls: 0, attemptId: prepared.attemptId, artifactDirectory: prepared.artifactDirectory, boundGroup, deliveryHolds: heldDelivery, progress: JSON.parse(fs.readFileSync(path.join(prepared.artifactDirectory, 'candidate', 'progress.json'), 'utf8')) };
    }
    const lifecycle = await (options.runPreparedLifecycle || runPreparedCodeProposalLifecycle)({
        ...options,
        proposal: options.proposal,
        originalProposal: options.proposal,
        attemptRoot: prepared.artifactDirectory,
        metadata: prepared.metadata,
        candidateRoot: path.join(prepared.artifactDirectory, 'candidate'),
        handoffPath: path.join(prepared.artifactDirectory, 'c2b-handoff.json'),
        validatedDraftResult: options.validatedDraftResult,
    });
    return { status: 'ready_for_manual_review', providerCalls: 0, attemptId: prepared.attemptId, artifactDirectory: prepared.artifactDirectory, boundGroup, deliveryHolds: heldDelivery, lifecycle };
}

module.exports = { routedRows, deliveryHeld, selectBoundHumanExplanationGroup, prepareManualCodeProposalReview };
