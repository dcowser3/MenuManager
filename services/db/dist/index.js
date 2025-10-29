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
const fs_1 = require("fs");
const path = __importStar(require("path"));
const app = (0, express_1.default)();
const port = 3004;
const DB_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'db');
const SUBMISSIONS_DB = path.join(DB_DIR, 'submissions.json');
const REPORTS_DB = path.join(DB_DIR, 'reports.json');
// Ensure DB directory and files exist
async function initDb() {
    try {
        await fs_1.promises.mkdir(DB_DIR, { recursive: true });
        await fs_1.promises.access(SUBMISSIONS_DB).catch(() => fs_1.promises.writeFile(SUBMISSIONS_DB, '{}')); // Now an object
        await fs_1.promises.access(REPORTS_DB).catch(() => fs_1.promises.writeFile(REPORTS_DB, '[]'));
    }
    catch (error) {
        console.error('Failed to initialize database:', error);
    }
}
app.use(express_1.default.json());
// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const { submitter_email, filename, original_path } = req.body;
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
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
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        res.status(201).json(newSubmission);
    }
    catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission.');
    }
});
// Endpoint to get all pending submissions (for dashboard)
// IMPORTANT: This must come BEFORE the /:id route
app.get('/submissions/pending', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const pending = Object.values(submissions).filter((sub) => sub.status === 'pending_human_review');
        res.status(200).json(pending);
    }
    catch (error) {
        console.error('Error getting pending submissions:', error);
        res.status(500).send('Error getting pending submissions.');
    }
});
// Endpoint to get a single submission by ID
app.get('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        if (!submissions[id]) {
            return res.status(404).send('Submission not found.');
        }
        res.status(200).json(submissions[id]);
    }
    catch (error) {
        console.error('Error getting submission:', error);
        res.status(500).send('Error getting submission.');
    }
});
// Endpoint to update a submission's status and paths
app.put('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, ai_draft_path, final_path } = req.body;
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        if (!submissions[id]) {
            return res.status(404).send('Submission not found.');
        }
        const updatedSubmission = { ...submissions[id], ...req.body, updated_at: new Date().toISOString() };
        submissions[id] = updatedSubmission;
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        res.status(200).json(updatedSubmission);
    }
    catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).send('Error updating submission.');
    }
});
// Endpoint to create a new report (can be deprecated or used for logging)
app.post('/reports', async (req, res) => {
    try {
        const { submission_id, report_json, ai_confidence } = req.body;
        const reports = JSON.parse(await fs_1.promises.readFile(REPORTS_DB, 'utf-8'));
        const newReport = {
            id: Date.now().toString(),
            submission_id,
            report_json,
            ai_confidence,
            created_at: new Date().toISOString()
        };
        reports.push(newReport);
        await fs_1.promises.writeFile(REPORTS_DB, JSON.stringify(reports, null, 2));
        res.status(201).json(newReport);
    }
    catch (error) {
        console.error('Error saving report:', error);
        res.status(500).send('Error saving report.');
    }
});
app.listen(port, () => {
    console.log(`db service listening at http://localhost:${port}`);
    initDb();
});
