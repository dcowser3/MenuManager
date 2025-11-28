import express from 'express';
import { Configuration, OpenAIApi } from 'openai';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import axios from 'axios';
import { generateRedlinedDocx } from './src/docx-generator';
import { modifyExistingDocx } from './src/docx-modifier';
import { buildRedlinedDocx } from './src/docx-builder';

// Load .env from project root (works whether running from src or dist)
const envPath = path.resolve(__dirname, '../../../.env');
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

const app = express();
const port = 3002;

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(express.json());

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

    } catch (error: any) {
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
        
        let generalQaFeedback: string = '';
        let redlinedContent: string = '';
        let issueCount: number = 0;

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
        } else {
            // Real AI mode with OpenAI
            console.log(`Using OpenAI for submission ${submission_id}`);
            
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
            generalQaFeedback = qaResponse.data.choices[0].message?.content || "No feedback generated.";
            issueCount = (generalQaFeedback.match(/Description of Issue:/g) || []).length;
        }

        // Temporarily increased threshold to 99 for testing red-lining functionality
        // TODO: Change back to 5 for production
        if (issueCount > 99) {
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

        // --- Tier 2: Passed Tier 1, generate redlined version for human review ---
        console.log(`Submission ${submission_id} passed Tier 1. Generating redlined version for review.`);
        
        // Save the AI draft by copying the original document (preserving template)
        const draftPath = await saveAiDraft(submission_id, '', text, original_path, hasOpenAIKey);
        
        // Automatically generate the redlined version using Python redliner
        // This ensures it's ready when the reviewer opens the dashboard
        const redlinedPath = await generateRedlinedDocument(submission_id, draftPath);

        // Update submission in DB with new status and draft path
        await axios.put(`http://localhost:3004/submissions/${submission_id}`, {
            status: 'pending_human_review',
            ai_draft_path: draftPath
        });

        // Trigger internal notification for human review (non-blocking)
        // If SMTP isn't configured, this will fail but shouldn't stop the workflow
        try {
            await axios.post('http://localhost:3003/notify', {
                type: 'internal_review_request',
                payload: {
                    submission_id: submission_id,
                    filename: filename
                }
            });
            console.log(`✓ Notification sent for submission ${submission_id}`);
        } catch (notifyError: any) {
            console.warn(`⚠️  Failed to send notification (SMTP not configured?):`, notifyError.message);
            console.log(`   Submission ${submission_id} is still ready for review in the dashboard`);
        }

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
        You are an expert menu editor for Richard Sandoval Hospitality.
        
        IMPORTANT: The document contains a template form on page 1 (headers, form fields, instructions).
        DO NOT make any changes to the template section. The template section ends at the text:
        "Please drop the menu content below on page 2."
        
        ONLY review and correct the MENU CONTENT that appears AFTER that line (page 2 onwards).
        This is the actual menu items, descriptions, and prices submitted by the chef.
        
        CAPITALIZATION - PRESERVE EXISTING:
        - DO NOT change existing capitalization of dish names, section headers, or titles
        - DO NOT lowercase or capitalize words that are already styled intentionally
        - Only fix ALL CAPS that shouldn't be (except approved acronyms/brands)
        
        SPELLING CORRECTIONS (only fix clear errors):
        - "tartar" → "tartare" (for raw preparations)
        - "pre-fix" or "prefix" → "prix fixe"
        - "avacado" → "avocado"
        - "mozarella" → "mozzarella"
        - "parmesian" → "parmesan"
        - "Ceasar/Cesar" → "Caesar"
        
        FORMATTING:
        - Mark deletions with [DELETE]text[/DELETE]
        - Mark additions with [ADD]text[/ADD]
        - DO NOT change ingredient separators - keep commas and hyphens as they are
        - DO NOT split compound words (yuzu-lime, cucumber-cilantro, huitlacoche-stuffed)
        - Dual prices: use " | " (space-bar-space), not "/"
        - Allergen markers: uppercase, comma-separated, no spaces (e.g., D,G,N)
        - Raw/undercooked items: append asterisk (*) for tartare, carpaccio, raw fish, caviar, raw egg
        - Diacritics: jalapeño, crème brûlée, purée, soufflé, flambéed
        
        EXAMPLE FORMAT:
        Original: "Tuna Tartar Tostada, avocado mousse, hibiscus ponzu D,G"
        Corrected: "Tuna [DELETE]Tartar[/DELETE][ADD]Tartare[/ADD] Tostada, avocado mousse, hibiscus ponzu[ADD] *[/ADD] D,G"
        
        DO NOT CHANGE:
        - Section headers like "The Spark – "El Primer Encuentro""
        - Dish names like "Chilean Sea Bass en Pipián Verde"
        - Compound words like "cucumber-cilantro", "yuzu-lime"
        - Existing capitalization choices
        
        Here are the RSH menu guidelines:
        ---
        ${JSON.stringify(sopRules, null, 2)}
        ---
        
        Remember: Leave the template (page 1) completely untouched. Only correct the menu content on page 2+.
        Be CONSERVATIVE - only fix clear errors. Do not change stylistic choices or capitalize descriptions.
    `;
}

/**
 * Generate redlined document using Python redliner
 * This applies AI corrections with visual track changes (red strikethrough, yellow highlight)
 */
async function generateRedlinedDocument(submissionId: string, draftPath: string): Promise<string | null> {
    try {
        const REDLINED_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'redlined');
        if (!fsSync.existsSync(REDLINED_DIR)) {
            await fs.mkdir(REDLINED_DIR, { recursive: true });
        }
        
        const redlinedPath = path.join(REDLINED_DIR, `${submissionId}-redlined.docx`);
        
        // Call Python redliner script
        const pythonScript = path.resolve(__dirname, '..', '..', 'docx-redliner', 'process_menu.py');
        const venvPython = path.resolve(__dirname, '..', '..', 'docx-redliner', 'venv', 'bin', 'python');
        
        let command = `"${venvPython}" "${pythonScript}" "${draftPath}" "${redlinedPath}"`;
        
        // Check if venv python exists
        try {
            await fs.access(venvPython);
        } catch {
            command = `python3 "${pythonScript}" "${draftPath}" "${redlinedPath}"`;
        }
        
        console.log(`🔍 Generating redlined version for ${submissionId}...`);
        console.log(`   Command: ${command}`);
        
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const { stdout, stderr } = await execAsync(command, { timeout: 120000 });
        
        if (stdout) console.log(`   Redliner output: ${stdout.substring(0, 200)}`);
        if (stderr) console.warn(`   Redliner warnings: ${stderr.substring(0, 200)}`);
        
        // Update database with redlined path
        await axios.put(`http://localhost:3004/submissions/${submissionId}`, {
            redlined_path: redlinedPath,
            redlined_at: new Date().toISOString()
        });
        
        console.log(`✅ Redlined version ready: ${redlinedPath}`);
        return redlinedPath;
        
    } catch (error: any) {
        console.error(`❌ Error generating redlined version: ${error.message}`);
        // Don't fail the whole process if redlining fails
        return null;
    }
}

