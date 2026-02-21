import express from 'express';
import { promises as fs } from 'fs';
import mammoth from 'mammoth';
import * as path from 'path';

const app = express();
const port = 3006;

const DIFFERENCES_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'learning');
const TRAINING_DATA_FILE = path.join(DIFFERENCES_DIR, 'training_data.jsonl');
const LEARNED_RULES_FILE = path.join(DIFFERENCES_DIR, 'learned_rules.json');
const RULE_OVERRIDES_FILE = path.join(DIFFERENCES_DIR, 'rule_overrides.json');
const MIN_OCCURRENCES = Number(process.env.LEARNING_MIN_OCCURRENCES || 2);
const MAX_RULES_IN_OVERLAY = Number(process.env.LEARNING_MAX_OVERLAY_RULES || 25);

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

async function extractText(filePath: string): Promise<string> {
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
    const maxLines = Math.max(aiLines.length, finalLines.length);
    const replacements: ReplacementSignal[] = [];

    for (let i = 0; i < maxLines; i += 1) {
        const beforeLine = aiLines[i] || '';
        const afterLine = finalLines[i] || '';
        if (normalizeWhitespace(beforeLine) === normalizeWhitespace(afterLine)) {
            continue;
        }

        const lineReplacements = extractLineReplacements(beforeLine, afterLine, i);
        replacements.push(...lineReplacements);
    }

    return dedupeSignals(replacements);
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
    if (!containsLetter(fromNorm) || !containsLetter(toNorm)) return false;
    if (fromNorm.length > 40 || toNorm.length > 40) return false;
    if (isMostlyNumeric(fromNorm) || isMostlyNumeric(toNorm)) return false;

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
