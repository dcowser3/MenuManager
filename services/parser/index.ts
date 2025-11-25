import express from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import { validateTemplate } from './src/validator';
import axios from 'axios';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const app = express();
const port = 3001;

// Use absolute path for uploads to avoid path resolution issues
// __dirname in compiled code is services/parser/dist, so we need ../../../tmp/uploads to get to workspace root
const uploadsDir = path.resolve(__dirname, '../../../tmp/uploads');
const upload = multer({ dest: uploadsDir });
const execAsync = promisify(exec);

app.post('/parser', upload.single('file') as any, async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    if (req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Here you would auto-reply with an email, for now, just sending a response
        return res.status(400).send('Invalid file type. Only .docx files are accepted.');
    }

    try {
        // Create initial record in the database
        const dbResponse = await axios.post('http://localhost:3004/submissions', {
            submitter_email: req.body.submitter_email || 'unknown@example.com', // You'll need to get this from the inbound-email service
            filename: req.file.originalname,
            original_path: req.file.path
        });
        const submission = dbResponse.data;

        const validationResult = await validateTemplate(req.file.path);

        if (!validationResult.isValid) {
            // Mark DB status as rejected due to template issues
            await axios.put(`http://localhost:3004/submissions/${submission.id}`, {
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

        // QA Pre-check: Run the SOP QA prompt to see if they pre-cleaned their menu
        // If there are too many errors, it means they didn't use the QA prompt before submitting
        const qaCheckResult = await runQAPreCheck(validationResult.text, submission.id);
        if (!qaCheckResult.passed) {
            await axios.put(`http://localhost:3004/submissions/${submission.id}`, {
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

        // SOP FORMAT LINT (center alignment, font size 12, Calibri)
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
            } catch { /* ignore */ }
            const { stdout } = await execAsync(command, { timeout: 60000 });
            const lint = JSON.parse(stdout);
            if (!lint.passed) {
                await axios.put(`http://localhost:3004/submissions/${submission.id}`, {
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
        } catch (lintError: any) {
            console.warn('SOP format lint error (continuing to AI review):', lintError.message);
        }

        // If validation passes, POST parsed payload to /ai-review
        console.log(`Validation passed for submission ${submission.id}. Posting to ai-review.`);
        await axios.post('http://localhost:3002/ai-review', {
            text: validationResult.text,
            submission_id: submission.id,
            submitter_email: submission.submitter_email,
            filename: submission.filename,
            original_path: req.file.path  // Pass the original file path for formatting preservation
        });
        
        res.status(200).json({ 
            message: 'File passed validation and was sent for AI review.',
            submission_id: submission.id
        });

    } catch (error) {
        console.error('Error parsing file:', error);
        res.status(500).send('Error parsing file.');
    } finally {
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
async function runQAPreCheck(text: string, submissionId: string): Promise<{
    passed: boolean;
    errorCount: number;
    feedback: string;
}> {
    try {
        // Check if OpenAI is configured
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
        const qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');

        console.log(`Running QA pre-check for submission ${submissionId}...`);

        // Call OpenAI with the QA prompt
        const response = await axios.post('http://localhost:3002/run-qa-check', {
            text,
            prompt: qaPrompt
        });

        const feedback = response.data.feedback || '';
        
        // Count how many issues were found
        // The QA prompt outputs issues with "Description of Issue:" prefix
        const errorCount = (feedback.match(/Description of Issue:/g) || []).length;

        console.log(`QA pre-check found ${errorCount} issues`);

        // Threshold: If more than 10 errors, reject and tell them to run the prompt
        // This means their menu is too messy and they didn't pre-clean it
        const ERROR_THRESHOLD = 10;
        const passed = errorCount <= ERROR_THRESHOLD;

        if (!passed) {
            console.log(`❌ Submission ${submissionId} failed QA pre-check (${errorCount} errors > ${ERROR_THRESHOLD} threshold)`);
        } else {
            console.log(`✅ Submission ${submissionId} passed QA pre-check (${errorCount} errors <= ${ERROR_THRESHOLD} threshold)`);
        }

        return {
            passed,
            errorCount,
            feedback
        };

    } catch (error: any) {
        console.error('Error running QA pre-check:', error.message);
        // If QA check fails, fall back to basic check
        return runBasicPreCheck(text);
    }
}

/**
 * Fallback basic check when OpenAI is not available
 * Checks for obvious placeholder content or too-short submissions
 */
function runBasicPreCheck(text: string): {
    passed: boolean;
    errorCount: number;
    feedback: string;
} {
    const lower = text.toLowerCase();
    const issues: string[] = [];

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
