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
exports.extractBaselineFromDocx = extractBaselineFromDocx;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = require("fs");
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
// Supabase client for dish extraction (optional - gracefully handles if not configured)
const supabase_client_1 = require("@menumanager/supabase-client");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const DEFAULT_ALLERGEN_KEY = 'C crustaceans | D dairy | E egg | F fish | G gluten | N nuts | V vegetarian | VG vegan';
function getRepoRoot() {
    const candidates = [
        path.resolve(__dirname, '..', '..'), // ts-node from services/dashboard
        path.resolve(__dirname, '..', '..', '..') // compiled from services/dashboard/dist
    ];
    for (const candidate of candidates) {
        if (fsSync.existsSync(path.join(candidate, 'services')) &&
            fsSync.existsSync(path.join(candidate, 'samples'))) {
            return candidate;
        }
    }
    return candidates[0];
}
function getDocxRedlinerDir() {
    return path.join(getRepoRoot(), 'services', 'docx-redliner');
}
function getDocumentStorageRoot() {
    return process.env.DOCUMENT_STORAGE_ROOT || path.join(getRepoRoot(), 'tmp', 'documents');
}
function slugifyStorageSegment(value) {
    const cleaned = (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || 'unknown';
}
function getSubmissionDocumentDir(projectName, property, submissionId) {
    return path.join(getDocumentStorageRoot(), slugifyStorageSegment(property), slugifyStorageSegment(projectName), submissionId);
}
/**
 * Extract dishes from approved menu and store in database
 * Fails silently if Supabase is not configured
 */
async function extractDishesAfterApproval(submissionId, menuContent, property, finalPath) {
    if (!(0, supabase_client_1.isSupabaseConfigured)()) {
        console.log('Supabase not configured - skipping dish extraction');
        return;
    }
    try {
        // If we don't have menu content, try to extract from the final document
        let content = menuContent;
        if (!content && finalPath) {
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ path: finalPath });
                content = result.value;
            }
            catch (err) {
                console.error('Failed to extract text from final document:', err);
                return;
            }
        }
        if (!content) {
            console.log('No menu content available for dish extraction');
            return;
        }
        const result = await (0, supabase_client_1.extractAndStoreDishes)(content, property, submissionId);
        console.log(`Dish extraction complete: ${result.added} dishes added`);
    }
    catch (error) {
        console.error('Error extracting dishes:', error);
        // Don't throw - dish extraction is not critical to approval
    }
}
const app = (0, express_1.default)();
const port = 3005;
// Configure multer for file uploads
const upload = (0, multer_1.default)({ dest: path.join(__dirname, '..', '..', '..', 'tmp', 'uploads') });
// Serve static files and use EJS for templates
app.use(express_1.default.static(path.join(__dirname, 'public')));
app.use(express_1.default.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
async function extractBaselineFromDocx(filePath) {
    const docxRedlinerDir = getDocxRedlinerDir();
    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
    const extractCleanScript = path.join(docxRedlinerDir, 'extract_clean_menu_text.py');
    const extractDetailsScript = path.join(docxRedlinerDir, 'extract_project_details.py');
    let pythonCmd = 'python3';
    try {
        await fs_1.promises.access(venvPython);
        pythonCmd = `"${venvPython}"`;
    }
    catch {
        // use system python
    }
    const cleanCommand = `${pythonCmd} "${extractCleanScript}" "${filePath}"`;
    const detailsCommand = `${pythonCmd} "${extractDetailsScript}" "${filePath}"`;
    const [{ stdout: cleanStdout }, { stdout: detailsStdout }] = await Promise.all([
        execAsync(cleanCommand, { timeout: 30000 }),
        execAsync(detailsCommand, { timeout: 30000 }),
    ]);
    const cleanData = JSON.parse((cleanStdout || '{}').trim() || '{}');
    const detailsData = JSON.parse((detailsStdout || '{}').trim() || '{}');
    if (cleanData.error) {
        throw new Error(cleanData.error);
    }
    const projectDetails = detailsData.project_details || {};
    return {
        approvedMenuContent: cleanData.cleaned_menu_content || cleanData.menu_content || '',
        approvedMenuContentRaw: cleanData.menu_content || '',
        approvedMenuContentHtml: cleanData.cleaned_menu_html || '',
        extractedAllergenKey: detailsData.allergen_key || '',
        extractedProject: {
            projectName: projectDetails.project_name || '',
            property: projectDetails.property || '',
            orientation: projectDetails.orientation || '',
            dateNeeded: projectDetails.date_needed || '',
            size: projectDetails.size || '',
        },
    };
}
/**
 * Dashboard Home - List all pending reviews
 */
app.get('/', async (req, res) => {
    try {
        // Get all submissions with status 'pending_human_review'
        const dbResponse = await axios_1.default.get('http://localhost:3004/submissions/pending');
        const pendingReviews = dbResponse.data;
        res.render('index', {
            reviews: pendingReviews,
            title: 'Menu Review Dashboard'
        });
    }
    catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).render('error', {
            message: 'Failed to load pending reviews'
        });
    }
});
/**
 * Welcome / Landing Page - Magic link entry point
 */
app.get('/submit/:token', (req, res) => {
    res.render('welcome', {
        title: 'Welcome - RSH Menu Manager'
    });
});
/**
 * Form Submission Page - New menu submission via form
 */
app.get('/form', (req, res) => {
    res.render('form', {
        title: 'Submit New Menu'
    });
});
/**
 * Design Approval Page - Compare DOCX against PDF
 */
app.get('/design-approval', (req, res) => {
    res.render('design-approval', {
        title: 'Design Approval'
    });
});
/**
 * Review Detail Page - View specific submission
 */
