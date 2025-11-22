import express from 'express';
import multer from 'multer';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

        // Handle relative paths from dist directory
        let absolutePath = submission.original_path;
        if (absolutePath.startsWith('../')) {
            absolutePath = path.resolve(__dirname, absolutePath);
        }

        console.log(`Downloading original from: ${absolutePath}`);
        res.download(absolutePath, submission.filename);
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

        // Get the proper filename with extension from the draft path
        const draftExt = path.extname(submission.ai_draft_path);
        const baseFilename = path.basename(submission.filename, path.extname(submission.filename));
        const draftFilename = `DRAFT_${baseFilename}${draftExt}`;

        console.log(`Downloading draft from: ${submission.ai_draft_path}`);
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
app.post('/upload/:submissionId', upload.single('finalDocument') as any, async (req, res) => {
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

/**
 * Generate Redlined Version - Apply AI corrections with tracked changes
 */
app.post('/redline/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        console.log(`Generating redlined version for submission ${submissionId}`);

        // Get submission details
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        // Determine the input file path (use AI draft if available, otherwise original)
        let inputPath = submission.ai_draft_path || submission.original_path;
        
        // Handle relative paths
        if (inputPath.startsWith('../')) {
            inputPath = path.resolve(__dirname, inputPath);
        }

        // Check if file exists and is a .docx
        if (!inputPath.endsWith('.docx')) {
            return res.status(400).json({ 
                error: 'Redlining only works with .docx files' 
            });
        }

        // Define output path for redlined version
        const redlinedPath = path.join(
            __dirname, '..', '..', '..', 'tmp', 'redlined',
            `${submissionId}-redlined.docx`
        );
        await fs.mkdir(path.dirname(redlinedPath), { recursive: true });

        // Call the Python redliner
        // __dirname points to services/dashboard/dist when built
        const pythonScript = path.resolve(__dirname, '..', '..', 'docx-redliner', 'process_menu.py');
        const venvPython = path.resolve(__dirname, '..', '..', 'docx-redliner', 'venv', 'bin', 'python');
        const pythonExec = venvPython; // fallback handled below
        
        // Fallback: if venv python doesn't exist, use system python3
        let command = `"${pythonExec}" "${pythonScript}" "${inputPath}" "${redlinedPath}"`;
        try {
            // simple existence check by attempting to stat via shell 'test -x'
            await execAsync(`[ -x "${venvPython}" ] || echo "NO_VENV"`);
        } catch (_) {
            // ignore
        }
        const venvCheck = await execAsync(`[ -x "${venvPython}" ] && echo OK || echo NO`);
        if (venvCheck.stdout.trim() === 'NO') {
            command = `python3 "${pythonScript}" "${inputPath}" "${redlinedPath}"`;
        }
        
        console.log(`Executing: ${command}`);
        
        const { stdout, stderr } = await execAsync(command, {
            env: { ...process.env },
            timeout: 120000 // 2 minute timeout
        });

        console.log('Redliner output:', stdout);
        if (stderr) console.error('Redliner stderr:', stderr);

        // Update DB with redlined path
        await axios.put(`http://localhost:3004/submissions/${submissionId}`, {
            redlined_path: redlinedPath,
            redlined_at: new Date().toISOString()
        });

        res.json({ 
            success: true, 
            message: 'Redlined version generated successfully',
            download_url: `/download/redlined/${submissionId}`
        });

    } catch (error: any) {
        console.error('Error generating redlined version:', error);
        res.status(500).json({ 
            error: 'Failed to generate redlined version',
            details: error.message 
        });
    }
});

/**
 * Download Redlined Version
 */
app.get('/download/redlined/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await axios.get(`http://localhost:3004/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission || !submission.redlined_path) {
            return res.status(404).send('Redlined version not found');
        }

        const baseFilename = path.basename(submission.filename, path.extname(submission.filename));
        const redlinedFilename = `REDLINED_${baseFilename}.docx`;

        console.log(`Downloading redlined version from: ${submission.redlined_path}`);
        res.download(submission.redlined_path, redlinedFilename);
    } catch (error) {
        console.error('Error downloading redlined version:', error);
        res.status(500).send('Error downloading redlined file');
    }
});

/**
 * Training Dashboard - Manage training data and sessions
 */
