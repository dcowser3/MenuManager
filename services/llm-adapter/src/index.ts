export type LlmProvider = 'openai' | 'openrouter';

export type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'developer';
    content: string;
};

export type ModelCapabilities = {
    family: string;
    supportsTemperature: boolean;
    maxTokensParam: 'max_tokens' | 'max_completion_tokens';
    supportsSeed: boolean;
    supportsJsonMode: boolean;
};

/**
 * Capability data for the model families currently used by the application.
 * The reasoning pattern deliberately preserves the historical
 * /o[0-9]|gpt-5|reasoning/i semantics; callers consult this table instead of
 * carrying their own model regex.
 */
export const MODEL_CAPABILITY_MAP: readonly {
    family: string;
    modelPattern: string;
    supportsTemperature: boolean;
    maxTokensParam: 'max_tokens' | 'max_completion_tokens';
    supportsSeed: boolean;
    supportsJsonMode: boolean;
}[] = [
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

export function getModelCapabilities(model: string): ModelCapabilities {
    const entry = MODEL_CAPABILITY_MAP.find((candidate) => new RegExp(candidate.modelPattern, 'i').test(`${model || ''}`))
        || MODEL_CAPABILITY_MAP[MODEL_CAPABILITY_MAP.length - 1];
    return {
        family: entry.family,
        supportsTemperature: entry.supportsTemperature,
        maxTokensParam: entry.maxTokensParam,
        supportsSeed: entry.supportsSeed,
        supportsJsonMode: entry.supportsJsonMode,
    };
}

/** Back-compatible name used by existing dashboard helpers. */
export function isReasoningModel(model: string): boolean {
    return getModelCapabilities(model).family === 'reasoning';
}

const OPENROUTER_VENDOR_MAP: readonly { vendor: string; modelPattern: string }[] = [
    { vendor: 'openai', modelPattern: '^(?:gpt-|o[0-9]|text-)' },
    { vendor: 'anthropic', modelPattern: '^claude' },
    { vendor: 'google', modelPattern: '^(?:gemini|gemma)' },
    { vendor: 'meta-llama', modelPattern: '^(?:llama|meta-llama)' },
    { vendor: 'mistralai', modelPattern: '^mistral' },
];

/** Map a plain model id to the vendor namespace required by OpenRouter. */
export function mapOpenRouterModelId(model: string): string {
    const normalized = `${model || ''}`.trim();
    if (!normalized) throw new Error('A model id is required');
    if (normalized.includes('/')) return normalized;
    const match = OPENROUTER_VENDOR_MAP.find((candidate) => new RegExp(candidate.modelPattern, 'i').test(normalized));
    return `${match?.vendor || 'openai'}/${normalized}`;
}

export type ChatJobConfig = {
    model: string;
    provider?: LlmProvider;
    apiKey?: string;
};

export type ChatCallOptions = {
    provider?: LlmProvider;
    temperature?: number;
    /** Logical completion-token budget; the adapter chooses the API parameter. */
    maxTokens?: number;
    /** Alias for callers that already use the OpenAI parameter name. */
    maxCompletionTokens?: number;
    seed?: number;
    jsonMode?: boolean;
    responseFormat?: Record<string, unknown>;
    retry?: Partial<RetryPolicy>;
    /** Test hook and a useful seam for callers with their own scheduler. */
    sleep?: (milliseconds: number) => Promise<void>;
};

export type RetryPolicy = {
    maxTransientRetries: number;
    maxRateLimitRetries: number;
    transientBaseDelayMs: number;
    maxDelayMs: number;
};

export type NormalizedUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
};

export type ChatResponse = {
    content: string;
    model: string;
    usage: NormalizedUsage;
    system_fingerprint: string | null;
    finish_reason: string | null;
    provider: LlmProvider;
};

export class LlmAdapterError extends Error {
    readonly provider: LlmProvider;
    readonly status: number | null;
    readonly body: string;

    constructor(message: string, details: { provider: LlmProvider; status?: number | null; body?: string }) {
        super(message);
        this.name = 'LlmAdapterError';
        this.provider = details.provider;
        this.status = details.status ?? null;
        this.body = details.body || '';
    }
}

export function resolveProvider(
    jobConfig: ChatJobConfig,
    options: Pick<ChatCallOptions, 'provider'> = {},
    env: Record<string, string | undefined> = process.env
): LlmProvider {
    const configured = options.provider || jobConfig.provider || env.LLM_PROVIDER || 'openai';
    if (configured !== 'openai' && configured !== 'openrouter') {
        throw new Error(`Unsupported LLM_PROVIDER "${configured}"; use openai or openrouter`);
    }
    return configured;
}

