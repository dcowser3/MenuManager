'use strict';

/**
 * Owner-bound, offline lifecycle coordinator. Draft generation and C2b apply
 * happen before this boundary; this module consumes only the frozen handoff,
 * runs the fixed C2c2 proof, and attaches it through B5-B.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { runCodeProposalProofWithDocker, readC2bHandoff } = require('./code-proposal-proof-runner');
const { loadVerificationModule, recordCodeVerification } = require('./proposal-verification-store');

const DIGEST = /^[a-f0-9]{64}$/;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const atomicWrite = (file, value) => {
    const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, value, { mode: 0o600 });
    fs.renameSync(temporary, file);
};

function progressPath(attemptRoot) { return path.join(path.resolve(attemptRoot), 'candidate', 'progress.json'); }
function writeProgress(attemptRoot, metadata, phase, state, extra = {}) {
    const attempt = fs.realpathSync(path.resolve(attemptRoot));
    const candidate = path.join(attempt, 'candidate');
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Lifecycle candidate progress parent is a symlink.');
    const file = progressPath(attemptRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const record = { schema_version: 1, attempt_id: metadata.attempt_id, phase, state, updated_at: new Date().toISOString(), ...(metadata.deadline_at ? { deadline_at: metadata.deadline_at } : {}), ...extra };
    atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
    return record;
}
function assertSafeVerifierRoot(attemptRoot) {
    const attempt = fs.realpathSync(path.resolve(attemptRoot));
    const verifier = path.join(attempt, 'verifier');
    if (fs.existsSync(verifier) && fs.lstatSync(verifier).isSymbolicLink()) throw new Error('Lifecycle verifier parent is a symlink.');
    if (fs.existsSync(verifier) && !fs.realpathSync(verifier).startsWith(`${attempt}${path.sep}`)) throw new Error('Lifecycle verifier parent escapes the attempt root.');
}

function assertOwnerAndFrozen(options, verification, allowVerified = false) {
    const { metadata, proposal, attemptRoot, handoffFile } = options;
    const claim = proposal?.eval_summary?.code_candidate;
    if (!claim || !['running', ...(allowVerified ? ['verified'] : [])].includes(claim.status) || claim.attempt_id !== metadata.attempt_id) throw new Error('Lifecycle owner claim is stale or belongs to another attempt.');
    for (const field of ['proposal_sha256', 'baseline_source_sha256', 'candidate_source_sha256', 'prompt_sha256', 'accepted_rules_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256', 'authorization_hash', 'scope_hash', 'c2b_handoff_sha256', 'draft_patch_sha256', 'draft_content_sha256', 'draft_response_sha256']) {
    if (!DIGEST.test(metadata[field] || '') || claim[field] !== metadata[field]) throw new Error(`Lifecycle frozen identity is missing or stale: ${field}.`);
    }
    if (options.originalProposal && verification.codeProposalVerificationFingerprint(options.originalProposal) !== metadata.proposal_sha256) throw new Error('Lifecycle live proposal identity differs from the frozen owner claim.');
    const handoff = readC2bHandoff(handoffFile, attemptRoot, metadata);
    if (handoff.handoff.attempt_id !== metadata.attempt_id || handoff.handoff.candidate_source_sha256 !== metadata.candidate_source_sha256 || handoff.handoff.baseline_source_sha256 !== metadata.baseline_source_sha256) throw new Error('Lifecycle handoff identity differs from the owner claim.');
    if (handoff.handoffHash !== metadata.c2b_handoff_sha256) throw new Error('Lifecycle handoff bytes changed after ownership binding.');
    if (verification.codeProposalVerificationFingerprint(proposal) !== metadata.proposal_sha256) throw new Error('Lifecycle proposal identity changed after ownership binding.');
    return handoff;
}

function readVisibleProgress(options) {
    const progressFile = progressPath(options.attemptRoot);
    if (!fs.existsSync(progressFile)) return null;
    let reader;
    try {
        const source = path.resolve(__dirname, '../../services/dashboard/lib/code-candidate-progress.ts');
        try { require(require.resolve('ts-node/register/transpile-only', { paths: [path.resolve(__dirname, '../..')] })); } catch { /* dist fallback */ }
        reader = fs.existsSync(source) ? require(source).readCodeCandidateProgress : require('../../services/dashboard/dist/lib/code-candidate-progress').readCodeCandidateProgress;
    } catch { throw new Error('Lifecycle progress reader is unavailable.'); }
    const progressRoot = options.progressRoot || options.repoRoot;
    if (!progressRoot) throw new Error('Lifecycle requires the repository root for B6-C progress visibility.');
    const visible = reader({ attempt_id: options.metadata.attempt_id, artifact_directory: options.attemptRoot }, progressRoot, Date.now());
    if (!visible) throw new Error('Lifecycle progress is malformed, stale, symlinked, oversized, or outside the trusted root.');
    return visible;
}

