'use strict';

const path = require('path');
const { validateParentCampaignLineage } = require('./parent-campaign-lineage');
const fs = require('fs');
const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
const DIGEST = /^[a-f0-9]{64}$/;
const TERMINAL_STATUSES = new Set(['verified', 'failed', 'blocked']);
const POST_DRAFT_IDENTITY_FIELDS = [
    'authorization_hash', 'scope_hash', 'c2b_handoff_sha256', 'candidate_source_sha256',
    'draft_patch_sha256', 'draft_content_sha256', 'draft_response_sha256',
];
const FROZEN_CANDIDATE_IDENTITY_FIELDS = [
    'proposal_sha256', 'baseline_source_sha256', 'expected_dataset_sha256',
    'behavior_tests_sha256', 'prompt_sha256', 'accepted_rules_sha256',
    'preparation_inventory_sha256', 'parent_campaign_sha256', ...POST_DRAFT_IDENTITY_FIELDS,
];
function requireXmin(current) {
    if (!current || current.xmin === undefined || current.xmin === null || `${current.xmin}` === '') throw new Error('Proposal CAS requires xmin.');
    return current;
}

function assertClaimIdentity(candidate) {
    const required = ['proposal_sha256', 'baseline_source_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256', 'prompt_sha256', 'accepted_rules_sha256'];
    for (const field of required) {
        if (typeof candidate?.[field] !== 'string' || !DIGEST.test(candidate[field])) {
            throw new Error(`Running code candidate claims require a valid ${field}.`);
        }
    }
    if (!Array.isArray(candidate.expected_case_ids) || candidate.expected_case_ids.length === 0
        || candidate.expected_case_ids.some((id) => typeof id !== 'string' || !id.trim())
        || new Set(candidate.expected_case_ids).size !== candidate.expected_case_ids.length) {
        throw new Error('Running code candidate claims require a nonempty unique expected_case_ids list.');
    }
}

function assertFrozenIdentity(previous, incoming) {
    for (const field of ['proposal_sha256', 'baseline_source_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256', 'prompt_sha256', 'accepted_rules_sha256', 'preparation_inventory_sha256', 'parent_campaign_sha256']) {
        if (incoming[field] !== previous[field]) throw new Error(`Candidate completion differs in frozen ${field}.`);
    }
    if (incoming.preparation_inventory_sha256 !== undefined && !DIGEST.test(incoming.preparation_inventory_sha256)) throw new Error('Candidate preparation inventory identity is invalid.');
    if (JSON.stringify(incoming.expected_case_ids) !== JSON.stringify(previous.expected_case_ids)) {
        throw new Error('Candidate completion differs in the frozen ordered case list.');
    }
    for (const field of POST_DRAFT_IDENTITY_FIELDS) {
        if (previous[field] !== undefined && incoming[field] !== previous[field]) {
            throw new Error(`Candidate completion differs in frozen ${field}.`);
        }
        if (incoming[field] !== undefined && (!DIGEST.test(incoming[field]) || typeof incoming[field] !== 'string')) {
            throw new Error(`Candidate completion requires a valid ${field}.`);
        }
    }
}

function assertPostDraftIdentities(candidate, status) {
    const supplied = POST_DRAFT_IDENTITY_FIELDS.filter((field) => candidate?.[field] !== undefined);
    if (supplied.length && supplied.length !== POST_DRAFT_IDENTITY_FIELDS.length) {
        throw new Error('Post-draft candidate identities must be added as one immutable owner-bound set.');
    }
    if (status === 'verified') {
        for (const field of POST_DRAFT_IDENTITY_FIELDS) {
            if (!DIGEST.test(candidate?.[field] || '')) throw new Error(`Verified candidate claims require a valid ${field}.`);
        }
    }
}

/**
 * Add only bounded JSON-path ownership predicates to the write CAS. The
 * previous implementation compared the complete eval_summary JSON, which can
 * exceed proxy URL limits when behavior evidence is large. The update body
 * still carries the complete summary, but no private evidence is placed in
 * the query string.
 */
