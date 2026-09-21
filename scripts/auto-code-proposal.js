'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ModelBudgetBroker, canonicalHash, redact, sha256 } = require('./lib/model-budget-broker');
const { snapshotBaseline, revalidateAttemptArtifacts, validateDraft, applyDraft } = require('./lib/code-proposal-draft');
const { loadVerificationModule } = require('./lib/proposal-verification-store');
const { validateParentCampaignLineage, buildParentCampaignLineage, readImmutablePendingSnapshot } = require('./lib/parent-campaign-lineage');

const DIGEST = /^[a-f0-9]{64}$/;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_BYTES = 180000;

function requireDigest(value, label) {
    if (!DIGEST.test(value || '')) throw new Error(`Draft scope requires a valid ${label} hash.`);
    return value;
}

function deriveDraftScope({ attemptRoot, metadata, parentCampaignSha256, proposal, checked }) {
    const frozenParentCampaignSha256 = proposal.parent_campaign_sha256 || proposal.eval_summary?.parent_campaign_sha256;
    if (!DIGEST.test(frozenParentCampaignSha256 || '') || frozenParentCampaignSha256 !== parentCampaignSha256) throw new Error('Parent campaign lineage is missing or differs from the frozen proposal artifact.');
    const scope = {
        attemptId: metadata.attempt_id,
        runId: metadata.attempt_id,
        parentCampaignSha256: requireDigest(parentCampaignSha256, 'parent campaign'),
        proposalSha256: requireDigest(metadata.proposal_sha256, 'proposal'),
        promptSha256: requireDigest(metadata.prompt_sha256, 'prompt'),
        rulesSha256: requireDigest(metadata.accepted_rules_sha256, 'accepted rules'),
        datasetSha256: requireDigest(metadata.expected_dataset_sha256, 'dataset'),
        sourceSha256: requireDigest(metadata.baseline_source_sha256, 'source'),
        behaviorSha256: requireDigest(metadata.behavior_tests_sha256, 'behavior'),
        outputRoot: path.resolve(attemptRoot),
    };
    if (!checked?.proposal || checked.proposal.id !== proposal.id) throw new Error('Prepared proposal identity is not the requested proposal.');
    return Object.freeze(scope);
}

function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) throw new Error('Draft messages must be a bounded nonempty list.');
    const body = JSON.stringify(messages);
    if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) throw new Error('Draft messages exceed the bounded request size.');
    for (const message of messages) {
        if (!message || !['system', 'user'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) throw new Error('Draft messages have an invalid role or content.');
    }
    return messages.map((message) => ({ role: message.role, content: message.content }));
}

function buildDraftRequest(authorization, messages) {
    if (!authorization || authorization.stage !== 'code-candidate') throw new Error('Draft request requires a code-candidate authorization.');
    return { model: authorization.model, messages: validateMessages(messages), response_format: { type: 'json_object' }, max_completion_tokens: authorization.requestLimits.completionTokens };
}

function responseUsage(body) {
    const usage = body?.usage;
    const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    const completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
    const reasoningTokens = Number(usage?.completion_tokens_details?.reasoning_tokens || 0);
    if (![inputTokens, completionTokens, reasoningTokens].every(Number.isInteger) || inputTokens < 0 || completionTokens < 0 || reasoningTokens < 0 || reasoningTokens > completionTokens) throw new Error('Draft response usage is incomplete or inconsistent.');
    return { inputTokens, completionTokens, reasoningTokens };
}

