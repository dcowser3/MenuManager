import express = require('express');
import { promises as fs } from 'fs';
import mammoth from 'mammoth';
import * as path from 'path';
import * as fsSync from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv = require('dotenv');
import { getSupabaseClient, isSupabaseConfigured } from '@menumanager/supabase-client';
import { requireInternalServiceAuth } from '@menumanager/internal-auth';
import {
    HUMAN_REVIEW_COMPARISON_SOURCE,
    buildLearningComparisonKey,
    deleteLearningSubmissionFromFiles,
    getLearningAggregationEntries,
    isHumanReviewLearningEntry,
    upsertTrainingEntry,
} from './lib/learning-store';
import {
    ReplacementExample,
    ReplacementSignal,
    diffLines,
    extractReplacementExamples,
    extractLineReplacements,
    extractReplacementSignals,
    linesLikelySameContext,
} from './lib/learning-signals';
import {
    buildTokenEdits,
    tokenizeDiffText,
} from '@menumanager/diff-core';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const app = express();
const port = 3006;
const execAsync = promisify(exec);

const DIFFERENCES_DIR = process.env.LEARNING_DATA_DIR || path.join(getRepoRoot(), 'tmp', 'learning');
const TRAINING_DATA_FILE = path.join(DIFFERENCES_DIR, 'training_data.jsonl');
const LEARNED_RULES_FILE = path.join(DIFFERENCES_DIR, 'learned_rules.json');
const RULE_OVERRIDES_FILE = path.join(DIFFERENCES_DIR, 'rule_overrides.json');
const LOCATION_RULES_FILE = path.join(DIFFERENCES_DIR, 'location_specific_rules.json');
const MIN_OCCURRENCES = Number(process.env.LEARNING_MIN_OCCURRENCES || 2);
const MAX_RULES_IN_OVERLAY = Number(process.env.LEARNING_MAX_OVERLAY_RULES || 25);

function getRepoRoot(): string {
    const candidates = [
        path.resolve(__dirname, '..', '..'),
        path.resolve(__dirname, '..', '..', '..'),
    ];

    for (const candidate of candidates) {
        if (fsSync.existsSync(path.join(candidate, 'services')) && fsSync.existsSync(path.join(candidate, 'samples'))) {
            return candidate;
        }
    }

    return candidates[0];
}

async function extractDocxCleanText(filePath: string): Promise<string> {
    const repoRoot = getRepoRoot();
    const scriptPath = path.join(repoRoot, 'services', 'docx-redliner', 'extract_clean_menu_text.py');
    const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');

    let command = `python3 "${scriptPath}" "${filePath}"`;
    if (fsSync.existsSync(venvPython)) {
        command = `"${venvPython}" "${scriptPath}" "${filePath}"`;
    }

    const { stdout } = await execAsync(command, { timeout: 30000 });
    const payload = JSON.parse((stdout || '{}').trim() || '{}');
    if (payload.error) {
        throw new Error(payload.error);
    }
    return String(payload.cleaned_menu_content || payload.menu_content || '').trim();
}

type TrainingEntry = {
    submission_id: string;
    timestamp: string;
    ai_draft_length: number;
    final_length: number;
    changes_detected: boolean;
    change_percentage: number;
    original_path?: string;
    ai_draft_path: string;
    final_path: string;
    comparison_source?: string;
    review_source?: string;
    review_completed_at?: string;
    changed_by_human?: boolean;
    learning_eligible?: boolean;
    comparison_key?: string;
    analysis: {
        identical: boolean;
        ai_draft_words: number;
        final_words: number;
        word_count_diff: number;
        character_count_diff: number;
    };
    learning_signals?: {
        replacements: ReplacementSignal[];
        replacement_count: number;
    };
};

type LearnedRule = {
    source: string;
    target: string;
    source_norm: string;
    target_norm: string;
    kind: 'diacritic' | 'punctuation' | 'spelling' | 'capitalization';
    occurrences: number;
    submission_count: number;
    confidence: number;
    dominance_ratio: number;
    last_seen_at: string;
    status: 'active' | 'weak' | 'conflicted';
};

type LearnedRulesSnapshot = {
    generated_at: string;
    min_occurrences: number;
    total_entries_analyzed: number;
    total_rules: number;
    active_rules: LearnedRule[];
    weak_rules: LearnedRule[];
    conflicted_rules: LearnedRule[];
};

type RuleOverrides = {
    disabled: Record<string, { updated_at: string; reason?: string }>;
};

type LocationSpecificRule = {
    id: string;
    created_at: string;
    submission_id: string;
    correction_id: string;
    before_line: string;
    after_line: string;
    token_changes: Array<{ from: string; to: string; kind: string }>;
    explanation: string;
    restaurant_name: string;
    location: string;
    shared_locations: string[];
    reviewer_name?: string;
};

type LineCorrection = {
    correction_id: string;
    line_index: number;
    before_line: string;
    after_line: string;
    token_changes: Array<{ from: string; to: string; kind: string }>;
};

type DishCorrection = {
    correction_id: string;
    line_index: number;
    before_line: string;
    after_line: string;
    diff_html: string;
    change_type: 'modified' | 'removed' | 'added';
};

