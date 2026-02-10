import express from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';

const app = express();
const port = 3004;

const DB_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'db');
const SUBMISSIONS_DB = path.join(DB_DIR, 'submissions.json');
const REPORTS_DB = path.join(DB_DIR, 'reports.json');
const PROFILES_DB = path.join(DB_DIR, 'submitter_profiles.json');

// Ensure DB directory and files exist
async function initDb() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        await fs.access(SUBMISSIONS_DB).catch(() => fs.writeFile(SUBMISSIONS_DB, '{}')); // Now an object
        await fs.access(REPORTS_DB).catch(() => fs.writeFile(REPORTS_DB, '[]'));
        await fs.access(PROFILES_DB).catch(() => fs.writeFile(PROFILES_DB, '{}'));
    } catch (error) {
        console.error('Failed to initialize database:', error);
    }
}

app.use(express.json());

// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newId = req.body.id || `sub_${Date.now()}`;
        const newSubmission = {
            ...req.body,
            id: newId,
            status: req.body.status || 'processing',
            created_at: req.body.created_at || new Date().toISOString(),
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

// Endpoint to get all pending submissions (for dashboard)
// IMPORTANT: This must come BEFORE the /:id route
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

// Endpoint to get recent projects (grouped by project_name)
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/recent-projects', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const allSubs = Object.values(submissions) as any[];

        // Filter to form submissions only
        const formSubs = allSubs.filter(s => s.source === 'form' && s.project_name);

        // Group by project_name (case-insensitive), keep most recent
        const projectMap: Record<string, any> = {};
        formSubs.forEach(s => {
            const key = (s.project_name || '').toLowerCase().trim();
            if (!key) return;
            if (!projectMap[key] || new Date(s.created_at) > new Date(projectMap[key].created_at)) {
                projectMap[key] = s;
            }
        });

        // Sort by most recent, return top N
        const projects = Object.values(projectMap)
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
            .map((s: any) => ({
                projectName: s.project_name,
                property: s.property || '',
                size: s.size || '',
                orientation: s.orientation || '',
                menuType: s.menu_type || 'standard',
                templateType: s.template_type || 'food',
                hotelName: s.hotel_name || '',
                cityCountry: s.city_country || '',
                assetType: s.asset_type || '',
            }));

        res.json(projects);
    } catch (error) {
        console.error('Error getting recent projects:', error);
        res.status(500).json([]);
    }
});

// Submitter profile search
app.get('/submitter-profiles/search', async (req, res) => {
    try {
        const q = (req.query.q as string || '').trim().toLowerCase();
        if (q.length < 2) {
            return res.json([]);
        }

        const profiles = JSON.parse(await fs.readFile(PROFILES_DB, 'utf-8'));
        const matches = Object.values(profiles)
            .filter((p: any) => p.name.toLowerCase().includes(q))
            .sort((a: any, b: any) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
            .slice(0, 8);

        res.json(matches);
    } catch (error) {
        console.error('Error searching submitter profiles:', error);
        res.json([]);
    }
});

// Submitter profile upsert
app.post('/submitter-profiles', async (req, res) => {
    try {
        const { name, email, jobTitle } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'name and email are required' });
        }

        const key = name.toLowerCase().trim();
        const profiles = JSON.parse(await fs.readFile(PROFILES_DB, 'utf-8'));
        const now = new Date().toISOString();

        profiles[key] = {
            name: name.trim(),
            email: email.trim(),
            jobTitle: (jobTitle || '').trim(),
            lastUsed: now,
        };

        await fs.writeFile(PROFILES_DB, JSON.stringify(profiles, null, 2));
        res.json(profiles[key]);
    } catch (error) {
        console.error('Error saving submitter profile:', error);
        res.status(500).json({ error: 'Failed to save profile' });
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
