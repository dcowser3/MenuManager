import { loadComparisonSource } from '../lib/comparison-source';
import { comparisonRevision, LEARNING_EDITOR_BASELINE_STAGE, LEARNING_SOURCE_STAGE, sha256Text } from '../lib/learning-source-revision';
import { diffLines } from '../lib/learning-signals';

function changedLines(source: string, final: string): string[] {
    return diffLines(source.split('\n'), final.split('\n'))
        .filter((edit) => edit.type !== 'equal')
        .flatMap((edit) => edit.lines.map((line) => `${edit.type === 'delete' ? '-' : '+'}${line}`));
}

// Shape of the Fairmont Chicago breakfast case (Oct 2026): the AI draft added a
// raw marker and fixed a typo the chef declined; the reviewer only fixed VG.
const AI_DRAFT = [
    'Freshly Pressed Specialty Juice 10',
    'sunflower seeds, radish, whole grain toast* D,G 26',
    'Tres Leches Pancakes, maple syrup D,G,N,V 19',
].join('\n');
const EDITOR_BASELINE = [
    'Freshy Pressed Specialty Juice 10',
    'sunflower seeds, radish, whole grain toast D,G 26',
    'Tres Leches Pancakes, maple syrup D,G,N,V 19',
].join('\n');
const FINAL = [
    'Freshy Pressed Specialty Juice 10',
    'sunflower seeds, radish, whole grain toast D,G 26',
    'Tres Leches Pancakes, maple syrup D,G,N,VG 19',
].join('\n');

function extractors(overrides: Partial<Parameters<typeof loadComparisonSource>[1]> = {}) {
    return {
        extractAiDraftText: jest.fn(async () => AI_DRAFT),
        extractEditorBaselineText: jest.fn(async () => EDITOR_BASELINE),
        fileExists: jest.fn(() => true),
        ...overrides,
    };
}

describe('learning comparison source', () => {
    test('diffs from the submitted DOCX the reviewer edited, not the AI draft', async () => {
        const source = await loadComparisonSource({ aiDraftPath: '/d/x-draft.docx', originalPath: '/d/x.docx' }, extractors());

        expect(source).toEqual({ text: EDITOR_BASELINE, stage: LEARNING_EDITOR_BASELINE_STAGE, path: '/d/x.docx' });
        expect(changedLines(source.text, FINAL)).toEqual([
            '-Tres Leches Pancakes, maple syrup D,G,N,V 19',
            '+Tres Leches Pancakes, maple syrup D,G,N,VG 19',
        ]);
        // The AI-draft baseline also blamed the reviewer for the raw marker and typo.
        expect(changedLines(AI_DRAFT, FINAL)).toEqual(expect.arrayContaining([
            '-sunflower seeds, radish, whole grain toast* D,G 26',
            '-Freshly Pressed Specialty Juice 10',
        ]));
    });

    test('falls back to the AI draft when there is no readable submitted DOCX', async () => {
        const missing = await loadComparisonSource({ aiDraftPath: '/d/x-draft.docx', originalPath: '/d/x.docx' }, extractors({ fileExists: () => false }));
        expect(missing.stage).toBe(LEARNING_SOURCE_STAGE);

        const failing = await loadComparisonSource({ aiDraftPath: '/d/x-draft.docx', originalPath: '/d/x.docx' }, extractors({
            extractEditorBaselineText: async () => { throw new Error('corrupt docx'); },
        }));
        expect(failing).toEqual({ text: AI_DRAFT, stage: LEARNING_SOURCE_STAGE, path: '/d/x-draft.docx' });

        const none = await loadComparisonSource({ aiDraftPath: '/d/x-draft.docx' }, extractors());
        expect(none.stage).toBe(LEARNING_SOURCE_STAGE);
    });

    test('re-reads a frozen comparison from the stage it was frozen with', async () => {
        const ex = extractors();
        const legacy = await loadComparisonSource({ aiDraftPath: '/d/x-draft.docx', originalPath: '/d/x.docx', sourceStage: LEARNING_SOURCE_STAGE }, ex);
        expect(legacy.text).toBe(AI_DRAFT);
        expect(ex.extractEditorBaselineText).not.toHaveBeenCalled();

        const baseline = await loadComparisonSource({ aiDraftPath: '/d/x-draft.docx', sourceStage: LEARNING_EDITOR_BASELINE_STAGE, sourcePath: '/d/x.docx' }, ex);
        expect(baseline).toEqual({ text: EDITOR_BASELINE, stage: LEARNING_EDITOR_BASELINE_STAGE, path: '/d/x.docx' });

        await expect(loadComparisonSource({ aiDraftPath: '/d/x-draft.docx', sourceStage: LEARNING_EDITOR_BASELINE_STAGE }, ex))
            .rejects.toThrow('no source path');
    });

    test('the source stage is part of the comparison revision', () => {
        const hash = sha256Text(EDITOR_BASELINE);
        expect(comparisonRevision('s', 'a', hash, FINAL)).toBe(comparisonRevision('s', 'a', hash, FINAL, LEARNING_SOURCE_STAGE));
        expect(comparisonRevision('s', 'a', hash, FINAL, LEARNING_EDITOR_BASELINE_STAGE)).not.toBe(comparisonRevision('s', 'a', hash, FINAL));
    });
});
