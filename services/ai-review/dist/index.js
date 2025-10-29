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
const docx_builder_1 = require("./src/docx-builder");
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
        // --- Tier 2: Passed Tier 1, proceed to red-lining ---
        console.log(`Submission ${submission_id} passed Tier 1. Generating red-lined draft.`);
        if (hasOpenAIKey) {
            const redlinePrompt = await createRedlinePrompt();
            const redlineResponse = await openai.createChatCompletion({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: redlinePrompt },
                    { role: 'user', content: `Here is the menu text to correct:\n\n---\n\n${text}` }
                ],
            });
            redlinedContent = redlineResponse.data.choices[0].message?.content || "Could not generate red-lined content.";
        }
        // else: redlinedContent already set in mock mode above
        // Save the AI draft as a proper Word document with red-lining
        // Pass the original document path so we can modify it directly (preserving all formatting)
        const draftPath = await saveAiDraft(submission_id, redlinedContent, text, original_path);
        // Update submission in DB with new status and draft path
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
async function createRedlinePrompt() {
    const sopRulesPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'sop_rules.json');
    const sopRules = JSON.parse(await fs_1.promises.readFile(sopRulesPath, 'utf-8'));
    return `
        You are an expert menu editor for Richard Sandoval Hospitality.
        
        IMPORTANT: The document contains a template form on page 1 (headers, form fields, instructions).
        DO NOT make any changes to the template section. The template section ends at the text:
        "Please drop the menu content below on page 2."
        
        ONLY review and correct the MENU CONTENT that appears AFTER that line (page 2 onwards).
        This is the actual menu items, descriptions, and prices submitted by the chef.
        
        When making corrections to the menu content:
        - Mark deletions with [DELETE]text to remove[/DELETE] (note the forward slash in closing tag)
        - Mark additions with [ADD]text to add[/ADD] (note the forward slash in closing tag)
        - IMPORTANT: Use [/DELETE] and [/ADD] with forward slashes for closing tags, NOT [DELETE] or [ADD]
        - Check for grammar, spelling, formatting consistency
        - Ensure menu items follow the SOP guidelines below
        - Verify pricing format is consistent
        
        EXAMPLE FORMAT:
        Original: "Guacamole - Fresh avacado, lime - $12"
        Corrected: "Guacamole - Fresh [DELETE]avacado[/DELETE][ADD]avocado[/ADD], lime - $12"
        
        Here are the RSH menu guidelines:
        ---
        ${JSON.stringify(sopRules, null, 2)}
        ---
        
        Remember: Leave the template (page 1) completely untouched. Only correct the menu content on page 2+.
    `;
}
async function saveAiDraft(submissionId, content, originalText = '', originalPath = '') {
    const DRAFTS_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'ai-drafts');
    if (!fsSync.existsSync(DRAFTS_DIR)) {
        await fs_1.promises.mkdir(DRAFTS_DIR, { recursive: true });
    }
    // Save as proper Word document with red-lining and yellow highlights
    const filePath = path.join(DRAFTS_DIR, `${submissionId}-draft.docx`);
    try {
        // Parse AI corrections to get clean corrected text
        const correctedText = parseAICorrectedText(content);
        // Build a clean Word document from scratch with track changes
        console.log(`📝 Building red-lined Word document from scratch...`);
        await (0, docx_builder_1.buildRedlinedDocx)(originalText, correctedText, filePath);
        console.log(`✓ AI draft Word document saved to ${filePath}`);
    }
    catch (error) {
        console.error('Error generating Word document, falling back to text:', error);
        // Fallback to text file if Word generation fails
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
