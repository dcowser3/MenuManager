import crypto from 'crypto';

export const LEARNING_SOURCE_EXTRACTION_VERSION = 'differ-source-extraction-v1';
export const LEARNING_SOURCE_STAGE = 'differ_ai_draft_v1';
// The text the reviewer actually started editing from: the submitted DOCX with
// its tracked changes accepted, exactly as the approval editor loads it.
export const LEARNING_EDITOR_BASELINE_STAGE = 'differ_editor_baseline_v1';
export const LEARNING_COORDINATE_BASIS = 'utf16_line_span_v1';

export function sha256Text(value: string): string {
    return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

export function comparisonRevision(
    submissionId: string,
    sourceAttemptId: string,
    sourceSnapshotSha256: string,
    finalText: string,
    sourceStage: string = LEARNING_SOURCE_STAGE,
): string {
    return `comparison-${sha256Text(JSON.stringify({
        submission_id: submissionId,
        source_attempt_id: sourceAttemptId,
        source_stage: sourceStage,
        source_snapshot_sha256: sourceSnapshotSha256,
        final_snapshot_sha256: sha256Text(finalText),
        extraction_version: LEARNING_SOURCE_EXTRACTION_VERSION,
    }))}`;
}
