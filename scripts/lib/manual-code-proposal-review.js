'use strict';

/**
 * Small outer coordinator for the human approval handoff. It binds every
 * code-recommendation group in one proposal to the same owner attempt,
 * prepares the existing code-candidate attempt, and stops before any provider
 * call when the separate code-candidate authorization/ledger is absent.
 */
const fs = require('fs');
const path = require('path');
const { prepareCodeProposalAttempt } = require('./code-proposal-preparation');
const { runPreparedCodeProposalLifecycle } = require('./code-proposal-lifecycle');
const { dispatchCodeDraft } = require('../auto-code-proposal');

function routedRows(proposal) {
    return (Array.isArray(proposal?.correction_routing) ? proposal.correction_routing : [])
        .filter((row) => row?.lane === 'code_recommendation')
        .sort((a, b) => `${a.correction_id}`.localeCompare(`${b.correction_id}`));
}

function identity(value) {
    return value == null || `${value}` === '' ? null : `${value}`;
}

function requireConsistentIdentity(label, values) {
    const present = values.map(identity).filter(Boolean);
    if (!present.length || present.some((value) => value !== present[0])) throw new Error(`Human explanation binding has inconsistent ${label} authority.`);
    return present[0];
}

function requireConsistentText(correctionId, label, values) {
    const present = values.filter((value) => typeof value === 'string' && value.length > 0);
    if (present.length !== values.length || present.some((value) => value !== present[0])) throw new Error(`Human explanation ${correctionId} has inconsistent ${label} authority.`);
    return present[0];
}

function selectBoundHumanExplanationGroups(proposal) {
    const routes = routedRows(proposal);
    if (!routes.length) throw new Error('No code_recommendation human explanation is available for manual review.');
    const evidence = Array.isArray(proposal?.replay_evidence) ? proposal.replay_evidence : [];
    const behaviorRecords = Array.isArray(proposal?.eval_summary?.behavior_tests?.records)
        ? proposal.eval_summary.behavior_tests.records
        : [];
    const seenRoutes = new Set();
    const groups = routes.map((route) => {
        const correctionId = identity(route.correction_id);
        if (!correctionId || seenRoutes.has(correctionId)) throw new Error(`Human explanation ${correctionId || '(missing)'} has a non-unique route binding.`);
        seenRoutes.add(correctionId);
        const replayMatches = evidence.filter((row) => identity(row?.correction_id) === correctionId);
        if (replayMatches.length !== 1) throw new Error(`Human explanation ${correctionId} has no unique replay evidence.`);
        const replayEvidence = replayMatches[0];
        const behaviorMatches = behaviorRecords.filter((row) => identity(row?.correctionId) === correctionId);
        if (behaviorMatches.length !== 1) throw new Error(`Human explanation ${correctionId} has no unique behavior record.`);
        const behaviorRecord = behaviorMatches[0];
        if (behaviorRecord.expectationAuthority !== 'human_explanation') throw new Error(`Human explanation ${correctionId} is not bound to the frozen behavior artifact.`);

        const submissionId = requireConsistentIdentity('submission', [route.submission_id, replayEvidence.submission_id, behaviorRecord.submissionId ?? behaviorRecord.submission_id]);
        const caseId = requireConsistentIdentity('case', [route.case_id, replayEvidence.case_id, behaviorRecord.caseId ?? behaviorRecord.case_id]);
        const originalText = requireConsistentText(correctionId, 'original text', [route.original_text, replayEvidence.original_text, behaviorRecord.inputSpan?.text]);
        const correctedText = requireConsistentText(correctionId, 'corrected text', [route.corrected_text, replayEvidence.corrected_text, behaviorRecord.expectedSpan?.text]);
        const held = route.replay_status === 'delivery_mismatch' || replayEvidence.status === 'delivery_mismatch';
        return Object.freeze({
            correctionId,
            route: { ...route },
            replayEvidence: { ...replayEvidence },
            behaviorRecord: { ...behaviorRecord },
            submissionId,
            caseId,
            originalText,
            correctedText,
            deliveryHeld: held,
            rawHumanExplanation: {
                original_text: originalText,
                corrected_text: correctedText,
                source: route.source || 'human',
                rule: route.rule || null,
                change_type: route.change_type || null,
            },
        });
    });
    return Object.freeze(groups);
}

function deliveryHeld(proposal) {
    return selectBoundHumanExplanationGroups(proposal)
        .filter((group) => group.deliveryHeld)
        .map((group) => ({
            correction_id: group.correctionId,
            status: 'delivery_verification_required',
            route: { ...group.route },
            replay_evidence: { ...group.replayEvidence },
        }));
}