function addEvaluationCasPredicates(query, current) {
    const previous = current.eval_summary?.code_candidate;
    if (previous == null) {
        query = query.is('eval_summary->code_candidate', null);
        const behavior = current.eval_summary?.behavior_tests;
        if (behavior == null) return query.is('eval_summary->behavior_tests', null);
        if (typeof behavior.sha256 !== 'string' || !DIGEST.test(behavior.sha256)) {
            throw new Error('Initial candidate claims require an immutable behavior artifact identity.');
        }
        return query.eq('eval_summary->behavior_tests->>sha256', behavior.sha256);
    }
    if (typeof previous !== 'object' || Array.isArray(previous)
        || typeof previous.attempt_id !== 'string' || !previous.attempt_id.trim()
        || typeof previous.status !== 'string' || !previous.status.trim()) {
        throw new Error('Current candidate owner identity is invalid.');
    }
    query = query.eq('eval_summary->code_candidate->>attempt_id', previous.attempt_id)
        .eq('eval_summary->code_candidate->>status', previous.status);
    for (const field of FROZEN_CANDIDATE_IDENTITY_FIELDS) {
        if (previous[field] !== undefined) query = query.eq(`eval_summary->code_candidate->>${field}`, field === 'expected_case_ids' ? JSON.stringify(previous[field]) : previous[field]);
    }
    return query;
}

function runningClaimIsFresh(candidate, now = Date.now()) {
    if (candidate?.status !== 'running') return false;
    const started = Date.parse(candidate.started_at || '');
    // An invalid timestamp is not proof that another worker's claim expired.
    return !Number.isFinite(started) || now - started <= CLAIM_TTL_MS;
}

function assertAttemptOwnership(current, patch) {
    const previous = current.eval_summary?.code_candidate;
    const incoming = patch.code_candidate;
    if (incoming) {
        if (typeof incoming.attempt_id !== 'string' || !incoming.attempt_id.trim()) throw new Error('Code candidate writes require an attempt_id.');
        if (incoming.status !== 'running' && !TERMINAL_STATUSES.has(incoming.status)) {
            throw new Error('Code candidate status must be running, verified, failed, or blocked.');
        }
        assertPostDraftIdentities(incoming, incoming.status);
        if (incoming.status === 'running') {
            assertClaimIdentity(incoming);
            if (!Number.isFinite(Date.parse(incoming.started_at || ''))) throw new Error('A running candidate claim requires a valid start time.');
            if (previous?.attempt_id === incoming.attempt_id && previous.status !== 'running') {
                throw new Error('This candidate attempt has already finished; use a new attempt_id.');
            }
            if (previous?.attempt_id === incoming.attempt_id) assertFrozenIdentity(previous, incoming);
            if (previous?.attempt_id !== incoming.attempt_id && runningClaimIsFresh(previous)) {
                throw new Error('Another code-proposal attempt is already running.');
            }
        } else {
            if (!previous?.attempt_id || previous.attempt_id !== incoming.attempt_id) {
                throw new Error('Candidate attempt ownership changed; the old worker cannot overwrite newer evidence.');
            }
            if (previous.status !== 'running') throw new Error('This candidate attempt has already finished; its evidence cannot be overwritten.');
            assertFrozenIdentity(previous, incoming);
        }
    } else if (patch.code_verification) {
        // Standalone proof uploads must not steal an automatic worker's result.
        // An explicitly identified owning attempt may attach proof while running.
        if (!previous || !patch.attempt_id || previous.attempt_id !== patch.attempt_id || previous.status !== 'running') {
            throw new Error('Proof attachment requires ownership of the current running candidate attempt.');
        }
        assertPostDraftIdentities(previous, 'verified');
    }
}

function loadVerificationModule(repoRoot = path.resolve(__dirname, '../..')) {
    const source = path.join(repoRoot, 'services/dashboard/lib/code-proposal-verification.ts');
    let register;
    try { register = require.resolve('ts-node/register/transpile-only', { paths: [repoRoot] }); } catch { /* lean runtime */ }
    if (register && fs.existsSync(source)) {
        require(register);
        return require(source); // A broken source module must never fall back to stale compiled proof checks.
    }
    return require(path.join(repoRoot, 'services/dashboard/dist/lib/code-proposal-verification.js'));
}