async function saveAiDraft(submissionId: string, content: string, originalText: string = '', originalPath: string = '', hasOpenAIKey: boolean = false): Promise<string> {
    const DRAFTS_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'ai-drafts');
    if (!fsSync.existsSync(DRAFTS_DIR)) {
        await fs.mkdir(DRAFTS_DIR, { recursive: true });
    }
    
    // Save as proper Word document - PRESERVE THE TEMPLATE
    const filePath = path.join(DRAFTS_DIR, `${submissionId}-draft.docx`);
    
    try {
        if (originalPath && fsSync.existsSync(originalPath)) {
            // IMPORTANT: Copy the original document to preserve the template
            // The template form (page 1) must remain completely untouched
            console.log(`📝 Copying original document to preserve template...`);
            await fs.copyFile(originalPath, filePath);
            console.log(`✓ Draft created (original document copied, template preserved): ${filePath}`);
            
            // Note: AI corrections are applied later when the reviewer clicks
            // "Generate Redlined Version" in the dashboard. The Python redliner will:
            // 1. Load this document (with template intact)
            // 2. Find the boundary marker
            // 3. Send ONLY menu content (after marker) to AI
            // 4. Apply redlines ONLY to menu content section
            // This ensures the template is NEVER modified.
        } else {
            console.warn('⚠️  Original path not found, creating text file instead');
            const textPath = path.join(DRAFTS_DIR, `${submissionId}-draft.txt`);
            await fs.writeFile(textPath, content);
            return textPath;
        }
    } catch (error) {
        console.error('Error creating AI draft:', error);
        // Fallback to text file
        const textPath = path.join(DRAFTS_DIR, `${submissionId}-draft.txt`);
        await fs.writeFile(textPath, content);
        console.log(`⚠️  Saved as text file instead: ${textPath}`);
        return textPath;
    }
    
    return filePath;
}

/**
 * Parse AI corrections and return clean corrected text (without [DELETE]/[ADD] markers)
 */
function parseAICorrectedText(aiText: string): string {
    // Remove [DELETE]...[/DELETE] or [DELETE]...[DELETE] content
    let cleaned = aiText.replace(/\[DELETE\].*?(?:\[\/DELETE\]|\[DELETE\])/gs, '');
    
    // Replace [ADD]...[/ADD] or [ADD]...[ADD] with just the content
    cleaned = cleaned.replace(/\[ADD\](.*?)(?:\[\/ADD\]|\[ADD\])/gs, '$1');
    
    return cleaned.trim();
}

app.listen(port, () => {
    console.log(`ai-review service listening at http://localhost:${port}`);
});