function readExactStagedProof(options, verification) {
    const file = path.join(path.resolve(options.attemptRoot), 'verifier', 'staged-proof.json');
    if (!fs.existsSync(file)) return null;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 12 * 1024 * 1024) throw new Error('Lifecycle staged proof is not a bounded regular file.');
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (envelope?.staged_status !== 'pending_store' || !envelope.proof || envelope.proof.status !== 'passed' || envelope.proof.proposal_sha256 !== options.metadata.proposal_sha256) throw new Error('Lifecycle staged proof identity is stale or incomplete.');
    const candidate = { ...options.proposal, eval_summary: { ...(options.proposal.eval_summary || {}), code_verification: envelope.proof } };
    const block = verification.assessCodeProposalVerificationIntegrity(candidate);
    if (block) throw new Error(`Lifecycle staged proof failed integrity: ${block.error || block}`);
    return envelope.proof;
}

async function readLiveProposal(options, verification) {
    const reader = options.readCurrentProposal || options.store?.readCurrentProposal;
    let current;
    if (typeof reader === 'function') current = await reader(options.client, options.proposal.id);
    else if (options.client?.from) {
        const result = await options.client.from('prompt_proposals').select('*').eq('id', options.proposal.id).single();
        if (result?.error) throw new Error(result.error.message || 'Lifecycle live proposal read failed.');
        current = result?.data;
    } else return null;
    if (!current || verification.codeProposalVerificationFingerprint(current) !== options.metadata.proposal_sha256) throw new Error('Lifecycle live stored proposal identity changed.');
    return current;
}

