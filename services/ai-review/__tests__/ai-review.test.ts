import http from 'http';

function postJson(app: any, path: string, body: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as { port: number };
            const payload = JSON.stringify(body);
            const request = http.request({
                hostname: '127.0.0.1',
                port: address.port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'x-menumanager-internal-token': 'test-internal-token',
                },
            }, (response) => {
                let text = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => { text += chunk; });
                response.on('end', () => {
                    server.close();
                    resolve({ status: response.statusCode || 0, body: JSON.parse(text) });
                });
            });
            request.on('error', (error) => {
                server.close();
                reject(error);
            });
            request.write(payload);
            request.end();
        });
    });
}

describe('AI Review Service', () => {
    const originalFetch = global.fetch;
    let app: any;

    beforeAll(async () => {
        process.env.INTERNAL_API_TOKEN = 'test-internal-token';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.AI_REVIEW_MODEL = 'gpt-5.6-luna';
        process.env.AI_REVIEW_SEED = '12345';
        ({ app } = await import('../index'));
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    afterAll(() => {
        delete process.env.INTERNAL_API_TOKEN;
        delete process.env.OPENAI_API_KEY;
        delete process.env.AI_REVIEW_MODEL;
        delete process.env.AI_REVIEW_SEED;
    });

    it('builds the real reasoning-model request through the adapter and parses the fenced response', async () => {
        const fetchMock = jest.fn(async (_url: string, init: any) => {
            return {
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async () => JSON.stringify({
                    model: 'gpt-5.6-luna',
                    system_fingerprint: null,
                    choices: [{
                        message: {
                            content: '=== CORRECTED MENU ===\nTACOS 12\n=== END CORRECTED MENU ===',
                        },
                        finish_reason: 'stop',
                    }],
                    usage: { prompt_tokens: 11, completion_tokens: 8, total_tokens: 19 },
                }),
            } as any;
        });
        global.fetch = fetchMock as any;

        const result = await postJson(app, '/run-qa-check', {
            prompt: 'Use the menu QA rules.',
            text: 'TACOS 12',
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            feedback: '=== CORRECTED MENU ===\nTACOS 12\n=== END CORRECTED MENU ===',
            model: 'gpt-5.6-luna',
            system_fingerprint: null,
            finish_reason: 'stop',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const request = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(request).toEqual({
            model: 'gpt-5.6-luna',
            seed: 12345,
            messages: [
                { role: 'system', content: 'Use the menu QA rules.' },
                { role: 'user', content: 'Here is the menu text to review:\n\n---\n\nTACOS 12' },
            ],
        });
    });

    it('allows an explicitly empty AI_REVIEW_SEED to disable the provider seed', async () => {
        const { resolveAiReviewSeed } = await import('../index');
        expect(resolveAiReviewSeed({ AI_REVIEW_SEED: '' })).toBeUndefined();
        expect(resolveAiReviewSeed({})).toBe(42);
    });

    it('parses approved dish quality verdicts from model JSON', async () => {
        const { parseDishQualityAiResponse } = await import('../index');
        const rows = [
            { index: 0, dishName: 'Adobo Chicken' },
            { index: 1, dishName: 'À La Carte PricingAntojitos' },
        ];

        const results = parseDishQualityAiResponse(JSON.stringify({
            results: [
                { index: 0, verdict: 'dish', confidence: 'high', reason: 'A priced fajita protein can be a menu item.' },
                { index: 1, verdict: 'not_dish', confidence: 'high', reason: 'This is a pricing grid.' },
            ],
        }), rows);

        expect(results).toEqual([
            expect.objectContaining({ index: 0, verdict: 'dish', confidence: 'high' }),
            expect.objectContaining({ index: 1, verdict: 'not_dish', confidence: 'high' }),
        ]);
    });

    it('returns uncertain for omitted or malformed approved dish quality responses', async () => {
        const { parseDishQualityAiResponse } = await import('../index');
        const rows = [
            { index: 0, dishName: 'Pan-Seared Scallops' },
            { index: 1, dishName: 'Pricing' },
        ];

        expect(parseDishQualityAiResponse('{not json', rows)).toEqual([
            expect.objectContaining({ index: 0, verdict: 'uncertain', confidence: 'low' }),
            expect.objectContaining({ index: 1, verdict: 'uncertain', confidence: 'low' }),
        ]);

        expect(parseDishQualityAiResponse(JSON.stringify({ results: [{ index: 0, verdict: 'dish', confidence: 'medium' }] }), rows)).toEqual([
            expect.objectContaining({ index: 0, verdict: 'dish', confidence: 'medium' }),
            expect.objectContaining({ index: 1, verdict: 'uncertain', confidence: 'low' }),
        ]);
    });

    it('includes beverage-specific approved dish quality guidance', async () => {
        const { buildDishQualityPrompt } = await import('../index');

        const prompt = buildDishQualityPrompt({
            property: 'Tamayo - Denver',
            servicePeriod: 'Beverage',
            rows: [
                {
                    index: 0,
                    dishName: 'Pick Me Up',
                    description: 'Carajillo – cinnamon-infused Licor 43 – reposado – espresso',
                    category: 'Mineral Water',
                    price: '14',
                    qualityIssues: [{ code: 'beverage_heading_as_name', severity: 'high' }],
                },
                {
                    index: 1,
                    dishName: 'Acqua Panna 1 liter........',
                    category: 'Mineral Water',
                    price: '8',
                    qualityIssues: [{ code: 'layout_leader_in_name', severity: 'high' }],
                },
            ],
        });

        expect(prompt).toContain('Beverage price-list rows can be valid dishes');
        expect(prompt).toContain('Beverage section headings such as Pick Me Up');
        expect(prompt).toContain('Visual leader dots');
    });
});