async function initDiffer() {
    try {
        await fs.mkdir(DIFFERENCES_DIR, { recursive: true });
        await ensureFile(TRAINING_DATA_FILE, '');
        await ensureFile(
            LEARNED_RULES_FILE,
            JSON.stringify(
                {
                    generated_at: new Date().toISOString(),
                    min_occurrences: MIN_OCCURRENCES,
                    total_entries_analyzed: 0,
                    total_rules: 0,
                    active_rules: [],
                    weak_rules: [],
                    conflicted_rules: [],
                },
                null,
                2
            )
        );
        await ensureFile(
            RULE_OVERRIDES_FILE,
            JSON.stringify({ disabled: {} }, null, 2)
        );
        await ensureFile(LOCATION_RULES_FILE, '[]');

        // Rebuild snapshot from historical training data on boot so dashboard stats
        // don't appear as zero after service restarts.
        await rebuildLearnedRules();
    } catch (error) {
        console.error('Failed to initialize differ:', error);
    }
}

async function ensureFile(filePath: string, initialContent: string): Promise<void> {
    try {
        await fs.access(filePath);
    } catch {
        await fs.writeFile(filePath, initialContent);
    }
}

app.use(express.json());
app.use(requireInternalServiceAuth);

app.post('/compare', async (req, res) => {
    try {
        const { submission_id, ai_draft_path, final_path, original_path } = req.body;
        const comparisonSource = `${req.body?.comparison_source || ''}`.trim();
        const reviewSource = `${req.body?.review_source || ''}`.trim();
        const reviewCompletedAt = `${req.body?.review_completed_at || ''}`.trim();
        const changedByHuman = req.body?.changed_by_human === true;

        if (!submission_id || !ai_draft_path || !final_path) {
            return res.status(400).json({
                error: 'Missing required fields: submission_id, ai_draft_path, final_path',
            });
        }

        if (comparisonSource !== HUMAN_REVIEW_COMPARISON_SOURCE || !changedByHuman) {
            const skipReason = `learning requires comparison_source="${HUMAN_REVIEW_COMPARISON_SOURCE}" and changed_by_human=true`;
            console.log(`⏭️  Skipping learning comparison for ${submission_id}: ${skipReason}`);
            return res.status(200).json({
                success: true,
                skipped: true,
                skip_reason: skipReason,
                submission_id,
                training_data_saved: false,
                learned_rules_active: (await readLearnedRulesSnapshot()).active_rules.length,
            });
        }

        console.log(`📊 Analyzing differences for submission ${submission_id}`);

        const aiDraftText = await extractText(ai_draft_path);
        const finalText = await extractText(final_path);
        const differences = analyzeDocuments(aiDraftText, finalText);
        const replacements = extractReplacementSignals(aiDraftText, finalText);

        if (!differences.hasChanges) {
            const skipReason = 'final approved document matches the AI draft';
            console.log(`⏭️  Skipping learning comparison for ${submission_id}: ${skipReason}`);
            return res.status(200).json({
                success: true,
                skipped: true,
                skip_reason: skipReason,
                submission_id,
                differences: differences.summary,
                training_data_saved: false,
                replacement_signals: 0,
                learned_rules_active: (await readLearnedRulesSnapshot()).active_rules.length,
            });
        }

        const trainingEntry: TrainingEntry = {
            submission_id,
            timestamp: new Date().toISOString(),
            ai_draft_length: aiDraftText.length,
            final_length: finalText.length,
            changes_detected: differences.hasChanges,
            change_percentage: differences.changePercentage,
            ...(original_path ? { original_path } : {}),
            ai_draft_path,
            final_path,
            comparison_source: comparisonSource,
            ...(reviewSource ? { review_source: reviewSource } : {}),
            ...(reviewCompletedAt ? { review_completed_at: reviewCompletedAt } : {}),
            changed_by_human: true,
            learning_eligible: true,
            analysis: differences.summary,
            learning_signals: {
                replacements,
                replacement_count: replacements.length,
            },
        };
        trainingEntry.comparison_key = buildLearningComparisonKey(trainingEntry);

        const saveResult = await saveTrainingEntry(trainingEntry);

        const detailPath = path.join(DIFFERENCES_DIR, `${submission_id}-comparison.json`);
        await fs.writeFile(
            detailPath,
            JSON.stringify(
                {
                    ...trainingEntry,
                    ai_draft_excerpt: aiDraftText.substring(0, 700),
                    final_excerpt: finalText.substring(0, 700),
                },
                null,
                2
            )
        );

        const learnedRules = await rebuildLearnedRules();

        console.log(`✅ Comparison complete for ${submission_id}`);
        console.log(`   Changes detected: ${differences.hasChanges ? 'YES' : 'NO'}`);
        console.log(`   Replacement signals: ${replacements.length}`);
        if (saveResult.replaced_entries > 0) {
            console.log(`   Replaced ${saveResult.replaced_entries} earlier comparison entr${saveResult.replaced_entries === 1 ? 'y' : 'ies'} for this submission/source`);
        }

        res.status(200).json({
            success: true,
            skipped: false,
            submission_id,
            differences: differences.summary,
            training_data_saved: true,
            replaced_training_entries: saveResult.replaced_entries,
            replacement_signals: replacements.length,
            learned_rules_active: learnedRules.active_rules.length,
            detail_path: detailPath,
        });
    } catch (error) {
        console.error('Error comparing documents:', error);
        res.status(500).json({ error: 'Failed to compare documents' });
    }
});

