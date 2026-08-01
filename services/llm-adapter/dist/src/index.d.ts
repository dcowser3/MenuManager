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
export declare const MODEL_CAPABILITY_MAP: readonly {
    family: string;
    modelPattern: string;
    supportsTemperature: boolean;
    maxTokensParam: 'max_tokens' | 'max_completion_tokens';
    supportsSeed: boolean;
    supportsJsonMode: boolean;
}[];
export declare function getModelCapabilities(model: string): ModelCapabilities;
/** Back-compatible name used by existing dashboard helpers. */
export declare function isReasoningModel(model: string): boolean;
/** Map a plain model id to the vendor namespace required by OpenRouter. */
export declare function mapOpenRouterModelId(model: string): string;
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
export declare class LlmAdapterError extends Error {
    readonly provider: LlmProvider;
    readonly status: number | null;
    readonly body: string;
    constructor(message: string, details: {
        provider: LlmProvider;
        status?: number | null;
        body?: string;
    });
}
export declare function resolveProvider(jobConfig: ChatJobConfig, options?: Pick<ChatCallOptions, 'provider'>, env?: Record<string, string | undefined>): LlmProvider;
export declare function resolveRetryPolicy(overrides?: Partial<RetryPolicy>, env?: Record<string, string | undefined>): RetryPolicy;
export declare function buildChatRequestBody(jobConfig: ChatJobConfig, messages: ChatMessage[], options?: Omit<ChatCallOptions, 'provider' | 'retry' | 'sleep'>, provider?: LlmProvider): Record<string, unknown>;
export declare function resolveChatTarget(jobConfig: ChatJobConfig, provider: LlmProvider, env?: Record<string, string | undefined>): {
    provider: LlmProvider;
    url: string;
    apiKey: string;
    model: string;
    headers: Record<string, string>;
};
export declare function classifyChatFailure(input: {
    status?: number | null;
    body?: string;
    networkError?: boolean;
}): 'quota' | 'request_too_large' | 'rate_limit' | 'transient' | 'fatal';
export declare function parseRetryAfter(headers: {
    get(name: string): string | null;
}, body?: string): number | null;
export declare function callChat(jobConfig: ChatJobConfig, messages: ChatMessage[], options?: ChatCallOptions): Promise<ChatResponse>;