function validateDraftResponse(result, authorization) {
    if (!result || result.status < 200 || result.status >= 300 || result.accountingStatus !== 'completed') throw new Error('Draft response transport or accounting is incomplete.');
    let body;
    try { body = JSON.parse(result.body); } catch { throw new Error('Draft response is not valid JSON.'); }
    if (body.model !== authorization.model) throw new Error('Draft response model identity differs from authorization.');
    const choice = body.choices?.[0];
    if (!choice || typeof choice.message?.content !== 'string' || choice.finish_reason !== 'stop') throw new Error('Draft response must contain JSON content and finish_reason stop.');
    const usage = responseUsage(body);
    let draft;
    try { draft = JSON.parse(choice.message.content); } catch { throw new Error('Draft response content is not valid JSON.'); }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Draft response content must be a JSON object.');
    return { draft, response: { requestId: result.requestId, status: result.status, accountingStatus: result.accountingStatus, model: body.model, finishReason: choice.finish_reason, usage, bodySha256: sha256(Buffer.from(result.body)), contentSha256: sha256(Buffer.from(choice.message.content)) } };
}

function loadPreparedDraft(options) {
    const required = ['attemptRoot', 'trustedRoot', 'metadata', 'proposal', 'verification', 'behaviorModule', 'sourceRoot', 'parentCampaignSha256', 'authorizationFile', 'stateFile'];
    for (const key of required) if (!options[key]) throw new Error(`Draft preparation requires ${key}.`);
    const attemptRoot = path.resolve(options.attemptRoot);
    const baselineRoot = path.resolve(options.baselineRoot || path.join(attemptRoot, 'baseline'));
    if (!options.baselineRoot) snapshotBaseline(options.sourceRoot, baselineRoot, options.verification, { secrets: options.secrets });
    const checked = revalidateAttemptArtifacts({ attemptRoot, trustedRoot: options.trustedRoot, metadata: options.metadata, proposal: options.proposal, verification: options.verification, behaviorModule: options.behaviorModule, baselineRoot });
    const scope = deriveDraftScope({ attemptRoot, metadata: options.metadata, parentCampaignSha256: options.parentCampaignSha256, proposal: options.proposal, checked });
    if (options.metadata.parent_campaign_sha256) {
        const lineageFile = path.join(attemptRoot, 'parent-campaign-lineage.json');
        if (!fs.existsSync(lineageFile)) throw new Error('Prepared attempt parent campaign lineage is missing.');
        const lineage = validateParentCampaignLineage(JSON.parse(fs.readFileSync(lineageFile, 'utf8')), { proposal: checked.proposal });
        const inventory = JSON.parse(fs.readFileSync(path.join(attemptRoot, 'preparation-inventory.json'), 'utf8'));
        const snapshot = readImmutablePendingSnapshot(path.join(attemptRoot, '..', '..', '..'), lineage.pending_enumeration.global_snapshot_sha256);
        const expected = buildParentCampaignLineage({ proposal: checked.proposal, inventory, proposalFingerprint: options.metadata.proposal_sha256, frozenHashes: { behavior_tests_sha256: options.metadata.behavior_tests_sha256, dataset_sha256: options.metadata.expected_dataset_sha256, source_sha256: options.metadata.baseline_source_sha256, prompt_sha256: options.metadata.prompt_sha256, accepted_rules_sha256: options.metadata.accepted_rules_sha256 }, pendingEnumeration: snapshot });
        if (JSON.stringify(lineage) !== JSON.stringify(expected) || lineage.parent_campaign_sha256 !== options.parentCampaignSha256 || options.metadata.parent_campaign_sha256 !== lineage.parent_campaign_sha256) throw new Error('Prepared attempt parent campaign lineage differs from the dispatch scope.');
    }
    const broker = new ModelBudgetBroker({ authorizationFile: options.authorizationFile, stateFile: options.stateFile, outputRoot: attemptRoot, env: options.env, now: options.now, transport: options.transport, countInputTokens: options.countInputTokens });
    if (canonicalHash(broker.authorization.scope) !== canonicalHash(scope)) throw new Error('Code-candidate authorization scope differs from prepared attempt identities.');
    return { attemptRoot, baselineRoot, checked, scope, broker };
}

