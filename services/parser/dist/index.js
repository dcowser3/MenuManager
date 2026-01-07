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
const multer_1 = __importDefault(require("multer"));
const fs_1 = require("fs");
const validator_1 = require("./src/validator");
const axios_1 = __importDefault(require("axios"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env from project root (works whether running from src or dist)
const envPath = path.resolve(__dirname, '../../../.env');
console.log(`Loading .env from: ${envPath}`);
dotenv_1.default.config({ path: envPath });
const app = (0, express_1.default)();
const port = 3001;
// Use absolute path for uploads to avoid path resolution issues
// __dirname in compiled code is services/parser/dist, so we need ../../../tmp/uploads to get to workspace root
const uploadsDir = path.resolve(__dirname, '../../../tmp/uploads');
const upload = (0, multer_1.default)({ dest: uploadsDir });
const execAsync = (0, util_1.promisify)(child_process_1.exec);
app.post('/parser', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    if (req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Here you would auto-reply with an email, for now, just sending a response
        return res.status(400).send('Invalid file type. Only .docx files are accepted.');
    }
    // Check for skip_validation flag (for testing purposes)
    const skipValidation = req.body.skip_validation === 'true' || req.body.skip_validation === true;
    if (skipValidation) {
        console.log('⚠️  SKIP_VALIDATION flag set - bypassing template and QA checks');
    }
    try {
        // Create initial record in the database
        const dbResponse = await axios_1.default.post('http://localhost:3004/submissions', {
            submitter_email: req.body.submitter_email || 'unknown@example.com', // You'll need to get this from the inbound-email service
            filename: req.file.originalname,
            original_path: req.file.path
        });
        const submission = dbResponse.data;
        const validationResult = await (0, validator_1.validateTemplate)(req.file.path);
        // Skip template validation if flag is set
        if (!skipValidation && !validationResult.isValid) {
            // Mark DB status as rejected due to template issues
            await axios_1.default.put(`http://localhost:3004/submissions/${submission.id}`, {
                status: 'rejected_template',
                template_errors: validationResult.errors
            });
            // Here you would auto-reply with an email attaching the official template
            console.log('Template validation failed:', validationResult.errors);
            return res.status(400).json({
                message: 'Document does not match the required template.',
                errors: validationResult.errors
            });
        }
        // Skip validation checks if flag is set
        if (!skipValidation) {
            // SOP FORMAT LINT (center alignment, font size 12, Calibri)
            // Check format FIRST - it's faster and more specific than QA check
            try {
                const pythonScript = path.resolve(__dirname, '..', '..', 'docx-redliner', 'format_lint.py');
                const venvPython = path.resolve(__dirname, '..', '..', 'docx-redliner', 'venv', 'bin', 'python');
                let command = `"${venvPython}" "${pythonScript}" "${req.file.path}"`;
                // fallback to system python if venv not present
                try {
                    const { stdout } = await execAsync(`[ -x "${venvPython}" ] && echo OK || echo NO`);
                    if (stdout.trim() === 'NO') {
                        command = `python3 "${pythonScript}" "${req.file.path}"`;
                    }
                }
                catch { /* ignore */ }
                const { stdout } = await execAsync(command, { timeout: 60000 });
                const lint = JSON.parse(stdout);
                if (!lint.passed) {
                    await axios_1.default.put(`http://localhost:3004/submissions/${submission.id}`, {
                        status: 'needs_prompt_fix',
                        sop_format_issues: lint.reasons,
                        sop_format_samples: lint.samples
                    });
                    return res.status(202).json({
                        message: 'Document failed SOP format check (center alignment / Calibri / 12pt).',
                        reasons: lint.reasons,
                        status: 'needs_prompt_fix'
                    });
                }
            }
            catch (lintError) {
                console.warn('SOP format lint error (continuing to QA check):', lintError.message);
            }
            // QA Pre-check: Run the SOP QA prompt to see if they pre-cleaned their menu
            // If there are too many errors, it means they didn't use the QA prompt before submitting
            const qaCheckResult = await runQAPreCheck(validationResult.text, submission.id);
            if (!qaCheckResult.passed) {
                await axios_1.default.put(`http://localhost:3004/submissions/${submission.id}`, {
                    status: 'needs_prompt_fix',
                    qa_feedback: qaCheckResult.feedback,
                    error_count: qaCheckResult.errorCount
                });
                return res.status(202).json({
                    message: 'Your menu has too many errors. Please run the SOP QA prompt (ChatGPT) to clean it up before resubmitting.',
                    status: 'needs_prompt_fix',
                    error_count: qaCheckResult.errorCount,
                    feedback_preview: qaCheckResult.feedback.substring(0, 500) + '...'
                });
            }
        }
        // If validation passes (or skipped), POST parsed payload to /ai-review
        console.log(`${skipValidation ? 'Validation skipped' : 'Validation passed'} for submission ${submission.id}. Posting to ai-review.`);
        await axios_1.default.post('http://localhost:3002/ai-review', {
            text: validationResult.text,
            submission_id: submission.id,
            submitter_email: submission.submitter_email,
            filename: submission.filename,
            original_path: req.file.path // Pass the original file path for formatting preservation
        });
        res.status(200).json({
            message: skipValidation
                ? 'File sent for AI review (validation bypassed).'
                : 'File passed validation and was sent for AI review.',
            submission_id: submission.id
        });
    }
    catch (error) {
        console.error('Error parsing file:', error);
        res.status(500).send('Error parsing file.');
    }
    finally {
        // DON'T clean up the uploaded file yet - AI review needs it to preserve formatting
        // The AI review service will handle cleanup after creating the draft
        // if (req.file) {
        //     await fs.unlink(req.file.path);
        // }
    }
});
app.listen(port, () => {
    console.log(`parser service listening at http://localhost:${port}`);
});
/**
 * Run the actual QA prompt (from SOP) to check if the menu was pre-cleaned
 * This is the SAME prompt chefs are supposed to run before submitting
 * If it finds too many errors, we reject and tell them to run the prompt first
 */
async function runQAPreCheck(text, submissionId) {
    try {
        // Check if OpenAI is configured
        console.log(`[DEBUG] OPENAI_API_KEY present: ${!!process.env.OPENAI_API_KEY}`);
        console.log(`[DEBUG] OPENAI_API_KEY length: ${process.env.OPENAI_API_KEY?.length || 0}`);
        console.log(`[DEBUG] OPENAI_API_KEY starts with: ${process.env.OPENAI_API_KEY?.substring(0, 10) || 'N/A'}`);
        const hasOpenAIKey = process.env.OPENAI_API_KEY &&
            process.env.OPENAI_API_KEY !== 'your-openai-api-key-here' &&
            process.env.OPENAI_API_KEY.trim() !== '';
        if (!hasOpenAIKey) {
            console.log(`⚠️  No OpenAI API key - skipping QA pre-check for submission ${submissionId}`);
            // In demo/test mode without OpenAI, we'll do a basic check
            return runBasicPreCheck(text);
        }
        // Load the QA prompt (same one chefs should use)
        const qaPromptPath = path.join(__dirname, '..', '..', '..', 'sop-processor', 'qa_prompt.txt');
        const qaPrompt = await fs_1.promises.readFile(qaPromptPath, 'utf-8');
        console.log(`Running QA pre-check for submission ${submissionId}...`);
        // Call OpenAI with the QA prompt
        const response = await axios_1.default.post('http://localhost:3002/run-qa-check', {
            text,
            prompt: qaPrompt
        });
        const feedback = response.data.feedback || '';
        // Count how many issues were found
        // We count BOTH: corrections made in CORRECTED MENU + items in SUGGESTIONS
        let suggestionsCount = 0;
        let correctionsCount = 0;
        // 1. Count suggestions in JSON array
        const suggestionsMatch = feedback.match(/=== SUGGESTIONS ===\s*(\[[\s\S]*?\])\s*=== END SUGGESTIONS ===/);
        if (suggestionsMatch) {
            try {
                const suggestions = JSON.parse(suggestionsMatch[1]);
                suggestionsCount = suggestions.length;
            }
            catch (e) {
                // Fallback: count "description": occurrences
                suggestionsCount = (feedback.match(/"description":/g) || []).length;
            }
        }
        // 2. Count corrections by comparing original to corrected menu
        const correctedMatch = feedback.match(/=== CORRECTED MENU ===\s*([\s\S]*?)\s*=== END CORRECTED MENU ===/);
        if (correctedMatch) {
            const correctedMenu = correctedMatch[1].trim();
            correctionsCount = countDifferences(text, correctedMenu);
            console.log(`Found ${correctionsCount} auto-corrections in CORRECTED MENU`);
        }
        const errorCount = suggestionsCount + correctionsCount;
        console.log(`QA pre-check found ${errorCount} total issues (${correctionsCount} corrections + ${suggestionsCount} suggestions)`);
        // Threshold: If 5 or more errors, reject and tell them to run the prompt
        // This means their menu is too messy and they didn't pre-clean it
        const ERROR_THRESHOLD = 5;
        const passed = errorCount < ERROR_THRESHOLD;
        if (!passed) {
            console.log(`❌ Submission ${submissionId} failed QA pre-check (${errorCount} errors >= ${ERROR_THRESHOLD} threshold)`);
        }
        else {
            console.log(`✅ Submission ${submissionId} passed QA pre-check (${errorCount} errors < ${ERROR_THRESHOLD} threshold)`);
        }
        return {
            passed,
            errorCount,
            feedback
        };
    }
    catch (error) {
        console.error('Error running QA pre-check:', error.message);
        // If QA check fails, fall back to basic check
        return runBasicPreCheck(text);
    }
}
/**
 * Fallback basic check when OpenAI is not available
 * Checks for obvious placeholder content or too-short submissions
 */
function runBasicPreCheck(text) {
    const lower = text.toLowerCase();
    const issues = [];
    // Check for placeholder phrases
    const placeholderPhrases = [
        'lorem ipsum',
        'tbd',
        'to be determined',
        'insert here',
        'placeholder',
        'sample text',
        'draft only',
        'xxx',
        '[fill in]',
        'coming soon'
    ];
    for (const phrase of placeholderPhrases) {
        if (lower.includes(phrase)) {
            issues.push(`Found placeholder text: "${phrase}"`);
        }
    }
    // Check word count
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 100) {
        issues.push('Menu content is too short (less than 100 words)');
    }
    // Check for menu content after boundary
    const boundaryMarker = 'Please drop the menu content below on page 2';
    if (text.includes(boundaryMarker)) {
        const boundaryIndex = text.indexOf(boundaryMarker);
        const contentAfter = text.substring(boundaryIndex + boundaryMarker.length).trim();
        if (contentAfter.length < 50) {
            issues.push('No substantial menu content found after the boundary marker');
        }
    }
    const passed = issues.length === 0;
    const feedback = issues.length > 0
        ? 'Basic validation issues:\n' + issues.map(i => `- ${i}`).join('\n')
        : 'Basic validation passed';
    return {
        passed,
        errorCount: issues.length,
        feedback
    };
}
/**
 * Count word-level differences between original and corrected text
 * Returns the number of words that were changed/corrected
 */
function countDifferences(original, corrected) {
    // Normalize both texts - lowercase, remove extra whitespace
    const normalizeWord = (w) => w.toLowerCase().replace(/[^\w\u00C0-\u017F]/g, '');
    const originalWords = original.split(/\s+/).map(normalizeWord).filter(Boolean);
    const correctedWords = corrected.split(/\s+/).map(normalizeWord).filter(Boolean);
    let differences = 0;
    const maxLen = Math.max(originalWords.length, correctedWords.length);
    // Simple word-by-word comparison
    // This catches spelling corrections like "avacado" -> "avocado"
    for (let i = 0; i < maxLen; i++) {
        const orig = originalWords[i] || '';
        const corr = correctedWords[i] || '';
        if (orig !== corr) {
            // Check if it's a meaningful difference (not just formatting)
            // Skip if both are empty or one is a subset of the other (partial match)
            if (orig && corr && orig !== corr) {
                differences++;
            }
        }
    }
    return differences;
}
