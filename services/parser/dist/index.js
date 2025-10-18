"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = require("fs");
const validator_1 = require("./src/validator");
const axios_1 = __importDefault(require("axios"));
const app = (0, express_1.default)();
const port = 3001;
const upload = (0, multer_1.default)({ dest: '../../../tmp/uploads/' });
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
            // Here you would auto-reply with an email attaching the official template
            console.log('Template validation failed:', validationResult.errors);
            return res.status(400).json({
                message: 'Document does not match the required template.',
                errors: validationResult.errors
            });
        }
        // If validation passes, POST parsed payload to /ai-review
        console.log(`Validation passed for submission ${submission.id}. Posting to ai-review.`);
        await axios_1.default.post('http://localhost:3002/ai-review', {
            text: validationResult.text,
            submission_id: submission.id,
            submitter_email: submission.submitter_email,
            filename: submission.filename
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
        // Clean up the uploaded file
        if (req.file) {
            await fs_1.promises.unlink(req.file.path);
        }
    }
});
app.listen(port, () => {
    console.log(`parser service listening at http://localhost:${port}`);
});