async function runCodeProposalLifecycle(options = {}) {
    const required = ['attemptRoot', 'trustedRoot', 'metadata', 'proposal', 'baselineRoot', 'candidateRoot', 'c2bHandoffFile', 'imageId', 'runtimeId', 'replayPolicyVersion'];
    for (const key of required) if (options[key] === undefined || options[key] === null) throw new Error(`Lifecycle requires ${key}.`);
    const verification = options.verification || loadVerificationModule(path.resolve(__dirname, '../..'));
    const attemptRoot = path.resolve(options.attemptRoot);
    assertSafeVerifierRoot(attemptRoot);
    const existing = readVisibleProgress(options);
    const liveBeforeProof = await readLiveProposal(options, verification);
    if (liveBeforeProof?.eval_summary?.code_candidate?.attempt_id && liveBeforeProof.eval_summary.code_candidate.attempt_id !== options.metadata.attempt_id) throw new Error('Lifecycle live owner differs from the requested attempt.');
    const claimHandoff = assertOwnerAndFrozen({ ...options, proposal: liveBeforeProof || options.proposal }, verification, existing?.state === 'verified' || liveBeforeProof?.eval_summary?.code_candidate?.status === 'verified');
    if (existing?.state === 'verified') {
        const proofPath = path.join(attemptRoot, 'verifier', 'proof.json');
        if (!fs.existsSync(proofPath) || fs.lstatSync(proofPath).isSymbolicLink()) throw new Error('Lifecycle verified progress has no trusted proof artifact.');
        assertSafeVerifierRoot(attemptRoot);
        const proofStat = fs.lstatSync(proofPath);
        if (!proofStat.isFile() || proofStat.size > 12 * 1024 * 1024) throw new Error('Lifecycle verified proof is not a bounded regular file.');
        const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
        if (proof.status !== 'passed' || proof.proposal_sha256 !== options.metadata.proposal_sha256) throw new Error('Lifecycle verified proof identity is stale.');
        const live = liveBeforeProof || await readLiveProposal(options, verification);
        if (!live || live.eval_summary?.code_candidate?.status !== 'verified' || !live.eval_summary?.code_verification) throw new Error('Lifecycle stored owner/proof is not verified.');
        if (JSON.stringify(canonical(live.eval_summary.code_verification)) !== JSON.stringify(canonical(proof))) throw new Error('Lifecycle stored proof differs from the local proof.');
        const integrityBlock = verification.assessCodeProposalVerificationIntegrity({ ...options.proposal, eval_summary: { ...(options.proposal.eval_summary || {}), code_verification: proof } });
        if (integrityBlock) throw new Error(`Lifecycle verified proof failed integrity: ${integrityBlock.error || integrityBlock}`);
        return { status: 'verified', resumed: true, progress: existing, proofPath };
    }
    const handoff = claimHandoff;
    if (!options.metadata.deadline_at || !Number.isFinite(Date.parse(options.metadata.deadline_at))) { writeProgress(attemptRoot, options.metadata, 'verification', 'failed', { reason: 'invalid_deadline' }); throw new Error('Lifecycle deadline is missing or invalid.'); }
    if (Date.parse(options.metadata.deadline_at) < Date.now()) { writeProgress(attemptRoot, options.metadata, 'verification', 'failed', { reason: 'attempt_deadline_exceeded' }); throw new Error('Lifecycle attempt deadline exceeded.'); }
    if (existing?.state === 'failed' && !options.resume) throw new Error('Lifecycle attempt is terminally failed; explicit resume is required.');
    if (existing?.state === 'blocked' && !options.resume) throw new Error('Lifecycle attempt is blocked; explicit resume is required.');
    if (existing?.state === 'blocked' && options.resume && existing.phase !== 'verification') throw new Error('Lifecycle cannot resume a blocked phase without its missing accepted transition.');
    const deliveryRequired = (options.proposal.correction_routing || []).some((route) => route?.replay_status === 'delivery_mismatch') || (options.proposal.replay_evidence || []).some((entry) => entry?.status === 'delivery_mismatch');
    if (deliveryRequired) { writeProgress(attemptRoot, options.metadata, 'verification', 'blocked', { reason: 'delivery_driver_unavailable' }); return { status: 'blocked', reason: 'delivery_driver_unavailable' }; }
    const stagedProof = existing?.state === 'blocked' && options.resume ? readExactStagedProof(options, verification) : null;
    writeProgress(attemptRoot, options.metadata, 'verification', 'active', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, handoff_sha256: handoff.handoffHash });
    let result;
    try {
        result = stagedProof ? { status: 'pending_store', proof: stagedProof, paths: { proof: path.join(attemptRoot, 'verifier', 'proof.json') } } : await runCodeProposalProofWithDocker({ ...options, proposal: liveBeforeProof || options.proposal, client: null, originalProposal: null, store: null });
    } catch (error) {
        const message = String(error.message || error);
        const blocked = /timeout|timed out|transport|Docker worker|terminated by signal/i.test(message);
        writeProgress(attemptRoot, options.metadata, 'verification', blocked ? 'blocked' : 'failed', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, reason: blocked ? 'docker_failure' : message.slice(0, 256) });
        throw error;
    }
    if (result.status !== 'pending_store' || !result.proof) {
        writeProgress(attemptRoot, options.metadata, 'verification', 'blocked', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, reason: 'proof_not_attachable' });
        return { status: 'blocked', result };
    }
    const client = options.client;
    const originalProposal = options.originalProposal;
    const store = options.store || { recordCodeVerification };
    if (!client || !originalProposal || typeof store.recordCodeVerification !== 'function') {
        writeProgress(attemptRoot, options.metadata, 'verification', 'blocked', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, reason: 'store_attachment_required' });
        return { status: 'blocked', result };
    }
    const liveBeforeAttach = await readLiveProposal(options, verification);
    if (!liveBeforeAttach) { writeProgress(attemptRoot, options.metadata, 'verification', 'blocked', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, reason: 'live_store_read_required' }); return { status: 'blocked', reason: 'live_store_read_required' }; }
    if (liveBeforeAttach?.eval_summary?.code_candidate?.attempt_id && liveBeforeAttach.eval_summary.code_candidate.attempt_id !== options.metadata.attempt_id) throw new Error('Lifecycle live owner changed before attachment.');
    const storedProof = liveBeforeAttach?.eval_summary?.code_verification;
    if (existing?.state === 'blocked' && liveBeforeAttach?.eval_summary?.code_candidate?.status === 'verified' && storedProof) {
        if (!isDeepStrictEqual(canonical(storedProof), canonical(result.proof))) throw new Error('Lifecycle stored proof differs from the staged proof.');
        assertSafeVerifierRoot(attemptRoot);
        const proofPath = result.paths.proof;
        atomicWrite(proofPath, `${JSON.stringify(result.proof, null, 2)}\n`);
        const progress = writeProgress(attemptRoot, options.metadata, 'verification', 'verified', { completed: options.metadata.expected_case_ids?.length || 0, total: options.metadata.expected_case_ids?.length || 0, proof_path: proofPath });
        return { status: 'verified', resumed: true, proof: result.proof, progress, proofPath };
    }
    let attached = false;
    try {
        await store.recordCodeVerification(client, originalProposal, { attempt_id: options.metadata.attempt_id, code_verification: result.proof, code_candidate: { ...options.metadata, status: 'verified', phase: 'verification', completed: options.metadata.expected_case_ids?.length || 0, total: options.metadata.expected_case_ids?.length || 0 } }, verification);
        attached = true;
    } catch (error) {
        writeProgress(attemptRoot, options.metadata, 'verification', 'blocked', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, reason: 'store_rejected' });
        throw error;
    }
    try {
        const storedAfterAttach = await readLiveProposal(options, verification);
        if (!storedAfterAttach || storedAfterAttach.eval_summary?.code_candidate?.status !== 'verified' || !storedAfterAttach.eval_summary?.code_verification || !isDeepStrictEqual(canonical(storedAfterAttach.eval_summary.code_verification), canonical(result.proof))) throw new Error('Lifecycle storage readback did not prove the exact verified proof.');
        const integrityBlock = verification.assessCodeProposalVerificationIntegrity({ ...options.proposal, eval_summary: { ...(options.proposal.eval_summary || {}), code_verification: result.proof } });
        if (integrityBlock) throw new Error(`Lifecycle attached proof failed integrity: ${integrityBlock.error || integrityBlock}`);
        const proofPath = result.paths.proof;
        atomicWrite(proofPath, `${JSON.stringify(result.proof, null, 2)}\n`);
        const progress = writeProgress(attemptRoot, options.metadata, 'verification', 'verified', { completed: options.metadata.expected_case_ids?.length || 0, total: options.metadata.expected_case_ids?.length || 0, proof_path: proofPath });
        return { status: 'verified', resumed: false, proof: result.proof, progress, proofPath };
    } catch (error) {
        writeProgress(attemptRoot, options.metadata, 'verification', 'blocked', { completed: 0, total: options.metadata.expected_case_ids?.length || 0, reason: attached ? 'attached_but_local_finalization_failed' : 'store_rejected' });
        throw error;
    }
}