app.get('/review/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        // Get submission details from DB
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/${submissionId}`);
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
    }
    catch (error) {
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
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;
        if (!submission || !submission.original_path) {
            return res.status(404).send('File not found');
        }
        // Handle relative paths from dist directory
        let absolutePath = submission.original_path;
        if (absolutePath.startsWith('../')) {
            absolutePath = path.resolve(__dirname, absolutePath);
        }
        console.log(`Downloading original from: ${absolutePath}`);
        res.download(absolutePath, submission.filename);
    }
    catch (error) {
        console.error('Error downloading original:', error);
        res.status(500).send('Error downloading file');
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
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        // Copy AI draft as final version (no changes needed)
        const finalPath = submission.ai_draft_path.replace('-draft.', '-final.');
        await fs_1.promises.copyFile(submission.ai_draft_path, finalPath);
        // Update DB with final path and status
        await axios_1.default.put(`http://localhost:3004/submissions/${submissionId}`, {
            status: 'approved',
            final_path: finalPath,
            reviewed_at: new Date().toISOString(),
            changes_made: false // No human changes
        });
        // Trigger differ service (will show no differences)
        await axios_1.default.post('http://localhost:3006/compare', {
            submission_id: submissionId,
            ai_draft_path: submission.ai_draft_path,
            final_path: finalPath
        });
        // Extract dishes from approved menu (async, non-blocking)
        extractDishesAfterApproval(submissionId, submission.menu_content, submission.property || 'Unknown', finalPath).catch(err => console.error('Background dish extraction failed:', err));
        res.json({
            success: true,
            message: 'Submission approved'
        });
    }
    catch (error) {
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
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        // Move uploaded file to final location
        const finalPath = path.join(__dirname, '..', '..', '..', 'tmp', 'finals', `${submissionId}-final.docx`);
        await fs_1.promises.mkdir(path.dirname(finalPath), { recursive: true });
        await fs_1.promises.rename(req.file.path, finalPath);
        // Update DB with final path and status
        await axios_1.default.put(`http://localhost:3004/submissions/${submissionId}`, {
            status: 'approved',
            final_path: finalPath,
            reviewed_at: new Date().toISOString(),
            changes_made: true // Human made corrections
        });
        // Trigger differ service (will analyze differences for learning)
        await axios_1.default.post('http://localhost:3006/compare', {
            submission_id: submissionId,
            ai_draft_path: submission.ai_draft_path,
            final_path: finalPath
        });
        // Extract dishes from approved menu (async, non-blocking)
        extractDishesAfterApproval(submissionId, submission.menu_content, submission.property || 'Unknown', finalPath).catch(err => console.error('Background dish extraction failed:', err));
        res.json({
            success: true,
            message: 'Corrected version uploaded'
        });
    }
    catch (error) {
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
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/${submissionId}`);
        res.json(dbResponse.data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});
/**
 * Training Dashboard - Manage training data and sessions
 */
app.get('/training', async (req, res) => {
    try {
        // Read training sessions from tmp/training directory
        const trainingDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training');
        await fs_1.promises.mkdir(trainingDir, { recursive: true });
        const files = await fs_1.promises.readdir(trainingDir);
        const sessionFiles = files.filter(f => f.startsWith('session_') && f.endsWith('.json'));
        const sessions = await Promise.all(sessionFiles.map(async (file) => {
            const content = await fs_1.promises.readFile(path.join(trainingDir, file), 'utf-8');
            return JSON.parse(content);
        }));
        // Sort by session ID (timestamp) descending
        sessions.sort((a, b) => b.session_id.localeCompare(a.session_id));
        res.render('training', {
            title: 'Training Dashboard',
            sessions: sessions
        });
    }
    catch (error) {
        console.error('Error loading training dashboard:', error);
        res.status(500).render('error', {
            message: 'Failed to load training dashboard'
        });
    }
});
/**
 * Upload Training Pair - Add new document pair for training
 */
app.post('/training/upload-pair', upload.fields([
    { name: 'original', maxCount: 1 },
    { name: 'redlined', maxCount: 1 }
]), async (req, res) => {
    try {
        const files = req.files;
        if (!files.original || !files.redlined) {
            return res.status(400).json({
                error: 'Both original and redlined documents are required'
            });
        }
        const originalFile = files.original[0];
        const redlinedFile = files.redlined[0];
        // Create pairs directory if it doesn't exist
        const pairsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training', 'pairs');
        await fs_1.promises.mkdir(pairsDir, { recursive: true });
        // Generate pair name
        const timestamp = Date.now();
        const pairName = req.body.pairName || `pair_${timestamp}`;
        // Move files to pairs directory with standard naming
        const originalDest = path.join(pairsDir, `${pairName}_original.docx`);
        const redlinedDest = path.join(pairsDir, `${pairName}_redlined.docx`);
        await fs_1.promises.rename(originalFile.path, originalDest);
        await fs_1.promises.rename(redlinedFile.path, redlinedDest);
        console.log(`Training pair added: ${pairName}`);
        res.json({
            success: true,
            message: 'Training pair uploaded successfully',
            pairName: pairName
        });
    }
    catch (error) {
        console.error('Error uploading training pair:', error);
        res.status(500).json({ error: 'Failed to upload training pair' });
    }
});
/**
 * Get Training Session Details
 */
app.get('/training/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const trainingDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training');
        const sessionFile = path.join(trainingDir, `session_${sessionId}.json`);
        const content = await fs_1.promises.readFile(sessionFile, 'utf-8');
        const session = JSON.parse(content);
        res.json(session);
    }
    catch (error) {
        console.error('Error loading session:', error);
        res.status(404).json({ error: 'Session not found' });
    }
});
/**
 * Download Training Rules
 */
app.get('/training/download-rules/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const trainingDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training');
        const rulesFile = path.join(trainingDir, `learned_rules_${sessionId}.json`);
        res.download(rulesFile, `learned_rules_${sessionId}.json`);
    }
    catch (error) {
        console.error('Error downloading rules:', error);
        res.status(404).send('Rules file not found');
    }
});
/**
 * Download Optimized Prompt
 */
app.get('/training/download-prompt/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const trainingDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training');
        const promptFile = path.join(trainingDir, `optimized_prompt_${sessionId}.txt`);
        res.download(promptFile, `optimized_prompt_${sessionId}.txt`);
    }
    catch (error) {
        console.error('Error downloading prompt:', error);
        res.status(404).send('Prompt file not found');
    }
});
/**
 * Learning Rules Dashboard
 */
app.get('/learning', async (_req, res) => {
    try {
        const [rulesResult, overridesResult, overlayResult] = await Promise.all([
            axios_1.default.get('http://localhost:3006/learning/rules', { timeout: 2500 }).catch(() => ({ data: {} })),
            axios_1.default.get('http://localhost:3006/learning/overrides', { timeout: 2500 }).catch(() => ({ data: { disabled: {} } })),
            axios_1.default.get('http://localhost:3006/learning/overlay', { timeout: 2500 }).catch(() => ({ data: { overlay: '' } })),
        ]);
        const rulesData = rulesResult.data || {};
        const overrides = overridesResult.data?.disabled || {};
        const learnedOverlay = overlayResult?.data?.overlay || '';
        const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
        const basePrompt = await fs_1.promises.readFile(qaPromptPath, 'utf-8');
        const effectivePrompt = learnedOverlay ? `${basePrompt}\n\n${learnedOverlay}` : basePrompt;
        const decorate = (category, items) => (items || []).map((r) => {
            const key = `${r.source_norm}=>${r.target_norm}`;
            const override = overrides[key];
            return {
                ...r,
                key,
                category,
                disabled: !!override,
                disabled_reason: override?.reason || '',
                disabled_updated_at: override?.updated_at || '',
            };
        });
        const rules = [
            ...decorate('active', rulesData.active_rules || []),
            ...decorate('weak', rulesData.weak_rules || []),
            ...decorate('conflicted', rulesData.conflicted_rules || []),
        ];
        res.render('learning', {
            title: 'Learning Rules',
            generatedAt: rulesData.generated_at || null,
            minOccurrences: rulesData.min_occurrences || 2,
            totalEntries: rulesData.total_entries_analyzed || 0,
            totalRules: rulesData.total_rules || 0,
            rules,
            basePrompt,
            learnedOverlay,
            effectivePrompt,
            documentStorageRoot: process.env.DOCUMENT_STORAGE_ROOT || '',
        });
    }
    catch (error) {
        console.error('Error loading learning dashboard:', error.message);
        res.status(500).render('error', {
            message: 'Failed to load learning dashboard'
        });
    }
});
/**
 * Toggle learned rule enable/disable override.
 */
app.post('/api/learning/rules/toggle', async (req, res) => {
    try {
        const { ruleKey, disabled, reason } = req.body || {};
        if (!ruleKey || typeof ruleKey !== 'string') {
            return res.status(400).json({ error: 'ruleKey is required' });
        }
        const response = await axios_1.default.post('http://localhost:3006/learning/overrides', {
            rule_key: ruleKey,
            disabled: !!disabled,
            reason: reason || '',
        }, { timeout: 2500 });
        res.json(response.data);
    }
    catch (error) {
        console.error('Error toggling learning rule:', error.message);
        res.status(500).json({ error: 'Failed to toggle learning rule' });
    }
});
/**
 * Proxy: Submitter profile search
 */
app.get('/api/submitter-profiles/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submitter-profiles/search`, {
            params: { q }
        });
        res.json(dbResponse.data);
    }
    catch (error) {
        res.json([]);
    }
});
/**
 * Proxy: Recent projects
 */
