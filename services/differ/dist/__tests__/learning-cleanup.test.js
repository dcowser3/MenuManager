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
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const learning_store_1 = require("../lib/learning-store");
describe('learning cleanup', () => {
    let tempDir;
    let trainingDataFile;
    beforeEach(async () => {
        tempDir = await fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'menumanager-learning-'));
        trainingDataFile = path.join(tempDir, 'training_data.jsonl');
    });
    afterEach(async () => {
        await fs_1.promises.rm(tempDir, { recursive: true, force: true });
    });
    test('deletes one learned submission and rebuilds the snapshot', async () => {
        await fs_1.promises.writeFile(trainingDataFile, [
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
        ].join('\n'));
        await fs_1.promises.writeFile(path.join(tempDir, 'delete-1-comparison.json'), '{"submission_id":"delete-1"}');
        const result = await (0, learning_store_1.deleteLearningSubmissionFromFiles)({
            submissionId: 'delete-1',
            differencesDir: tempDir,
            trainingDataFile,
            rebuildSnapshot: async () => {
                await fs_1.promises.writeFile(path.join(tempDir, 'learned_rules.json'), JSON.stringify({
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
        const remainingLines = (await fs_1.promises.readFile(trainingDataFile, 'utf-8'))
            .split('\n')
            .filter(Boolean);
        expect(remainingLines).toHaveLength(1);
        expect(JSON.parse(remainingLines[0]).submission_id).toBe('keep-1');
        await expect(fs_1.promises.access(path.join(tempDir, 'delete-1-comparison.json'))).rejects.toThrow();
        const snapshot = JSON.parse(await fs_1.promises.readFile(path.join(tempDir, 'learned_rules.json'), 'utf-8'));
        expect(snapshot.total_entries_analyzed).toBe(1);
        expect(snapshot.total_rules).toBe(0);
    });
    test('rejects unsafe submission ids', async () => {
        await fs_1.promises.writeFile(trainingDataFile, '');
        await expect((0, learning_store_1.deleteLearningSubmissionFromFiles)({
            submissionId: '../submissions',
            differencesDir: tempDir,
            trainingDataFile,
            rebuildSnapshot: async () => ({ total_rules: 0 }),
        })).rejects.toThrow('submissionId must contain only');
    });
    test('keys human-review comparisons once per submission/source', () => {
        const firstEntry = {
            submission_id: 'sub-1',
            timestamp: '2026-05-10T10:00:00.000Z',
            comparison_source: learning_store_1.HUMAN_REVIEW_COMPARISON_SOURCE,
            ai_draft_path: '/tmp/sub-1-draft.docx',
            final_path: '/tmp/sub-1-approved-a.docx',
        };
        const secondEntry = {
            ...firstEntry,
            timestamp: '2026-05-10T10:05:00.000Z',
            final_path: '/tmp/sub-1-approved-b.docx',
        };
        expect((0, learning_store_1.buildLearningComparisonKey)(firstEntry)).toBe((0, learning_store_1.buildLearningComparisonKey)(secondEntry));
    });
    test('upserts duplicate human-review training entries instead of appending counts', () => {
        const originalEntry = {
            submission_id: 'sub-1',
            timestamp: '2026-05-10T10:00:00.000Z',
            comparison_source: learning_store_1.HUMAN_REVIEW_COMPARISON_SOURCE,
            changed_by_human: true,
            learning_eligible: true,
            ai_draft_path: '/tmp/sub-1-draft.docx',
            final_path: '/tmp/sub-1-approved-a.docx',
            learning_signals: { replacement_count: 1 },
        };
        const repeatedEntry = {
            ...originalEntry,
            timestamp: '2026-05-10T10:05:00.000Z',
            final_path: '/tmp/sub-1-approved-b.docx',
            learning_signals: { replacement_count: 2 },
        };
        const result = (0, learning_store_1.upsertTrainingEntry)([originalEntry], repeatedEntry);
        expect(result.replaced_entries).toBe(1);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].final_path).toBe('/tmp/sub-1-approved-b.docx');
        expect(result.entries[0].learning_signals.replacement_count).toBe(2);
    });
    test('learning aggregation ignores legacy and ineligible entries before deduping', () => {
        const entries = [
            {
                submission_id: 'legacy-1',
                timestamp: '2026-05-10T10:00:00.000Z',
                ai_draft_path: '/tmp/legacy-draft.docx',
                final_path: '/tmp/legacy-final.docx',
                learning_signals: { replacement_count: 5 },
            },
            {
                submission_id: 'sub-1',
                timestamp: '2026-05-10T10:00:00.000Z',
                comparison_source: learning_store_1.HUMAN_REVIEW_COMPARISON_SOURCE,
                changed_by_human: true,
                learning_eligible: true,
                ai_draft_path: '/tmp/sub-1-draft.docx',
                final_path: '/tmp/sub-1-approved-a.docx',
                learning_signals: { replacement_count: 1 },
            },
            {
                submission_id: 'sub-1',
                timestamp: '2026-05-10T10:05:00.000Z',
                comparison_source: learning_store_1.HUMAN_REVIEW_COMPARISON_SOURCE,
                changed_by_human: true,
                learning_eligible: true,
                ai_draft_path: '/tmp/sub-1-draft.docx',
                final_path: '/tmp/sub-1-approved-b.docx',
                learning_signals: { replacement_count: 2 },
            },
            {
                submission_id: 'sub-2',
                timestamp: '2026-05-10T10:10:00.000Z',
                comparison_source: learning_store_1.HUMAN_REVIEW_COMPARISON_SOURCE,
                changed_by_human: false,
                learning_eligible: true,
                ai_draft_path: '/tmp/sub-2-draft.docx',
                final_path: '/tmp/sub-2-final.docx',
                learning_signals: { replacement_count: 3 },
            },
        ];
        const eligible = (0, learning_store_1.getLearningAggregationEntries)(entries);
        expect(eligible).toHaveLength(1);
        expect(eligible[0].submission_id).toBe('sub-1');
        expect(eligible[0].final_path).toBe('/tmp/sub-1-approved-b.docx');
    });
});
