import express from 'express';
import { promises as fs } from 'fs';
import mammoth from 'mammoth';
import * as path from 'path';
import * as fsSync from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const app = express();
const port = 3006;
const execAsync = promisify(exec);

const DIFFERENCES_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'learning');
const TRAINING_DATA_FILE = path.join(DIFFERENCES_DIR, 'training_data.jsonl');
const LEARNED_RULES_FILE = path.join(DIFFERENCES_DIR, 'learned_rules.json');
const RULE_OVERRIDES_FILE = path.join(DIFFERENCES_DIR, 'rule_overrides.json');
const LOCATION_RULES_FILE = path.join(DIFFERENCES_DIR, 'location_specific_rules.json');
const MIN_OCCURRENCES = Number(process.env.LEARNING_MIN_OCCURRENCES || 2);
const MAX_RULES_IN_OVERLAY = Number(process.env.LEARNING_MAX_OVERLAY_RULES || 25);
const ALLERGEN_CODE_TOKENS = new Set(['c', 'd', 'e', 'f', 'g', 'n', 'v', 'vg', 'gf', 'df', 'sf', 'nf']);
const STOPWORD_TOKENS = new Set(['of', 'or', 'and', 'the', 'a', 'an', 'to', 'for', 'with', 'may']);

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

type ReplacementSignal = {
    from: string;
    to: string;
    from_norm: string;
    to_norm: string;
    kind: 'diacritic' | 'punctuation' | 'spelling';
    confidence: number;
    line_index: number;
};

