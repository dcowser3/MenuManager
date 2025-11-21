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
const validator_1 = require("./src/validator");
const axios_1 = __importDefault(require("axios"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const app = (0, express_1.default)();
const port = 3001;
const upload = (0, multer_1.default)({ dest: '../../../tmp/uploads/' });
const execAsync = (0, util_1.promisify)(child_process_1.exec);
app.post('/parser', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    if (req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Here you would auto-reply with an email, for now, just sending a response
        return res.status(400).send('Invalid file type. Only .docx files are accepted.');
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
        if (!validationResult.isValid) {
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
        // Light-weight “prompt/vibe” check: reject obviously placeholder/unfinished content
        const needsPromptFix = shouldRequestPromptFix(validationResult.text);
        if (needsPromptFix) {
            await axios_1.default.put(`http://localhost:3004/submissions/${submission.id}`, {
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
            console.warn('SOP format lint error (continuing to AI review):', lintError.message);
        }
        // If validation passes, POST parsed payload to /ai-review
        console.log(`Validation passed for submission ${submission.id}. Posting to ai-review.`);
        await axios_1.default.post('http://localhost:3002/ai-review', {
            text: validationResult.text,
            submission_id: submission.id,
            submitter_email: submission.submitter_email,
            filename: submission.filename,
            original_path: req.file.path // Pass the original file path for formatting preservation
        });
        res.status(200).json({
            message: 'File passed validation and was sent for AI review.',
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
 * Check for placeholder/unfinished content. Intentionally simple, no mocks.
 */
function shouldRequestPromptFix(text) {
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