function selectBoundHumanExplanationGroup(proposal, correctionId) {
    const groups = selectBoundHumanExplanationGroups(proposal);
    const group = correctionId ? groups.find((candidate) => candidate.correctionId === correctionId) : groups[0];
    if (!group) throw new Error(`No code_recommendation human explanation is available for ${correctionId}.`);
    return group;
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

async function readLiveOwner(options, attemptId) {
    const reader = options.readCurrentProposal || options.store?.readCurrentProposal;
    let result;
    if (typeof reader === 'function') result = await reader(options.client, options.proposal.id);
    else if (options.client?.from) {
        result = await options.client.from('prompt_proposals').select('*').eq('id', options.proposal.id).single();
        if (result?.error) throw new Error(`live owner read failed: ${result.error.message}`);
        result = result?.data;
    } else return null;
    const claim = result?.eval_summary?.code_candidate;
    if (!claim || claim.attempt_id !== attemptId || claim.status !== 'running') throw new Error('live owner claim is missing, changed, or no longer running');
    return result;
}

async function prepareManualCodeProposalReview(options = {}) {
    const boundGroups = selectBoundHumanExplanationGroups(options.proposal);
    const boundGroup = options.correctionId
        ? boundGroups.find((group) => group.correctionId === options.correctionId)
        : boundGroups[0];
    if (!boundGroup) throw new Error(`No code_recommendation human explanation is available for ${options.correctionId}.`);
    const heldDelivery = boundGroups.filter((group) => group.deliveryHeld).map((group) => ({
        correction_id: group.correctionId,
        status: 'delivery_verification_required',
        route: { ...group.route },
        replay_evidence: { ...group.replayEvidence },
    }));
    const prepared = options.existingAttempt || await (options.prepareAttempt || prepareCodeProposalAttempt)({ ...options, proposal: options.proposal });
    const common = { attemptId: prepared.attemptId, artifactDirectory: prepared.artifactDirectory, boundGroup, boundGroups, deliveryHolds: heldDelivery };
    if (heldDelivery.length) {
        return { status: 'ready_for_manual_review', reason: 'delivery_verification_required', providerCalls: 0, ...common, progress: JSON.parse(fs.readFileSync(path.join(prepared.artifactDirectory, 'candidate', 'progress.json'), 'utf8')) };
    }
    const authorization = options.authorization || (options.authorizationFile && fs.existsSync(options.authorizationFile)
        ? JSON.parse(fs.readFileSync(options.authorizationFile, 'utf8'))
        : null);
    if (!authorization || authorization.stage !== 'code-candidate' || authorization.status !== 'active') {
        const progress = markBlocked(prepared, 'code_candidate_authorization_required');
        return { status: 'blocked', reason: 'code_candidate_authorization_required', providerCalls: 0, ...common, progress };
    }
    let validatedDraftResult = options.validatedDraftResult;
    let providerCalls = 0;
    if (!validatedDraftResult) {
        if (!options.authorizationFile || !options.stateFile || !options.messages || !options.trustedRoot || !options.repoRoot) {
            return { status: 'ready_for_manual_review', reason: 'validated_draft_required', providerCalls: 0, ...common, progress: JSON.parse(fs.readFileSync(path.join(prepared.artifactDirectory, 'candidate', 'progress.json'), 'utf8')) };
        }
        const liveOwner = await readLiveOwner(options, prepared.attemptId);
        try {
            validatedDraftResult = await (options.dispatchDraft || dispatchCodeDraft)({
                ...options,
                ...prepared,
                ...(liveOwner ? { proposal: liveOwner } : {}),
                attemptRoot: prepared.artifactDirectory,
                trustedRoot: options.trustedRoot,
                sourceRoot: options.repoRoot,
                parentCampaignSha256: options.proposal.parent_campaign_sha256 || options.proposal.eval_summary?.parent_campaign_sha256,
                authorizationFile: options.authorizationFile,
                stateFile: options.stateFile,
            });
        } catch (error) {
            error.providerCallAttempted = true;
            markBlocked(prepared, 'draft_dispatch_failed');
            throw error;
        }
        providerCalls = 1;
    }
    const progressPath = path.join(prepared.artifactDirectory, 'candidate', 'progress.json');
    const currentProgress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    if (currentProgress.state === 'blocked' && currentProgress.reason === 'code_candidate_authorization_required') {
        const resumed = { ...currentProgress, phase: 'verification', state: 'blocked', reason: 'authorization_supplied', updated_at: new Date().toISOString() };
        fs.writeFileSync(progressPath, `${JSON.stringify(resumed, null, 2)}\n`, { mode: 0o600 });
    }
    const lifecycle = await (options.runPreparedLifecycle || runPreparedCodeProposalLifecycle)({
        ...options,
        proposal: options.proposal,
        originalProposal: options.proposal,
        attemptRoot: prepared.artifactDirectory,
        metadata: prepared.metadata,
        candidateRoot: path.join(prepared.artifactDirectory, 'candidate'),
        handoffPath: path.join(prepared.artifactDirectory, 'c2b-handoff.json'),
        validatedDraftResult,
        resume: currentProgress.state === 'blocked',
    });
    return { status: 'ready_for_manual_review', providerCalls, ...common, lifecycle };
}

module.exports = { routedRows, deliveryHeld, selectBoundHumanExplanationGroups, selectBoundHumanExplanationGroup, prepareManualCodeProposalReview };