type TrainingEntry = {
    submission_id: string;
    timestamp: string;
    ai_draft_length: number;
    final_length: number;
    changes_detected: boolean;
    change_percentage: number;
    ai_draft_path: string;
    final_path: string;
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
    kind: 'diacritic' | 'punctuation' | 'spelling';
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

app.post('/compare', async (req, res) => {
    try {
        const { submission_id, ai_draft_path, final_path } = req.body;

        if (!submission_id || !ai_draft_path || !final_path) {
            return res.status(400).json({
                error: 'Missing required fields: submission_id, ai_draft_path, final_path',
            });
        }

        console.log(`📊 Analyzing differences for submission ${submission_id}`);

        const aiDraftText = await extractText(ai_draft_path);
        const finalText = await extractText(final_path);
        const differences = analyzeDocuments(aiDraftText, finalText);
        const replacements = extractReplacementSignals(aiDraftText, finalText);

        const trainingEntry: TrainingEntry = {
            submission_id,
            timestamp: new Date().toISOString(),
            ai_draft_length: aiDraftText.length,
            final_length: finalText.length,
            changes_detected: differences.hasChanges,
            change_percentage: differences.changePercentage,
            ai_draft_path,
            final_path,
            analysis: differences.summary,
            learning_signals: {
                replacements,
                replacement_count: replacements.length,
            },
        };

        await fs.appendFile(TRAINING_DATA_FILE, `${JSON.stringify(trainingEntry)}\n`);

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

        res.status(200).json({
            success: true,
            submission_id,
            differences: differences.summary,
            training_data_saved: true,
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
        const entries = await readTrainingEntries();
        const comparisonsWithChanges = entries.filter((e) => e.changes_detected).length;

        const stats = {
            total_comparisons: entries.length,
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

app.get('/learning/overlay', async (_req, res) => {
    try {
        const snapshot = await readLearnedRulesSnapshot();
        const overrides = await readRuleOverrides();
        const enabledRules = snapshot.active_rules.filter((r) => !isRuleDisabled(r, overrides));
        const overlay = buildPromptOverlay(enabledRules);
        res.json({
            generated_at: snapshot.generated_at,
            rules_used: enabledRules.length,
            overlay,
        });
    } catch (error) {
        console.error('Error generating learning overlay:', error);
        res.status(500).json({ error: 'Failed to build learning overlay' });
    }
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
        const entries = await readTrainingEntries();
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
            }));

        res.json({ count: submissions.length, submissions });
    } catch (error) {
        console.error('Error loading learning submissions:', error);
        res.status(500).json({ error: 'Failed to load learning submissions' });
    }
});

app.get('/learning/submissions/:submissionId', async (req, res) => {
    try {
        const submissionId = `${req.params.submissionId || ''}`.trim();
        const entries = await readTrainingEntries();
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
                });
            } catch {
                skipped += 1;
                refreshed.push(entry);
            }
        }

        const lines = refreshed.map((entry) => JSON.stringify(entry)).join('\n');
        await fs.writeFile(TRAINING_DATA_FILE, lines ? `${lines}\n` : '');
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

function extractReplacementSignals(aiDraft: string, final: string): ReplacementSignal[] {
    const aiLines = aiDraft.split('\n');
    const finalLines = final.split('\n');
    const replacements: ReplacementSignal[] = [];

    const lineEdits = diffLines(aiLines, finalLines);
    for (let i = 0; i < lineEdits.length; i += 1) {
        const current = lineEdits[i];
        if (!current) continue;

        if (current.type === 'equal') {
            continue;
        }

        const next = lineEdits[i + 1];
        if (!next || current.type !== 'delete' || next.type !== 'insert') continue;

        const pairCount = Math.min(current.lines.length, next.lines.length);
        for (let j = 0; j < pairCount; j += 1) {
            const beforeLine = current.lines[j];
            const afterLine = next.lines[j];
            if (!beforeLine || !afterLine) continue;
            if (!linesLikelySameContext(beforeLine, afterLine)) continue;

            const beforeLineIndex = current.indices[j];
            const lineReplacements = extractLineReplacements(beforeLine, afterLine, beforeLineIndex);
            replacements.push(...lineReplacements);
        }
    }

    return dedupeSignals(replacements);
}

type LineDiffEdit = { type: 'equal' | 'delete' | 'insert'; lines: string[]; indices: number[] };

function diffLines(before: string[], after: string[]): LineDiffEdit[] {
    const beforeNorm = before.map((line) => normalizeLine(line));
    const afterNorm = after.map((line) => normalizeLine(line));
    const m = beforeNorm.length;
    const n = afterNorm.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            if (beforeNorm[i] === afterNorm[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const edits: LineDiffEdit[] = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (beforeNorm[i] === afterNorm[j]) {
            pushLineEdit(edits, 'equal', before[i], i);
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            pushLineEdit(edits, 'delete', before[i], i);
            i += 1;
        } else {
            pushLineEdit(edits, 'insert', after[j], j);
            j += 1;
        }
    }

    while (i < m) {
        pushLineEdit(edits, 'delete', before[i], i);
        i += 1;
    }
    while (j < n) {
        pushLineEdit(edits, 'insert', after[j], j);
        j += 1;
    }

    return edits;
}

function pushLineEdit(edits: LineDiffEdit[], type: LineDiffEdit['type'], line: string, idx: number): void {
    const last = edits[edits.length - 1];
    if (last && last.type === type) {
        last.lines.push(line);
        last.indices.push(idx);
        return;
    }
    edits.push({ type, lines: [line], indices: [idx] });
}

function normalizeLine(line: string): string {
    return normalizeWhitespace(stripDiacritics((line || '').toLowerCase()));
}

function linesLikelySameContext(beforeLine: string, afterLine: string): boolean {
    const beforeTokens = tokenize(beforeLine).map((t) => normalizeToken(stripDiacritics(t))).filter(Boolean);
    const afterTokens = tokenize(afterLine).map((t) => normalizeToken(stripDiacritics(t))).filter(Boolean);
    if (!beforeTokens.length || !afterTokens.length) return false;

    const beforeSet = new Set(beforeTokens);
    let overlap = 0;
    for (const token of afterTokens) {
        if (beforeSet.has(token)) overlap += 1;
    }
    const ratio = overlap / Math.max(beforeTokens.length, afterTokens.length);
    return ratio >= 0.5;
}

function extractLineReplacements(before: string, after: string, lineIndex: number): ReplacementSignal[] {
    const beforeTokens = tokenize(before);
    const afterTokens = tokenize(after);

    const edits = diffTokens(beforeTokens, afterTokens);
    const replacements: ReplacementSignal[] = [];

    for (let i = 0; i < edits.length; i += 1) {
        const current = edits[i];
        const next = edits[i + 1];

        if (!current || !next) continue;
        if (current.type !== 'delete' || next.type !== 'insert') continue;

        const pairCount = Math.min(current.tokens.length, next.tokens.length);
        for (let j = 0; j < pairCount; j += 1) {
            const from = current.tokens[j];
            const to = next.tokens[j];
            if (!isHighSignalReplacement(from, to)) continue;

            const kind = classifyReplacementKind(from, to);
            replacements.push({
                from,
                to,
                from_norm: normalizeToken(from),
                to_norm: normalizeToken(to),
                kind,
                confidence: baseSignalConfidence(from, to, kind),
                line_index: lineIndex,
            });
        }
    }

    return replacements;
}

function tokenize(line: string): string[] {
    const matches = line.match(/[\p{L}\p{N}]+(?:[’'`-][\p{L}\p{N}]+)*/gu);
    return matches || [];
}

type DiffEdit = { type: 'equal' | 'delete' | 'insert'; tokens: string[] };

function diffTokens(before: string[], after: string[]): DiffEdit[] {
    const beforeNorm = before.map((t) => normalizeToken(t));
    const afterNorm = after.map((t) => normalizeToken(t));
    const m = beforeNorm.length;
    const n = afterNorm.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            if (beforeNorm[i] === afterNorm[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const edits: DiffEdit[] = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (beforeNorm[i] === afterNorm[j]) {
            pushEdit(edits, 'equal', before[i]);
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            pushEdit(edits, 'delete', before[i]);
            i += 1;
        } else {
            pushEdit(edits, 'insert', after[j]);
            j += 1;
        }
    }

    while (i < m) {
        pushEdit(edits, 'delete', before[i]);
        i += 1;
    }
    while (j < n) {
        pushEdit(edits, 'insert', after[j]);
        j += 1;
    }

    return edits;
}

function pushEdit(edits: DiffEdit[], type: DiffEdit['type'], token: string): void {
    const last = edits[edits.length - 1];
    if (last && last.type === type) {
        last.tokens.push(token);
        return;
    }
    edits.push({ type, tokens: [token] });
}

function normalizeToken(token: string): string {
    return (token || '').toLowerCase().replace(/[’'`]/g, "'").trim();
}

function normalizeWhitespace(input: string): string {
    return (input || '').replace(/\s+/g, ' ').trim();
}

function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) dp[i][0] = i;
    for (let j = 0; j <= n; j += 1) dp[0][j] = j;

    for (let i = 1; i <= m; i += 1) {
        for (let j = 1; j <= n; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function containsLetter(input: string): boolean {
    return /[\p{L}]/u.test(input);
}

function isMostlyNumeric(input: string): boolean {
    const compact = (input || '').replace(/[^\p{N}]/gu, '');
    return compact.length > 0 && compact.length >= Math.ceil((input || '').length * 0.6);
}

function isHighSignalReplacement(from: string, to: string): boolean {
    const fromNorm = normalizeToken(from);
    const toNorm = normalizeToken(to);
    if (!fromNorm || !toNorm) return false;
    if (fromNorm === toNorm) return false;
    if (fromNorm.length < 3 || toNorm.length < 3) return false;
    if (!containsLetter(fromNorm) || !containsLetter(toNorm)) return false;
    if (fromNorm.length > 40 || toNorm.length > 40) return false;
    if (isMostlyNumeric(fromNorm) || isMostlyNumeric(toNorm)) return false;
    if (STOPWORD_TOKENS.has(fromNorm) || STOPWORD_TOKENS.has(toNorm)) return false;
    if (ALLERGEN_CODE_TOKENS.has(fromNorm) || ALLERGEN_CODE_TOKENS.has(toNorm)) return false;

    const fromPlain = stripDiacritics(fromNorm);
    const toPlain = stripDiacritics(toNorm);
    if (fromPlain === toPlain) return true;

    const fromNoPunc = fromPlain.replace(/[^a-z0-9]/g, '');
    const toNoPunc = toPlain.replace(/[^a-z0-9]/g, '');
    if (fromNoPunc && fromNoPunc === toNoPunc) return true;

    const distance = levenshteinDistance(fromPlain, toPlain);
    const maxLen = Math.max(fromPlain.length, toPlain.length) || 1;
    return distance <= 3 || distance / maxLen <= 0.4;
}

function classifyReplacementKind(from: string, to: string): 'diacritic' | 'punctuation' | 'spelling' {
    const fromNorm = normalizeToken(from);
    const toNorm = normalizeToken(to);
    const fromPlain = stripDiacritics(fromNorm);
    const toPlain = stripDiacritics(toNorm);

    if (fromPlain === toPlain && fromNorm !== toNorm) return 'diacritic';
    const fromNoPunc = fromPlain.replace(/[^a-z0-9]/g, '');
    const toNoPunc = toPlain.replace(/[^a-z0-9]/g, '');
    if (fromNoPunc === toNoPunc && fromNorm !== toNorm) return 'punctuation';
    return 'spelling';
}

function baseSignalConfidence(from: string, to: string, kind: ReplacementSignal['kind']): number {
    const fromPlain = stripDiacritics(normalizeToken(from));
    const toPlain = stripDiacritics(normalizeToken(to));
    const distance = levenshteinDistance(fromPlain, toPlain);
    const maxLen = Math.max(fromPlain.length, toPlain.length) || 1;
    const ratio = distance / maxLen;

    let confidence = 0.55;
    if (kind === 'diacritic') confidence += 0.2;
    if (kind === 'punctuation') confidence += 0.1;
    if (ratio <= 0.2) confidence += 0.15;
    if (ratio > 0.5) confidence -= 0.15;
    return clamp(confidence, 0.35, 0.95);
}

function dedupeSignals(signals: ReplacementSignal[]): ReplacementSignal[] {
    const seen = new Set<string>();
    const out: ReplacementSignal[] = [];

    for (const signal of signals) {
        const key = `${signal.from_norm}=>${signal.to_norm}@${signal.line_index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(signal);
    }
    return out;
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
    const beforeTokens = tokenizeWithWhitespace(beforeLine);
    const afterTokens = tokenizeWithWhitespace(afterLine);

    const edits = diffTokensFull(beforeTokens, afterTokens);
    const parts: string[] = [];

    for (const edit of edits) {
        const text = escapeHtml(edit.tokens.join(''));
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

/** Tokenize preserving whitespace as separate tokens for readable diffs. */
function tokenizeWithWhitespace(line: string): string[] {
    const matches = line.match(/\S+|\s+/g);
    return matches || [];
}

/** Diff two token arrays without any filtering — returns all edits. */
function diffTokensFull(before: string[], after: string[]): Array<{ type: 'equal' | 'delete' | 'insert'; tokens: string[] }> {
    const m = before.length;
    const n = after.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            if (before[i] === after[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const edits: Array<{ type: 'equal' | 'delete' | 'insert'; tokens: string[] }> = [];
    let i = 0;
    let j = 0;

    function push(type: 'equal' | 'delete' | 'insert', token: string) {
        const last = edits[edits.length - 1];
        if (last && last.type === type) {
            last.tokens.push(token);
        } else {
            edits.push({ type, tokens: [token] });
        }
    }

    while (i < m && j < n) {
        if (before[i] === after[j]) {
            push('equal', before[i]);
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            push('delete', before[i]);
            i += 1;
        } else {
            push('insert', after[j]);
            j += 1;
        }
    }
    while (i < m) { push('delete', before[i]); i += 1; }
    while (j < n) { push('insert', after[j]); j += 1; }

    return edits;
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

async function readLearnedRulesSnapshot(): Promise<LearnedRulesSnapshot> {
    const content = await fs.readFile(LEARNED_RULES_FILE, 'utf-8');
    return JSON.parse(content) as LearnedRulesSnapshot;
}

async function readLocationRules(): Promise<LocationSpecificRule[]> {
    const content = await fs.readFile(LOCATION_RULES_FILE, 'utf-8');
    const parsed = JSON.parse(content || '[]');
    return Array.isArray(parsed) ? parsed : [];
}

async function rebuildLearnedRules(): Promise<LearnedRulesSnapshot> {
    const entries = await readTrainingEntries();

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
    return snapshot;
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

app.listen(port, async () => {
    console.log(`🔬 Differ service listening at http://localhost:${port}`);
    console.log(`   Learning data directory: ${DIFFERENCES_DIR}`);
    await initDiffer();
});