app.get('/api/recent-projects', async (req, res) => {
    try {
        const limit = req.query.limit || 20;
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/recent-projects`, {
            params: { limit }
        });
        res.json(dbResponse.data);
    }
    catch (error) {
        res.json([]);
    }
});
/**
 * Proxy: Search approved submissions for modification flow
 */
app.get('/api/submissions/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        const limit = req.query.limit || 20;
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/search`, {
            params: { q, limit }
        });
        res.json(dbResponse.data);
    }
    catch (error) {
        res.json([]);
    }
});
/**
 * Proxy: Get latest approved submission for a project/property pair
 */
app.get('/api/submissions/latest-approved', async (req, res) => {
    try {
        const { projectName, property } = req.query;
        const dbResponse = await axios_1.default.get(`http://localhost:3004/submissions/latest-approved`, {
            params: { projectName, property }
        });
        res.json(dbResponse.data);
    }
    catch (error) {
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to fetch approved submission' });
    }
});
/**
 * Modification Flow: Upload approved baseline DOCX when no prior record exists in DB.
 * Extracts cleaned menu text + project details to prefill the form.
 */
app.post('/api/modification/baseline-upload', upload.single('baselineDoc'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No baseline document uploaded' });
        }
        if (req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            return res.status(400).json({ error: 'Only .docx files are accepted' });
        }
        const extracted = await extractBaselineFromDocx(req.file.path);
        res.json({
            success: true,
            baselineDocPath: req.file.path,
            baselineFileName: req.file.originalname,
            approvedMenuContent: extracted.approvedMenuContent,
            approvedMenuContentRaw: extracted.approvedMenuContentRaw,
            approvedMenuContentHtml: extracted.approvedMenuContentHtml,
            extractedAllergenKey: extracted.extractedAllergenKey,
            extractedProject: extracted.extractedProject,
        });
    }
    catch (error) {
        console.error('Error extracting baseline document:', error);
        res.status(500).json({ error: 'Failed to process baseline document', details: error.message });
    }
});
/**
 * Form API: Basic AI Check - Run QA check on menu content
 */
