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
        // --- Tier 1: Run the General QA Prompt ---
        const qaPromptPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'qa_prompt.txt');
        const qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');

        const qaResponse = await openai.createChatCompletion({
            model: 'gpt-4o', // Using a more advanced model is better for this kind of structured task
            messages: [
                { role: 'system', content: qaPrompt },
                { role: 'user', content: `Here is the menu text to review:\n\n---\n\n${text}` }
            ],
        });

        const generalQaFeedback = qaResponse.data.choices[0].message?.content || "No feedback generated.";

        // --- Decision Point: Is the document good enough for red-lining? ---
        // Placeholder logic: We'll count the number of identified issues. If more than 5, we reject.
        // A more robust method would be to ask the LLM to provide a "pass" field in its response.
        const issueCount = (generalQaFeedback.match(/Description of Issue:/g) || []).length;

        if (issueCount > 5) {
            // Fails Tier 1: Not ready for red-lining. Send back general feedback only.
            console.log(`Submission failed Tier 1 review with ${issueCount} issues.`);
            return res.status(200).json({
                status: 'needs_resubmission',
                feedback_type: 'general_qa',
                feedback_content: generalQaFeedback
            });
        }

        // --- Tier 2: Passed Tier 1, proceed to red-lining ---
        console.log(`Submission passed Tier 1 with ${issueCount} issues. Proceeding to red-lining.`);
        const redlinePrompt = await createRedlinePrompt(text);

        const redlineResponse = await openai.createChatCompletion({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: redlinePrompt },
                { role: 'user', content: `Here is the menu text to correct:\n\n---\n\n${text}` }
            ],
        });

        const redlinedContent = redlineResponse.data.choices[0].message?.content;

        res.status(200).json({
            status: 'approved_with_edits',
            feedback_type: 'redlined_document',
            redlined_content: redlinedContent
        });

    } catch (error) {
        console.error('Error with OpenAI API:', error);
        res.status(500).send('Error performing AI review.');
    }
});

async function createRedlinePrompt(text: string): Promise<string> {
    const sopRulesPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'sop_rules.json');
    const sopRules = JSON.parse(await fs.readFile(sopRulesPath, 'utf-8'));

    // In a real RAG implementation, you'd query a vector DB to find the most relevant rules.
    // For now, we'll just stringify the rules.

    return `
        You are an expert editor for a hospitality group. Your task is to correct a menu submission based on a strict set of company rules.
        Rewrite the entire menu document, incorporating all necessary corrections.
        Mark your changes clearly using the following tags:
        - For text you are adding, wrap it in [ADD]...[/ADD] tags.
        - For text you are deleting, wrap it in [DELETE]...[/DELETE] tags.

        Do NOT just list the issues. You must return the full, corrected text with the markup.

        Here are the company rules:
        ---
        ${JSON.stringify(sopRules, null, 2)}
        ---
    `;
}


app.listen(port, () => {
    console.log(`ai-review service listening at http://localhost:${port}`);
});