export function resolveRetryPolicy(
    overrides: Partial<RetryPolicy> = {},
    env: Record<string, string | undefined> = process.env
): RetryPolicy {
    const integer = (value: unknown, fallback: number) => {
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

export function buildChatRequestBody(
    jobConfig: ChatJobConfig,
    messages: ChatMessage[],
    options: Omit<ChatCallOptions, 'provider' | 'retry' | 'sleep'> = {},
    provider: LlmProvider = jobConfig.provider || 'openai'
): Record<string, unknown> {
    const capabilities = getModelCapabilities(jobConfig.model);
    const body: Record<string, unknown> = {
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
    } else if (options.jsonMode && capabilities.supportsJsonMode) {
        body.response_format = { type: 'json_object' };
    }
    return body;
}

function apiKeyFor(provider: LlmProvider, jobConfig: ChatJobConfig, env: Record<string, string | undefined>): string {
    const apiKey = jobConfig.apiKey || (provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY);
    const placeholder = provider === 'openrouter' ? /^sk-or-\.\.\.$/ : /^(?:your-openai-api-key-here|sk-your_openai_api_key_here)$/;
    if (!apiKey || placeholder.test(apiKey)) {
        throw new Error(`${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY'} is required for ${provider}`);
    }
    return apiKey;
}

export function resolveChatTarget(
    jobConfig: ChatJobConfig,
    provider: LlmProvider,
    env: Record<string, string | undefined> = process.env
): { provider: LlmProvider; url: string; apiKey: string; model: string; headers: Record<string, string> } {
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

function bodyIndicatesCreditExhaustion(body: string): boolean {
    return /insufficient_quota|credit_balance_exhausted|insufficient credits|quota exhausted/i.test(body || '');
}

function bodyIndicatesUnretryableLargeRequest(body: string): boolean {
    return /request too large/i.test(body || '');
}

export function classifyChatFailure(input: { status?: number | null; body?: string; networkError?: boolean }):
    'quota' | 'request_too_large' | 'rate_limit' | 'transient' | 'fatal' {
    const body = `${input.body || ''}`;
    if (bodyIndicatesCreditExhaustion(body)) return 'quota';
    if (bodyIndicatesUnretryableLargeRequest(body)) return 'request_too_large';
    if (input.status === 429) return 'rate_limit';
    if (input.networkError || (input.status !== undefined && input.status !== null && input.status >= 500)) return 'transient';
    return 'fatal';
}

export function parseRetryAfter(headers: { get(name: string): string | null }, body = ''): number | null {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const dateMs = Date.parse(retryAfter);
        if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
    }
    const hint = body.match(/try again in ([\d.]+)\s*(ms|s)?/i);
    if (hint) return Math.max(0, Math.ceil(parseFloat(hint[1]) * (hint[2]?.toLowerCase() === 'ms' ? 1 : 1000)));
    return null;
}

function retryDelay(policy: RetryPolicy, attempt: number): number {
    return Math.min(policy.maxDelayMs, policy.transientBaseDelayMs * (3 ** attempt));
}

function sleepDefault(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function creditFailure(provider: LlmProvider, status: number | null, body: string): LlmAdapterError {
    const alternate = provider === 'openai' ? 'openrouter' : 'openai';
    console.error(
        `[llm-adapter] ${provider} credit/quota failure${status ? ` (HTTP ${status})` : ''}. `
        + `Set LLM_PROVIDER=${alternate} (or the call-site provider override) to switch providers manually. `
        + `${body.slice(0, 200)}`
    );
    return new LlmAdapterError(`${provider} credits are unavailable; manual provider switch required`, { provider, status, body });
}

export async function callChat(
    jobConfig: ChatJobConfig,
    messages: ChatMessage[],
    options: ChatCallOptions = {}
): Promise<ChatResponse> {
    const env = process.env;
    const provider = resolveProvider(jobConfig, options, env);
    const target = resolveChatTarget(jobConfig, provider, env);
    const body = buildChatRequestBody(jobConfig, messages, options, provider);
    const policy = resolveRetryPolicy(options.retry, env);
    const sleep = options.sleep || sleepDefault;
    let transientRetries = 0;
    let rateLimitRetries = 0;
    let lastError: unknown = null;

    while (true) {
        let response: Response;
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
        } catch (error: any) {
            lastError = error;
            const classification = classifyChatFailure({ networkError: true, body: error?.message });
            if (classification === 'transient' && transientRetries < policy.maxTransientRetries) {
                await sleep(retryDelay(policy, transientRetries));
                transientRetries += 1;
                continue;
            }
            throw new LlmAdapterError(
                `${provider} network failure after ${transientRetries} transient retries: ${error?.message || error}`,
                { provider, body: `${error?.message || error}` }
            );
        }

        if (response.ok) {
            let data: any;
            try {
                data = JSON.parse(responseBody || '{}');
            } catch (error: any) {
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
        if (classification === 'quota') throw creditFailure(provider, response.status, responseBody);
        if (classification === 'request_too_large') {
            throw new LlmAdapterError(`${provider} request exceeds the provider limit; retrying cannot help`, {
                provider,
                status: response.status,
                body: responseBody,
            });
        }
        if (classification === 'rate_limit' && rateLimitRetries < policy.maxRateLimitRetries) {
            const delay = Math.min(
                policy.maxDelayMs,
                parseRetryAfter(response.headers, responseBody) ?? retryDelay(policy, rateLimitRetries)
            );
            await sleep(delay);
            rateLimitRetries += 1;
            continue;
        }
        if (classification === 'transient' && transientRetries < policy.maxTransientRetries) {
            await sleep(retryDelay(policy, transientRetries));
            transientRetries += 1;
            continue;
        }

        throw new LlmAdapterError(
            `${provider} API error ${response.status} after retries: ${responseBody.slice(0, 500)}`,
            { provider, status: response.status, body: responseBody }
        );
    }
}
