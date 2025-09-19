import express from 'express';
import { Configuration, OpenAIApi } from 'openai';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import * as path from 'path';

dotenv.config({ path: '../../../.env' });

const app = express();
const port = 3002;

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(express.json());

app.post('/ai-review', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).send('No text provided for review.');
    }

    try {
        const sopPath = path.join(__dirname, '..', '..', '..', process.env.SOP_DOC_PATH!);
        const sopText = await fs.readFile(sopPath, 'utf-8');
        
        // In a real app, you would load few-shot examples from 'samples/example_pairs'
        const fewShotExamples = "Example 1: ... \n Example 2: ...";

        const prompt = `
            You are an AI assistant reviewing a menu design brief.
            Your task is to check the brief against the company's Standard Operating Procedures (SOP).
            
            SOP:
            ---
            ${sopText}
            ---

            Few-shot examples of prior edits:
            ---
            ${fewShotExamples}
            ---

            Menu Brief Text to Review:
            ---
            ${text}
            ---

            Please return a JSON object with the following structure:
            {
              "pass": boolean,
              "confidence": number (0-1),
              "needs_resubmit": boolean,
              "issues": [{ "type": "string", "location": "string", "explanation": "string", "fix": "string" }],
              "summary": "string",
              "redlined_doc": "base64" (only if pass=true)
            }
        `;

        const response = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            // Ensure the model returns JSON. In newer models, you can use response_format.
        });

        const reviewResult = JSON.parse(response.data.choices[0].message!.content!);

        // Here you would store the report in the DB.
        
        res.status(200).json(reviewResult);

    } catch (error) {
        console.error('Error with OpenAI API:', error);
        res.status(500).send('Error performing AI review.');
    }
});

app.listen(port, () => {
    console.log(`ai-review service listening at http://localhost:${port}`);
});
