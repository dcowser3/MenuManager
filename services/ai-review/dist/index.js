"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const openai_1 = require("openai");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
// Load .env from project root (works whether running from src or dist)
const envPath = path.resolve(__dirname, '../../../.env');
console.log(`Loading .env from: ${envPath}`);
dotenv_1.default.config({ path: envPath });
const app = (0, express_1.default)();
const port = 3002;
const configuration = new openai_1.Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new openai_1.OpenAIApi(configuration);
app.use(express_1.default.json());
/**
 * QA Check Endpoint - Used by parser to run pre-check validation
 * This runs the same QA prompt that chefs should use before submitting
 */
app.post('/run-qa-check', async (req, res) => {
    const { text, prompt } = req.body;
    if (!text || !prompt) {
        return res.status(400).send('Missing text or prompt for QA check.');
    }
    try {
        const hasOpenAIKey = !!process.env.OPENAI_API_KEY &&
            process.env.OPENAI_API_KEY !== 'your-openai-api-key-here';
        if (!hasOpenAIKey) {
            return res.status(503).json({
                error: 'OpenAI API key not configured',
                feedback: 'QA check unavailable - API key not set'
            });
        }
        console.log('Running QA check...');
        const qaResponse = await openai.createChatCompletion({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: `Here is the menu text to review:\n\n---\n\n${text}` }
            ],
        });
        const feedback = qaResponse.data.choices[0].message?.content || "No feedback generated.";
        res.status(200).json({ feedback });
    }
    catch (error) {
        console.error('Error during QA check:', error);
        res.status(500).json({
            error: 'Error performing QA check',
            message: error.message
        });
    }
});
app.post('/ai-review', async (req, res) => {
    // We'll now expect more metadata from the parser service
    const { text, submission_id, submitter_email, filename, original_path } = req.body;
    if (!text || !submission_id) {
        return res.status(400).send('Missing text or submission_id for review.');
    }
    try {
        // Check if OpenAI API key is configured
        const hasOpenAIKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your-openai-api-key-here';
        let generalQaFeedback = '';
        let redlinedContent = '';
        let issueCount = 0;
        if (!hasOpenAIKey) {
            // Mock mode for testing/demo without OpenAI API key
            console.log(`⚠️  No OpenAI API key configured - using mock AI responses for submission ${submission_id}`);
            generalQaFeedback = `Mock Tier 1 QA Feedback:\n\n✓ All required sections present\n✓ Formatting consistent\n✓ Menu items clearly listed\n\nMinor recommendations:\n- Description of Issue: Consider adding more descriptive language\n- Description of Issue: Check price consistency\n\nOverall: PASS`;
            issueCount = 2; // Mock: 2 issues (below threshold of 5)
            redlinedContent = `==============================================
AI-GENERATED REVIEW (MOCK MODE)
==============================================

TIER 1 ANALYSIS - GENERAL QA
----------------------------
✅ All required sections present
✅ Formatting consistent with RSH standards
✅ Menu items clearly organized
⚠️  Recommendation: Add more sensory descriptions

TIER 2 ANALYSIS - RED-LINED CORRECTIONS
----------------------------------
Suggested changes:
1. Enhanced item descriptions for better appeal
2. Price formatting standardization
3. Wine pairing suggestions where appropriate

CONFIDENCE: 92% (Mock)
STATUS: Ready for human review

NOTE: This is a mock AI response for testing purposes.
Configure OPENAI_API_KEY in .env for real AI reviews.
==============================================`;
        }
        else {
            // Real AI mode with OpenAI
            console.log(`Using OpenAI for submission ${submission_id}`);
            // --- Tier 1: Run the General QA Prompt ---
            const qaPromptPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'qa_prompt.txt');
            const qaPrompt = await fs_1.promises.readFile(qaPromptPath, 'utf-8');
            const qaResponse = await openai.createChatCompletion({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: qaPrompt },
                    { role: 'user', content: `Here is the menu text to review:\n\n---\n\n${text}` }
                ],
            });
            generalQaFeedback = qaResponse.data.choices[0].message?.content || "No feedback generated.";
            issueCount = (generalQaFeedback.match(/Description of Issue:/g) || []).length;
        }
        // Temporarily increased threshold to 99 for testing red-lining functionality
        // TODO: Change back to 5 for production
        if (issueCount > 99) {
            // Fails Tier 1: Notify the original submitter to resubmit.
            console.log(`Submission ${submission_id} failed Tier 1. Notifying submitter.`);
            await axios_1.default.post('http://localhost:3003/notify', {
                type: 'tier1_rejection',
                payload: {
                    submitter_email: submitter_email,
                    feedback_content: generalQaFeedback
                }
            });
            await axios_1.default.put(`http://localhost:3004/submissions/${submission_id}/status`, { status: 'rejected_tier1' });
            return res.status(200).send({ status: 'rejected_tier1', message: 'Submission failed Tier 1 review.' });
        }
        // --- Tier 2: Passed Tier 1, generate clean document for human review ---
        console.log(`Submission ${submission_id} passed Tier 1. Preparing for human review.`);
        // Save the AI draft by copying the original document (preserving template)
        const draftPath = await saveAiDraft(submission_id, '', text, original_path, hasOpenAIKey);
        // Update submission in DB with new status and draft path
        // Note: Document goes directly to pending_human_review without redlining
        await axios_1.default.put(`http://localhost:3004/submissions/${submission_id}`, {
            status: 'pending_human_review',
            ai_draft_path: draftPath
        });
        // Trigger internal notification for human review (non-blocking)
        // If SMTP isn't configured, this will fail but shouldn't stop the workflow
        try {
            await axios_1.default.post('http://localhost:3003/notify', {
                type: 'internal_review_request',
                payload: {
                    submission_id: submission_id,
                    filename: filename
                }
            });
            console.log(`✓ Notification sent for submission ${submission_id}`);
        }
        catch (notifyError) {
            console.warn(`⚠️  Failed to send notification (SMTP not configured?):`, notifyError.message);
            console.log(`   Submission ${submission_id} is still ready for review in the dashboard`);
        }
        res.status(200).send({ status: 'pending_human_review', message: 'AI draft generated and is pending human review.' });
    }
    catch (error) {
        console.error('Error during AI review:', error);
        res.status(500).send('Error performing AI review.');
    }
});
async function saveAiDraft(submissionId, content, originalText = '', originalPath = '', hasOpenAIKey = false) {
    const DRAFTS_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'ai-drafts');
    if (!fsSync.existsSync(DRAFTS_DIR)) {
        await fs_1.promises.mkdir(DRAFTS_DIR, { recursive: true });
    }
    // Save as proper Word document - PRESERVE THE TEMPLATE
    const filePath = path.join(DRAFTS_DIR, `${submissionId}-draft.docx`);
    try {
        if (originalPath && fsSync.existsSync(originalPath)) {
            // IMPORTANT: Copy the original document to preserve the template
            // The template form (page 1) must remain completely untouched
            console.log(`📝 Copying original document to preserve template...`);
            await fs_1.promises.copyFile(originalPath, filePath);
            console.log(`✓ Draft created (original document copied, template preserved): ${filePath}`);
            // Note: AI corrections are applied later when the reviewer clicks
            // "Generate Redlined Version" in the dashboard. The Python redliner will:
            // 1. Load this document (with template intact)
            // 2. Find the boundary marker
            // 3. Send ONLY menu content (after marker) to AI
            // 4. Apply redlines ONLY to menu content section
            // This ensures the template is NEVER modified.
        }
        else {
            console.warn('⚠️  Original path not found, creating text file instead');
            const textPath = path.join(DRAFTS_DIR, `${submissionId}-draft.txt`);
            await fs_1.promises.writeFile(textPath, content);
            return textPath;
        }
    }
    catch (error) {
        console.error('Error creating AI draft:', error);
        // Fallback to text file
        const textPath = path.join(DRAFTS_DIR, `${submissionId}-draft.txt`);
        await fs_1.promises.writeFile(textPath, content);
        console.log(`⚠️  Saved as text file instead: ${textPath}`);
        return textPath;
    }
    return filePath;
}
/**
 * Parse AI corrections and return clean corrected text (without [DELETE]/[ADD] markers)
 */
function parseAICorrectedText(aiText) {
    // Remove [DELETE]...[/DELETE] or [DELETE]...[DELETE] content
    let cleaned = aiText.replace(/\[DELETE\].*?(?:\[\/DELETE\]|\[DELETE\])/gs, '');
    // Replace [ADD]...[/ADD] or [ADD]...[ADD] with just the content
    cleaned = cleaned.replace(/\[ADD\](.*?)(?:\[\/ADD\]|\[ADD\])/gs, '$1');
    return cleaned.trim();
}
app.listen(port, () => {
    console.log(`ai-review service listening at http://localhost:${port}`);
});
