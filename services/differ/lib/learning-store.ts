import { promises as fs } from 'fs';
import * as path from 'path';

export const HUMAN_REVIEW_COMPARISON_SOURCE = 'human_review_final_approval';

export type LearningTrainingEntryLike = {
    submission_id?: string;
    timestamp?: string;
    ai_draft_path?: string;
    final_path?: string;
    comparison_source?: string;
    changed_by_human?: boolean;
    learning_eligible?: boolean;
};

export type LearningSubmissionDeleteResult = {
    submission_id: string;
    deleted_entries: number;
    deleted_detail_file: boolean;
    remaining_entries: number;
    total_rules: number;
};

export function assertValidLearningSubmissionId(submissionId: string): string {
    const normalized = `${submissionId || ''}`.trim();
    if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
        const error: any = new Error('submissionId must contain only letters, numbers, dashes, or underscores');
        error.code = 'INVALID_SUBMISSION_ID';
        throw error;
    }
    return normalized;
}

function normalizeKeyPart(value: unknown): string {
    return `${value || ''}`.trim().toLowerCase();
}

export function buildLearningComparisonKey(entry: LearningTrainingEntryLike): string {
    const submissionId = normalizeKeyPart(entry.submission_id);
    const comparisonSource = normalizeKeyPart(entry.comparison_source) || 'legacy';

    if (submissionId) {
        return JSON.stringify([submissionId, comparisonSource]);
    }

    return JSON.stringify([
        comparisonSource,
        `${entry.ai_draft_path || ''}`.trim(),
        `${entry.final_path || ''}`.trim(),
    ]);
}

export function isHumanReviewLearningEntry(entry: LearningTrainingEntryLike): boolean {
    return entry.learning_eligible === true &&
        entry.changed_by_human === true &&
        normalizeKeyPart(entry.comparison_source) === HUMAN_REVIEW_COMPARISON_SOURCE;
}

export function upsertTrainingEntry<T extends LearningTrainingEntryLike>(
    entries: T[],
    nextEntry: T
): { entries: T[]; replaced_entries: number } {
    const nextKey = buildLearningComparisonKey(nextEntry);
    const retained: T[] = [];
    let replacedEntries = 0;

    for (const entry of entries) {
        if (buildLearningComparisonKey(entry) === nextKey) {
            replacedEntries += 1;
            continue;
        }
        retained.push(entry);
    }

    retained.push(nextEntry);
    return {
        entries: retained,
        replaced_entries: replacedEntries,
    };
}

export function dedupeTrainingEntries<T extends LearningTrainingEntryLike>(entries: T[]): T[] {
    const latestByKey = new Map<string, T>();

    for (const entry of entries) {
        const key = buildLearningComparisonKey(entry);
        const existing = latestByKey.get(key);
        if (!existing) {
            latestByKey.set(key, entry);
            continue;
        }

        const existingTs = new Date(existing.timestamp || 0).getTime();
        const entryTs = new Date(entry.timestamp || 0).getTime();
        if (entryTs >= existingTs) {
            latestByKey.set(key, entry);
        }
    }

    return Array.from(latestByKey.values());
}

export function getLearningAggregationEntries<T extends LearningTrainingEntryLike>(entries: T[]): T[] {
    return dedupeTrainingEntries(entries.filter(isHumanReviewLearningEntry));
}

export async function deleteLearningSubmissionFromFiles(input: {
    submissionId: string;
    differencesDir: string;
    trainingDataFile: string;
    rebuildSnapshot: () => Promise<{ total_rules: number }>;
}): Promise<LearningSubmissionDeleteResult> {
    const normalizedId = assertValidLearningSubmissionId(input.submissionId);
    const content = await fs.readFile(input.trainingDataFile, 'utf-8');
    const entries = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter((entry) => entry !== null);

    const remaining = entries.filter((entry: any) => entry.submission_id !== normalizedId);
    const deletedEntries = entries.length - remaining.length;
    const lines = remaining.map((entry) => JSON.stringify(entry)).join('\n');
    await fs.writeFile(input.trainingDataFile, lines ? `${lines}\n` : '');

    let deletedDetailFile = false;
    const detailPath = path.join(input.differencesDir, `${normalizedId}-comparison.json`);
    try {
        await fs.unlink(detailPath);
        deletedDetailFile = true;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }

    const snapshot = await input.rebuildSnapshot();

    return {
        submission_id: normalizedId,
        deleted_entries: deletedEntries,
        deleted_detail_file: deletedDetailFile,
        remaining_entries: remaining.length,
        total_rules: snapshot.total_rules,
    };
}
