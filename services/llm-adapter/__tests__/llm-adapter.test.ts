import {
    buildChatRequestBody,
    callChat,
    classifyChatFailure,
    getModelCapabilities,
    mapOpenRouterModelId,
} from '../src';

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] || null },
        text: jest.fn(async () => typeof body === 'string' ? body : JSON.stringify(body)),
    } as any;
}

describe('llm adapter', () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };

    afterEach(() => {
        global.fetch = originalFetch;
        process.env = { ...originalEnv };
        jest.restoreAllMocks();
    });

    test.each([
        ['gpt-5.6-luna', false, 'max_completion_tokens'],
        ['o3', false, 'max_completion_tokens'],
        ['gpt-4o-mini-2024-07-18', true, 'max_tokens'],
    ])('shapes %s according to its capability entry', (model, supportsTemperature, maxTokensParam) => {
        const body = buildChatRequestBody(
            { model },
            [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }],
            { temperature: 0, maxTokens: 123, seed: 42, jsonMode: true },
            'openai'
        );

        expect(body.model).toBe(model);
        expect(body.messages).toHaveLength(2);
        expect(body.seed).toBe(42);
        expect(body[maxTokensParam]).toBe(123);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.temperature).toBe(supportsTemperature ? 0 : undefined);
    });

    test('keeps the default OpenAI bodies byte-equivalent for the two legacy shapes', () => {
        const messages = [{ role: 'user' as const, content: 'test' }];
        expect(JSON.stringify(buildChatRequestBody({ model: 'gpt-4o-mini' }, messages, { temperature: 0 }, 'openai')))
            .toBe(JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0 }));
        expect(JSON.stringify(buildChatRequestBody({ model: 'gpt-5.6-luna' }, messages, {}, 'openai')))
            .toBe(JSON.stringify({ model: 'gpt-5.6-luna', messages }));
    });

    test('omits a disabled seed while retaining it for models that support seeds', () => {
        const messages = [{ role: 'user' as const, content: 'test' }];
        expect(buildChatRequestBody({ model: 'gpt-5.6-luna' }, messages, { seed: 42 })).toMatchObject({ seed: 42 });
        expect(buildChatRequestBody({ model: 'gpt-5.6-luna' }, messages, { seed: undefined })).not.toHaveProperty('seed');
    });

    test('preserves OpenAI ids and maps plain ids to OpenRouter vendor ids centrally', () => {
        expect(mapOpenRouterModelId('gpt-5.6-luna')).toBe('openai/gpt-5.6-luna');
        expect(mapOpenRouterModelId('anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5');
        expect(mapOpenRouterModelId('gemini-3-flash')).toBe('google/gemini-3-flash');
        expect(buildChatRequestBody({ model: 'gpt-5.6-luna' }, [], {}, 'openrouter').model)
            .toBe('openai/gpt-5.6-luna');
    });

    test('classifies quota, request-size, rate-limit, and transient failures', () => {
        expect(classifyChatFailure({ status: 429, body: 'insufficient_quota' })).toBe('quota');
        expect(classifyChatFailure({ status: 429, body: 'Request too large for this model' })).toBe('request_too_large');
        expect(classifyChatFailure({ status: 429, body: 'try again later' })).toBe('rate_limit');
        expect(classifyChatFailure({ status: 503, body: 'server error' })).toBe('transient');
        expect(classifyChatFailure({ networkError: true })).toBe('transient');
    });

    test('retries a transient 5xx once, then normalizes usage and preserves null fingerprint', async () => {
        const fetchMock = jest.fn()
            .mockResolvedValueOnce(response(503, { error: { message: 'temporary' } }))
            .mockResolvedValueOnce(response(200, {
                model: 'gpt-4o-mini-2024-07-18',
                choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
                system_fingerprint: null,
            }));
        global.fetch = fetchMock as any;

        const result = await callChat(
            { model: 'gpt-4o-mini-2024-07-18', apiKey: 'test-key' },
            [{ role: 'user', content: 'hello' }],
            { retry: { maxTransientRetries: 1, maxRateLimitRetries: 0 }, sleep: async () => undefined }
        );

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            content: 'ok',
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
            system_fingerprint: null,
            finish_reason: 'stop',
        });
    });

    test('retries a 429 using Retry-After and fails quota loudly without retrying', async () => {
        const sleep = jest.fn(async () => undefined);
        const fetchMock = jest.fn()
            .mockResolvedValueOnce(response(429, { error: { message: 'rate limited' } }, { 'retry-after': '2' }))
            .mockResolvedValueOnce(response(200, {
                choices: [{ message: { content: 'ok' } }],
                usage: {},
            }));
        global.fetch = fetchMock as any;

        await callChat(
            { model: 'gpt-4o', apiKey: 'test-key' },
            [{ role: 'user', content: 'hello' }],
            { retry: { maxRateLimitRetries: 1, maxTransientRetries: 0 }, sleep }
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(2000);

        global.fetch = jest.fn(async () => response(429, { error: { code: 'insufficient_quota' } })) as any;
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(callChat(
            { model: 'gpt-4o', apiKey: 'test-key' },
            [{ role: 'user', content: 'hello' }],
            { retry: { maxRateLimitRetries: 3 }, sleep: async () => undefined }
        )).rejects.toMatchObject({ provider: 'openai', status: 429 });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('LLM_PROVIDER=openrouter'));
    });

    test('uses OpenRouter headers and a mapped model when selected per call', async () => {
        const fetchMock = jest.fn(async () => response(200, {
            choices: [{ message: { content: 'ok' } }],
            usage: {},
        }));
        global.fetch = fetchMock as any;

        await callChat(
            { model: 'gpt-5.6-luna', apiKey: 'router-key' },
            [{ role: 'user', content: 'hello' }],
            { provider: 'openrouter' }
        );

        const call = (fetchMock.mock.calls as any[])[0] as any[];
        const request = call[1] as any;
        expect(call[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(request.headers['HTTP-Referer']).toBeTruthy();
        expect(JSON.parse(request.body).model).toBe('openai/gpt-5.6-luna');
        expect(getModelCapabilities('gpt-5.6-luna').supportsTemperature).toBe(false);
    });
});
