import express from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';

const app = express();
const port = 3004;

const DB_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'db');
const SUBMISSIONS_DB = path.join(DB_DIR, 'submissions.json');
const REPORTS_DB = path.join(DB_DIR, 'reports.json');

// Ensure DB directory and files exist
async function initDb() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        await fs.access(SUBMISSIONS_DB).catch(() => fs.writeFile(SUBMISSIONS_DB, '{}')); // Now an object
        await fs.access(REPORTS_DB).catch(() => fs.writeFile(REPORTS_DB, '[]'));
    } catch (error) {
        console.error('Failed to initialize database:', error);
    }
}

app.use(express.json());

// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const { submitter_email, filename, original_path } = req.body;
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newId = `sub_${Date.now()}`;
        const newSubmission = {
            id: newId,
            submitter_email,
            filename,
            original_path,
            status: 'processing', // Initial status
            ai_draft_path: null,
            final_path: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        submissions[newId] = newSubmission;
        await fs.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        res.status(201).json(newSubmission);
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission.');
    }
});

// Endpoint to get a single submission by ID
app.get('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));

        if (!submissions[id]) {
            return res.status(404).send('Submission not found.');
        }

        res.status(200).json(submissions[id]);
    } catch (error) {
        console.error('Error getting submission:', error);
        res.status(500).send('Error getting submission.');
    }
});

// Endpoint to get all pending submissions (for dashboard)
app.get('/submissions/pending', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const pending = Object.values(submissions).filter(
            (sub: any) => sub.status === 'pending_human_review'
        );
        res.status(200).json(pending);
    } catch (error) {
        console.error('Error getting pending submissions:', error);
        res.status(500).send('Error getting pending submissions.');
    }
});

// Endpoint to update a submission's status and paths
app.put('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, ai_draft_path, final_path } = req.body;
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));

        if (!submissions[id]) {
            return res.status(404).send('Submission not found.');
        }

        const updatedSubmission = { ...submissions[id], ...req.body, updated_at: new Date().toISOString() };
        submissions[id] = updatedSubmission;

        await fs.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        res.status(200).json(updatedSubmission);
    } catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).send('Error updating submission.');
    }
});


// Endpoint to create a new report (can be deprecated or used for logging)
app.post('/reports', async (req, res) => {
    try {
        const { submission_id, report_json, ai_confidence } = req.body;
        const reports = JSON.parse(await fs.readFile(REPORTS_DB, 'utf-8'));
        const newReport = {
            id: Date.now().toString(),
            submission_id,
            report_json,
            ai_confidence,
            created_at: new Date().toISOString()
        };
        reports.push(newReport);
        await fs.writeFile(REPORTS_DB, JSON.stringify(reports, null, 2));
        res.status(201).json(newReport);
    } catch (error) {
        console.error('Error saving report:', error);
        res.status(500).send('Error saving report.');
    }
});

app.listen(port, () => {
    console.log(`db service listening at http://localhost:${port}`);
    initDb();
});
