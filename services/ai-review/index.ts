import express from 'express';
import { Configuration, OpenAIApi } from 'openai';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import * as path from 'path';
import axios from 'axios';

dotenv.config({ path: '../../../.env' });

const app = express();
const port = 3002;

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(express.json());

app.post('/ai-review', async (req, res) => {
    // We'll now expect more metadata from the parser service
    const { text, submission_id, submitter_email, filename } = req.body;

    if (!text || !submission_id) {
        return res.status(400).send('Missing text or submission_id for review.');
    }

    try {
        // --- Tier 1: Run the General QA Prompt ---
        const qaPromptPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'qa_prompt.txt');
        const qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');

        const qaResponse = await openai.createChatCompletion({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: qaPrompt },
                { role: 'user', content: `Here is the menu text to review:\n\n---\n\n${text}` }
            ],
        });
        const generalQaFeedback = qaResponse.data.choices[0].message?.content || "No feedback generated.";
        const issueCount = (generalQaFeedback.match(/Description of Issue:/g) || []).length;

        if (issueCount > 5) {
            // Fails Tier 1: Notify the original submitter to resubmit.
            console.log(`Submission ${submission_id} failed Tier 1. Notifying submitter.`);
            await axios.post('http://localhost:3003/notify', {
                type: 'tier1_rejection',
                payload: {
                    submitter_email: submitter_email,
                    feedback_content: generalQaFeedback
                }
            });
            await axios.put(`http://localhost:3004/submissions/${submission_id}/status`, { status: 'rejected_tier1' });
            return res.status(200).send({ status: 'rejected_tier1', message: 'Submission failed Tier 1 review.' });
        }

        // --- Tier 2: Passed Tier 1, proceed to red-lining ---
        console.log(`Submission ${submission_id} passed Tier 1. Generating red-lined draft.`);
        const redlinePrompt = await createRedlinePrompt();
        const redlineResponse = await openai.createChatCompletion({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: redlinePrompt },
                { role: 'user', content: `Here is the menu text to correct:\n\n---\n\n${text}` }
            ],
        });
        const redlinedContent = redlineResponse.data.choices[0].message?.content || "Could not generate red-lined content.";

        // Save the AI draft (e.g., to a file, and update DB with the path)
        const draftPath = await saveAiDraft(submission_id, redlinedContent);

        // Update submission in DB with new status and draft path
        await axios.put(`http://localhost:3004/submissions/${submission_id}`, {
            status: 'pending_human_review',
            ai_draft_path: draftPath
        });

        // Trigger internal notification for human review
        await axios.post('http://localhost:3003/notify', {
            type: 'internal_review_request',
            payload: {
                submission_id: submission_id,
                filename: filename
            }
        });

        res.status(200).send({ status: 'pending_human_review', message: 'AI draft generated and is pending human review.' });

    } catch (error) {
        console.error('Error during AI review:', error);
        res.status(500).send('Error performing AI review.');
    }
});

async function createRedlinePrompt(): Promise<string> {
    const sopRulesPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'sop_rules.json');
    const sopRules = JSON.parse(await fs.readFile(sopRulesPath, 'utf-8'));
    return `
        You are an expert editor... Mark your changes clearly using [ADD]...[/ADD] and [DELETE]...[/DELETE] tags.
        Here are the company rules:
        ---
        ${JSON.stringify(sopRules, null, 2)}
        ---
    `;
}

async function saveAiDraft(submissionId: string, content: string): Promise<string> {
    const DRAFTS_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'ai-drafts');
    if (!fs.existsSync(DRAFTS_DIR)) {
        await fs.mkdir(DRAFTS_DIR, { recursive: true });
    }
    const filePath = path.join(DRAFTS_DIR, `${submissionId}-draft.txt`);
    await fs.writeFile(filePath, content);
    console.log(`AI draft for submission ${submissionId} saved to ${filePath}`);
    return filePath;
}

app.listen(port, () => {
    console.log(`ai-review service listening at http://localhost:${port}`);
});