/** Store only evidence for an unchanged pending proposal; never approve, deploy, or send mail. */
async function recordCodeVerification(supabase, original, patch, verification = loadVerificationModule()) {
    const { data: current, error } = await supabase.from('prompt_proposals').select('*,xmin').eq('id', original.id).single();
    if (error) throw new Error(error.message);
    requireXmin(current); if (current.status !== 'pending') throw new Error('Proposal is no longer pending.');
    const fingerprint = verification.codeProposalVerificationFingerprint;
    if (fingerprint(current) !== fingerprint(original)) throw new Error('Proposal changed while the candidate was being verified.');
    assertAttemptOwnership(current, patch);
    const summary = { ...(current.eval_summary || {}) };
    if (patch.code_candidate) {
        // A fresh attempt must never display or approve the previous attempt's proof.
        if (patch.code_candidate.status === 'running'
            && patch.code_candidate.attempt_id !== summary.code_candidate?.attempt_id) delete summary.code_verification;
        summary.code_candidate = patch.code_candidate;
    }
    if (patch.code_verification) {
        const candidate = { ...current, eval_summary: { ...summary, code_verification: patch.code_verification } };
        // Validate the complete proof before persisting it. Synthetic/test-only
        // evidence is allowed to remain non-approvable, but it must satisfy the
        // same schema, binding, membership, replay, and regression gates.
        const integrityCheck = verification.assessCodeProposalVerificationIntegrity || verification.assessCodeProposalVerification;
        const block = integrityCheck(candidate);
        if (block) throw new Error(block.error);
        if (patch.code_verification.proposal_sha256 !== fingerprint(current)) throw new Error('Verification does not belong to this proposal.');
        summary.code_verification = patch.code_verification;
    }
    let query = supabase.from('prompt_proposals').update({ eval_summary: summary })
        .eq('id', current.id).eq('status', 'pending');
    if (current.xmin !== undefined && current.xmin !== null) query = query.eq('xmin', current.xmin);
    query = addEvaluationCasPredicates(query, current);
    const result = await query.select('id');
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.length) throw new Error('Proposal evaluation changed concurrently; no evidence was overwritten.');
    return summary;
}

/** Bind the pre-claim parent lineage with a narrow pending-row CAS. */
async function recordParentCampaignLineage(supabase, original, envelope, verification = loadVerificationModule(), options = {}) {
    validateParentCampaignLineage(envelope, { proposal: original });
    const { data: current, error } = await supabase.from('prompt_proposals').select('*,xmin').eq('id', original.id).single();
    if (error) throw new Error(error.message);
    requireXmin(current); if (current.status !== 'pending') throw new Error('Proposal is no longer pending.');
    if (verification.codeProposalVerificationFingerprint(current) !== verification.codeProposalVerificationFingerprint(original)) throw new Error('Proposal changed while parent lineage was being bound.');
    const existing = current.eval_summary?.parent_campaign_sha256;
    if (existing && existing !== envelope.parent_campaign_sha256 && !(options.replaceExistingDigest && existing === options.expectedExistingDigest)) throw new Error('Parent campaign lineage already differs.');
    const owner = current.eval_summary?.code_candidate;
    if (owner && !(options.allowClosedOwner && owner.status === 'blocked' && owner.attempt_id === options.expectedAttemptId)) throw new Error('Parent campaign lineage must be bound before an owner claim.');
    if (options.allowClosedOwner && (!owner || owner.status !== 'blocked' || owner.attempt_id !== options.expectedAttemptId)) throw new Error('Closed owner identity changed before parent lineage binding.');
    const summary = { ...(current.eval_summary || {}), parent_campaign_sha256: envelope.parent_campaign_sha256 };
    let query = supabase.from('prompt_proposals').update({ eval_summary: summary }).eq('id', current.id).eq('status', 'pending');
    if (current.xmin !== undefined && current.xmin !== null) query = query.eq('xmin', current.xmin);
    query = owner ? addEvaluationCasPredicates(query, current) : query.is('eval_summary->code_candidate', null);
    const result = await query.select('id');
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.length) throw new Error('Proposal changed concurrently; parent lineage was not written.');
    return summary;
}

