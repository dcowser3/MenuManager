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
        await fs.access(SUBMISSIONS_DB).catch(() => fs.writeFile(SUBMISSIONS_DB, '[]'));
        await fs.access(REPORTS_DB).catch(() => fs.writeFile(REPORTS_DB, '[]'));
    } catch (error) {
        console.error('Failed to initialize database:', error);
    }
}

app.use(express.json());

// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const { submitter_email, filename, parsed_json } = req.body;
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newSubmission = {
            id: Date.now().toString(),
            submitter_email,
            filename,
            parsed_json,
            created_at: new Date().toISOString()
        };
        submissions.push(newSubmission);
        await fs.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        res.status(201).json(newSubmission);
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission.');
    }
});

// Endpoint to create a new report
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