app.post('/api/form/basic-check', async (req, res) => {
    try {
        const { menuContent, allergens, menuType, baselineMenuContent, reviewMode } = req.body;
        if (!menuContent || !menuContent.trim()) {
            return res.status(400).json({ error: 'Menu content is required' });
        }
        const changedOnlyMode = reviewMode === 'changed_only' && !!baselineMenuContent;
        let textForReview = menuContent;
        let changedLineCount = 0;
        if (changedOnlyMode) {
            const changedOnlyText = extractChangedLinesForReview(baselineMenuContent, menuContent);
            changedLineCount = changedOnlyText.changedLineCount;
            if (changedLineCount === 0) {
                return res.json({
                    success: true,
                    originalMenu: menuContent,
                    correctedMenu: menuContent,
                    suggestions: [],
                    hasChanges: false,
                    hasCriticalErrors: false,
                    reviewMode: 'changed_only',
                    changedLineCount: 0
                });
            }
            textForReview = changedOnlyText.text;
        }
        // Debug logging
        console.log('=== BASIC CHECK REQUEST ===');
        console.log('Menu content length:', menuContent.length);
        console.log('First 200 chars:', menuContent.substring(0, 200));
        console.log('Menu type:', menuType || 'standard');
        console.log('Custom allergens:', allergens ? 'Yes' : 'No (using defaults)');
        console.log('===========================');
        // Load QA prompt
        const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
        let qaPrompt = await fs_1.promises.readFile(qaPromptPath, 'utf-8');
        // If prix fixe menu type, inject special rules
        if (menuType === 'prix_fixe') {
            const prixFixeSection = `
**PRIX FIXE / PRE-FIX MENU RULES:**
This is a PRIX FIXE (pre-fix) menu. Apply these special rules:

1. **PRICING STRUCTURE**: Prix fixe menus should have:
   - A single prix fixe price at the TOP of the menu (format: 00.00PP or just a whole number)
   - Optional wine/alcohol pairing price listed alongside (e.g., "185 | 85 wine pairing")
   - Individual dishes do NOT need their own prices - this is CORRECT for prix fixe menus
   - Do NOT flag missing prices on individual courses/dishes

2. **COURSE NUMBERING**: Prix fixe menus MUST have numbered courses:
   - Each course should be preceded by its course number (1, 2, 3, etc.)
   - Numbers can be on their own line above the course name
   - Example format:
     1
     First Course
     dish name, description

     2
     Second Course
     dish name, description
   - FLAG if course numbers are missing

3. **COURSE STRUCTURE**: Look for proper course progression:
   - Courses should flow logically (appetizer → main → dessert, or similar)
   - Each course section should have clear separation

4. **WHAT TO CHECK**:
   - Prix fixe price present at top (FLAG if missing)
   - Course numbers present (FLAG if missing)
   - All other standard rules still apply (spelling, accents, allergens, etc.)

5. **WHAT NOT TO FLAG**:
   - Missing prices on individual dishes (this is normal for prix fixe)
   - Individual items without their own pricing
   - Do NOT set severity to "critical" for missing individual dish prices on prix fixe menus
`;
            // Insert at the beginning of the rules section
            qaPrompt = qaPrompt.replace('## RSH MENU GUIDELINES - COMPREHENSIVE RULES', `## RSH MENU GUIDELINES - COMPREHENSIVE RULES\n${prixFixeSection}`);
            console.log('Injected prix fixe rules into prompt');
        }
        // If custom allergens provided, inject them into the prompt
        if (allergens && allergens.trim()) {
            const allergenSection = `
**CUSTOM ALLERGEN KEY FOR THIS MENU:**
Use the following allergen codes for reviewing this menu:
${allergens}

Note: Use ONLY these allergen codes when checking allergen compliance. Do not use any other allergen codes not defined above.
`;
            // Insert after "### 7. ALLERGENS" section header
            qaPrompt = qaPrompt.replace('### 7. ALLERGENS', `### 7. ALLERGENS\n${allergenSection}`);
            console.log('Injected custom allergens into prompt');
        }
        // Add learned reviewer correction overlay from differ service (fail-open).
        const learnedOverlay = await fetchLearnedPromptOverlay();
        if (learnedOverlay) {
            qaPrompt = `${qaPrompt}\n\n${learnedOverlay}`;
            console.log('Injected learned correction overlay into prompt');
        }
        // Call AI Review service's QA endpoint
        let finalPrompt = qaPrompt;
        if (changedOnlyMode) {
            finalPrompt = `${qaPrompt}\n\nIMPORTANT SCOPE FOR THIS REVIEW:\nYou are reviewing ONLY changed excerpts from a menu revision.\nDo NOT flag unchanged baseline content.\nReturn issues only for the changed excerpts provided.`;
        }
        const qaResponse = await axios_1.default.post('http://localhost:3002/run-qa-check', {
            text: textForReview,
            prompt: finalPrompt
        });
        const feedback = qaResponse.data.feedback;
        // Debug: Log raw feedback to see format
        console.log('=== RAW AI FEEDBACK ===');
        console.log(feedback);
        console.log('=== END RAW FEEDBACK ===');
        // Parse the new format: corrected menu + suggestions
        const parsed = parseAIResponse(feedback, textForReview);
        const reconciledSuggestions = reconcileCriticalSuggestionsAgainstCorrectedMenu(parsed.correctedMenu, parsed.suggestions);
        console.log('=== PARSED RESPONSE ===');
        console.log('Corrected menu length:', parsed.correctedMenu.length);
        console.log('Suggestions count:', parsed.suggestions.length);
        console.log('Reconciled suggestions count:', reconciledSuggestions.length);
        console.log('Has changes:', parsed.correctedMenu !== menuContent);
        console.log('===========================');
        const hasCriticalErrors = reconciledSuggestions.some(s => s.severity === 'critical');
        res.json({
            success: true,
            originalMenu: menuContent,
            correctedMenu: changedOnlyMode ? menuContent : parsed.correctedMenu,
            suggestions: reconciledSuggestions,
            hasChanges: changedOnlyMode ? false : parsed.correctedMenu !== menuContent,
            hasCriticalErrors,
            reviewMode: changedOnlyMode ? 'changed_only' : 'full',
            changedLineCount
        });
    }
    catch (error) {
        console.error('Error running basic check:', error);
        res.status(500).json({
            error: 'Failed to run basic AI check',
            details: error.message
        });
    }
});
function extractChangedLinesForReview(baselineText, currentText) {
    const baseLines = baselineText.split('\n').map(l => l.trim()).filter(Boolean);
    const currLines = currentText.split('\n').map(l => l.trim()).filter(Boolean);
    const baseSet = new Set(baseLines.map(normalizeReviewLine));
    const changedLines = [];
    for (const line of currLines) {
        const norm = normalizeReviewLine(line);
        if (!baseSet.has(norm)) {
            changedLines.push(line);
        }
    }
    return {
        text: changedLines.join('\n'),
        changedLineCount: changedLines.length
    };
}
function normalizeReviewLine(line) {
    return (line || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[“”"]/g, '"')
        .replace(/[’']/g, "'")
        .trim();
}
function stripDiacritics(input) {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
async function fetchLearnedPromptOverlay() {
    try {
        const response = await axios_1.default.get('http://localhost:3006/learning/overlay', { timeout: 1500 });
        const overlay = response.data?.overlay;
        if (typeof overlay === 'string' && overlay.trim()) {
            return overlay;
        }
        return '';
    }
    catch {
        return '';
    }
}
function normalizeForSuggestionMatch(input) {
    return stripDiacritics(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function looksLikePriceOnLine(line) {
    const compact = (line || '').trim();
    // Handles "... - 8", "... 14", "... $12", "... 12.50"
    return /(?:^|[\s\-|])\$?\d{1,3}(?:[.,]\d{1,2})?\s*$/.test(compact);
}
function findCorrectedLineForMenuItem(correctedMenu, menuItem) {
    const itemNorm = normalizeForSuggestionMatch(menuItem || '');
    if (!itemNorm)
        return null;
    const lines = (correctedMenu || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const lineNorm = normalizeForSuggestionMatch(line);
        if (lineNorm.includes(itemNorm)) {
            return line;
        }
    }
    return null;
}
function isCriticalResolvedByCorrectedMenu(suggestion, correctedMenu) {
    const type = (suggestion.type || '').toLowerCase();
    const line = findCorrectedLineForMenuItem(correctedMenu, suggestion.menuItem || '');
    if (!line)
        return false;
    if (type.includes('missing price')) {
        return looksLikePriceOnLine(line);
    }
    if (type.includes('incomplete dish name')) {
        const itemNorm = normalizeForSuggestionMatch(suggestion.menuItem || '');
        const lineNorm = normalizeForSuggestionMatch(line);
        const remainder = lineNorm.replace(itemNorm, '').trim();
        if (remainder.length >= 6) {
            return true;
        }
        // If AI explicitly referenced a malformed token and it's now gone, treat as resolved.
        const combined = `${suggestion.description || ''} ${suggestion.recommendation || ''}`;
        const quotedTokenMatch = combined.match(/['"]([^'"]{2,30})['"]/);
        if (quotedTokenMatch && quotedTokenMatch[1]) {
            const tokenNorm = normalizeForSuggestionMatch(quotedTokenMatch[1]);
            if (tokenNorm && !lineNorm.includes(tokenNorm)) {
                return true;
            }
        }
    }
    return false;
}
function reconcileCriticalSuggestionsAgainstCorrectedMenu(correctedMenu, suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return [];
    }
    return suggestions.filter((s) => {
        if (s.severity !== 'critical')
            return true;
        return !isCriticalResolvedByCorrectedMenu(s, correctedMenu);
    });
}
/**
 * Form API: Submit Menu - Create docx from form and trigger review workflow
 */
app.post('/api/form/submit', async (req, res) => {
    try {
        const { submitterName, submitterEmail, submitterJobTitle, projectName, property, width, height, cropMarks, bleedMarks, fileSizeLimit, fileSizeLimitMb, fileDeliveryNotes, orientation, menuType, templateType, dateNeeded, hotelName, cityCountry, assetType, allergens, menuContent, menuContentHtml, approvals, criticalOverrides, submissionMode, revisionBaseSubmissionId, revisionSource, revisionBaselineDocPath, revisionBaselineFileName, baseApprovedMenuContent, chefPersistentDiff } = req.body;
        // Validate required fields
        if (!submitterName || !submitterEmail || !submitterJobTitle || !projectName || !property || !width || !height || !orientation || !templateType || !dateNeeded || !cityCountry || !assetType || !menuContent) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (submissionMode === 'modification' && !revisionBaseSubmissionId && !revisionBaselineDocPath) {
            return res.status(400).json({ error: 'Modification flow requires a prior approved submission or uploaded approved baseline document' });
        }
        // Construct size string for DOCX template backward compatibility
        const sizeForDocx = assetType === 'PRINT'
            ? `${width} x ${height} inches`
            : `${width} x ${height} pixels`;
        const effectiveAllergens = (allergens || '').trim() || DEFAULT_ALLERGEN_KEY;
        // Approvals are attestations from the submitter - we store them as-is
        // Frontend enforces that all required approvals are marked "Yes" before submission
        // Generate unique submission ID
        const submissionId = `form-${Date.now()}`;
        // Create Word document from template and form data
        const docxPath = await generateDocxFromForm(submissionId, {
            projectName,
            property,
            size: sizeForDocx,
            orientation,
            menuType: menuType || 'standard',
            templateType: templateType || 'food',
            dateNeeded,
            menuContent,
            allergens: effectiveAllergens
        });
        console.log(`📝 Generated document for submission ${submissionId}: ${docxPath}`);
        let persistedBaselineDocPath = null;
        if (revisionBaselineDocPath) {
            try {
                await fs_1.promises.access(revisionBaselineDocPath);
                const submissionDir = getSubmissionDocumentDir(projectName, property, submissionId);
                const baselineDir = path.join(submissionDir, 'baseline');
                await fs_1.promises.mkdir(baselineDir, { recursive: true });
                const baselineFile = revisionBaselineFileName || path.basename(revisionBaselineDocPath);
                persistedBaselineDocPath = path.join(baselineDir, baselineFile);
                if (path.resolve(revisionBaselineDocPath) !== path.resolve(persistedBaselineDocPath)) {
                    await fs_1.promises.copyFile(revisionBaselineDocPath, persistedBaselineDocPath);
                }
            }
            catch (baselineError) {
                console.warn(`Failed to persist baseline doc for ${submissionId}:`, baselineError.message);
                persistedBaselineDocPath = revisionBaselineDocPath;
            }
        }
        // Create submission in database
        const dbResponse = await axios_1.default.post('http://localhost:3004/submissions', {
            id: submissionId,
            submitter_email: submitterEmail,
            submitter_name: submitterName,
            submitter_job_title: submitterJobTitle,
            project_name: projectName,
            property,
            date_needed: dateNeeded,
            filename: `${projectName}_Menu.docx`,
            original_path: docxPath,
            status: 'pending_human_review',
            created_at: new Date().toISOString(),
            source: 'form',
            menu_type: menuType || 'standard',
            template_type: templateType || 'food',
            hotel_name: hotelName || null,
            city_country: cityCountry,
            asset_type: assetType,
            width,
            height,
            crop_marks: cropMarks === 'yes',
            bleed_marks: bleedMarks === 'yes',
            file_size_limit: fileSizeLimit === 'yes',
            file_size_limit_mb: fileSizeLimitMb || null,
            file_delivery_notes: fileDeliveryNotes || null,
            approvals: JSON.stringify(approvals),
            critical_overrides: JSON.stringify(criticalOverrides || []),
            menu_content: menuContent,
            menu_content_html: menuContentHtml || null,
            allergens: effectiveAllergens,
            submission_mode: submissionMode || 'new',
            revision_source: revisionSource || null,
            revision_base_submission_id: revisionBaseSubmissionId || null,
            revision_baseline_doc_path: persistedBaselineDocPath || null,
            revision_baseline_file_name: revisionBaselineFileName || null,
            base_approved_menu_content: baseApprovedMenuContent || null,
            chef_persistent_diff: chefPersistentDiff ? JSON.stringify(chefPersistentDiff) : null,
        });
        console.log(`✓ Submission created in database: ${submissionId}`);
        // Record original source document metadata (storage abstraction: local now, Teams later)
        axios_1.default.post('http://localhost:3004/assets', {
            submission_id: submissionId,
            asset_type: 'original_docx',
            source: 'chef_form',
            storage_provider: 'local',
            storage_path: docxPath,
            file_name: `${projectName}_Menu.docx`
        }).catch(err => console.error('Failed to save original_docx asset metadata:', err.message));
        if (persistedBaselineDocPath) {
            axios_1.default.post('http://localhost:3004/assets', {
                submission_id: submissionId,
                asset_type: 'baseline_approved_docx',
                source: 'chef_modification_upload',
                storage_provider: 'local',
                storage_path: persistedBaselineDocPath,
                file_name: revisionBaselineFileName || path.basename(persistedBaselineDocPath),
            }).catch(err => console.error('Failed to save baseline_approved_docx asset metadata:', err.message));
        }
        // Save submitter profile (fire-and-forget)
        axios_1.default.post('http://localhost:3004/submitter-profiles', {
            name: submitterName,
            email: submitterEmail,
            jobTitle: submitterJobTitle
        }).catch(err => console.error('Failed to save submitter profile:', err.message));
        // Trigger AI review process (same as email workflow)
        // This will:
        // 1. Copy to ai-drafts
        // 2. Generate redlined version
        // 3. Set status to 'pending_human_review'
        try {
            // Extract text from the document for AI review
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: docxPath });
            const text = result.value;
            await axios_1.default.post('http://localhost:3002/ai-review', {
                text: text,
                submission_id: submissionId,
                submitter_email: submitterEmail,
                filename: `${projectName}_Menu.docx`,
                original_path: docxPath
            });
            console.log(`✓ AI review triggered for ${submissionId}`);
        }
        catch (aiError) {
            console.error('Error triggering AI review:', aiError.message);
            // Update status to indicate manual review needed
            await axios_1.default.put(`http://localhost:3004/submissions/${submissionId}`, {
                status: 'pending_human_review'
            });
        }
        // Create ClickUp task (fire-and-forget)
        axios_1.default.post('http://localhost:3007/create-task', {
            submissionId,
            submitterName,
            submitterEmail,
            submitterJobTitle,
            projectName,
            property,
            width,
            height,
            cropMarks,
            bleedMarks,
            fileSizeLimit,
            fileSizeLimitMb,
            fileDeliveryNotes,
            orientation,
            menuType,
            templateType,
            dateNeeded,
            hotelName,
            cityCountry,
            assetType,
            docxPath,
            submissionMode,
            revisionSource,
            revisionBaseSubmissionId,
            revisionBaselineDocPath: persistedBaselineDocPath,
            revisionBaselineFileName,
            chefPersistentDiff,
            criticalOverrides,
        }).catch(err => console.error('Failed to create ClickUp task:', err.message));
        res.json({
            success: true,
            submissionId: submissionId,
            message: 'Menu submitted successfully'
        });
    }
    catch (error) {
        console.error('Error submitting form:', error);
        res.status(500).json({
            error: 'Failed to submit menu',
            details: error.message
        });
    }
});
/**
 * NEW: Parse AI response that contains corrected menu + suggestions
 */
function parseAIResponse(feedback, originalMenu) {
    // Extract corrected menu between markers
    const correctedMenuMatch = feedback.match(/=== CORRECTED MENU ===\s*\n([\s\S]*?)\n=== END CORRECTED MENU ===/);
    const correctedMenu = correctedMenuMatch ? correctedMenuMatch[1].trim() : originalMenu;
    // Extract suggestions JSON between markers
    const suggestionsMatch = feedback.match(/=== SUGGESTIONS ===\s*\n([\s\S]*?)\n=== END SUGGESTIONS ===/);
    let suggestions = [];
    if (suggestionsMatch) {
        try {
            const jsonStr = suggestionsMatch[1].trim();
            suggestions = JSON.parse(jsonStr);
            console.log(`Parsed ${suggestions.length} suggestions from JSON`);
        }
        catch (e) {
            console.error('Failed to parse suggestions JSON:', e);
            console.log('Raw suggestions text:', suggestionsMatch[1]);
        }
    }
    // Normalize severity on all suggestions
    suggestions = suggestions.map(s => {
        // Default missing severity to "normal"
        if (!s.severity) {
            s.severity = 'normal';
        }
        // Force critical severity for known critical types (safety net)
        if (s.type === 'Missing Price' || s.type === 'Incomplete Dish Name') {
            s.severity = 'critical';
        }
        // Fallback regex: if description mentions missing price/dish name but type/severity wasn't set
        if (s.severity !== 'critical') {
            const descLower = (s.description || '').toLowerCase();
            if (/missing\s+price|no\s+price|price\s+is\s+missing/.test(descLower) && s.type !== 'Missing Price') {
                s.type = 'Missing Price';
                s.severity = 'critical';
            }
            else if (/missing\s+dish\s+name|incomplete\s+dish\s+name|no\s+dish\s+name/.test(descLower) && s.type !== 'Incomplete Dish Name') {
                s.type = 'Incomplete Dish Name';
                s.severity = 'critical';
            }
        }
        return s;
    });
    return {
        correctedMenu,
        suggestions
    };
}
/**
 * OLD: Parse AI feedback into structured suggestions with confidence levels (DEPRECATED - keeping for fallback)
 */
function parseFeedbackToSuggestions(feedback) {
    const suggestions = [];
    // Extract each item block that has Menu Item + Description + Recommendation
    // Pattern: look for "- **Menu Item:" or "- **Menu Item:**" followed by description and recommendation
    // Match until we hit another Menu Item, Menu Category, or end of feedback
    const itemBlocks = feedback.match(/- \*\*Menu Item:?\*\*[^]*?(?=(?:\n\s*- \*\*Menu (?:Item|Category):?|$))/gi);
    if (!itemBlocks || itemBlocks.length === 0) {
        console.log('⚠️  No structured suggestions found in feedback');
        console.log('First 500 chars of feedback:', feedback.substring(0, 500));
        return [];
    }
    console.log(`Found ${itemBlocks.length} suggestion blocks`);
    itemBlocks.forEach((block, blockIdx) => {
        console.log(`\nParsing block ${blockIdx + 1}:`);
        console.log(block.substring(0, 200));
        // Extract components from each block (handle both "Item:" and "Item:**" formats)
        const menuItemMatch = block.match(/- \*\*Menu Item:?\*\*\s*(.+?)(?=\n|$)/i);
        const descriptionMatch = block.match(/- \*\*Description of Issue:?\*\*\s*(.+?)(?=\n\s*- \*\*Recommendation:|$)/is);
        const recommendationMatch = block.match(/- \*\*Recommendation:?\*\*\s*(.+?)(?=\n\s*(?:-|\n)|$)/is);
        const menuItem = menuItemMatch ? menuItemMatch[1].trim() : '';
        if (!descriptionMatch) {
            console.log('⚠️  No description found in block');
            return;
        }
        const description = descriptionMatch[1].trim();
        const recommendation = recommendationMatch ? recommendationMatch[1].trim() : '';
        // Determine confidence level based on keywords
        let confidence = 'medium';
        // High confidence: spelling errors, typos, missing commas, clear factual errors
        if (description.match(/spelling|misspell|typo|incorrect spelling|correct spelling/i)) {
            confidence = 'high';
        }
        else if (description.match(/missing comma|missing punctuation/i)) {
            confidence = 'high';
        }
        else if (recommendation.match(/correct\s+(?:spelling\s+)?to/i) && description.match(/should\s+(?:be|likely be)/i)) {
            confidence = 'high';
        }
        // Low confidence: suggestions, could, might, consider
        else if (description.match(/consider|could|might|suggest|may want|unclear|ensure/i)) {
            confidence = 'low';
        }
        // Try to extract original and corrected text from recommendation and description
        let originalText = '';
        let correctedText = '';
        // Pattern 1: Correct to "X"  or Correct spelling to "X"
        const correctToPattern = recommendation.match(/correct(?:\s+(?:to|spelling\s+to))?\s+["']([^"']+)["']/i);
        if (correctToPattern) {
            correctedText = correctToPattern[1];
            // Try to find the incorrect word in the description
            const incorrectMatch = description.match(/["']([^"']+)["']\s+(?:is|should be|appears)/i);
            if (incorrectMatch) {
                originalText = incorrectMatch[1];
            }
        }
        // Pattern 2: "X" should be "Y"
        if (!correctedText) {
            const shouldBePattern = recommendation.match(/["']([^"']+)["']\s+should be\s+["']([^"']+)["']/i);
            if (shouldBePattern) {
                originalText = shouldBePattern[1];
                correctedText = shouldBePattern[2];
            }
        }
        // Pattern 3: Look in description for misspelling patterns
        if (!correctedText && description.match(/misspell/i)) {
            // "Hibik" is a likely misspelling of "Hibiki"
            const misspellPattern = description.match(/["']([^"']+)["']\s+is\s+a\s+(?:likely\s+)?misspelling/i);
            if (misspellPattern) {
                originalText = misspellPattern[1];
            }
            // Look for correct spelling in recommendation
            const correctPattern = recommendation.match(/correct\s+(?:to|spelling\s+to)?\s*["']([^"']+)["']/i);
            if (correctPattern) {
                correctedText = correctPattern[1];
            }
        }
        // Pattern 4: Correct spelling to "X" (extract from description)
        if (!correctedText) {
            const correctSpellingPattern = recommendation.match(/correct\s+spelling\s+to\s+["']([^"']+)["']/i);
            if (correctSpellingPattern) {
                correctedText = correctSpellingPattern[1];
                // Extract the misspelled word from description
                // Look for quoted words that appear multiple times or standalone
                const quotedWords = description.match(/["']([^"']+)["']/g);
                if (quotedWords && quotedWords.length > 0) {
                    // Get the first quoted word (usually the incorrect one)
                    const firstWord = quotedWords[0].replace(/["']/g, '');
                    // Check if it's similar to the correction (edit distance)
                    if (firstWord.toLowerCase().replace(/s$/, '') === correctedText.toLowerCase().replace(/s$/, '').replace(/\.$/, '')) {
                        originalText = firstWord.split(',')[0].trim(); // Handle "biters" in "biters, orange biters"
                    }
                }
            }
        }
        // Pattern 5: "X" is likely a typo for "Y"
        if (!originalText || !correctedText) {
            const typoPattern = description.match(/["']([^"']+)["']\s+is\s+likely\s+a\s+typo\s+for\s+["']([^"']+)["']/i);
            if (typoPattern) {
                originalText = typoPattern[1];
                correctedText = typoPattern[2];
            }
        }
        // Pattern 6: "X" should be "Y" in description
        if (!originalText || !correctedText) {
            const descShouldBePattern = description.match(/["']([^"']+)["']\s+should\s+(?:be|likely be)\s+["']([^"']+)["']/i);
            if (descShouldBePattern) {
                originalText = descShouldBePattern[1];
                correctedText = descShouldBePattern[2];
            }
        }
        // Pattern 7: Extract word pairs when correctedText is a phrase like "mole bitters, orange bitters"
        // and description mentions the incorrect version
        if (correctedText && !originalText && correctedText.includes(',')) {
            // Try to find common misspelling in description
            const descQuoted = description.match(/["']([^"']+)["']/);
            if (descQuoted) {
                const descText = descQuoted[1];
                // Extract the repeated incorrect word (e.g., "biters" from "mole biters, orange biters")
                const correctedWords = correctedText.split(/,\s*/);
                const descWords = descText.split(/,\s*/);
                // Find the differing word between original and corrected
                if (correctedWords[0] && descWords[0]) {
                    const corrParts = correctedWords[0].split(' ');
                    const descParts = descWords[0].split(' ');
                    // Find the word that differs (e.g., "biters" vs "bitters")
                    for (let i = 0; i < Math.min(corrParts.length, descParts.length); i++) {
                        if (corrParts[i] !== descParts[i]) {
                            originalText = descParts[i];
                            correctedText = corrParts[i];
                            break;
                        }
                    }
                }
            }
        }
        // Try to identify the type based on content
        let type = 'General';
        if (description.toLowerCase().includes('diacritic') || description.toLowerCase().includes('accent')) {
            type = 'Diacritics';
        }
        else if (description.toLowerCase().includes('allergen')) {
            type = 'Allergen Code';
        }
        else if (description.toLowerCase().includes('spelling')) {
            type = 'Spelling';
        }
        else if (description.toLowerCase().includes('format')) {
            type = 'Formatting';
        }
        else if (description.toLowerCase().includes('raw') || description.toLowerCase().includes('asterisk')) {
            type = 'Raw Item Marker';
        }
        else if (description.toLowerCase().includes('comma') || description.toLowerCase().includes('punctuation')) {
            type = 'Punctuation';
        }
        suggestions.push({
            type: type,
            description: description,
            recommendation: recommendation,
            confidence: confidence,
            menuItem: menuItem,
            originalText: originalText || undefined,
            correctedText: correctedText || undefined
        });
    });
    // If no structured issues found, create general feedback
    if (suggestions.length === 0 && feedback && !feedback.includes('No feedback generated')) {
        const lines = feedback.split('\n').filter(line => line.trim() &&
            !line.includes('---') &&
            !line.startsWith('Here is') &&
            line.length > 20);
        lines.slice(0, 5).forEach(line => {
            suggestions.push({
                type: 'Suggestion',
                description: line.trim(),
                confidence: 'low'
            });
        });
    }
    return suggestions;
}
/**
 * Helper: Generate Word document from form data using Python
 */
async function generateDocxFromForm(submissionId, formData) {
    const tempUploadsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'uploads');
    await fs_1.promises.mkdir(tempUploadsDir, { recursive: true });
    const submissionDir = getSubmissionDocumentDir(formData.projectName || '', formData.property || '', submissionId);
    const originalDir = path.join(submissionDir, 'original');
    await fs_1.promises.mkdir(originalDir, { recursive: true });
    const outputPath = path.join(originalDir, `${submissionId}.docx`);
    // Create Python script to generate docx
    const repoRoot = getRepoRoot();
    const docxRedlinerDir = getDocxRedlinerDir();
    const pythonScript = path.join(docxRedlinerDir, 'generate_from_form.py');
    // Select template based on templateType (food or beverage)
    const templateType = formData.templateType || 'food';
    const templatePath = templateType === 'beverage'
        ? path.join(repoRoot, 'samples', 'RSH Design Brief Beverage Template.docx')
        : path.join(repoRoot, 'samples', 'RSH_DESIGN BRIEF_FOOD_Menu_Template .docx');
    console.log(`Using ${templateType} template: ${templatePath}`);
    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
    // Create a temp JSON file with form data
    const formDataPath = path.join(tempUploadsDir, `${submissionId}_formdata.json`);
    await fs_1.promises.writeFile(formDataPath, JSON.stringify(formData, null, 2));
    // Try venv python first, fallback to system python3
    let command = `"${venvPython}" "${pythonScript}" "${templatePath}" "${formDataPath}" "${outputPath}"`;
    try {
        await fs_1.promises.access(venvPython);
    }
    catch {
        command = `python3 "${pythonScript}" "${templatePath}" "${formDataPath}" "${outputPath}"`;
    }
    console.log(`Executing: ${command}`);
    const { stdout, stderr } = await execAsync(command, {
        env: { ...process.env },
        timeout: 60000
    });
    if (stdout)
        console.log('Document generation output:', stdout);
    if (stderr)
        console.error('Document generation stderr:', stderr);
    // Clean up temp file
    await fs_1.promises.unlink(formDataPath).catch(() => { });
    return outputPath;
}
/**
 * Design Approval API: Compare DOCX against PDF
 */
app.post('/api/design-approval/compare', upload.fields([
    { name: 'docxFile', maxCount: 1 },
    { name: 'pdfFile', maxCount: 1 }
]), async (req, res) => {
    const files = req.files;
    const tempFiles = [];
    // Extract submitter metadata from multipart form fields
    const submitterName = req.body.submitterName || '';
    const submitterEmail = req.body.submitterEmail || '';
    const submitterJobTitle = req.body.submitterJobTitle || '';
    try {
        if (!files.docxFile || !files.pdfFile) {
            return res.status(400).json({ error: 'Both DOCX and PDF files are required' });
        }
        const docxFile = files.docxFile[0];
        const pdfFile = files.pdfFile[0];
        tempFiles.push(docxFile.path, pdfFile.path);
        // Validate MIME types
        const docxMime = docxFile.mimetype;
        const pdfMime = pdfFile.mimetype;
        if (!docxMime.includes('wordprocessingml') && !docxMime.includes('octet-stream')) {
            return res.status(400).json({ error: 'First file must be a .docx document' });
        }
        if (pdfMime !== 'application/pdf' && !pdfMime.includes('octet-stream')) {
            return res.status(400).json({ error: 'Second file must be a PDF' });
        }
        const docxRedlinerDir = getDocxRedlinerDir();
        const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
        let pythonCmd;
        try {
            await fs_1.promises.access(venvPython);
            pythonCmd = `"${venvPython}"`;
        }
        catch {
            pythonCmd = 'python3';
        }
        // Extract project details + menu content from DOCX
        const extractDetailsScript = path.join(docxRedlinerDir, 'extract_project_details.py');
        const detailsResult = await execAsync(`${pythonCmd} "${extractDetailsScript}" "${docxFile.path}"`, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
        const docxData = JSON.parse(detailsResult.stdout);
        if (docxData.error) {
            return res.status(400).json({ error: `DOCX extraction failed: ${docxData.error}` });
        }
        // Extract text from PDF
        const extractPdfScript = path.join(docxRedlinerDir, 'extract_pdf_text.py');
        const pdfResult = await execAsync(`${pythonCmd} "${extractPdfScript}" "${pdfFile.path}"`, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
        const pdfData = JSON.parse(pdfResult.stdout);
        if (pdfData.error) {
            return res.status(400).json({ error: `PDF extraction failed: ${pdfData.error}` });
        }
        if (!pdfData.has_text_layer) {
            return res.status(400).json({
                error: 'The PDF does not contain a text layer. It may be a scanned image. Please provide a PDF with selectable text.'
            });
        }
        // Run comparison
        const docxText = (docxData.menu_content || '').trim();
        const pdfText = (pdfData.full_text || '').trim();
        const differences = compareMenuTexts(docxText, pdfText);
        const isMatch = differences.length === 0;
        // Create submission record in database
        const projectDetails = docxData.project_details || {};
        const submissionId = `design-${Date.now()}`;
        let dbSaved = false;
        try {
            await axios_1.default.post('http://localhost:3004/submissions', {
                id: submissionId,
                submitter_email: submitterEmail,
                submitter_name: submitterName,
                submitter_job_title: submitterJobTitle,
                project_name: projectDetails.project_name || 'Design Approval',
                property: projectDetails.property || '',
                size: projectDetails.size || '',
                orientation: projectDetails.orientation || '',
                filename: docxFile.originalname || 'design-approval.docx',
                status: isMatch ? 'approved' : 'needs_correction',
                created_at: new Date().toISOString(),
                source: 'design_approval'
            });
            dbSaved = true;
            console.log(`Design approval submission saved: ${submissionId}`);
        }
        catch (dbError) {
            console.error('Failed to save design approval submission:', dbError.message);
        }
        // Save submitter profile (fire-and-forget)
        if (submitterName && submitterEmail) {
            axios_1.default.post('http://localhost:3004/submitter-profiles', {
                name: submitterName,
                email: submitterEmail,
                jobTitle: submitterJobTitle
            }).catch(err => console.error('Failed to save submitter profile:', err.message));
        }
        res.json({
            isMatch,
            projectDetails: docxData.project_details,
            differences,
            docxText,
            pdfText,
            submissionId: dbSaved ? submissionId : undefined
        });
    }
    catch (error) {
        console.error('Error comparing documents:', error);
        res.status(500).json({ error: error.message || 'Comparison failed' });
    }
    finally {
        // Clean up temp files
        for (const f of tempFiles) {
            fs_1.promises.unlink(f).catch(() => { });
        }
    }
});
const PRICE_REGEX = /\$?\d+\.?\d*/g;
const ALLERGEN_CODES = new Set(['GF', 'V', 'VG', 'DF', 'N', 'SF', 'S', 'G', 'C', 'D', 'E', 'F']);
function stripAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function classifyWordDiff(docxWord, pdfWord) {
    // Price difference
    if (PRICE_REGEX.test(docxWord) || PRICE_REGEX.test(pdfWord)) {
        // Reset regex lastIndex
        PRICE_REGEX.lastIndex = 0;
        const docxPrices = docxWord.match(PRICE_REGEX) || [];
        const pdfPrices = pdfWord.match(PRICE_REGEX) || [];
        if (docxPrices.join() !== pdfPrices.join()) {
            return { type: 'price', severity: 'critical' };
        }
    }
    PRICE_REGEX.lastIndex = 0;
    // Allergen code
    const docxUpper = docxWord.replace(/[^A-Za-z]/g, '').toUpperCase();
    const pdfUpper = pdfWord.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (ALLERGEN_CODES.has(docxUpper) || ALLERGEN_CODES.has(pdfUpper)) {
        if (docxUpper !== pdfUpper) {
            return { type: 'allergen', severity: 'critical' };
        }
    }
    // Diacritical difference
    if (stripAccents(docxWord).toLowerCase() === stripAccents(pdfWord).toLowerCase() &&
        docxWord.toLowerCase() !== pdfWord.toLowerCase()) {
        return { type: 'diacritical', severity: 'warning' };
    }
    // Spelling
    return { type: 'spelling', severity: 'warning' };
}
function compareMenuTexts(docxText, pdfText) {
    const differences = [];
    const docxLines = docxText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const pdfLines = pdfText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Build LCS alignment between lines
    const m = docxLines.length;
    const n = pdfLines.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (linesMatchFuzzy(docxLines[i - 1], pdfLines[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    const aligned = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (linesMatchFuzzy(docxLines[i - 1], pdfLines[j - 1])) {
            aligned.unshift({ type: 'match', docxIdx: i - 1, pdfIdx: j - 1 });
            i--;
            j--;
        }
        else if (dp[i - 1][j] > dp[i][j - 1]) {
            aligned.unshift({ type: 'docx_only', docxIdx: i - 1 });
            i--;
        }
        else {
            aligned.unshift({ type: 'pdf_only', pdfIdx: j - 1 });
            j--;
        }
    }
    while (i > 0) {
        aligned.unshift({ type: 'docx_only', docxIdx: i - 1 });
        i--;
    }
    while (j > 0) {
        aligned.unshift({ type: 'pdf_only', pdfIdx: j - 1 });
        j--;
    }
    // Process aligned pairs
    for (const pair of aligned) {
        if (pair.type === 'docx_only') {
            differences.push({
                type: 'missing',
                severity: 'critical',
                description: `Line missing in PDF`,
                docxValue: docxLines[pair.docxIdx],
                docxLineNum: pair.docxIdx
            });
        }
        else if (pair.type === 'pdf_only') {
            differences.push({
                type: 'extra',
                severity: 'warning',
                description: `Extra line in PDF`,
                pdfValue: pdfLines[pair.pdfIdx],
                pdfLineNum: pair.pdfIdx
            });
        }
        else if (pair.type === 'match') {
            const docxLine = docxLines[pair.docxIdx];
            const pdfLine = pdfLines[pair.pdfIdx];
            // Even if lines "match" fuzzy, check word-by-word for differences
            if (docxLine !== pdfLine) {
                const wordDiffs = compareWords(docxLine, pdfLine);
                for (const wd of wordDiffs) {
                    differences.push({
                        ...wd,
                        docxLineNum: pair.docxIdx,
                        pdfLineNum: pair.pdfIdx
                    });
                }
            }
        }
    }
    return differences;
}
function linesMatchFuzzy(a, b) {
    if (a === b)
        return true;
    // Normalize: strip accents, lowercase, collapse whitespace
    const normA = stripAccents(a).toLowerCase().replace(/\s+/g, ' ').trim();
    const normB = stripAccents(b).toLowerCase().replace(/\s+/g, ' ').trim();
    if (normA === normB)
        return true;
    // Similarity based on common words
    const wordsA = normA.split(/\s+/);
    const wordsB = normB.split(/\s+/);
    if (wordsA.length === 0 || wordsB.length === 0)
        return false;
    let common = 0;
    const setB = new Set(wordsB);
    for (const w of wordsA) {
        if (setB.has(w))
            common++;
    }
    return common / Math.max(wordsA.length, wordsB.length) > 0.5;
}
function compareWords(docxLine, pdfLine) {
    const diffs = [];
    const docxWords = docxLine.split(/\s+/);
    const pdfWords = pdfLine.split(/\s+/);
    // LCS on words
    const m = docxWords.length;
    const n = pdfWords.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (docxWords[i - 1] === pdfWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    const waligned = [];
    let wi = m, wj = n;
    while (wi > 0 && wj > 0) {
        if (docxWords[wi - 1] === pdfWords[wj - 1]) {
            waligned.unshift({ type: 'same', dIdx: wi - 1, pIdx: wj - 1 });
            wi--;
            wj--;
        }
        else if (dp[wi - 1][wj] > dp[wi][wj - 1]) {
            waligned.unshift({ type: 'docx', dIdx: wi - 1 });
            wi--;
        }
        else {
            waligned.unshift({ type: 'pdf', pIdx: wj - 1 });
            wj--;
        }
    }
    while (wi > 0) {
        waligned.unshift({ type: 'docx', dIdx: wi - 1 });
        wi--;
    }
    while (wj > 0) {
        waligned.unshift({ type: 'pdf', pIdx: wj - 1 });
        wj--;
    }
    // Pair up adjacent docx/pdf removals/additions as changes
    let idx = 0;
    while (idx < waligned.length) {
        const cur = waligned[idx];
        if (cur.type === 'docx' && idx + 1 < waligned.length && waligned[idx + 1].type === 'pdf') {
            // This is a word change
            const docxW = docxWords[cur.dIdx];
            const pdfW = pdfWords[waligned[idx + 1].pIdx];
            const classification = classifyWordDiff(docxW, pdfW);
            diffs.push({
                type: classification.type,
                severity: classification.severity,
                description: `"${docxW}" changed to "${pdfW}"`,
                docxValue: docxW,
                pdfValue: pdfW
            });
            idx += 2;
        }
        else if (cur.type === 'pdf' && idx + 1 < waligned.length && waligned[idx + 1].type === 'docx') {
            const docxW = docxWords[waligned[idx + 1].dIdx];
            const pdfW = pdfWords[cur.pIdx];
            const classification = classifyWordDiff(docxW, pdfW);
            diffs.push({
                type: classification.type,
                severity: classification.severity,
                description: `"${docxW}" changed to "${pdfW}"`,
                docxValue: docxW,
                pdfValue: pdfW
            });
            idx += 2;
        }
        else if (cur.type === 'docx') {
            diffs.push({
                type: 'missing',
                severity: 'critical',
                description: `Word missing in PDF: "${docxWords[cur.dIdx]}"`,
                docxValue: docxWords[cur.dIdx]
            });
            idx++;
        }
        else if (cur.type === 'pdf') {
            diffs.push({
                type: 'extra',
                severity: 'info',
                description: `Extra word in PDF: "${pdfWords[cur.pIdx]}"`,
                pdfValue: pdfWords[cur.pIdx]
            });
            idx++;
        }
        else {
            idx++;
        }
    }
    return diffs;
}
if (require.main === module) {
    app.listen(port, () => {
        console.log(`📊 Dashboard service listening at http://localhost:${port}`);
        console.log(`   Access dashboard: http://localhost:${port}`);
        console.log(`   Form submission: http://localhost:${port}/form`);
        console.log(`   Design approval: http://localhost:${port}/design-approval`);
        console.log(`   Training dashboard: http://localhost:${port}/training`);
    });
}
exports.default = app;