app.get('/training', async (req, res) => {
    try {
        // Read training sessions from tmp/training directory
        const trainingDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training');
        await fs.mkdir(trainingDir, { recursive: true });

        const files = await fs.readdir(trainingDir);
        const sessionFiles = files.filter(f => f.startsWith('session_') && f.endsWith('.json'));

        const sessions = await Promise.all(
            sessionFiles.map(async (file) => {
                const content = await fs.readFile(path.join(trainingDir, file), 'utf-8');
                return JSON.parse(content);
            })
        );

        // Sort by session ID (timestamp) descending
        sessions.sort((a, b) => b.session_id.localeCompare(a.session_id));

        res.render('training', {
            title: 'Training Dashboard',
            sessions: sessions
        });
    } catch (error) {
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
]) as any, async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        if (!files.original || !files.redlined) {
            return res.status(400).json({ 
                error: 'Both original and redlined documents are required' 
            });
        }

        const originalFile = files.original[0];
        const redlinedFile = files.redlined[0];

        // Create pairs directory if it doesn't exist
        const pairsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training', 'pairs');
        await fs.mkdir(pairsDir, { recursive: true });

        // Generate pair name
        const timestamp = Date.now();
        const pairName = req.body.pairName || `pair_${timestamp}`;

        // Move files to pairs directory with standard naming
        const originalDest = path.join(pairsDir, `${pairName}_original.docx`);
        const redlinedDest = path.join(pairsDir, `${pairName}_redlined.docx`);

        await fs.rename(originalFile.path, originalDest);
        await fs.rename(redlinedFile.path, redlinedDest);

        console.log(`Training pair added: ${pairName}`);

        res.json({
            success: true,
            message: 'Training pair uploaded successfully',
            pairName: pairName
        });

    } catch (error) {
        console.error('Error uploading training pair:', error);
        res.status(500).json({ error: 'Failed to upload training pair' });
    }
});

/**
 * Run Training - Execute training pipeline on accumulated pairs
 */
app.post('/training/run', async (req, res) => {
    try {
        const minOccurrences = req.body.minOccurrences || 2;
        
        console.log(`Starting training pipeline with minOccurrences=${minOccurrences}`);

        // Path to training script
        const pairsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'training', 'pairs');
        const pythonScript = path.resolve(__dirname, '..', '..', 'docx-redliner', 'training_pipeline.py');
        const venvPython = path.resolve(__dirname, '..', '..', 'docx-redliner', 'venv', 'bin', 'python');
        const sopRulesPath = path.resolve(__dirname, '..', '..', '..', 'sop-processor', 'sop_rules.json');

        // Check if pairs directory exists and has files
        try {
            const files = await fs.readdir(pairsDir);
            const pairCount = files.filter(f => f.endsWith('_original.docx')).length;
            
            if (pairCount === 0) {
                return res.status(400).json({ 
                    error: 'No training pairs found. Upload some pairs first.' 
                });
            }
        } catch (err) {
            return res.status(400).json({ 
                error: 'No training pairs directory found. Upload some pairs first.' 
            });
        }

        // Build command
        let command = `"${venvPython}" "${pythonScript}" --directory "${pairsDir}" --min-occurrences ${minOccurrences} --merge-rules "${sopRulesPath}" --optimize-prompt`;
        
        // Check if venv python exists
        const venvCheck = await execAsync(`[ -x "${venvPython}" ] && echo OK || echo NO`).catch(() => ({ stdout: 'NO' }));
        if (venvCheck.stdout.trim() === 'NO') {
            command = `python3 "${pythonScript}" --directory "${pairsDir}" --min-occurrences ${minOccurrences} --merge-rules "${sopRulesPath}" --optimize-prompt`;
        }

        console.log(`Executing: ${command}`);

        // Execute training pipeline
        const { stdout, stderr } = await execAsync(command, {
            env: { ...process.env },
            timeout: 300000 // 5 minute timeout
        });

        console.log('Training output:', stdout);
        if (stderr) console.error('Training stderr:', stderr);

        res.json({
            success: true,
            message: 'Training completed successfully',
            output: stdout
        });

    } catch (error: any) {
        console.error('Error running training:', error);
        res.status(500).json({
            error: 'Failed to run training',
            details: error.message
        });
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

        const content = await fs.readFile(sessionFile, 'utf-8');
        const session = JSON.parse(content);

        res.json(session);
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
        console.error('Error downloading prompt:', error);
        res.status(404).send('Prompt file not found');
    }
});

app.listen(port, () => {
    console.log(`📊 Dashboard service listening at http://localhost:${port}`);
    console.log(`   Access dashboard: http://localhost:${port}`);
    console.log(`   Training dashboard: http://localhost:${port}/training`);
});