async function dispatchCodeDraft(options = {}) {
    const prepared = loadPreparedDraft(options);
    const request = buildDraftRequest(prepared.broker.authorization, options.messages);
    const draftAttempt = options.draftAttempt || 1;
    const transportAttempt = options.transportAttempt || 1;
    if (!Number.isInteger(draftAttempt) || draftAttempt < 1 || !Number.isInteger(transportAttempt) || transportAttempt < 1) throw new Error('Draft attempt identity is invalid.');
    const requestId = options.requestId || `${prepared.scope.attemptId}:draft:${draftAttempt}:transport:${transportAttempt}`;
    try {
        const result = await prepared.broker.dispatch({ requestId, endpoint: prepared.broker.authorization.endpoint, body: request, apiKey: options.apiKey, transport: options.transport });
        const validated = validateDraftResponse(result, prepared.broker.authorization);
        const draft = validateDraft(validated.draft, prepared.checked.proposal, prepared.checked.cases, prepared.baselineRoot, { eligibleCorrectionIds: prepared.checked.eligibleCorrectionIds });
        return { draft, response: validated.response, baselineRoot: prepared.baselineRoot, attemptRoot: prepared.attemptRoot, scope: prepared.scope, authorizationHash: prepared.broker.authorizationHash, checked: prepared.checked, cases: prepared.checked.cases };
    } catch (error) {
        throw new Error(redact(error?.message || error, options.secrets || []));
    }
}

function applyValidatedDraft(result, proposal, candidateRoot, command, expectedAttemptId) {
    if (!result?.draft || result?.proof || result?.code_verification || result?.verification) throw new Error('C2b cannot apply or carry verification evidence.');
    return applyDraft(result.draft.patch, result.baselineRoot, candidateRoot, proposal, command, expectedAttemptId);
}

