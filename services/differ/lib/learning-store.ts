import { promises as fs } from 'fs';
import * as path from 'path';

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