/** Full offline seam: apply an already validated C2a draft, persist C2b, then
 * enter the post-handoff Docker/proof/store phase above. No model dispatch is
 * reachable from this function. */
async function runPreparedCodeProposalLifecycle(options = {}) {
    if (!options.validatedDraftResult || !options.proposal || !options.candidateRoot || !options.handoffPath || !options.repoRoot || !options.client || !options.originalProposal || typeof options.store?.recordCodeVerification !== 'function') throw new Error('Prepared lifecycle requires a validated draft, owner-bound store, candidate root, handoff path, and trusted repo root.');
    const { applyValidatedDraftWithHandoff } = require('../../scripts/auto-code-proposal');
    const applied = await applyValidatedDraftWithHandoff(options.validatedDraftResult, options.proposal, options.candidateRoot, { repoRoot: options.repoRoot, handoffPath: options.handoffPath, attemptId: options.metadata?.attempt_id, client: options.client, originalProposal: options.originalProposal, store: options.store, metadata: options.metadata });
    const h = applied.handoff || {};
    const metadata = { ...options.metadata, authorization_hash: h.authorization_hash || options.metadata.authorization_hash, scope_hash: h.scope_hash || options.metadata.scope_hash, c2b_handoff_sha256: h.c2b_handoff_sha256 || options.metadata.c2b_handoff_sha256, baseline_source_sha256: h.baseline_source_sha256 || options.metadata.baseline_source_sha256, candidate_source_sha256: h.candidate_source_sha256 || options.metadata.candidate_source_sha256, draft_patch_sha256: h.draft?.patch_sha256 || options.metadata.draft_patch_sha256, draft_content_sha256: h.draft?.content_sha256 || options.metadata.draft_content_sha256, draft_response_sha256: h.draft?.response_sha256 || options.metadata.draft_response_sha256 };
    return runCodeProposalLifecycle({ ...options, metadata, proposal: options.originalProposal, candidateRoot: applied.candidateRoot, c2bHandoffFile: options.handoffPath });
}

module.exports = { runCodeProposalLifecycle, runPostHandoffCodeProposalLifecycle: runCodeProposalLifecycle, runPreparedCodeProposalLifecycle, writeProgress, progressPath };