function atomicOwnerWrite(file, bytes) {
    const directory = path.dirname(file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
    const dirFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

/**
 * Persist the authoritative C2b -> C2c handoff from the bytes that were
 * actually validated and applied. Hash strings supplied by a caller are never
 * accepted as evidence; every identity below is recomputed from local bytes.
 */
function persistC2bHandoff(result, proposal, candidateRoot, options = {}) {
    const derivedAttemptId = result?.scope?.attemptId;
    const derivedAuthorizationHash = result?.authorizationHash;
    const derivedScopeHash = result?.scope ? canonicalHash(result.scope) : null;
    if (!result?.draft || !result?.baselineRoot || !result?.scope?.outputRoot || !options.handoffPath || !options.repoRoot
        || !derivedAttemptId || !DIGEST.test(derivedAuthorizationHash || '') || !DIGEST.test(derivedScopeHash || '')) {
        throw new Error('C2b handoff persistence requires the validated draft, owner scope, and output path.');
    }
    const attemptRoot = path.resolve(result.scope.outputRoot);
    if (path.resolve(options.handoffPath) !== path.join(attemptRoot, 'c2b-handoff.json')) throw new Error('C2b handoff path must be the owner-contained attempt handoff path.');
    if (options.attemptId && options.attemptId !== derivedAttemptId) throw new Error('C2b attempt identity differs from the completed dispatch scope.');
    if (options.authorizationHash && options.authorizationHash !== derivedAuthorizationHash) throw new Error('C2b authorization identity differs from the completed dispatch authorization.');
    if (options.scopeHash && options.scopeHash !== derivedScopeHash) throw new Error('C2b scope identity differs from the completed dispatch scope.');
    const trustedRepoRoot = path.resolve(__dirname, '..');
    if (path.resolve(options.repoRoot) !== trustedRepoRoot) throw new Error('C2b verifier root must be the current trusted repository root.');
    const verifier = loadVerificationModule(trustedRepoRoot);
    const patchBytes = Buffer.from(result.draft.patch);
    const responseSha = result.response?.bodySha256;
    if (!DIGEST.test(responseSha || '')) throw new Error('C2b response identity is missing from the completed transport.');
    const baselineSourceSha = verifier.hashCodeImplementation(result.baselineRoot);
    const candidateSourceSha = verifier.hashCodeImplementation(candidateRoot);
    if (!DIGEST.test(baselineSourceSha) || !DIGEST.test(candidateSourceSha) || baselineSourceSha === candidateSourceSha) {
        throw new Error('C2b applied candidate source identity is invalid or unchanged.');
    }
    const draftBody = {
        summary: result.draft.summary || '', patch: result.draft.patch,
        test_files: [...(result.draft.test_files || [])], corrections: [...(result.draft.corrections || [])],
    };
    const draftContentSha = crypto.createHash('sha256').update(JSON.stringify(draftBody)).digest('hex');
    const handoff = {
        schema_version: 1, attempt_id: `${derivedAttemptId}`,
        authorization_hash: derivedAuthorizationHash, scope_hash: derivedScopeHash,
        baseline_source_sha256: baselineSourceSha, candidate_source_sha256: candidateSourceSha,
        draft: {
            ...draftBody,
            patch_sha256: crypto.createHash('sha256').update(patchBytes).digest('hex'),
            content_sha256: draftContentSha, response_sha256: responseSha,
        },
        response: { body_sha256: responseSha, request_id: result.response.requestId || null, model: result.response.model || null, finish_reason: result.response.finishReason || null },
    };
    if (!DIGEST.test(handoff.authorization_hash) || !DIGEST.test(handoff.scope_hash)) throw new Error('C2b owner authorization/scope identities are invalid.');
    const bytes = Buffer.from(`${JSON.stringify(handoff, null, 2)}\n`);
    atomicOwnerWrite(options.handoffPath, bytes);
    return { ...handoff, c2b_handoff_sha256: crypto.createHash('sha256').update(bytes).digest('hex'), handoff_path: path.resolve(options.handoffPath) };
}

/** Apply the validated C2b patch and atomically emit the owner-only C2b handoff. */
async function applyValidatedDraftWithHandoff(result, proposal, candidateRoot, options = {}) {
    if (!result?.checked?.cases && !Array.isArray(result?.cases) && !Array.isArray(options.cases)) throw new Error('C2b apply requires the frozen dataset cases returned by dispatch.');
    validateDraft(result.draft, proposal, result.checked?.cases || result.cases || options.cases, result.baselineRoot, { eligibleCorrectionIds: result.checked?.eligibleCorrectionIds });
    const applied = applyValidatedDraft(result, proposal, candidateRoot, options.command, options.attemptId);
    const handoff = persistC2bHandoff(result, proposal, applied, options);
    let ownerBound = false;
    if (options.client && options.originalProposal) {
        const store = options.store || { recordCodeVerification };
        const metadata = options.metadata || {};
        await store.recordCodeVerification(options.client, options.originalProposal, {
            attempt_id: options.attemptId,
            code_candidate: {
                ...metadata, status: 'running', phase: 'draft',
                authorization_hash: handoff.authorization_hash, scope_hash: handoff.scope_hash,
                c2b_handoff_sha256: handoff.c2b_handoff_sha256,
                baseline_source_sha256: handoff.baseline_source_sha256,
                candidate_source_sha256: handoff.candidate_source_sha256,
                draft_patch_sha256: handoff.draft.patch_sha256,
                draft_content_sha256: handoff.draft.content_sha256,
                draft_response_sha256: handoff.draft.response_sha256,
            },
        }, loadVerificationModule(path.resolve(__dirname, '..')));
        ownerBound = true;
    }
    return { status: ownerBound ? 'owner_bound' : 'pending_store', ownerBound, candidateRoot: applied, handoff };
}

module.exports = { buildDraftRequest, deriveDraftScope, dispatchCodeDraft, applyValidatedDraft, applyValidatedDraftWithHandoff, persistC2bHandoff, loadPreparedDraft, redact, validateDraftResponse };
