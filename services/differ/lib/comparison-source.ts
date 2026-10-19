import { LEARNING_EDITOR_BASELINE_STAGE, LEARNING_SOURCE_STAGE } from './learning-source-revision';

export type ComparisonSource = {
    text: string;
    stage: string;
    path: string;
};

type ComparisonSourceInput = {
    aiDraftPath: string;
    originalPath?: string;
    // When re-reading a frozen comparison, the stage it was frozen with.
    sourceStage?: string;
    sourcePath?: string;
};

type ComparisonSourceExtractors = {
    extractAiDraftText: (filePath: string) => Promise<string>;
    extractEditorBaselineText: (filePath: string) => Promise<string>;
    fileExists: (filePath: string) => boolean;
};

/**
 * Learning explanations must list only what the human reviewer changed. The
 * reviewer edits the submitted DOCX (chef's choices + tracked changes), not the
 * AI's raw draft, so diffing the AI draft against the final attributed every
 * AI suggestion the chef declined (raw markers, spelling fixes) to the reviewer
 * and misaligned the rows around them. Prefer the editor's starting text; fall
 * back to the AI draft only when no submitted DOCX can be read.
 */
export async function loadComparisonSource(
    input: ComparisonSourceInput,
    extractors: ComparisonSourceExtractors,
): Promise<ComparisonSource> {
    if (input.sourceStage) {
        if (input.sourceStage === LEARNING_EDITOR_BASELINE_STAGE) {
            const sourcePath = `${input.sourcePath || ''}`.trim();
            if (!sourcePath) throw new Error('Frozen editor-baseline comparison has no source path.');
            return { text: await extractors.extractEditorBaselineText(sourcePath), stage: LEARNING_EDITOR_BASELINE_STAGE, path: sourcePath };
        }
        return { text: await extractors.extractAiDraftText(input.aiDraftPath), stage: LEARNING_SOURCE_STAGE, path: input.aiDraftPath };
    }

    const originalPath = `${input.originalPath || ''}`.trim();
    if (originalPath.toLowerCase().endsWith('.docx') && extractors.fileExists(originalPath)) {
        try {
            const text = await extractors.extractEditorBaselineText(originalPath);
            if (text.trim()) return { text, stage: LEARNING_EDITOR_BASELINE_STAGE, path: originalPath };
        } catch (error: any) {
            console.warn(`Editor baseline extraction failed for ${originalPath}; comparing against the AI draft: ${error?.message || error}`);
        }
    }
    return { text: await extractors.extractAiDraftText(input.aiDraftPath), stage: LEARNING_SOURCE_STAGE, path: input.aiDraftPath };
}
