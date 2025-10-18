import express from 'express';
import { promises as fs } from 'fs';
import mammoth from 'mammoth';
import * as path from 'path';

const app = express();
const port = 3006;

const DIFFERENCES_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'learning');
const TRAINING_DATA_FILE = path.join(DIFFERENCES_DIR, 'training_data.jsonl');

// Ensure directories exist
async function initDiffer() {
    try {
        await fs.mkdir(DIFFERENCES_DIR, { recursive: true });
        // Create training data file if it doesn't exist
        try {
            await fs.access(TRAINING_DATA_FILE);
        } catch {
            await fs.writeFile(TRAINING_DATA_FILE, '');
        }
    } catch (error) {
        console.error('Failed to initialize differ:', error);
    }
}

app.use(express.json());

/**
 * Compare AI draft with final human-approved version
 * This endpoint analyzes the differences to create training data
 */
app.post('/compare', async (req, res) => {
    try {
        const { submission_id, ai_draft_path, final_path } = req.body;

        if (!submission_id || !ai_draft_path || !final_path) {
            return res.status(400).json({ 
                error: 'Missing required fields: submission_id, ai_draft_path, final_path' 
            });
        }

        console.log(`📊 Analyzing differences for submission ${submission_id}`);

        // Extract text from both documents
        const aiDraftText = await extractText(ai_draft_path);
        const finalText = await extractText(final_path);

        // Compare the two versions
        const differences = analyzeDocuments(aiDraftText, finalText);

        // Log the differences for training
        const trainingEntry = {
            submission_id,
            timestamp: new Date().toISOString(),
            ai_draft_length: aiDraftText.length,
            final_length: finalText.length,
            changes_detected: differences.hasChanges,
            change_percentage: differences.changePercentage,
            ai_draft_path,
            final_path,
            analysis: differences.summary
        };

        // Append to training data file (JSONL format - one JSON object per line)
        await fs.appendFile(
            TRAINING_DATA_FILE, 
            JSON.stringify(trainingEntry) + '\n'
        );

        // Also save detailed comparison to individual file
        const detailPath = path.join(
            DIFFERENCES_DIR, 
            `${submission_id}-comparison.json`
        );
        await fs.writeFile(
            detailPath, 
            JSON.stringify({
                ...trainingEntry,
                ai_draft_excerpt: aiDraftText.substring(0, 500),
                final_excerpt: finalText.substring(0, 500)
            }, null, 2)
        );

        console.log(`✅ Comparison complete for ${submission_id}`);
        console.log(`   Changes detected: ${differences.hasChanges ? 'YES' : 'NO'}`);
        console.log(`   Change percentage: ${differences.changePercentage.toFixed(2)}%`);

        res.status(200).json({
            success: true,
            submission_id,
            differences: differences.summary,
            training_data_saved: true,
            detail_path: detailPath
        });

    } catch (error) {
        console.error('Error comparing documents:', error);
        res.status(500).json({ error: 'Failed to compare documents' });
    }
});

/**
 * Get training statistics
 */
app.get('/stats', async (req, res) => {
    try {
        const content = await fs.readFile(TRAINING_DATA_FILE, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line);
        const entries = lines.map(line => JSON.parse(line));

        const stats = {
            total_comparisons: entries.length,
            comparisons_with_changes: entries.filter(e => e.changes_detected).length,
            comparisons_without_changes: entries.filter(e => !e.changes_detected).length,
            average_change_percentage: entries.reduce((sum, e) => sum + e.change_percentage, 0) / entries.length || 0,
            latest_comparison: entries[entries.length - 1] || null
        };

        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

/**
 * Get all training data (for analysis/export)
 */
app.get('/training-data', async (req, res) => {
    try {
        const content = await fs.readFile(TRAINING_DATA_FILE, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line);
        const entries = lines.map(line => JSON.parse(line));

        res.json({
            count: entries.length,
            data: entries
        });
    } catch (error) {
        console.error('Error getting training data:', error);
        res.status(500).json({ error: 'Failed to get training data' });
    }
});

/**
 * Extract text from .docx file
 */
async function extractText(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

/**
 * Analyze differences between two documents
 * This is a simple implementation - can be enhanced with more sophisticated diff algorithms
 */
function analyzeDocuments(aiDraft: string, final: string) {
    // Simple character-level comparison
    const lengthDiff = Math.abs(final.length - aiDraft.length);
    const changePercentage = (lengthDiff / Math.max(aiDraft.length, final.length)) * 100;

    // Check if documents are identical
    const hasChanges = aiDraft.trim() !== final.trim();

    // Simple analysis
    const summary = {
        identical: !hasChanges,
        ai_draft_words: aiDraft.split(/\s+/).length,
        final_words: final.split(/\s+/).length,
        word_count_diff: Math.abs(
            final.split(/\s+/).length - aiDraft.split(/\s+/).length
        ),
        character_count_diff: lengthDiff
    };

    return {
        hasChanges,
        changePercentage,
        summary
    };
}

app.listen(port, async () => {
    console.log(`🔬 Differ service listening at http://localhost:${port}`);
    console.log(`   Training data directory: ${DIFFERENCES_DIR}`);
    await initDiffer();
});
