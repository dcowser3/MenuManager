import express = require('express');
import { Configuration, OpenAIApi } from 'openai';
import dotenv = require('dotenv');
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import axios from 'axios';
import { createInternalApiClient, requireInternalServiceAuth } from '@menumanager/internal-auth';

// Load .env from project root (works whether running from src or dist)
const envPath = path.resolve(__dirname, '../../../.env');
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

const app = express();
const port = 3002;
const DB_SERVICE_URL = process.env.DB_SERVICE_URL || 'http://localhost:3004';
const internalApi = createInternalApiClient(axios);

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const AI_REVIEW_MODEL = process.env.AI_REVIEW_MODEL || 'gpt-4o-mini';

app.use(express.json());
app.use(requireInternalServiceAuth);

type DishQualityVerdict = 'dish' | 'not_dish' | 'uncertain';
type DishQualityConfidence = 'high' | 'medium' | 'low';

type DishQualityCheckRow = {
    index: number;
    dishName?: string;
    description?: string;
    category?: string;
    servicePeriod?: string;
    price?: string;
    allergens?: string[];
    qualityIssues?: Array<{ code?: string; reason?: string; severity?: string }>;
    sourceContext?: {
        sourceLine?: string;
        previousLine?: string;
        nextLine?: string;
        context?: string;
        lineNumber?: number;
    };
};

export type DishQualityAiResult = {
    index: number;
    verdict: DishQualityVerdict;
    confidence: DishQualityConfidence;
    reason: string;
};

function hasConfiguredOpenAIKey(): boolean {
    return !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your-openai-api-key-here';
}

function normalizeVerdict(value: unknown): DishQualityVerdict {
    if (value === 'dish' || value === 'not_dish' || value === 'uncertain') {
        return value;
    }
    return 'uncertain';
}

function normalizeConfidence(value: unknown): DishQualityConfidence {
    if (value === 'high' || value === 'medium' || value === 'low') {
        return value;
    }
    return 'low';
}

function uncertainResult(index: number, reason = 'AI response was unavailable or invalid.'): DishQualityAiResult {
    return {
        index,
        verdict: 'uncertain',
        confidence: 'low',
        reason,
    };
}

function extractJsonObject(text: string): any {
    const trimmed = `${text || ''}`.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonText = fenced ? fenced[1] : trimmed;
    return JSON.parse(jsonText);
}

export function parseDishQualityAiResponse(content: string, rows: DishQualityCheckRow[]): DishQualityAiResult[] {
    try {
        const parsed = extractJsonObject(content);
        const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];
        const byIndex = new Map<number, DishQualityAiResult>();

        for (const result of rawResults) {
            const index = Number(result?.index);
            if (!Number.isInteger(index)) {
                continue;
            }
            byIndex.set(index, {
                index,
                verdict: normalizeVerdict(result?.verdict),
                confidence: normalizeConfidence(result?.confidence),
                reason: `${result?.reason || ''}`.trim() || 'No reason provided.',
            });
        }

        return rows.map((row) => byIndex.get(Number(row.index)) || uncertainResult(Number(row.index), 'AI response omitted this row.'));
    } catch {
        return rows.map((row) => uncertainResult(Number(row.index), 'AI response was not valid JSON.'));
    }
}

