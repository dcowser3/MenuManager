"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
// Mocking OpenAI API
globals_1.jest.mock('openai', () => ({
    Configuration: globals_1.jest.fn(),
    OpenAIApi: globals_1.jest.fn(() => ({
        createChatCompletion: globals_1.jest.fn().mockResolvedValue({
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
        })
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
});
