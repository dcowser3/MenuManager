"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmAdapterError = exports.MODEL_CAPABILITY_MAP = void 0;
exports.getModelCapabilities = getModelCapabilities;
exports.isReasoningModel = isReasoningModel;
exports.mapOpenRouterModelId = mapOpenRouterModelId;
exports.resolveProvider = resolveProvider;
exports.resolveRetryPolicy = resolveRetryPolicy;
exports.buildChatRequestBody = buildChatRequestBody;
exports.resolveChatTarget = resolveChatTarget;
exports.classifyChatFailure = classifyChatFailure;
exports.parseRetryAfter = parseRetryAfter;
exports.callChat = callChat;
/**
 * Capability data for the model families currently used by the application.
 * The reasoning pattern deliberately preserves the historical
 * /o[0-9]|gpt-5|reasoning/i semantics; callers consult this table instead of
 * carrying their own model regex.
 */
exports.MODEL_CAPABILITY_MAP = [
    {
        family: 'reasoning',
        modelPattern: 'o[0-9]|gpt-5|reasoning',
        supportsTemperature: false,
        maxTokensParam: 'max_completion_tokens',
        supportsSeed: true,
        supportsJsonMode: true,
    },
    {
        family: 'standard',
        modelPattern: '.*',
        supportsTemperature: true,
        maxTokensParam: 'max_tokens',
        supportsSeed: true,
        supportsJsonMode: true,
    },
];
function getModelCapabilities(model) {
    const entry = exports.MODEL_CAPABILITY_MAP.find((candidate) => new RegExp(candidate.modelPattern, 'i').test(`${model || ''}`))
        || exports.MODEL_CAPABILITY_MAP[exports.MODEL_CAPABILITY_MAP.length - 1];
    return {
        family: entry.family,
        supportsTemperature: entry.supportsTemperature,
        maxTokensParam: entry.maxTokensParam,
        supportsSeed: entry.supportsSeed,
        supportsJsonMode: entry.supportsJsonMode,
    };
}
/** Back-compatible name used by existing dashboard helpers. */
function isReasoningModel(model) {
    return getModelCapabilities(model).family === 'reasoning';
}
const OPENROUTER_VENDOR_MAP = [
    { vendor: 'openai', modelPattern: '^(?:gpt-|o[0-9]|text-)' },
    { vendor: 'anthropic', modelPattern: '^claude' },
    { vendor: 'google', modelPattern: '^(?:gemini|gemma)' },
    { vendor: 'meta-llama', modelPattern: '^(?:llama|meta-llama)' },
    { vendor: 'mistralai', modelPattern: '^mistral' },
];
/** Map a plain model id to the vendor namespace required by OpenRouter. */
function mapOpenRouterModelId(model) {
    const normalized = `${model || ''}`.trim();
    if (!normalized)
        throw new Error('A model id is required');
    if (normalized.includes('/'))
        return normalized;
    const match = OPENROUTER_VENDOR_MAP.find((candidate) => new RegExp(candidate.modelPattern, 'i').test(normalized));
    return `${match?.vendor || 'openai'}/${normalized}`;
}
class LlmAdapterError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'LlmAdapterError';
        this.provider = details.provider;
        this.status = details.status ?? null;
        this.body = details.body || '';
    }
}
exports.LlmAdapterError = LlmAdapterError;
function resolveProvider(jobConfig, options = {}, env = process.env) {
    const configured = options.provider || jobConfig.provider || env.LLM_PROVIDER || 'openai';
    if (configured !== 'openai' && configured !== 'openrouter') {
        throw new Error(`Unsupported LLM_PROVIDER "${configured}"; use openai or openrouter`);
    }
    return configured;
}
function resolveRetryPolicy(overrides = {}, env = process.env) {
    const integer = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
    };
    return {
        maxTransientRetries: integer(overrides.maxTransientRetries ?? env.LLM_TRANSIENT_RETRIES, 4),
        maxRateLimitRetries: integer(overrides.maxRateLimitRetries ?? env.LLM_RATE_LIMIT_RETRIES, 6),
        transientBaseDelayMs: integer(overrides.transientBaseDelayMs ?? env.LLM_TRANSIENT_BASE_DELAY_MS, 5000),
        maxDelayMs: integer(overrides.maxDelayMs ?? env.LLM_MAX_RETRY_DELAY_MS, 90000),
    };
}
function buildChatRequestBody(jobConfig, messages, options = {}, provider = jobConfig.provider || 'openai') {
    const capabilities = getModelCapabilities(jobConfig.model);
    const body = {
        model: provider === 'openrouter' ? mapOpenRouterModelId(jobConfig.model) : jobConfig.model,
        messages,
    };
    if (options.temperature !== undefined && capabilities.supportsTemperature) {
        body.temperature = options.temperature;
    }
    const completionTokens = options.maxTokens ?? options.maxCompletionTokens;
    if (completionTokens !== undefined) {
        body[capabilities.maxTokensParam] = completionTokens;
    }
    if (options.seed !== undefined && capabilities.supportsSeed) {
        body.seed = options.seed;
    }
    if (options.responseFormat && capabilities.supportsJsonMode) {
        body.response_format = options.responseFormat;
    }
    else if (options.jsonMode && capabilities.supportsJsonMode) {
        body.response_format = { type: 'json_object' };
    }
    return body;
}
function apiKeyFor(provider, jobConfig, env) {
    const apiKey = jobConfig.apiKey || (provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY);
    const placeholder = provider === 'openrouter' ? /^sk-or-\.\.\.$/ : /^(?:your-openai-api-key-here|sk-your_openai_api_key_here)$/;
    if (!apiKey || placeholder.test(apiKey)) {
        throw new Error(`${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY'} is required for ${provider}`);
    }
    return apiKey;
}
function resolveChatTarget(jobConfig, provider, env = process.env) {
    const apiKey = apiKeyFor(provider, jobConfig, env);
    if (provider === 'openrouter') {
        return {
            provider,
            url: 'https://openrouter.ai/api/v1/chat/completions',
            apiKey,
            model: mapOpenRouterModelId(jobConfig.model),
            headers: {
                'HTTP-Referer': env.OPENROUTER_HTTP_REFERER || 'https://github.com/dcowser3/MenuManager',
                'X-Title': env.OPENROUTER_APP_TITLE || 'MenuManager',
            },
        };
    }
    return {
        provider,
        url: 'https://api.openai.com/v1/chat/completions',
        apiKey,
        model: jobConfig.model,
        headers: {},
    };
}
function bodyIndicatesCreditExhaustion(body) {
    return /insufficient_quota|credit_balance_exhausted|insufficient credits|quota exhausted/i.test(body || '');
}
function bodyIndicatesUnretryableLargeRequest(body) {
    return /request too large/i.test(body || '');
}
function classifyChatFailure(input) {
    const body = `${input.body || ''}`;
    if (bodyIndicatesCreditExhaustion(body))
        return 'quota';
    if (bodyIndicatesUnretryableLargeRequest(body))
        return 'request_too_large';
    if (input.status === 429)
        return 'rate_limit';
    if (input.networkError || (input.status !== undefined && input.status !== null && input.status >= 500))
        return 'transient';
    return 'fatal';
}
function parseRetryAfter(headers, body = '') {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds))
            return Math.max(0, seconds * 1000);
        const dateMs = Date.parse(retryAfter);
        if (Number.isFinite(dateMs))
            return Math.max(0, dateMs - Date.now());
    }
    const hint = body.match(/try again in ([\d.]+)\s*(ms|s)?/i);
    if (hint)
        return Math.max(0, Math.ceil(parseFloat(hint[1]) * (hint[2]?.toLowerCase() === 'ms' ? 1 : 1000)));
    return null;
}
function retryDelay(policy, attempt) {
    return Math.min(policy.maxDelayMs, policy.transientBaseDelayMs * (3 ** attempt));
}
function sleepDefault(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function creditFailure(provider, status, body) {
    const alternate = provider === 'openai' ? 'openrouter' : 'openai';
    console.error(`[llm-adapter] ${provider} credit/quota failure${status ? ` (HTTP ${status})` : ''}. `
        + `Set LLM_PROVIDER=${alternate} (or the call-site provider override) to switch providers manually. `
        + `${body.slice(0, 200)}`);
    return new LlmAdapterError(`${provider} credits are unavailable; manual provider switch required`, { provider, status, body });
}
async function callChat(jobConfig, messages, options = {}) {
    const env = process.env;
    const provider = resolveProvider(jobConfig, options, env);
    const target = resolveChatTarget(jobConfig, provider, env);
    const body = buildChatRequestBody(jobConfig, messages, options, provider);
    const policy = resolveRetryPolicy(options.retry, env);
    const sleep = options.sleep || sleepDefault;
    let transientRetries = 0;
    let rateLimitRetries = 0;
    let lastError = null;
    while (true) {
        let response;
        let responseBody = '';
        try {
            response = await fetch(target.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${target.apiKey}`,
                    ...target.headers,
                },
                body: JSON.stringify(body),
            });
            responseBody = await response.text();
        }
        catch (error) {
            lastError = error;
            const classification = classifyChatFailure({ networkError: true, body: error?.message });
            if (classification === 'transient' && transientRetries < policy.maxTransientRetries) {
                await sleep(retryDelay(policy, transientRetries));
                transientRetries += 1;
                continue;
            }
            throw new LlmAdapterError(`${provider} network failure after ${transientRetries} transient retries: ${error?.message || error}`, { provider, body: `${error?.message || error}` });
        }
        if (response.ok) {
            let data;
            try {
                data = JSON.parse(responseBody || '{}');
            }
            catch (error) {
                throw new LlmAdapterError(`${provider} returned invalid JSON: ${error.message}`, {
                    provider,
                    status: response.status,
                    body: responseBody,
                });
            }
            const usage = data.usage || {};
            return {
                content: data.choices?.[0]?.message?.content || '',
                model: data.model || target.model,
                usage: {
                    prompt_tokens: Number(usage.prompt_tokens) || 0,
                    completion_tokens: Number(usage.completion_tokens) || 0,
                    total_tokens: Number(usage.total_tokens) || 0,
                },
                // Preserve an explicit null from providers; never synthesize a fingerprint.
                system_fingerprint: Object.prototype.hasOwnProperty.call(data, 'system_fingerprint')
                    ? (data.system_fingerprint || null)
                    : null,
                finish_reason: data.choices?.[0]?.finish_reason || null,
                provider,
            };
        }
        const classification = classifyChatFailure({ status: response.status, body: responseBody });
        if (classification === 'quota')
            throw creditFailure(provider, response.status, responseBody);
        if (classification === 'request_too_large') {
            throw new LlmAdapterError(`${provider} request exceeds the provider limit; retrying cannot help`, {
                provider,
                status: response.status,
                body: responseBody,
            });
        }
        if (classification === 'rate_limit' && rateLimitRetries < policy.maxRateLimitRetries) {
            const delay = Math.min(policy.maxDelayMs, parseRetryAfter(response.headers, responseBody) ?? retryDelay(policy, rateLimitRetries));
            await sleep(delay);
            rateLimitRetries += 1;
            continue;
        }
        if (classification === 'transient' && transientRetries < policy.maxTransientRetries) {
            await sleep(retryDelay(policy, transientRetries));
            transientRetries += 1;
            continue;
        }
        throw new LlmAdapterError(`${provider} API error ${response.status} after retries: ${responseBody.slice(0, 500)}`, { provider, status: response.status, body: responseBody });
    }
}
