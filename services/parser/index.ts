import express from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import { validateTemplate } from './src/validator';
import axios from 'axios';

const app = express();
const port = 3001;

const upload = multer({ dest: '../../../tmp/uploads/' });

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
            // Here you would auto-reply with an email attaching the official template
            console.log('Template validation failed:', validationResult.errors);
            return res.status(400).json({
                message: 'Document does not match the required template.',
                errors: validationResult.errors
            });
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
