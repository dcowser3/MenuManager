"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COORDINATOR_ENGINE_VERSION = exports.COORDINATOR_SCHEMA_VERSION = void 0;
exports.stableJson = stableJson;
exports.sha256 = sha256;
exports.hashText = hashText;
exports.normalizeConfiguredSeed = normalizeConfiguredSeed;
exports.normalizeConfiguredTemperature = normalizeConfiguredTemperature;
exports.configuredExecutionIdentity = configuredExecutionIdentity;
exports.buildRequestDigest = buildRequestDigest;
exports.buildCoordinatorRequest = buildCoordinatorRequest;
exports.validateCoordinatorRequest = validateCoordinatorRequest;
exports.validateCoordinatorResponse = validateCoordinatorResponse;
exports.sameExecutionIdentity = sameExecutionIdentity;
const crypto_1 = require("crypto");
const llm_adapter_1 = require("@menumanager/llm-adapter");
exports.COORDINATOR_SCHEMA_VERSION = 1;
exports.COORDINATOR_ENGINE_VERSION = 'review-coordinator-v1';
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, canonicalize(entry)]));
    }
    return value;
}
function stableJson(value) {
    return JSON.stringify(canonicalize(value));
}
function sha256(value) {
    return (0, crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
}
function hashText(value) {
    return sha256(value);
}
function normalizeConfiguredSeed(env) {
    const configured = env.AI_REVIEW_SEED ?? env.BASIC_AI_CHECK_SEED;
    if (configured !== undefined && configured.trim() === '')
        return { state: 'disabled', value: null };
    const parsed = Number(configured);
    if (configured !== undefined && Number.isInteger(parsed) && parsed >= 0) {
        return { state: 'explicit', value: parsed };
    }
    return { state: 'default', value: 42 };
}
function normalizeConfiguredTemperature(env) {
    const parsed = Number(env.AI_REVIEW_TEMPERATURE);
    return Number.isFinite(parsed) ? parsed : 0;
}
function configuredExecutionIdentity(env) {
    const provider = env.AI_REVIEW_LLM_PROVIDER || env.LLM_PROVIDER || 'openai';
    const model = env.AI_REVIEW_MODEL || 'gpt-5.6-luna';
    const temperature = normalizeConfiguredTemperature(env);
    const seed = normalizeConfiguredSeed(env);
    const capabilities = (0, llm_adapter_1.getModelCapabilities)(model);
    const wireSeed = seed.value !== null && capabilities.supportsSeed ? seed.value : null;
    const wireTemperature = capabilities.supportsTemperature ? temperature : null;
    const omitted = [];
    if (wireTemperature === null)
        omitted.push('temperature');
    if (wireSeed === null)
        omitted.push('seed');
    return {
        provider,
        model,
        temperature,
        seed,
        wire: {
            model: provider === 'openrouter' ? (0, llm_adapter_1.mapOpenRouterModelId)(model) : model,
            temperature: wireTemperature,
            seed: wireSeed,
            omitted,
        },
    };
}
function buildRequestDigest(request) {
    return sha256(stableJson({
        schemaVersion: request.schemaVersion,
        engineVersion: request.engineVersion,
        textHash: request.textHash,
        promptHash: request.promptHash,
        callerAttestations: request.callerAttestations,
        effectiveExecutionIdentity: request.effectiveExecutionIdentity,
        replayIdentity: request.replayIdentity,
    }));
}
function buildCoordinatorRequest(input) {
    const request = {
        ...input,
        textHash: hashText(input.text),
        promptHash: hashText(input.prompt),
    };
    return { ...request, requestDigest: buildRequestDigest(request) };
}
function validateCoordinatorRequest(request) {
    if (!request || typeof request !== 'object')
        return { ok: false, reason: 'malformed_request' };
    const candidate = request;
    if (candidate.schemaVersion !== exports.COORDINATOR_SCHEMA_VERSION || candidate.engineVersion !== exports.COORDINATOR_ENGINE_VERSION) {
        return { ok: false, reason: 'version_mismatch' };
    }
    if (typeof candidate.text !== 'string' || !candidate.text || typeof candidate.prompt !== 'string' || !candidate.prompt) {
        return { ok: false, reason: 'missing_model_input' };
    }
    if (typeof candidate.replayIdentity !== 'string' || !candidate.replayIdentity.trim())
        return { ok: false, reason: 'missing_replay_identity' };
    if (candidate.replayIdentity.length > 160)
        return { ok: false, reason: 'replay_identity_too_long' };
    const attestations = candidate.callerAttestations;
    if (!attestations || !['sourceHash', 'contextHash', 'policyHash', 'vocabularySnapshotHash'].every((key) => typeof attestations[key] === 'string' && !!attestations[key])) {
        return { ok: false, reason: 'missing_identity' };
    }
    const execution = candidate.effectiveExecutionIdentity;
    if (!execution || !['openai', 'openrouter'].includes(execution.provider) || typeof execution.provider !== 'string' || !execution.provider
        || typeof execution.model !== 'string' || !execution.model
        || typeof execution.temperature !== 'number' || !Number.isFinite(execution.temperature)
        || !execution.seed || !['default', 'explicit', 'disabled'].includes(execution.seed.state)
        || (execution.seed.state === 'disabled' && execution.seed.value !== null)
        || (execution.seed.state !== 'disabled' && (!Number.isInteger(execution.seed.value) || execution.seed.value < 0))) {
        return { ok: false, reason: 'malformed_execution_identity' };
    }
    const expectedExecution = configuredExecutionIdentity({
        AI_REVIEW_LLM_PROVIDER: execution.provider,
        LLM_PROVIDER: execution.provider,
        AI_REVIEW_MODEL: execution.model,
        AI_REVIEW_TEMPERATURE: `${execution.temperature}`,
        AI_REVIEW_SEED: execution.seed.state === 'disabled' ? '' : `${execution.seed.value ?? ''}`,
    });
    if (!execution.wire || stableJson(execution.wire) !== stableJson(expectedExecution.wire)) {
        return { ok: false, reason: 'malformed_wire_execution_identity' };
    }
    const expectedTextHash = hashText(candidate.text);
    const expectedPromptHash = hashText(candidate.prompt);
    if (candidate.textHash !== expectedTextHash)
        return { ok: false, reason: 'text_hash_mismatch' };
    if (candidate.promptHash !== expectedPromptHash)
        return { ok: false, reason: 'prompt_hash_mismatch' };
    const expectedDigest = buildRequestDigest({ ...candidate, requestDigest: undefined });
    if (candidate.requestDigest !== expectedDigest)
        return { ok: false, reason: 'request_digest_mismatch' };
    return { ok: true, request: candidate };
}
function validateCoordinatorResponse(response) {
    if (!response || typeof response !== 'object')
        return { ok: false, reason: 'malformed_response' };
    const candidate = response;
    if (candidate.schemaVersion !== exports.COORDINATOR_SCHEMA_VERSION || candidate.engineVersion !== exports.COORDINATOR_ENGINE_VERSION)
        return { ok: false, reason: 'version_mismatch' };
    if (![candidate.textHash, candidate.promptHash, candidate.requestDigest, candidate.replayIdentity].every((value) => typeof value === 'string' && !!value))
        return { ok: false, reason: 'missing_response_identity' };
    if (typeof candidate.feedback !== 'string' || typeof candidate.requestedModel !== 'string' || typeof candidate.observedModel !== 'string')
        return { ok: false, reason: 'malformed_response_fields' };
    if (!candidate.callerAttestations || !candidate.effectiveExecutionIdentity)
        return { ok: false, reason: 'missing_response_execution_identity' };
    return { ok: true, response: candidate };
}
function sameExecutionIdentity(a, b) {
    return stableJson(a) === stableJson(b);
}