export function buildDishQualityPrompt(input: {
    property?: string;
    servicePeriod?: string;
    rows: DishQualityCheckRow[];
}): string {
    return [
        'You are reviewing extracted restaurant menu rows before they are saved as approved dishes.',
        'Return JSON only with shape {"results":[{"index":number,"verdict":"dish|not_dish|uncertain","confidence":"high|medium|low","reason":"short reason"}]}.',
        'Use "dish" for real menu items, including beverages, spirits, wines, beers, waters, flights, and simple protein options like a fajita protein with a price.',
        'Beverage price-list rows can be valid dishes even when they have only a name and price.',
        'Use "not_dish" for pricing grids, instructions, category headings, package/course labels, allergen legends, and rows that are clearly not orderable items.',
        'Beverage section headings such as Pick Me Up, Pick Me Ups, Cocteles, Zero Proof, Espumoso, Blanco, Rosado, Rojo, Cerveza, Reposado, Añejo, Mezcal, Flights, and Vino by the Bottle are not dishes when they describe the following rows.',
        'Visual leader dots or repeated punctuation are layout artifacts, not part of an item name.',
        'Use "uncertain" when context is insufficient or a row may be a legitimate unusual menu item.',
        'Only use high confidence when the evidence is obvious.',
        '',
        `Property: ${input.property || 'Unknown'}`,
        `Service period: ${input.servicePeriod || 'Unknown'}`,
        '',
        'Rows to review:',
        JSON.stringify(input.rows, null, 2),
    ].join('\n');
}

app.post('/approved-dishes/quality-check', async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 100) as DishQualityCheckRow[] : [];
    if (rows.length === 0) {
        return res.status(400).json({ error: 'rows are required' });
    }

    if (!hasConfiguredOpenAIKey()) {
        return res.status(503).json({ error: 'OpenAI API key not configured' });
    }

    try {
        const prompt = buildDishQualityPrompt({
            property: `${req.body?.property || ''}`.trim(),
            servicePeriod: `${req.body?.servicePeriod || ''}`.trim(),
            rows,
        });

        const response = await openai.createChatCompletion({
            model: AI_REVIEW_MODEL,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: 'You classify extracted menu rows. Respond with strict JSON only.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        });

        const content = response.data.choices[0].message?.content || '';
        res.json({
            results: parseDishQualityAiResponse(content, rows),
        });
    } catch (error: any) {
        console.error('Error during approved dish quality check:', error.message);
        res.status(500).json({
            error: 'Error performing approved dish quality check',
            message: error.message,
        });
    }
});

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
            model: AI_REVIEW_MODEL,
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
            console.log(`Using OpenAI model ${AI_REVIEW_MODEL} for submission ${submission_id}`);
            
            // --- Tier 1: Run the General QA Prompt ---
            const qaPromptPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'qa_prompt.txt');
            const qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');

            const qaResponse = await openai.createChatCompletion({
                model: AI_REVIEW_MODEL,
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
            // Fails Tier 1: mark as rejected_tier1 (no email notification in current workflow).
            console.log(`Submission ${submission_id} failed Tier 1.`);
            await internalApi.put(`${DB_SERVICE_URL}/submissions/${submission_id}`, { status: 'rejected_tier1' });
            return res.status(200).send({ status: 'rejected_tier1', message: 'Submission failed Tier 1 review.' });
        }

        // --- Tier 2: Passed Tier 1, generate clean document for human review ---
        console.log(`Submission ${submission_id} passed Tier 1. Preparing for human review.`);

        // Save the AI draft by copying the original document (preserving template)
        const draftPath = await saveAiDraft(submission_id, '', text, original_path, hasOpenAIKey);

        // Update submission in DB with new status and draft path
        // Note: Document goes directly to pending_human_review without redlining
        await internalApi.put(`${DB_SERVICE_URL}/submissions/${submission_id}`, {
            status: 'pending_human_review',
            ai_draft_path: draftPath
        });

        res.status(200).send({ status: 'pending_human_review', message: 'AI draft generated and is pending human review.' });

    } catch (error) {
        console.error('Error during AI review:', error);
        res.status(500).send('Error performing AI review.');
    }
});

async function saveAiDraft(submissionId: string, content: string, originalText: string = '', originalPath: string = '', hasOpenAIKey: boolean = false): Promise<string> {
    let DRAFTS_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'ai-drafts');
    if (originalPath) {
        DRAFTS_DIR = path.dirname(originalPath);
    }
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

if (require.main === module) {
    app.listen(port, () => {
        console.log(`ai-review service listening at http://localhost:${port}`);
    });
}
