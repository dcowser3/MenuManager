import { jest } from '@jest/globals';

// Mocking OpenAI API
jest.mock('openai', () => ({
    Configuration: jest.fn(),
    OpenAIApi: jest.fn(() => ({
        createChatCompletion: jest.fn(async () => ({
            data: {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                pass: true,
                                confidence: 0.9,
                                needs_resubmit: false,
                                issues: [],
                                summary: 'Looks good.',
                                redlined_doc: 'base64-encoded-doc'
                            })
                        }
                    }
                ]
            }
        }))
    }))
}));

describe('AI Review Service', () => {
    it('should return a valid AI review response', async () => {
        // This is a placeholder for a more complete test.
        // A full test would involve setting up a test server and making a request to the /ai-review endpoint.
        // For now, this test primarily verifies the OpenAI mock.
        
        const { OpenAIApi } = require('openai');
        const openai = new OpenAIApi();

        const response = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'test' }]
        });
        
        const reviewResult = JSON.parse(response.data.choices[0].message.content);

        expect(reviewResult.pass).toBe(true);
        expect(reviewResult.confidence).toBe(0.9);
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
});