/** Close exactly the current running owner before a bounded lineage repair. */
async function closeCodeCandidateOwnerForLineageRepair(supabase, original, expectedAttemptId, verification = loadVerificationModule()) {
    const { data: current, error } = await supabase.from('prompt_proposals').select('*,xmin').eq('id', original.id).single();
    if (error) throw new Error(error.message);
    requireXmin(current); const owner = current?.eval_summary?.code_candidate;
    if (!current || current.status !== 'pending' || !owner || owner.status !== 'running' || owner.attempt_id !== expectedAttemptId) throw new Error('Lineage repair owner is not the expected pending running attempt.');
    if (verification.codeProposalVerificationFingerprint(current) !== verification.codeProposalVerificationFingerprint(original)) throw new Error('Proposal changed before lineage repair owner closure.');
    const closed = { ...owner, status: 'blocked', phase: 'analysis', reason: 'parent_campaign_lineage_repair', closed_at: new Date().toISOString() };
    assertFrozenIdentity(owner, closed);
    let query = supabase.from('prompt_proposals').update({ eval_summary: { ...(current.eval_summary || {}), code_candidate: closed } }).eq('id', current.id).eq('status', 'pending');
    if (current.xmin !== undefined && current.xmin !== null) query = query.eq('xmin', current.xmin);
    query = addEvaluationCasPredicates(query, current);
    const result = await query.select('id');
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.length) throw new Error('Owner changed concurrently; lineage repair closure was not written.');
    return { ...current, eval_summary: { ...(current.eval_summary || {}), code_candidate: closed } };
}

/** Clear only the just-closed owner, retaining all private attempt artifacts. */
async function clearClosedCodeCandidateOwnerForLineageRepair(supabase, original, expectedAttemptId, verification = loadVerificationModule()) {
    const { data: current, error } = await supabase.from('prompt_proposals').select('*,xmin').eq('id', original.id).single();
    if (error) throw new Error(error.message);
    requireXmin(current); const owner = current?.eval_summary?.code_candidate;
    if (!current || current.status !== 'pending' || !owner || owner.status !== 'blocked' || owner.attempt_id !== expectedAttemptId || owner.reason !== 'parent_campaign_lineage_repair') throw new Error('Closed lineage repair owner identity changed.');
    if (verification.codeProposalVerificationFingerprint(current) !== verification.codeProposalVerificationFingerprint(original)) throw new Error('Proposal changed before lineage repair owner release.');
    const summary = { ...(current.eval_summary || {}) };
    delete summary.code_candidate;
    delete summary.code_verification;
    let query = supabase.from('prompt_proposals').update({ eval_summary: summary }).eq('id', current.id).eq('status', 'pending');
    if (current.xmin !== undefined && current.xmin !== null) query = query.eq('xmin', current.xmin);
    query = addEvaluationCasPredicates(query, current);
    const result = await query.select('id');
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.length) throw new Error('Owner changed concurrently; lineage repair release was not written.');
    return { ...current, eval_summary: summary };
}

function shouldDraftCodeProposal(proposal, implementationHash, verification = loadVerificationModule(), force = false) {
    if (proposal?.status !== 'pending' || !proposal.code_recommendations?.length) return false;
    // Legacy replay can contain incorrectly retired delivery failures. Regenerate it under
    // the current policy before drafting a patch against an incomplete correction set.
    const currentPolicy = verification.REPLAY_RETIREMENT_POLICY_VERSION;
    if (!Number.isInteger(currentPolicy) || proposal.eval_summary?.replay_retirement_policy_version !== currentPolicy) return false;
    const previous = proposal.eval_summary?.code_candidate;
    if (!previous) return true;
    if (previous.status === 'running') return !runningClaimIsFresh(previous);
    if (force) return true;
    const same = previous.proposal_sha256 === verification.codeProposalVerificationFingerprint(proposal)
        && previous.baseline_source_sha256 === implementationHash;
    if (!same) return true;
    // A bounded automatic attempt must not retry expensive failed drafts every poll.
    return false;
}

module.exports = { loadVerificationModule, recordCodeVerification, recordParentCampaignLineage, closeCodeCandidateOwnerForLineageRepair, clearClosedCodeCandidateOwnerForLineageRepair, shouldDraftCodeProposal, runningClaimIsFresh };
