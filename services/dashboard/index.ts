import express from 'express';
import multer from 'multer';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';

const app = express();
const port = 3005;

// Configure multer for file uploads
const upload = multer({ dest: path.join(__dirname, '..', '..', '..', 'tmp', 'uploads') });

// Serve static files and use EJS for templates
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/**
 * Dashboard Home - List all pending reviews
 */
app.get('/', async (req, res) => {
    try {
        // Get all submissions with status 'pending_human_review'
        const dbResponse = await axios.get('http://localhost:3004/submissions/pending');
        const pendingReviews = dbResponse.data;

        res.render('index', { 
            reviews: pendingReviews,
            title: 'Menu Review Dashboard' 
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).render('error', { 
            message: 'Failed to load pending reviews' 
        });
    }
});

/**
 * Review Detail Page - View specific submission
 */
app.get('/review/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        // Get submission details from DB
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).render('error', { 
                message: 'Submission not found' 
            });
        }

        if (submission.status !== 'pending_human_review') {
            return res.render('error', { 
                message: 'This submission has already been reviewed' 
            });
        }

        res.render('review', { 
            submission,
            title: `Review: ${submission.filename}` 
        });
    } catch (error) {
        console.error('Error loading review:', error);
        res.status(500).render('error', { 
            message: 'Failed to load review details' 
        });
    }
});

/**
 * Download Original Submission
 */
app.get('/download/original/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission || !submission.original_path) {
            return res.status(404).send('File not found');
        }

        res.download(submission.original_path, submission.filename);
    } catch (error) {
        console.error('Error downloading original:', error);
        res.status(500).send('Error downloading file');
    }
});

/**
 * Download AI Draft
 */
app.get('/download/draft/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission || !submission.ai_draft_path) {
            return res.status(404).send('Draft not found');
        }

        const draftFilename = `DRAFT_${submission.filename}`;
        res.download(submission.ai_draft_path, draftFilename);
    } catch (error) {
        console.error('Error downloading draft:', error);
        res.status(500).send('Error downloading draft');
    }
});

/**
 * Quick Approve - AI draft is perfect, no changes needed
 */
app.post('/approve/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        console.log(`Quick approve for submission ${submissionId}`);

        // Get submission details
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        // Copy AI draft as final version (no changes needed)
        const finalPath = submission.ai_draft_path.replace('-draft.', '-final.');
        await fs.copyFile(submission.ai_draft_path, finalPath);

        // Update DB with final path and status
        await axios.put(`http://localhost:3004/submissions/${submissionId}`, {
            status: 'approved',
            final_path: finalPath,
            reviewed_at: new Date().toISOString(),
            changes_made: false // No human changes
        });

        // Trigger differ service (will show no differences)
        await axios.post('http://localhost:3006/compare', {
            submission_id: submissionId,
            ai_draft_path: submission.ai_draft_path,
            final_path: finalPath
        });

        // Send final document to chef
        await axios.post('http://localhost:3003/notify', {
            type: 'final_approval_to_chef',
            payload: {
                submitter_email: submission.submitter_email,
                filename: submission.filename,
                final_path: finalPath
            }
        });

        res.json({ 
            success: true, 
            message: 'Submission approved and sent to chef' 
        });

    } catch (error) {
        console.error('Error approving submission:', error);
        res.status(500).json({ error: 'Failed to approve submission' });
    }
});

/**
 * Upload Corrected Version - Reviewer made additional corrections
 */
app.post('/upload/:submissionId', upload.single('finalDocument'), async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`Corrected version uploaded for submission ${submissionId}`);

        // Get submission details
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        // Move uploaded file to final location
        const finalPath = path.join(
            __dirname, '..', '..', '..', 'tmp', 'finals',
            `${submissionId}-final.docx`
        );
        await fs.mkdir(path.dirname(finalPath), { recursive: true });
        await fs.rename(req.file.path, finalPath);

        // Update DB with final path and status
        await axios.put(`http://localhost:3004/submissions/${submissionId}`, {
            status: 'approved',
            final_path: finalPath,
            reviewed_at: new Date().toISOString(),
            changes_made: true // Human made corrections
        });

        // Trigger differ service (will analyze differences for learning)
        await axios.post('http://localhost:3006/compare', {
            submission_id: submissionId,
            ai_draft_path: submission.ai_draft_path,
            final_path: finalPath
        });

        // Send final document to chef
        await axios.post('http://localhost:3003/notify', {
            type: 'final_approval_to_chef',
            payload: {
                submitter_email: submission.submitter_email,
                filename: submission.filename,
                final_path: finalPath
            }
        });

        res.json({ 
            success: true, 
            message: 'Corrected version uploaded and sent to chef' 
        });

    } catch (error) {
        console.error('Error uploading corrected version:', error);
        res.status(500).json({ error: 'Failed to upload corrected version' });
    }
});

/**
 * API endpoint to get submission status (for AJAX polling)
 */
app.get('/api/submission/:submissionId/status', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        res.json(dbResponse.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

app.listen(port, () => {
    console.log(`📊 Dashboard service listening at http://localhost:${port}`);
    console.log(`   Access dashboard: http://localhost:${port}`);
});
