'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ModelBudgetBroker, canonicalHash, redact, sha256 } = require('./lib/model-budget-broker');
const { snapshotBaseline, revalidateAttemptArtifacts, validateDraft, applyDraft } = require('./lib/code-proposal-draft');

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
        const draft = validateDraft(validated.draft, prepared.checked.proposal, prepared.checked.cases, prepared.baselineRoot);
        return { draft, response: validated.response, baselineRoot: prepared.baselineRoot, attemptRoot: prepared.attemptRoot, scope: prepared.scope, authorizationHash: prepared.broker.authorizationHash };
    } catch (error) {
        throw new Error(redact(error?.message || error, options.secrets || []));
    }
}

function applyValidatedDraft(result, proposal, candidateRoot, command) {
    if (!result?.draft || result?.proof || result?.code_verification || result?.verification) throw new Error('C2b cannot apply or carry verification evidence.');
    return applyDraft(result.draft.patch, result.baselineRoot, candidateRoot, proposal, command);
}

module.exports = { buildDraftRequest, deriveDraftScope, dispatchCodeDraft, applyValidatedDraft, loadPreparedDraft, redact, validateDraftResponse };