app.get('/stats', async (_req, res) => {
    try {
        const rawEntries = await readTrainingEntries();
        const entries = getLearningAggregationEntries(rawEntries);
        const comparisonsWithChanges = entries.filter((e) => e.changes_detected).length;

        const stats = {
            total_comparisons: entries.length,
            raw_training_entries: rawEntries.length,
            ineligible_or_duplicate_entries: rawEntries.length - entries.length,
            comparisons_with_changes: comparisonsWithChanges,
            comparisons_without_changes: entries.length - comparisonsWithChanges,
            average_change_percentage:
                entries.reduce((sum, e) => sum + (e.change_percentage || 0), 0) / (entries.length || 1),
            replacement_signals_total: entries.reduce(
                (sum, e) => sum + (e.learning_signals?.replacement_count || 0),
                0
            ),
            latest_comparison: entries[entries.length - 1] || null,
        };

        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

app.get('/training-data', async (_req, res) => {
    try {
        const entries = await readTrainingEntries();
        res.json({
            count: entries.length,
            data: entries,
        });
    } catch (error) {
        console.error('Error getting training data:', error);
        res.status(500).json({ error: 'Failed to get training data' });
    }
});

app.get('/learning/rules', async (_req, res) => {
    try {
        const snapshot = await readLearnedRulesSnapshot();
        res.json(snapshot);
    } catch (error) {
        console.error('Error getting learned rules:', error);
        res.status(500).json({ error: 'Failed to get learned rules' });
    }
});

app.get('/learning/rule-examples', async (req, res) => {
    try {
        const originalText = firstQueryValue(req.query.original_text || req.query.from).trim();
        const correctedText = firstQueryValue(req.query.corrected_text || req.query.to).trim();
        const submissionIds = parseSubmissionIdQuery(req.query.submission_ids || req.query.submission_id);
        const limit = clampPositiveInteger(firstQueryValue(req.query.limit), 1, 20, 8);

        if (!originalText || !correctedText) {
            return res.status(400).json({ error: 'original_text and corrected_text are required' });
        }

        const payload = await findRuleExamplesForReplacement({
            originalText,
            correctedText,
            submissionIds,
            limit,
        });

        res.json(payload);
    } catch (error) {
        console.error('Error loading learning rule examples:', error);
        res.status(500).json({ error: 'Failed to load learning rule examples' });
    }
});

// v2: Overlay injection removed. This endpoint returns empty for backward compatibility.
app.get('/learning/overlay', async (_req, res) => {
    res.json({
        generated_at: new Date().toISOString(),
        rules_used: 0,
        overlay: '',
        deprecated: true,
        message: 'Overlay injection removed in v2. Rules now flow through correction_rules table.',
    });
});

app.get('/learning/overrides', async (_req, res) => {
    try {
        const overrides = await readRuleOverrides();
        res.json(overrides);
    } catch (error) {
        console.error('Error loading learning overrides:', error);
        res.status(500).json({ error: 'Failed to load learning overrides' });
    }
});

app.get('/learning/submissions', async (_req, res) => {
    try {
        const entries = getLearningAggregationEntries(await readTrainingEntries());
        const latestBySubmission = new Map<string, TrainingEntry>();

        for (const entry of entries) {
            const existing = latestBySubmission.get(entry.submission_id);
            if (!existing) {
                latestBySubmission.set(entry.submission_id, entry);
                continue;
            }
            const existingTs = new Date(existing.timestamp || 0).getTime();
            const entryTs = new Date(entry.timestamp || 0).getTime();
            if (entryTs >= existingTs) {
                latestBySubmission.set(entry.submission_id, entry);
            }
        }

        const submissions = Array.from(latestBySubmission.values())
            .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
            .map((entry) => ({
                submission_id: entry.submission_id,
                timestamp: entry.timestamp,
                changes_detected: entry.changes_detected,
                change_percentage: entry.change_percentage,
                replacement_count: entry.learning_signals?.replacement_count || 0,
                ai_draft_path: entry.ai_draft_path,
                final_path: entry.final_path,
                comparison_source: entry.comparison_source,
                review_source: entry.review_source,
            }));

        res.json({ count: submissions.length, submissions });
    } catch (error) {
        console.error('Error loading learning submissions:', error);
        res.status(500).json({ error: 'Failed to load learning submissions' });
    }
});

app.delete('/learning/submissions/:submissionId', async (req, res) => {
    try {
        const result = await deleteLearningSubmission(req.params.submissionId);

        if (result.deleted_entries === 0 && !result.deleted_detail_file) {
            return res.status(404).json({
                error: 'Submission not found in learning data',
                submission_id: result.submission_id,
            });
        }

        res.json({
            success: true,
            ...result,
        });
    } catch (error: any) {
        const status = error?.code === 'INVALID_SUBMISSION_ID' ? 400 : 500;
        console.error('Error deleting learning submission:', error.message);
        res.status(status).json({ error: error.message || 'Failed to delete learning submission' });
    }
});

app.get('/learning/submissions/:submissionId', async (req, res) => {
    try {
        const submissionId = `${req.params.submissionId || ''}`.trim();
        const entries = getLearningAggregationEntries(await readTrainingEntries());
        const matches = entries
            .filter((entry) => entry.submission_id === submissionId)
            .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

        const latest = matches[0];
        if (!latest) {
            return res.status(404).json({ error: 'Submission not found in learning data' });
        }

        const aiDraftText = await extractText(latest.ai_draft_path);
        const finalText = await extractText(latest.final_path);
        const lineCorrections = extractLineCorrections(aiDraftText, finalText);
        const dishCorrections = extractDishCorrections(aiDraftText, finalText);

        res.json({
            submission_id: latest.submission_id,
            timestamp: latest.timestamp,
            ai_draft_path: latest.ai_draft_path,
            final_path: latest.final_path,
            change_percentage: latest.change_percentage,
            line_corrections: lineCorrections,
            correction_count: lineCorrections.length,
            dish_corrections: dishCorrections,
            dish_correction_count: dishCorrections.length,
        });
    } catch (error) {
        console.error('Error loading learning submission details:', error);
        res.status(500).json({ error: 'Failed to load submission details' });
    }
});

app.get('/learning/location-rules', async (req, res) => {
    try {
        const submissionId = `${req.query?.submission_id || ''}`.trim();
        const all = await readLocationRules();
        const filtered = submissionId ? all.filter((r) => r.submission_id === submissionId) : all;
        res.json({ count: filtered.length, rules: filtered });
    } catch (error) {
        console.error('Error loading location-specific rules:', error);
        res.status(500).json({ error: 'Failed to load location-specific rules' });
    }
});

app.post('/learning/location-rules', async (req, res) => {
    try {
        const submissionId = `${req.body?.submission_id || ''}`.trim();
        const correctionId = `${req.body?.correction_id || ''}`.trim();
        const beforeLine = `${req.body?.before_line || ''}`.trim();
        const afterLine = `${req.body?.after_line || ''}`.trim();
        const explanation = `${req.body?.explanation || ''}`.trim();
        const restaurantName = `${req.body?.restaurant_name || ''}`.trim();
        const location = `${req.body?.location || ''}`.trim();
        const reviewerName = `${req.body?.reviewer_name || ''}`.trim();
        const tokenChangesRaw = Array.isArray(req.body?.token_changes) ? req.body.token_changes : [];
        const sharedLocationsRaw = Array.isArray(req.body?.shared_locations) ? req.body.shared_locations : [];

        if (!submissionId || !correctionId || !beforeLine || !afterLine || !explanation || !restaurantName || !location) {
            return res.status(400).json({ error: 'submission_id, correction_id, before_line, after_line, explanation, restaurant_name, and location are required' });
        }

        const tokenChanges = tokenChangesRaw.map((item: any) => ({
            from: `${item?.from || ''}`.trim(),
            to: `${item?.to || ''}`.trim(),
            kind: `${item?.kind || ''}`.trim(),
        })).filter((item: any) => item.from && item.to);

        const sharedLocations = sharedLocationsRaw
            .map((item: any) => `${item || ''}`.trim())
            .filter((item: string) => !!item);

        const newRule: LocationSpecificRule = {
            id: `locrule-${Date.now()}`,
            created_at: new Date().toISOString(),
            submission_id: submissionId,
            correction_id: correctionId,
            before_line: beforeLine,
            after_line: afterLine,
            token_changes: tokenChanges,
            explanation,
            restaurant_name: restaurantName,
            location,
            shared_locations: sharedLocations,
            reviewer_name: reviewerName || undefined,
        };

        const allRules = await readLocationRules();
        allRules.push(newRule);
        await fs.writeFile(LOCATION_RULES_FILE, JSON.stringify(allRules, null, 2));
        res.json({ success: true, rule: newRule });
    } catch (error) {
        console.error('Error saving location-specific rule:', error);
        res.status(500).json({ error: 'Failed to save location-specific rule' });
    }
});

app.post('/learning/overrides', async (req, res) => {
    try {
        const ruleKey = `${req.body?.rule_key || ''}`.trim();
        const disabled = !!req.body?.disabled;
        const reason = `${req.body?.reason || ''}`.trim();

        if (!ruleKey || !ruleKey.includes('=>')) {
            return res.status(400).json({ error: 'rule_key is required (format: source=>target)' });
        }

        const overrides = await readRuleOverrides();
        if (disabled) {
            overrides.disabled[ruleKey] = {
                updated_at: new Date().toISOString(),
                reason: reason || undefined,
            };
        } else {
            delete overrides.disabled[ruleKey];
        }

        await fs.writeFile(RULE_OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
        res.json({ success: true, rule_key: ruleKey, disabled });
    } catch (error) {
        console.error('Error saving learning override:', error);
        res.status(500).json({ error: 'Failed to save learning override' });
    }
});

app.post('/learning/recompute-signals', async (_req, res) => {
    try {
        const entries = await readTrainingEntries();
        let recomputed = 0;
        let skipped = 0;
        let replacementCount = 0;

        const refreshed: TrainingEntry[] = [];
        for (const entry of entries) {
            try {
                const aiDraftText = await extractText(entry.ai_draft_path);
                const finalText = await extractText(entry.final_path);
                const replacements = extractReplacementSignals(aiDraftText, finalText);
                replacementCount += replacements.length;
                recomputed += 1;

                refreshed.push({
                    ...entry,
                    ai_draft_length: aiDraftText.length,
                    final_length: finalText.length,
                    changes_detected: aiDraftText.trim() !== finalText.trim(),
                    change_percentage: (() => {
                        const lengthDiff = Math.abs(finalText.length - aiDraftText.length);
                        const maxLen = Math.max(aiDraftText.length, finalText.length) || 1;
                        return (lengthDiff / maxLen) * 100;
                    })(),
                    learning_signals: {
                        replacements,
                        replacement_count: replacements.length,
                    },
                    ...(isHumanReviewLearningEntry(entry) ? { comparison_key: buildLearningComparisonKey(entry) } : {}),
                });
            } catch {
                skipped += 1;
                refreshed.push(entry);
            }
        }

        await writeTrainingEntries(refreshed);
        const snapshot = await rebuildLearnedRules();

        res.json({
            success: true,
            total_entries: entries.length,
            recomputed,
            skipped,
            replacement_signals_total: replacementCount,
            active_rules: snapshot.active_rules.length,
            weak_rules: snapshot.weak_rules.length,
            conflicted_rules: snapshot.conflicted_rules.length,
        });
    } catch (error) {
        console.error('Error recomputing learning signals:', error);
        res.status(500).json({ error: 'Failed to recompute learning signals' });
    }
});

async function extractText(filePath: string): Promise<string> {
    const isDocx = filePath.toLowerCase().endsWith('.docx');
    if (isDocx) {
        try {
            const cleaned = await extractDocxCleanText(filePath);
            if (cleaned) return cleaned;
        } catch (error: any) {
            console.warn(`Differ fallback to Mammoth for ${path.basename(filePath)}: ${error.message}`);
        }
    }

    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

function analyzeDocuments(aiDraft: string, final: string) {
    const lengthDiff = Math.abs(final.length - aiDraft.length);
    const maxLen = Math.max(aiDraft.length, final.length) || 1;
    const changePercentage = (lengthDiff / maxLen) * 100;
    const hasChanges = aiDraft.trim() !== final.trim();

    const summary = {
        identical: !hasChanges,
        ai_draft_words: aiDraft.split(/\s+/).filter(Boolean).length,
        final_words: final.split(/\s+/).filter(Boolean).length,
        word_count_diff: Math.abs(
            aiDraft.split(/\s+/).filter(Boolean).length - final.split(/\s+/).filter(Boolean).length
        ),
        character_count_diff: lengthDiff,
    };

    return {
        hasChanges,
        changePercentage,
        summary,
    };
}

function extractLineCorrections(aiDraft: string, final: string): LineCorrection[] {
    const aiLines = aiDraft.split('\n');
    const finalLines = final.split('\n');
    const lineEdits = diffLines(aiLines, finalLines);
    const corrections: LineCorrection[] = [];
    let counter = 0;

    for (let i = 0; i < lineEdits.length; i += 1) {
        const current = lineEdits[i];
        const next = lineEdits[i + 1];
        if (!current || !next) continue;
        if (current.type !== 'delete' || next.type !== 'insert') continue;

        const pairCount = Math.min(current.lines.length, next.lines.length);
        for (let j = 0; j < pairCount; j += 1) {
            const beforeLine = current.lines[j] || '';
            const afterLine = next.lines[j] || '';
            if (!beforeLine || !afterLine) continue;
            if (!linesLikelySameContext(beforeLine, afterLine)) continue;

            const lineIndex = current.indices[j];
            const replacements = extractLineReplacements(beforeLine, afterLine, lineIndex);
            if (!replacements.length) continue;

            corrections.push({
                correction_id: `${lineIndex}-${counter}`,
                line_index: lineIndex,
                before_line: beforeLine,
                after_line: afterLine,
                token_changes: replacements.map((r) => ({ from: r.from, to: r.to, kind: r.kind })),
            });
            counter += 1;
        }
    }

    return corrections;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildInlineDiffHtml(beforeLine: string, afterLine: string): string {
    const edits = buildTokenEdits(tokenizeDiffText(beforeLine), tokenizeDiffText(afterLine));
    const parts: string[] = [];

    for (const edit of edits) {
        const text = escapeHtml(edit.tokens.map((token) => token.value).join(''));
        if (edit.type === 'equal') {
            parts.push(text);
        } else if (edit.type === 'delete') {
            parts.push(`<span style="color:#c62828;text-decoration:line-through">${text}</span>`);
        } else if (edit.type === 'insert') {
            parts.push(`<span style="background:#fff176;padding:0 1px">${text}</span>`);
        }
    }
    return parts.join('');
}

function extractDishCorrections(aiDraft: string, final: string): DishCorrection[] {
    const aiLines = aiDraft.split('\n');
    const finalLines = final.split('\n');
    const lineEdits = diffLines(aiLines, finalLines);
    const corrections: DishCorrection[] = [];
    let counter = 0;

    for (let i = 0; i < lineEdits.length; i += 1) {
        const current = lineEdits[i];
        if (!current) continue;

        if (current.type === 'equal') continue;

        const next = lineEdits[i + 1];

        // Delete→insert pair: modified lines
        if (current.type === 'delete' && next && next.type === 'insert') {
            const pairCount = Math.max(current.lines.length, next.lines.length);
            for (let j = 0; j < pairCount; j += 1) {
                const beforeLine = current.lines[j] || '';
                const afterLine = next.lines[j] || '';

                // Skip empty pairs
                if (!beforeLine.trim() && !afterLine.trim()) continue;

                if (beforeLine && afterLine) {
                    // Modified: both before and after exist
                    corrections.push({
                        correction_id: `dish-${counter}`,
                        line_index: current.indices[j] ?? 0,
                        before_line: beforeLine,
                        after_line: afterLine,
                        diff_html: buildInlineDiffHtml(beforeLine, afterLine),
                        change_type: 'modified',
                    });
                } else if (beforeLine && !afterLine) {
                    // Extra deleted line (more deletes than inserts)
                    corrections.push({
                        correction_id: `dish-${counter}`,
                        line_index: current.indices[j] ?? 0,
                        before_line: beforeLine,
                        after_line: '',
                        diff_html: `<span style="color:#c62828;text-decoration:line-through">${escapeHtml(beforeLine)}</span>`,
                        change_type: 'removed',
                    });
                } else if (!beforeLine && afterLine) {
                    // Extra inserted line (more inserts than deletes)
                    corrections.push({
                        correction_id: `dish-${counter}`,
                        line_index: 0,
                        before_line: '',
                        after_line: afterLine,
                        diff_html: `<span style="background:#fff176;padding:0 1px">${escapeHtml(afterLine)}</span>`,
                        change_type: 'added',
                    });
                }
                counter += 1;
            }
            i += 1; // Skip the insert block since we processed it
            continue;
        }

        // Pure delete (no following insert): removed lines
        if (current.type === 'delete') {
            for (let j = 0; j < current.lines.length; j += 1) {
                const line = current.lines[j];
                if (!line.trim()) continue;
                corrections.push({
                    correction_id: `dish-${counter}`,
                    line_index: current.indices[j] ?? 0,
                    before_line: line,
                    after_line: '',
                    diff_html: `<span style="color:#c62828;text-decoration:line-through">${escapeHtml(line)}</span>`,
                    change_type: 'removed',
                });
                counter += 1;
            }
            continue;
        }

        // Pure insert (no preceding delete): added lines
        if (current.type === 'insert') {
            for (let j = 0; j < current.lines.length; j += 1) {
                const line = current.lines[j];
                if (!line.trim()) continue;
                corrections.push({
                    correction_id: `dish-${counter}`,
                    line_index: 0,
                    before_line: '',
                    after_line: line,
                    diff_html: `<span style="background:#fff176;padding:0 1px">${escapeHtml(line)}</span>`,
                    change_type: 'added',
                });
                counter += 1;
            }
        }
    }

    return corrections;
}

async function readTrainingEntries(): Promise<TrainingEntry[]> {
    const content = await fs.readFile(TRAINING_DATA_FILE, 'utf-8');
    return content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line) as TrainingEntry;
            } catch {
                return null;
            }
        })
        .filter((entry): entry is TrainingEntry => entry !== null);
}

async function writeTrainingEntries(entries: TrainingEntry[]): Promise<void> {
    const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
    await fs.writeFile(TRAINING_DATA_FILE, lines ? `${lines}\n` : '');
}

async function saveTrainingEntry(entry: TrainingEntry): Promise<{ replaced_entries: number; total_entries: number }> {
    const existingEntries = await readTrainingEntries();
    const result = upsertTrainingEntry(existingEntries, entry);
    await writeTrainingEntries(result.entries);

    return {
        replaced_entries: result.replaced_entries,
        total_entries: result.entries.length,
    };
}

type RuleExampleRecord = ReplacementExample & {
    submission_id: string;
    timestamp: string;
    ai_draft_path: string;
    final_path: string;
    evidence_source: 'ai_draft_vs_final_approved_docx';
    comparison_source?: string;
    review_source?: string;
};

function firstQueryValue(value: any): string {
    if (Array.isArray(value)) {
        return `${value[0] || ''}`;
    }
    return `${value || ''}`;
}

function parseSubmissionIdQuery(value: any): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    const ids = rawValues
        .flatMap((item) => `${item || ''}`.split(','))
        .map((item) => item.trim())
        .filter((item) => item && /^[A-Za-z0-9_-]+$/.test(item));

    return Array.from(new Set(ids));
}

function clampPositiveInteger(value: string, min: number, max: number, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeEvidenceToken(token: string): string {
    return (token || '').toLowerCase().replace(/[’'`]/g, "'").trim();
}

async function findRuleExamplesForReplacement(input: {
    originalText: string;
    correctedText: string;
    submissionIds: string[];
    limit: number;
}): Promise<{
    original_text: string;
    corrected_text: string;
    evidence_source: 'ai_draft_vs_final_approved_docx';
    count: number;
    examples: RuleExampleRecord[];
    searched_submission_ids: string[];
    errors: Array<{ submission_id: string; error: string }>;
}> {
    const entries = getLearningAggregationEntries(await readTrainingEntries());
    const submissionFilter = new Set(input.submissionIds);
    const fromNorm = normalizeEvidenceToken(input.originalText);
    const toNorm = normalizeEvidenceToken(input.correctedText);
    const examples: RuleExampleRecord[] = [];
    const errors: Array<{ submission_id: string; error: string }> = [];
    const searchedSubmissionIds = new Set<string>();

    const candidates = entries
        .filter((entry) => !submissionFilter.size || submissionFilter.has(entry.submission_id))
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    for (const entry of candidates) {
        if (examples.length >= input.limit) break;

        const storedReplacements = entry.learning_signals?.replacements || [];
        const hasStoredSignal = storedReplacements.some((rep) =>
            rep.from_norm === fromNorm && rep.to_norm === toNorm
        );

        if (!hasStoredSignal && (!submissionFilter.size || storedReplacements.length > 0)) {
            continue;
        }

        searchedSubmissionIds.add(entry.submission_id);

        try {
            const aiDraftText = await extractText(entry.ai_draft_path);
            const finalText = await extractText(entry.final_path);
            const matches = extractReplacementExamples(aiDraftText, finalText, input.originalText, input.correctedText);

            for (const match of matches) {
                examples.push({
                    ...match,
                    submission_id: entry.submission_id,
                    timestamp: entry.timestamp,
                    ai_draft_path: entry.ai_draft_path,
                    final_path: entry.final_path,
                    evidence_source: 'ai_draft_vs_final_approved_docx',
                    comparison_source: entry.comparison_source,
                    review_source: entry.review_source,
                });
                if (examples.length >= input.limit) break;
            }
        } catch (error: any) {
            errors.push({
                submission_id: entry.submission_id,
                error: error?.message || 'failed to extract comparison text',
            });
        }
    }

    return {
        original_text: input.originalText,
        corrected_text: input.correctedText,
        evidence_source: 'ai_draft_vs_final_approved_docx',
        count: examples.length,
        examples,
        searched_submission_ids: Array.from(searchedSubmissionIds),
        errors,
    };
}

async function readLearnedRulesSnapshot(): Promise<LearnedRulesSnapshot> {
    const content = await fs.readFile(LEARNED_RULES_FILE, 'utf-8');
    return JSON.parse(content) as LearnedRulesSnapshot;
}

export async function deleteLearningSubmission(submissionId: string): Promise<{
    submission_id: string;
    deleted_entries: number;
    deleted_detail_file: boolean;
    remaining_entries: number;
    total_rules: number;
}> {
    return deleteLearningSubmissionFromFiles({
        submissionId,
        differencesDir: DIFFERENCES_DIR,
        trainingDataFile: TRAINING_DATA_FILE,
        rebuildSnapshot: rebuildLearnedRules,
    });
}

async function readLocationRules(): Promise<LocationSpecificRule[]> {
    const content = await fs.readFile(LOCATION_RULES_FILE, 'utf-8');
    const parsed = JSON.parse(content || '[]');
    return Array.isArray(parsed) ? parsed : [];
}

async function rebuildLearnedRules(): Promise<LearnedRulesSnapshot> {
    const entries = getLearningAggregationEntries(await readTrainingEntries());

    const pairMap = new Map<
        string,
        {
            source: string;
            target: string;
            source_norm: string;
            target_norm: string;
            kind: LearnedRule['kind'];
            occurrences: number;
            submissions: Set<string>;
            last_seen_at: string;
        }
    >();
    const sourceTotals = new Map<string, number>();

    for (const entry of entries) {
        const replacements = entry.learning_signals?.replacements || [];
        for (const rep of replacements) {
            const key = `${rep.from_norm}=>${rep.to_norm}`;
            const sourceTotal = sourceTotals.get(rep.from_norm) || 0;
            sourceTotals.set(rep.from_norm, sourceTotal + 1);

            const existing = pairMap.get(key);
            if (existing) {
                existing.occurrences += 1;
                existing.submissions.add(entry.submission_id);
                existing.last_seen_at = entry.timestamp;
            } else {
                pairMap.set(key, {
                    source: rep.from,
                    target: rep.to,
                    source_norm: rep.from_norm,
                    target_norm: rep.to_norm,
                    kind: rep.kind,
                    occurrences: 1,
                    submissions: new Set([entry.submission_id]),
                    last_seen_at: entry.timestamp,
                });
            }
        }
    }

    const allRules: LearnedRule[] = [];
    for (const data of pairMap.values()) {
        const sourceTotal = sourceTotals.get(data.source_norm) || 1;
        const dominanceRatio = data.occurrences / sourceTotal;
        const submissionCount = data.submissions.size;

        let status: LearnedRule['status'] = 'active';
        if (data.occurrences < MIN_OCCURRENCES) status = 'weak';
        if (dominanceRatio < 0.6) status = 'conflicted';

        const confidence = clamp(
            0.4 +
                Math.min(0.35, data.occurrences * 0.08) +
                Math.min(0.15, submissionCount * 0.04) +
                (data.kind === 'diacritic' ? 0.08 : 0) -
                (status === 'conflicted' ? 0.18 : 0),
            0.2,
            0.98
        );

        allRules.push({
            source: data.source,
            target: data.target,
            source_norm: data.source_norm,
            target_norm: data.target_norm,
            kind: data.kind,
            occurrences: data.occurrences,
            submission_count: submissionCount,
            confidence,
            dominance_ratio: dominanceRatio,
            last_seen_at: data.last_seen_at,
            status,
        });
    }

    const activeRules = allRules
        .filter((r) => r.status === 'active')
        .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);
    const weakRules = allRules
        .filter((r) => r.status === 'weak')
        .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);
    const conflictedRules = allRules
        .filter((r) => r.status === 'conflicted')
        .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);

    const snapshot: LearnedRulesSnapshot = {
        generated_at: new Date().toISOString(),
        min_occurrences: MIN_OCCURRENCES,
        total_entries_analyzed: entries.length,
        total_rules: allRules.length,
        active_rules: activeRules,
        weak_rules: weakRules,
        conflicted_rules: conflictedRules,
    };

    await fs.writeFile(LEARNED_RULES_FILE, JSON.stringify(snapshot, null, 2));

    // v2: Propose active rules as system-generated correction_rules in Supabase
    // (fire-and-forget, never blocks the compare response)
    if (isSupabaseConfigured() && activeRules.length > 0) {
        proposeSystemRules(activeRules, pairMap).catch((err) => {
            console.error('System rule proposal failed:', err.message || err);
        });
    }

    return snapshot;
}

async function proposeSystemRules(
    activeRules: LearnedRule[],
    pairMap: Map<string, { submissions: Set<string> }>
): Promise<void> {
    const supabase = getSupabaseClient();
    const CORRECTION_RULES_TABLE = 'correction_rules';

    // Fetch existing system-proposed rules to avoid duplicates
    const { data: existing, error: fetchError } = await supabase
        .from(CORRECTION_RULES_TABLE)
        .select('original_text, corrected_text')
        .eq('source', 'system');

    if (fetchError) {
        console.warn('Could not fetch existing system rules for dedup:', fetchError.message);
        return;
    }

    const existingKeys = new Set(
        (existing || []).map((r: any) => `${(r.original_text || '').toLowerCase()}=>${(r.corrected_text || '').toLowerCase()}`)
    );

    const newProposals: any[] = [];
    for (const rule of activeRules) {
        const dedupKey = `${rule.source.toLowerCase()}=>${rule.target.toLowerCase()}`;
        if (existingKeys.has(dedupKey)) continue;

        const pairData = pairMap.get(`${rule.source_norm}=>${rule.target_norm}`);
        const submissionIds = pairData ? Array.from(pairData.submissions) : [];

        newProposals.push({
            submission_id: submissionIds[submissionIds.length - 1] || 'unknown',
            correction_id: `system-${rule.source_norm}=>${rule.target_norm}`,
            original_text: rule.source,
            corrected_text: rule.target,
            change_type: rule.kind,
            rule: `Always use "${rule.target}" instead of "${rule.source}" (seen ${rule.occurrences}x across ${rule.submission_count} submissions)`,
            is_location_specific: false,
            restaurant_name: '',
            location: 'All properties (global rule)',
            source: 'system',
            status: 'pending',
            occurrences: rule.occurrences,
            confidence: rule.confidence,
            submission_ids: submissionIds,
        });
    }

    if (newProposals.length === 0) return;

    const { error: insertError } = await supabase
        .from(CORRECTION_RULES_TABLE)
        .insert(newProposals);

    if (insertError) {
        console.error('Failed to insert system rule proposals:', insertError.message);
    } else {
        console.log(`Proposed ${newProposals.length} system rules for human review`);
    }
}

async function readRuleOverrides(): Promise<RuleOverrides> {
    const content = await fs.readFile(RULE_OVERRIDES_FILE, 'utf-8');
    const parsed = JSON.parse(content || '{}');
    return {
        disabled: parsed.disabled || {},
    };
}

function getRuleKey(rule: Pick<LearnedRule, 'source_norm' | 'target_norm'>): string {
    return `${rule.source_norm}=>${rule.target_norm}`;
}

function isRuleDisabled(rule: Pick<LearnedRule, 'source_norm' | 'target_norm'>, overrides: RuleOverrides): boolean {
    return !!overrides.disabled[getRuleKey(rule)];
}

function buildPromptOverlay(activeRules: LearnedRule[]): string {
    if (!activeRules.length) return '';

    const lines = activeRules.slice(0, MAX_RULES_IN_OVERLAY).map((rule) => {
        return `- "${rule.source}" -> "${rule.target}" (seen ${rule.occurrences}x)`;
    });

    return [
        '### LEARNED HUMAN REVIEW CORRECTIONS (AUTO-GENERATED)',
        'Apply these conservatively when context matches; do not force a change if uncertain.',
        ...lines,
    ].join('\n');
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

if (require.main === module) {
    app.listen(port, async () => {
        console.log(`🔬 Differ service listening at http://localhost:${port}`);
        console.log(`   Learning data directory: ${DIFFERENCES_DIR}`);
        await initDiffer();
    });
}
