import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteLearningSubmissionFromFiles } from '../lib/learning-store';

describe('learning cleanup', () => {
    let tempDir: string;
    let trainingDataFile: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'menumanager-learning-'));
        trainingDataFile = path.join(tempDir, 'training_data.jsonl');
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('deletes one learned submission and rebuilds the snapshot', async () => {
        await fs.writeFile(
            trainingDataFile,
            [
                JSON.stringify({
                    submission_id: 'keep-1',
                    timestamp: '2026-05-10T10:00:00.000Z',
                    changes_detected: true,
                    change_percentage: 1,
                    ai_draft_path: '/tmp/keep-draft.docx',
                    final_path: '/tmp/keep-final.docx',
                    analysis: {},
                    learning_signals: { replacements: [], replacement_count: 0 },
                }),
                JSON.stringify({
                    submission_id: 'delete-1',
                    timestamp: '2026-05-11T10:00:00.000Z',
                    changes_detected: true,
                    change_percentage: 2,
                    ai_draft_path: '/tmp/delete-draft.docx',
                    final_path: '/tmp/delete-final.docx',
                    analysis: {},
                    learning_signals: { replacements: [], replacement_count: 0 },
                }),
                '',
            ].join('\n')
        );
        await fs.writeFile(path.join(tempDir, 'delete-1-comparison.json'), '{"submission_id":"delete-1"}');

        const result = await deleteLearningSubmissionFromFiles({
            submissionId: 'delete-1',
            differencesDir: tempDir,
            trainingDataFile,
            rebuildSnapshot: async () => {
                await fs.writeFile(path.join(tempDir, 'learned_rules.json'), JSON.stringify({
                    total_entries_analyzed: 1,
                    total_rules: 0,
                }));
                return { total_rules: 0 };
            },
        });

        expect(result).toEqual(expect.objectContaining({
            submission_id: 'delete-1',
            deleted_entries: 1,
            deleted_detail_file: true,
            remaining_entries: 1,
        }));

        const remainingLines = (await fs.readFile(trainingDataFile, 'utf-8'))
            .split('\n')
            .filter(Boolean);
        expect(remainingLines).toHaveLength(1);
        expect(JSON.parse(remainingLines[0]).submission_id).toBe('keep-1');
        await expect(fs.access(path.join(tempDir, 'delete-1-comparison.json'))).rejects.toThrow();

        const snapshot = JSON.parse(await fs.readFile(path.join(tempDir, 'learned_rules.json'), 'utf-8'));
        expect(snapshot.total_entries_analyzed).toBe(1);
        expect(snapshot.total_rules).toBe(0);
    });

    test('rejects unsafe submission ids', async () => {
        await fs.writeFile(trainingDataFile, '');
        await expect(deleteLearningSubmissionFromFiles({
            submissionId: '../submissions',
            differencesDir: tempDir,
            trainingDataFile,
            rebuildSnapshot: async () => ({ total_rules: 0 }),
        })).rejects.toThrow('submissionId must contain only');
    });
});
