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

const upload = multer({ dest: '../../../tmp/uploads/' });
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

        // Light-weight “prompt/vibe” check: reject obviously placeholder/unfinished content
        const needsPromptFix = shouldRequestPromptFix(validationResult.text);
        if (needsPromptFix) {
            await axios.put(`http://localhost:3004/submissions/${submission.id}`, {
                status: 'needs_prompt_fix',
                prompt_fix_reason: 'Document contains placeholder or incomplete content.'
            });
            return res.status(202).json({
                message: 'Document appears incomplete. Ask the submitter to finalize content before review.',
                status: 'needs_prompt_fix'
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
 * Check for placeholder/unfinished content. Intentionally simple, no mocks.
 */
function shouldRequestPromptFix(text: string): boolean {
    const lower = text.toLowerCase();
    const placeholderPhrases = [
        'lorem ipsum',
        'tbd',
        'to be determined',
        'insert here',
        'placeholder',
        'sample text',
        'draft only'
    ];
    const hasPlaceholder = placeholderPhrases.some(p => lower.includes(p));
    // Require some reasonable amount of menu text after boundary
    const wordCount = lower.split(/\s+/).filter(Boolean).length;
    return hasPlaceholder || wordCount < 60; // too short → likely not ready
}
